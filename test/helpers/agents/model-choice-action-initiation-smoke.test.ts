import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createV1JArmCOnlyPreflightDiagnosticJournal,
  resolveV1JSmokeRoot,
  runV1JArmCPreflightOnly,
  V1J_FORMAL_ARTIFACT_RELATIVE_PATH,
} from "./model-choice-action-initiation-smoke.js";

describe("v1J Arm C preflight-only diagnostic", () => {
  it("terminates after successful Arm C preflight without touching formal or smoke artifacts", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-arm-c-only-path-test-"));
    const head = "9".repeat(40);
    const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
    const smokeRoot = resolveV1JSmokeRoot(repoRoot, head);
    fs.mkdirSync(formalRoot, { recursive: true });
    fs.mkdirSync(smokeRoot, { recursive: true });
    const formalSentinel = path.join(formalRoot, "preserve-sentinel");
    const smokeSentinel = path.join(smokeRoot, "preserve-sentinel");
    fs.writeFileSync(formalSentinel, "formal-state-preserved\n");
    fs.writeFileSync(smokeSentinel, "smoke-state-preserved\n");
    const journal = createV1JArmCOnlyPreflightDiagnosticJournal({
      repoRoot,
      harnessCommit: head,
      caseId: "offline-arm-c-case",
      preflightId: "offline-arm-c-success",
      pid: process.pid,
      startedAtMs: Date.now(),
    });
    let capturedArm = 0;
    try {
      const result = await runV1JArmCPreflightOnly({
        journal,
        captureArmC: async () => {
          capturedArm += 1;
          return { arm: "C", complete: true };
        },
      });
      expect(result).toEqual({ arm: "C", complete: true });
      expect(capturedArm).toBe(1);
      expect(journal.arm).toBe("C");
      expect(path.dirname(journal.filePath)).toBe(
        path.join(
          repoRoot,
          "artifacts/capability-intelligence/v1j-action-initiation",
          `arm-c-preflight-diagnostic-${head}`,
        ),
      );
    } finally {
      journal.close();
    }
    try {
      const rows = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows.map((row) => row.event)).toEqual([
        "arm-c-preflight-start",
        "arm-c-only-preflight-start",
        "arm-c-only-preflight-terminated",
      ]);
      expect(rows.at(-1)).toMatchObject({
        outcome: "complete",
        entrypointGuards: {
          armAPreflightReached: false,
          smokeScheduleReached: false,
          formalArtifactTouched: false,
          normalSmokeArtifactTouched: false,
        },
      });
      expect(fs.readFileSync(formalSentinel, "utf8")).toBe("formal-state-preserved\n");
      expect(fs.readFileSync(smokeSentinel, "utf8")).toBe("smoke-state-preserved\n");
      expect(fs.readdirSync(formalRoot)).toEqual(["preserve-sentinel"]);
      expect(fs.readdirSync(smokeRoot)).toEqual(["preserve-sentinel"]);
      expect(fs.readdirSync(path.dirname(journal.filePath))).toEqual(["arm-c-preflight.jsonl"]);
      expect(() =>
        createV1JArmCOnlyPreflightDiagnosticJournal({
          repoRoot,
          harnessCommit: head,
          caseId: "offline-arm-c-case",
          preflightId: "offline-arm-c-duplicate",
          pid: process.pid,
        }),
      ).toThrow();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
