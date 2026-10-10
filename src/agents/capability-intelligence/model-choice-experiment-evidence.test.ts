import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeBenchmarkRealToolMappings } from "./benchmark-real-tool-mapping.js";
import {
  appendV1IObservation,
  assertNoDuplicateValidCells,
  canonicalizeV1IValue,
  createV1IArtifactState,
  expectedCellsForV1IMode,
  finalizeV1IArtifact,
  hashV1ICanonical,
  missingV1ICells,
  resolveV1IMode,
  requiredV1ICells,
  splitV1IExperimentSets,
  summarizeV1IObservations,
  type V1IManifest,
  type V1IObservation,
} from "./model-choice-experiment-evidence.js";
import { TOOL_RANKING_HELD_OUT_CASES } from "./tool-ranking-benchmark-cases.js";

describe("v1I evidence protocol", () => {
  it("hashes structured provenance canonically and rejects non-JSON values", () => {
    expect(hashV1ICanonical({ b: 2, a: { y: false, x: ["one", null] } })).toBe(
      hashV1ICanonical({ a: { x: ["one", null], y: false }, b: 2 }),
    );
    expect(hashV1ICanonical(["one", "two"])).not.toBe(hashV1ICanonical(["two", "one"]));
    expect(canonicalizeV1IValue({ nested: [{ value: 1 }, { value: true }] })).toBe(
      '{"nested":[{"value":1},{"value":true}]}',
    );
    expect(hashV1ICanonical("stable")).toBe(hashV1ICanonical("stable"));
    expect(hashV1ICanonical(null)).toBe(hashV1ICanonical(null));
    expect(() => hashV1ICanonical(undefined)).toThrow("unsupported v1I hash value");
    expect(() => hashV1ICanonical(new Date(0))).toThrow("unsupported v1I hash value");
  });

  it("splits the frozen corpus into 17 synthetic, 8 exact, 3 adapter, and 6 unsupported cases", () => {
    const summary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
    const sets = splitV1IExperimentSets(TOOL_RANKING_HELD_OUT_CASES, summary);
    expect(sets.synthetic).toHaveLength(17);
    expect(sets.realExact).toHaveLength(8);
    expect(sets.realAdapter).toHaveLength(3);
    expect(sets.unsupported).toHaveLength(6);
    expect(sets.realExact.length + sets.realAdapter.length + sets.unsupported.length).toBe(17);
    const eligibility = new Map(summary.cases.map((entry) => [entry.caseId, entry.mappingClass]));
    expect(sets.realExact.every((entry) => eligibility.get(entry.id) === "EXACT")).toBe(true);
    expect(sets.realAdapter.every((entry) => eligibility.get(entry.id) === "ADAPTER")).toBe(true);
    expect(sets.unsupported.every((entry) => eligibility.get(entry.id) === "UNSUPPORTED")).toBe(
      true,
    );
    expect(expectedCellsForV1IMode("synthetic")).toBe(102);
    expect(expectedCellsForV1IMode("real-exact")).toBe(48);
    expect(expectedCellsForV1IMode("real-adapter")).toBe(18);
    const required = requiredV1ICells("real-exact", sets.realExact);
    expect(required).toHaveLength(48);
    expect(
      missingV1ICells(
        "real-exact",
        sets.realExact,
        new Set([
          `${required[0]!.surfaceMode}:${required[0]!.caseId}:${required[0]!.arm}:${required[0]!.replicate}`,
        ]),
      ),
    ).toHaveLength(47);
  });

  it("requires the master gate and an explicit valid mode before inference", () => {
    expect(resolveV1IMode(false, undefined)).toBeNull();
    expect(() => resolveV1IMode(true, undefined)).toThrow("OPENCLAW_V1I_MODE");
    expect(() => resolveV1IMode(true, "all")).toThrow("OPENCLAW_V1I_MODE");
    expect(resolveV1IMode(true, "synthetic")).toBe("synthetic");
    expect(resolveV1IMode(true, "real-exact")).toBe("real-exact");
    expect(resolveV1IMode(true, "real-adapter")).toBe("real-adapter");
  });

  it("serializes valid and invalid attempts and resumes compatible evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-evidence-test-"));
    try {
      const manifest = makeManifest();
      createV1IArtifactState(root, manifest, "synthetic");
      const valid = makeObservation({ valid: true, invalidReason: null });
      const invalid = makeObservation({ valid: false, invalidReason: "SCHEMA_DRIFT", attempt: 2 });
      appendV1IObservation(root, "synthetic", valid);
      appendV1IObservation(root, "synthetic", invalid);
      const resumed = createV1IArtifactState(root, manifest, "synthetic");
      expect(resumed.observations).toHaveLength(1);
      expect(resumed.invalidAttempts).toHaveLength(1);
      const summary = summarizeV1IObservations(
        resumed.observations,
        resumed.invalidAttempts,
        1,
        "synthetic",
      );
      expect(
        summarizeV1IObservations(resumed.observations, resumed.invalidAttempts, 2, "synthetic")
          .status,
      ).toBe("PARTIAL");
      finalizeV1IArtifact(root, "synthetic", resumed, summary);
      expect(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))).toMatchObject({
        activeFilteringEnabled: false,
      });
      expect(fs.readFileSync(path.join(root, "synthetic-invalid.jsonl"), "utf8")).toContain(
        "SCHEMA_DRIFT",
      );
      expect(fs.readFileSync(path.join(root, "synthetic-summary.json"), "utf8")).toContain(
        '"status": "COMPLETE"',
      );
      expect(() =>
        createV1IArtifactState(root, { ...manifest, modelConfigHash: "different" }, "synthetic"),
      ).toThrow("incompatible v1I manifest");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resumes a compatible manifest when the process crashed before JSONL output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1i-manifest-only-test-"));
    try {
      const manifest = makeManifest();
      const resumed = createV1IArtifactState(root, manifest, "synthetic");
      expect(resumed.observations).toHaveLength(0);
      expect(resumed.invalidAttempts).toHaveLength(0);
      expect(missingV1ICells("synthetic", TOOL_RANKING_HELD_OUT_CASES, new Set())).toHaveLength(
        102,
      );
      expect(fs.existsSync(path.join(root, "manifest.json"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate valid cells and computes case-level paired analysis", () => {
    const observations = [
      makeObservation({ caseId: "case-a", arm: "A", v1cTop8: [] }),
      makeObservation({ caseId: "case-a", arm: "B" }),
      makeObservation({
        caseId: "case-b",
        arm: "A",
        firstExecutedTool: null,
        executedToolSequence: [],
      }),
      makeObservation({
        caseId: "case-b",
        arm: "B",
        firstExecutedTool: null,
        executedToolSequence: [],
      }),
    ];
    const summary = summarizeV1IObservations(observations, [], 4, "synthetic");
    expect(summary.status).toBe("COMPLETE");
    expect(summary.pairedCaseCount).toBe(2);
    expect(summary.meanPairedDeltaPercentagePoints).toBe(50);
    expect(summary.noToolRunsIncludedInModalAgreement).toBe(1);
    expect(() => assertNoDuplicateValidCells([observations[0]!, observations[0]!])).toThrow(
      "duplicate valid v1I cell",
    );
  });

  it("does not classify incomplete synthetic strata", () => {
    const required = requiredV1ICells("synthetic", TOOL_RANKING_HELD_OUT_CASES);
    const observations = required.map((cell) =>
      makeObservation({
        surfaceMode: cell.surfaceMode,
        caseId: cell.caseId,
        arm: cell.arm,
        replicate: cell.replicate,
      }),
    );
    for (const count of [0, 1, 101]) {
      const summary = summarizeV1IObservations(
        observations.slice(0, count),
        [],
        102,
        "synthetic",
        undefined,
        required,
      );
      expect(summary.status).toBe("PARTIAL");
      expect(summary.result).toBe("NOT_CLASSIFIED");
    }
    const complete = summarizeV1IObservations(
      observations,
      [],
      102,
      "synthetic",
      undefined,
      required,
    );
    expect(complete.status).toBe("COMPLETE");
    expect(complete.result).not.toBe("NOT_CLASSIFIED");
    expect(complete.pairedCaseCount).toBe(17);
  });
});

