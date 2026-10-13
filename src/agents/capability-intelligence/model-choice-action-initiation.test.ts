import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendV1JSmokeRecord,
  assertV1JFormalStateEmpty,
  assertV1JSmokeProvenance,
  assertV1JSmokeWritePath,
  buildV1JSmokeSchedule,
  createV1JSmokeArtifactState,
  finalizeV1JSmokeArtifacts,
  resolveV1JSmokeRoot,
  V1J_FORMAL_ARTIFACT_RELATIVE_PATH,
  type V1JSmokeRecord,
} from "../../../test/helpers/agents/model-choice-action-initiation-smoke.js";
import {
  appendV1JInvalidAttempt,
  appendV1JObservation,
  assertV1JRuntimeGate,
  assertV1JSchemaBaseline,
  buildV1JSchedule,
  createV1JManifest,
  fingerprintV1JToolSurface,
  loadV1JPreregistration,
  openV1JArtifactState,
  readV1JPreregistration,
  runV1JCellBatch,
  selectMissingV1JCells,
  sha256,
  summarizeV1JObservations,
  v1jInstructionForArm,
  v1jNextAttempt,
  V1JSerializationFailureError,
  V1J_PREREGISTRATION_SHA256,
  type V1JCell,
  type V1JObservation,
  type V1JProtocol,
} from "../../../test/helpers/agents/model-choice-action-initiation.js";
import { getBenchmarkRealToolMapping } from "./benchmark-real-tool-mapping.js";
import { TOOL_RANKING_HELD_OUT_CASES } from "./tool-ranking-benchmark-cases.js";

const preregistrationPath = path.resolve(
  "artifacts/capability-intelligence/v1j-action-initiation/preregistration-v2.json",
);

function loadProtocol(): V1JProtocol {
  const expectedRuntimeNames = [
    "apply_patch",
    "edit",
    "exec",
    "memory_get",
    "memory_search",
    "message",
    "process",
    "read",
    "sessions_history",
    "sessions_list",
    "sessions_search",
    "sessions_spawn",
    "web_fetch",
    "web_search",
    "write",
  ];
  const cases = [
    ...Array.from({ length: 8 }, (_, index) => ({
      caseId: index === 0 ? "file-write-notes" : `required-${index}`,
      stratum: "TOOL_REQUIRED" as const,
      prompt: `required prompt ${index}`,
      expectedAction: "at_least_one_authorized_tool_attempt" as const,
      requiredTools: ["write"],
      preferredTool: "write",
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      caseId: index === 0 ? "control-summarize" : `control-${index}`,
      stratum: "NO_TOOL_CONTROL" as const,
      prompt: `self-contained control ${index}`,
      expectedAction: "no_tool_attempt" as const,
      requiredTools: [] as string[],
      preferredTool: null,
    })),
  ];
  const schemaBaseline = {
    authorizedToolCount: 15,
    providerToolCount: 15,
    authorizedToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
    providerToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
    authorizedToolSchemaSha256: "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128",
    providerToolSchemaSha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
  };
  const protocol = {
    version: 2,
    experimentId: "v1J-ACTION-INITIATION",
    base: {
      head: "a6c1188899aaf365b627472f91a7627e1e87d42a",
      productionFrozen: { rankerVersion: "v1C", topK: 8, activeFilteringEnabled: false },
    },
    model: {
      id: "qwen/qwen3.5-9b",
      provider: "lmstudio",
      contextLength: 262_144,
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      modelConfig: {},
    },
    arms: {
      A: { name: "production-baseline", experimentalInstruction: "" },
      C: {
        name: "action-initiation-instruction",
        experimentalInstruction:
          "## Tool use\n\nWhen a task depends on reading, retrieving, searching, changing, or acting on information or state outside the current conversation, use an appropriate authorized tool rather than answering from assumption or merely describing what could be done.\n\nIf the task can be fully answered from the conversation itself and does not require external state or an external action, do not call a tool.\n\nWhen a tool is required, prefer the appropriate available tool and preserve normal authorization and failure handling.",
      },
    },
    design: {
      toolRequiredCases: 8,
      noToolControlCases: 8,
      arms: ["A", "C"] as const,
      repetitionsPerCasePerArm: 3,
      expectedValidCells: 96,
      cells: cases,
    },
    schedule: { seed: 106_993, noOutcomeBasedReordering: true },
    surfaceAndRuntime: { schemaIntegrityGate: schemaBaseline },
    schemaBaseline: { ...schemaBaseline, expectedRuntimeNames },
    metrics: {},
    primarySuccessCriteria: {
      toolRequiredPairedMeanImprovementPPAtLeast: 10,
      toolRequiredPairedCiLowerBoundGreaterThanPP: 0,
      noToolControlUnnecessaryToolRateIncreaseAtMostPP: 5,
      noToolControlArmCUnnecessaryToolRateAtMostPct: 10,
      overtriggeringHardFailIfArmCUnnecessaryToolRateGreaterThanPct: 10,
      overtriggeringHardFailIfControlIncreaseGreaterThanPP: 5,
    },
    classification: {},
    integrityGates: {},
    retryRules: { retryOnly: [], neverRetryScientificOutcomes: [] },
    serializationFailurePolicy: {
      automaticRetryCount: 0,
      hardStop: "Any evidence serialization failure.",
    },
    authorizationGate: { liveExecutionAuthorized: false },
  } as unknown as V1JProtocol;
  const serialized = JSON.stringify(protocol);
  return loadV1JPreregistration(serialized, sha256(serialized));
}

