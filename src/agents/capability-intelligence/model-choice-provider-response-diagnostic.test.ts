import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createV1JProviderResponseDiagnosticJournal,
  isV1JCleanupFailureSecondary,
  observeV1JAdapterResponse,
  resolveV1JProviderResponseDiagnosticRoot,
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH,
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX,
} from "../../../test/helpers/agents/model-choice-provider-response-diagnostic.js";

describe("v1J provider-response diagnostic artifacts", () => {
  it("writes commit-bound diagnostics outside smoke/formal state and redacts payload fields", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-response-diagnostic-"));
    const commit = "a".repeat(40);
    try {
      const journal = createV1JProviderResponseDiagnosticJournal({
        repoRoot,
        harnessCommit: commit,
        modelId: "test-model",
        modelConfigHash: "b".repeat(64),
        schemaFingerprint: {
          authorizedToolCount: 15,
          providerToolCount: 15,
          authorizedToolNameSha256: "c".repeat(64),
          providerToolNameSha256: "c".repeat(64),
          authorizedToolSchemaSha256: "d".repeat(64),
          providerToolSchemaSha256: "e".repeat(64),
        },
        startedAt: "2026-10-13T00:00:00.000Z",
      });
      journal.record("http-response-headers", {
        requestId: "safe-correlation-id",
        httpStatus: 503,
        contentType: "application/json",
        prompt: "must-not-persist",
        responseBody: "must-not-persist",
        apiKey: "must-not-persist",
      });
      journal.close();

      const root = resolveV1JProviderResponseDiagnosticRoot(repoRoot, commit);
      const row = JSON.parse(
        fs.readFileSync(journal.filePath, "utf8").trim().split("\n").at(-1)!,
      ) as Record<string, unknown>;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(root).toContain(`${V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX}${commit}`);
      expect(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH)).not.toBe(root);
      expect(row).toMatchObject({ event: "http-response-headers", httpStatus: 503 });
      expect(row).not.toHaveProperty("prompt");
      expect(row).not.toHaveProperty("responseBody");
      expect(row).not.toHaveProperty("apiKey");
      expect(manifest).toMatchObject({
        harnessCommit: commit,
        cellId: "smoke-tool-required:A:1",
        activeFilteringEnabled: false,
        formalStateTouched: false,
        smokeStateTouched: false,
        promptContentPersisted: false,
        credentialsPersisted: false,
      });
      expect(
        fs.existsSync(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH)),
      ).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses existing formal state and makes cleanup secondary only after durable complete evidence", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-diagnostic-formal-"));
    const commit = "b".repeat(40);
    try {
      fs.mkdirSync(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH), {
        recursive: true,
      });
      expect(() =>
        createV1JProviderResponseDiagnosticJournal({
          repoRoot,
          harnessCommit: commit,
          modelId: "test-model",
          modelConfigHash: "c".repeat(64),
          schemaFingerprint: {
            authorizedToolCount: 15,
            providerToolCount: 15,
            authorizedToolNameSha256: "d".repeat(64),
            providerToolNameSha256: "d".repeat(64),
            authorizedToolSchemaSha256: "e".repeat(64),
            providerToolSchemaSha256: "f".repeat(64),
          },
          startedAt: "2026-10-13T00:00:00.000Z",
        }),
      ).toThrow(/existing formal state/);
      expect(fs.existsSync(resolveV1JProviderResponseDiagnosticRoot(repoRoot, commit))).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: true,
        terminalEvidencePersisted: true,
      }),
    ).toBe(true);
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: false,
        terminalEvidencePersisted: true,
      }),
    ).toBe(false);
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: true,
        terminalEvidencePersisted: false,
      }),
    ).toBe(false);
  });

  it("distinguishes adapter rejection from a received provider response and preserves the error", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-adapter-error-"));
    const journal = createV1JProviderResponseDiagnosticJournal({
      repoRoot,
      harnessCommit: "f".repeat(40),
      modelId: "test-model",
      modelConfigHash: "a".repeat(64),
      schemaFingerprint: {
        authorizedToolCount: 15,
        providerToolCount: 15,
        authorizedToolNameSha256: "b".repeat(64),
        providerToolNameSha256: "b".repeat(64),
        authorizedToolSchemaSha256: "c".repeat(64),
        providerToolSchemaSha256: "d".repeat(64),
      },
      startedAt: "2026-10-13T00:00:00.000Z",
    });
    const providerError = Object.assign(new Error("private provider error"), {
      code: "PROVIDER_REJECTED",
    });
    try {
      journal.record("provider-response-observed", {
        providerResponseObserved: true,
        httpStatus: 400,
      });
      await expect(
        observeV1JAdapterResponse({
          journal,
          requestIndex: 1,
          observe: () => {
            throw providerError;
          },
        }),
      ).rejects.toBe(providerError);
      journal.close();
      const rows = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows.find((row) => row.event === "provider-response-observed")).toMatchObject({
        providerResponseObserved: true,
        httpStatus: 400,
      });
      expect(rows.find((row) => row.event === "adapter-response-failed")).toMatchObject({
        errorClass: "Error",
        errorCode: "PROVIDER_REJECTED",
      });
      expect(JSON.stringify(rows)).not.toContain("private provider error");
    } finally {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