function makeManifest(): V1IManifest {
  return {
    schemaVersion: 1,
    experimentVersion: "v1I",
    harnessCommit: "test",
    branch: "test",
    modelId: "model",
    provider: "provider",
    contextLength: 1,
    modelConfig: {},
    modelConfigHash: "model-config",
    rankerVersion: "ranker",
    qualificationPolicyVersion: "policy",
    scheduleSeed: 1,
    caseSetHash: "cases",
    syntheticCaseSetHash: "synthetic-cases",
    realExactCaseSetHash: "exact-cases",
    realAdapterCaseSetHash: "adapter-cases",
    syntheticSurfaceHash: "synthetic-surface",
    realExactSurfaceHash: "exact-surface",
    realAdapterSurfaceHash: "adapter-surface",
    schemaHash: "schema",
    systemPromptHash: "system",
    experimentalInstructionHash: "instruction",
    startedAt: "start",
    completedAt: null,
    activeFilteringEnabled: false,
  };
}

function makeObservation(overrides: Partial<V1IObservation> = {}): V1IObservation {
  return {
    schemaVersion: 1,
    experimentVersion: "v1I",
    harnessCommit: "test",
    surfaceMode: "SYNTHETIC",
    caseId: "case-a",
    arm: "A",
    replicate: 1,
    attempt: 1,
    scheduleSeed: 1,
    modelId: "model",
    provider: "provider",
    contextLength: 1,
    modelConfigHash: "model-config",
    systemPromptHash: "system",
    userPromptHash: "user",
    experimentalInstructionHash: "instruction",
    authorizedSurfaceHash: "surface",
    schemaHash: "schema",
    caseSetHash: "cases",
    rankerVersion: "ranker",
    qualificationPolicyVersion: "policy",
    rankingEpoch: "epoch",
    benchmarkPreferredTool: "purpose",
    mappedRealTool: "purpose",
    mappingClassification: "SYNTHETIC",
    v1cTop8: ["purpose"],
    selectedTools: ["purpose"],
    firstExecutedTool: "purpose",
    executedToolSequence: ["purpose"],
    terminalSuccess: true,
    terminalFailureReason: null,
    preferredToolAuthorized: true,
    preferredToolInTop8: true,
    preferredToolAttempted: true,
    substituteTool: null,
    substitutionWithoutPreferredAttempt: false,
    fallbackAfterPreferredFailure: false,
    valid: true,
    invalidReason: null,
    startTime: "start",
    endTime: "end",
    ...overrides,
  };
}