function observation(
  protocol: V1JProtocol,
  cell: V1JCell,
  input: {
    attempted?: boolean;
    valid?: boolean;
    invalidClass?: V1JObservation["invalidClass"];
  } = {},
): V1JObservation {
  const attempted = input.attempted ?? false;
  const toolName = cell.stratum === "TOOL_REQUIRED" ? (cell.requiredTools[0] ?? "write") : "exec";
  const toolCallId = `${cell.cellId}-call`;
  const tools = protocol.surfaceAndRuntime.schemaIntegrityGate;
  return {
    cellId: cell.cellId,
    caseId: cell.caseId,
    stratum: cell.stratum,
    arm: cell.arm,
    replicate: cell.replicate,
    attempt: 1,
    harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
    modelId: protocol.model.id,
    provider: protocol.model.provider,
    contextLength: protocol.model.contextLength,
    modelConfigHash: protocol.model.modelConfigHash,
    rankerVersion: protocol.base.productionFrozen.rankerVersion,
    topK: protocol.base.productionFrozen.topK,
    activeFilteringEnabled: false,
    modelRequestsSent: 1,
    providerResponseObserved: true,
    experimentalInstructionHash: sha256(v1jInstructionForArm(protocol, cell.arm)),
    authorizedToolNameSha256: tools.authorizedToolNameSha256,
    providerToolNameSha256: tools.providerToolNameSha256,
    authorizedToolSchemaSha256: tools.authorizedToolSchemaSha256,
    providerToolSchemaSha256: tools.providerToolSchemaSha256,
    authorizedToolNames: toolsNames(protocol),
    v1cTop8: cell.stratum === "TOOL_REQUIRED" ? [cell.requiredTools[0] ?? "write"] : [],
    firstExecutedTool: attempted ? toolName : null,
    executedToolSequence: attempted ? [toolName] : [],
    terminalSuccess: true,
    rankingEpoch: "epoch-1",
    terminalEvidenceComplete: true,
    correlationStatus: "PROVABLE",
    toolCalls: attempted ? [{ toolCallId, toolName, modelTurnIndex: 0 }] : [],
    executions: attempted
      ? [{ executionId: `${cell.cellId}-execution`, toolCallId, toolName, success: true }]
      : [],
    substituteTool: attempted && toolName !== cell.preferredTool ? toolName : null,
    fallbackAfterPreferredFailure: false,
    semanticSubstitution: false,
    valid: input.valid ?? true,
    invalidReason: input.valid === false ? "INFRASTRUCTURE_FAILURE" : null,
    ...(input.invalidClass ? { invalidClass: input.invalidClass } : {}),
  };
}

function toolsNames(protocol: V1JProtocol): string[] {
  return [...protocol.schemaBaseline.expectedRuntimeNames];
}

describe("v1J action-initiation protocol and offline harness", () => {
  it("loads the exact accepted preregistration bytes and rejects any byte drift", () => {
    expect(V1J_PREREGISTRATION_SHA256).toBe(
      "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
    );
    const protocol = loadProtocol();
    expect(protocol.experimentId).toBe("v1J-ACTION-INITIATION");
    expect(protocol.design.expectedValidCells).toBe(96);
    if (fs.existsSync(preregistrationPath)) {
      const bytes = fs.readFileSync(preregistrationPath, "utf8");
      expect(readV1JPreregistration().experimentId).toBe(protocol.experimentId);
      expect(() => loadV1JPreregistration(`${bytes} `)).toThrow("SHA-256 mismatch");
    }
  });

  it("builds the frozen unique schedule in deterministic case/replicate/arm order", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    expect(schedule).toHaveLength(96);
    expect(new Set(schedule.map((cell) => cell.cellId)).size).toBe(96);
    expect(schedule.filter((cell) => cell.stratum === "TOOL_REQUIRED")).toHaveLength(48);
    expect(schedule.filter((cell) => cell.stratum === "NO_TOOL_CONTROL")).toHaveLength(48);
    expect(schedule.filter((cell) => cell.arm === "A")).toHaveLength(48);
    expect(schedule.filter((cell) => cell.arm === "C")).toHaveLength(48);
    expect(buildV1JSchedule(protocol)).toEqual(schedule);
    for (const entry of protocol.design.cells) {
      expect(schedule.filter((cell) => cell.caseId === entry.caseId)).toHaveLength(6);
    }
  });

  it("keeps Arm A instruction empty and uses the exact preregistered Arm C bytes", () => {
    const protocol = loadProtocol();
    expect(v1jInstructionForArm(protocol, "A")).toBe("");
    expect(v1jInstructionForArm(protocol, "C")).toBe(protocol.arms.C.experimentalInstruction);
    expect(sha256(v1jInstructionForArm(protocol, "A"))).not.toBe(
      sha256(v1jInstructionForArm(protocol, "C")),
    );
  });

  it("binds every required v1J case to the frozen REAL_EXACT benchmark mapping", () => {
    const frozen = [
      [
        "file-write-notes",
        "Create a new markdown file and put the meeting notes in it",
        ["write"],
        "write",
      ],
      [
        "read-then-edit",
        "Read the config file and edit the port setting",
        ["read", "edit"],
        "read",
      ],
      [
        "stop-process",
        "Check the background command I started and stop it if it is still running",
        ["process"],
        "process",
      ],
      [
        "spawn-worker",
        "Start another agent session to handle this task in parallel",
        ["sessions_spawn"],
        "sessions_spawn",
      ],
      [
        "session-history",
        "Read the transcript of yesterday's agent conversation",
        ["sessions_history"],
        "sessions_history",
      ],
      [
        "read-memory",
        "Open the saved memory entry about the release checklist",
        ["memory_get"],
        "memory_get",
      ],
      [
        "research-then-remember",
        "Research the current docs for this API and save a note about the decision",
        ["web_search", "memory_search"],
        "web_search",
      ],
      [
        "fetch-and-read",
        "Download the page at this URL and read the local copy of the spec next to it",
        ["web_fetch", "read"],
        "web_fetch",
      ],
    ] as const;
    for (const [caseId, prompt, requiredTools, preferredTool] of frozen) {
      const benchmark = TOOL_RANKING_HELD_OUT_CASES.find((candidate) => candidate.id === caseId);
      expect(benchmark?.query).toBe(prompt);
      const mapped = benchmark?.expectedTopTools.map(
        (name) => getBenchmarkRealToolMapping(name).realTool,
      );
      expect(mapped).toEqual(requiredTools);
      expect(mapped?.[0]).toBe(preferredTool);
    }
  });

  it("fingerprints the whole surface independent of tool order and object-key order", () => {
    const authorized = [
      { name: "write", parameters: { type: "object", properties: { path: { type: "string" } } } },
      { name: "read", parameters: { type: "object", required: ["path"] } },
    ];
    const provider = [
      { function: { parameters: { required: ["path"], type: "object" }, name: "read" } },
      {
        function: {
          name: "write",
          parameters: { properties: { path: { type: "string" } }, type: "object" },
        },
      },
    ];
    const first = fingerprintV1JToolSurface({
      authorizedTools: authorized,
      providerTools: provider,
    });
    const reordered = fingerprintV1JToolSurface({
      authorizedTools: [
        { parameters: { properties: { path: { type: "string" } }, type: "object" }, name: "write" },
        { parameters: { required: ["path"], type: "object" }, name: "read" },
      ],
      providerTools: provider.toReversed(),
    });
    expect(reordered).toEqual(first);
    expect(first.authorizedToolCount).toBe(2);
    expect(first.providerToolCount).toBe(2);
    const expected = { ...first };
    assertV1JSchemaBaseline(expected, first);
    expect(() => assertV1JSchemaBaseline({ ...expected, providerToolCount: 15 }, first)).toThrow(
      "providerToolCount",
    );
  });

  it("enforces the exact pre-run model, ranker, filtering, and canonical surface gate", () => {
    const protocol = loadProtocol();
    const actual = {
      modelId: protocol.model.id,
      provider: protocol.model.provider,
      contextLength: protocol.model.contextLength,
      modelConfigHash: protocol.model.modelConfigHash,
      rankerVersion: protocol.base.productionFrozen.rankerVersion,
      topK: protocol.base.productionFrozen.topK,
      activeFilteringEnabled: false,
      surface: protocol.schemaBaseline,
    };
    expect(() => assertV1JRuntimeGate(protocol, actual)).not.toThrow();
    expect(() =>
      assertV1JRuntimeGate(protocol, { ...actual, activeFilteringEnabled: true }),
    ).toThrow("configuration drift");
    expect(() =>
      assertV1JRuntimeGate(protocol, {
        ...actual,
        surface: { ...actual.surface, providerToolSchemaSha256: "0".repeat(64) },
      }),
    ).toThrow("providerToolSchemaSha256");
  });

  it("builds a source-bound manifest without changing the frozen preregistration", () => {
    const protocol = loadProtocol();
    const manifest = createV1JManifest({
      protocol,
      harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
      modelConfigHash: protocol.model.modelConfigHash,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(manifest).toMatchObject({
      preregistrationSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
      baseCommit: protocol.base.head,
      harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
      activeFilteringEnabled: false,
      expectedValidCells: 96,
    });
    expect(() =>
      createV1JManifest({
        protocol,
        harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
        modelConfigHash: "0".repeat(64),
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow("model config hash");
  });

  it("selects only missing cells, preserves invalid history, and rejects unsafe selectors", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const complete = observation(protocol, schedule[0]!);
    const pending = selectMissingV1JCells(schedule, [complete]);
    expect(pending).toHaveLength(95);
    expect(pending[0]?.cellId).toBe(schedule[1]?.cellId);
    expect(selectMissingV1JCells(schedule, [complete], [schedule[1]!.cellId], 1)).toEqual([
      schedule[1],
    ]);
    expect(() => selectMissingV1JCells(schedule, [complete], [complete.cellId])).toThrow(
      "already valid",
    );
    expect(() => selectMissingV1JCells(schedule, [], ["unknown:A:1"])).toThrow("out-of-design");
    expect(() => selectMissingV1JCells(schedule, [complete, complete])).toThrow("duplicate valid");
    const invalid = observation(protocol, schedule[0]!, {
      attempted: false,
      valid: false,
      invalidClass: "INFRASTRUCTURE_RETRY_ELIGIBLE",
    });
    expect(v1jNextAttempt(schedule[0]!, [invalid])).toBe(2);
    expect(() =>
      v1jNextAttempt(schedule[0]!, [
        { ...invalid, invalidReason: "EVIDENCE_SERIALIZATION_FAILURE" },
      ]),
    ).toThrow("not eligible");
    expect(() =>
      v1jNextAttempt(schedule[0]!, [{ ...invalid, invalidClass: "SCIENTIFIC_OUTCOME" }]),
    ).toThrow("not eligible");
  });

  it("keeps valid observations and invalid attempts append-only in separate files", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-artifact-test-"));
    try {
      const manifest = {
        experimentId: protocol.experimentId,
        preregistrationSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
        harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
      };
      const state = openV1JArtifactState(root, manifest);
      const valid = observation(protocol, schedule[0]!);
      const invalid = observation(protocol, schedule[1]!, {
        valid: false,
        invalidClass: "INFRASTRUCTURE_RETRY_ELIGIBLE",
      });
      appendV1JObservation(root, valid);
      expect(() => appendV1JObservation(root, valid)).toThrow("duplicate valid");
      appendV1JInvalidAttempt(root, invalid);
      const loaded = openV1JArtifactState(root, manifest);
      expect(loaded.observations).toEqual([valid]);
      expect(loaded.invalidAttempts).toEqual([invalid]);
      expect(() => appendV1JInvalidAttempt(root, valid)).toThrow("cannot be appended as invalid");
      expect(() => openV1JArtifactState(root, { ...manifest, harnessCommit: "different" })).toThrow(
        "incompatible v1J manifest",
      );
      expect(state.observations).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects existing JSONL evidence without a manifest instead of adopting it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-orphan-evidence-test-"));
    try {
      fs.writeFileSync(path.join(root, "observations.jsonl"), "{}\n");
      expect(() =>
        openV1JArtifactState(root, {
          experimentId: "v1J-ACTION-INITIATION",
          preregistrationSha256: V1J_PREREGISTRATION_SHA256,
          harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
        }),
      ).toThrow("without its source-bound manifest");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes each missing cell once per batch and resumes only eligible infrastructure attempts", async () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-batch-test-"));
    const manifest = {
      experimentId: protocol.experimentId,
      preregistrationSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
      harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
    };
    const [first, second] = schedule;
    if (!first || !second) {
      throw new Error("expected v1J schedule cells");
    }
    let firstAttempts = 0;
    try {
      const batch = await runV1JCellBatch({
        root,
        manifest,
        protocol,
        schedule,
        allowlist: [first.cellId, second.cellId],
        maxCells: 2,
        executeCell: async (cell, attempt) => {
          if (cell.cellId === first.cellId) {
            firstAttempts += 1;
            return observation(protocol, cell, {
              valid: false,
              invalidClass: "INFRASTRUCTURE_RETRY_ELIGIBLE",
            });
          }
          return { ...observation(protocol, cell), attempt };
        },
      });
      expect(batch.attemptedCells).toEqual([first.cellId, second.cellId]);
      expect(batch.remainingCells).toBe(95);
      const resumed = await runV1JCellBatch({
        root,
        manifest,
        protocol,
        schedule,
        allowlist: [first.cellId],
        maxCells: 1,
        executeCell: async (cell, attempt) => {
          expect(attempt).toBe(2);
          firstAttempts += 1;
          return { ...observation(protocol, cell), attempt };
        },
      });
      expect(resumed.attemptedCells).toEqual([first.cellId]);
      expect(firstAttempts).toBe(2);
      const final = openV1JArtifactState(root, manifest);
      expect(final.observations.map((row) => row.cellId)).toEqual([second.cellId, first.cellId]);
      expect(final.invalidAttempts).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recomputes initiation, control, paired-CI, and classification from cells", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const observations = schedule.map((cell) =>
      observation(protocol, cell, {
        attempted:
          cell.arm === "C" &&
          (cell.stratum === "TOOL_REQUIRED" || cell.caseId === "control-summarize"),
      }),
    );
    const summary = summarizeV1JObservations({
      protocol,
      schedule,
      observations,
      invalidAttempts: [],
    });
    expect(summary.status).toBe("COMPLETE");
    expect(summary.result).toBe("OVERTRIGGERING");
    expect(summary.byStratum.TOOL_REQUIRED.A.requiredInitiationRate).toBe(0);
    expect(summary.byStratum.TOOL_REQUIRED.C.requiredInitiationRate).toBe(1);
    expect(summary.byStratum.NO_TOOL_CONTROL.C.unnecessaryToolRate).toBe(0.125);
    expect(summary.byStratum.TOOL_REQUIRED.C.c8Rate).toBe(1);
    expect(summary.paired.TOOL_REQUIRED).toEqual({
      caseCount: 8,
      meanDeltaPP: 100,
      ciLowPP: 100,
      ciHighPP: 100,
    });
  });

  it("fails closed on missing cells, surface drift, prompt leakage, or serialization failure", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const observations = schedule.map((cell) => observation(protocol, cell));
    const partial = summarizeV1JObservations({
      protocol,
      schedule,
      observations: observations.slice(0, 95),
      invalidAttempts: [],
    });
    expect(partial.result).toBe("NOT_CLASSIFIED");
    expect(partial.missingCells).toBe(1);
    const invalidRow = summarizeV1JObservations({
      protocol,
      schedule,
      observations: [{ ...observations[0]!, valid: false }, ...observations.slice(1)],
      invalidAttempts: [],
    });
    expect(invalidRow.result).toBe("NOT_CLASSIFIED");
    expect(invalidRow.integrity.outOfDesignCells).toBe(1);
    const hardStopHistory = summarizeV1JObservations({
      protocol,
      schedule,
      observations,
      invalidAttempts: [
        {
          ...observations[0]!,
          valid: false,
          invalidClass: "INTEGRITY_FAILURE",
          invalidReason: "EPOCH_FAILURE",
        },
      ],
    });
    expect(hardStopHistory.status).toBe("INTEGRITY_FAILURE");
    expect(hardStopHistory.result).toBe("NOT_CLASSIFIED");
    const drifted = summarizeV1JObservations({
      protocol,
      schedule,
      observations: [
        { ...observations[0]!, providerToolSchemaSha256: "0".repeat(64) },
        ...observations.slice(1),
      ],
      invalidAttempts: [],
    });
    expect(drifted.result).toBe("NOT_CLASSIFIED");
    expect(drifted.integrity.providerSurfaceDrift).toBe(1);
    const unprovable = summarizeV1JObservations({
      protocol,
      schedule,
      observations: [
        {
          ...observations[0]!,
          toolCalls: [{ toolCallId: "call-a", toolName: "write", modelTurnIndex: 0 }],
          executions: [
            { executionId: "execution-a", toolCallId: "call-a", toolName: "read", success: true },
          ],
        },
        ...observations.slice(1),
      ],
      invalidAttempts: [],
    });
    expect(unprovable.result).toBe("NOT_CLASSIFIED");
    expect(unprovable.integrity.unprovableCorrelations).toBe(1);
    const leaked = summarizeV1JObservations({
      protocol,
      schedule,
      observations: [
        { ...observations[0]!, experimentalInstructionHash: sha256("Arm C instruction") },
        ...observations.slice(1),
      ],
      invalidAttempts: [],
    });
    expect(leaked.integrity.crossArmLeaks).toBe(1);
    const serializationFailed = summarizeV1JObservations({
      protocol,
      schedule,
      observations,
      invalidAttempts: [],
      resultSerializationFailures: 1,
    });
    expect(serializationFailed.status).toBe("INTEGRITY_FAILURE");
    expect(serializationFailed.result).toBe("NOT_CLASSIFIED");
  });

  it("classifies complete paired no-change and supported outcomes from the frozen thresholds", () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const noChange = schedule.map((cell) => observation(protocol, cell));
    expect(
      summarizeV1JObservations({
        protocol,
        schedule,
        observations: noChange,
        invalidAttempts: [],
      }).result,
    ).toBe("NO_MEANINGFUL_EFFECT");
    const supported = schedule.map((cell) =>
      observation(protocol, cell, {
        attempted: cell.stratum === "TOOL_REQUIRED" && cell.arm === "C",
      }),
    );
    expect(
      summarizeV1JObservations({
        protocol,
        schedule,
        observations: supported,
        invalidAttempts: [],
      }).result,
    ).toBe("ACTION_INITIATION_HYPOTHESIS_SUPPORTED");
  });

  it("fails closed when durable result serialization fails and never retries it", async () => {
    const protocol = loadProtocol();
    const schedule = buildV1JSchedule(protocol);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-serialization-test-"));
    const manifest = {
      experimentId: protocol.experimentId,
      preregistrationSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
      harnessCommit: "a6c1188899aaf365b627472f91a7627e1e87d42a",
    };
    let executions = 0;
    try {
      await expect(
        runV1JCellBatch({
          root,
          manifest,
          protocol,
          schedule,
          maxCells: 1,
          executeCell: async (cell, attempt) => {
            executions += 1;
            return Object.assign(observation(protocol, cell), {
              attempt,
              unserializable: 1n,
            }) as V1JObservation;
          },
        }),
      ).rejects.toBeInstanceOf(V1JSerializationFailureError);
      expect(executions).toBe(1);
      expect(openV1JArtifactState(root, manifest).observations).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds exactly four non-scientific smoke cells with distinct IDs and prompts", () => {
    const protocol = loadProtocol();
    const smoke = buildV1JSmokeSchedule(protocol);
    expect(smoke).toHaveLength(4);
    expect(smoke.map((cell) => `${cell.caseId}:${cell.arm}:${cell.replicate}`)).toEqual([
      "smoke-tool-required:A:1",
      "smoke-tool-required:C:1",
      "smoke-no-tool-control:A:1",
      "smoke-no-tool-control:C:1",
    ]);
    expect(new Set(smoke.map((cell) => cell.cellId)).size).toBe(4);
    expect(
      smoke.every((cell) => !protocol.design.cells.some((entry) => entry.caseId === cell.caseId)),
    ).toBe(true);
    expect(
      smoke.every((cell) => !protocol.design.cells.some((entry) => entry.prompt === cell.prompt)),
    ).toBe(true);
    expect(smoke.find((cell) => cell.caseId === "smoke-tool-required")?.requiredTools).toEqual([
      "read",
    ]);
    expect(smoke.find((cell) => cell.caseId === "smoke-no-tool-control")?.requiredTools).toEqual(
      [],
    );
  });

  it("writes smoke records only beneath the commit-bound smoke root and preserves no-tool rows", () => {
    const protocol = loadProtocol();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-smoke-root-test-"));
    const commit = "b".repeat(40);
    try {
      assertV1JFormalStateEmpty(repoRoot);
      const state = createV1JSmokeArtifactState({
        repoRoot,
        harnessCommit: commit,
        protocol,
        modelConfigHash: protocol.model.modelConfigHash,
        schemaFingerprints: protocol.schemaBaseline,
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(state.root).toBe(resolveV1JSmokeRoot(repoRoot, commit));
      const [toolCell, controlCell] = buildV1JSmokeSchedule(protocol);
      const toolObservation = {
        ...observation(protocol, toolCell!, { attempted: true }),
        harnessCommit: commit,
      };
      const noToolObservation = {
        ...observation(protocol, controlCell!),
        harnessCommit: commit,
      };
      const toolRecord: V1JSmokeRecord = {
        smokeCellId: toolCell!.cellId,
        caseId: toolCell!.caseId,
        arm: toolCell!.arm,
        replicate: 1,
        observation: toolObservation,
        workspaceCleanupComplete: true,
      };
      const noToolRecord: V1JSmokeRecord = {
        smokeCellId: controlCell!.cellId,
        caseId: controlCell!.caseId,
        arm: controlCell!.arm,
        replicate: 1,
        observation: noToolObservation,
        workspaceCleanupComplete: true,
      };
      appendV1JSmokeRecord(state, toolRecord);
      appendV1JSmokeRecord(state, noToolRecord);
      expect(() => appendV1JSmokeRecord(state, noToolRecord)).toThrow(/duplicate identity/);
      const summary = finalizeV1JSmokeArtifacts(state, {
        completedAt: "2026-01-01T00:01:00.000Z",
        modelRequestsSent: 2,
        preflightPassed: true,
      });
      expect(summary).toMatchObject({
        artifactKind: "v1J-live-operational-smoke",
        scientificClassification: "NOT_CLASSIFIED",
        validSmokeCells: 2,
        noToolOutcomes: 1,
        cleanupFailures: 0,
      });
      const stored = fs
        .readFileSync(path.join(state.root, "smoke-observations.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as V1JSmokeRecord);
      expect(stored.map((record) => record.smokeCellId)).toEqual([
        toolCell!.cellId,
        controlCell!.cellId,
      ]);
      expect(stored[1]?.observation.toolCalls).toEqual([]);
      expect(fs.existsSync(path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH))).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects formal v1J paths and refuses smoke when formal state already exists", () => {
    const protocol = loadProtocol();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-smoke-formal-guard-test-"));
    const commit = "c".repeat(40);
    try {
      const smokeRoot = resolveV1JSmokeRoot(repoRoot, commit);
      const formalRoot = path.resolve(repoRoot, V1J_FORMAL_ARTIFACT_RELATIVE_PATH);
      expect(() =>
        assertV1JSmokeWritePath(repoRoot, commit, path.join(formalRoot, "manifest.json")),
      ).toThrow(/formal evidence path/);
      expect(() =>
        assertV1JSmokeWritePath(repoRoot, commit, path.join(smokeRoot, "observations.jsonl")),
      ).toThrow(/formal evidence path/);
      fs.mkdirSync(formalRoot, { recursive: true });
      expect(() =>
        createV1JSmokeArtifactState({
          repoRoot,
          harnessCommit: commit,
          protocol,
          modelConfigHash: protocol.model.modelConfigHash,
          schemaFingerprints: protocol.schemaBaseline,
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      ).toThrow(/requires absent formal state/);
      expect(fs.existsSync(smokeRoot)).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("accepts only a recognized harness-control amendment bound to the exact smoke HEAD", () => {
    const protocol = loadProtocol();
    const commit = "d".repeat(40);
    const amendment = {
      provenanceAmendment: true,
      amendmentType: "observational/harness-control-only",
      baseHarnessCommit: protocol.base.head,
      continuationHarnessCommit: commit,
      scientificProtocolChanged: false,
      modelFacingBehaviorChanged: false,
      runtimeBehaviorChanged: false,
      runtimeExecutionSemanticsChanged: false,
    };
    expect(() => assertV1JSmokeProvenance(amendment, protocol, commit)).not.toThrow();
    expect(() => assertV1JSmokeProvenance(amendment, protocol, "e".repeat(40))).toThrow(
      /provenance amendment/,
    );
  });
});
