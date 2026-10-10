import { describe, expect, it } from "vitest";
import { rankAgentTools } from "./rank-agent-tools.js";
import {
  EXECUTION_HEDGE_ID,
  EXECUTION_HEDGE_MAX_ADDED_TOOLS,
  EXECUTION_HEDGE_MIN_OPPORTUNITIES,
  EXECUTION_HEDGE_MODEL_ID,
  EXECUTION_HEDGE_SELECTION_BATCH,
  EXECUTION_HEDGE_TRAINING_BATCH,
  FROZEN_EXECUTION_SUBSTITUTIONS,
  selectExecutionSubstitution,
  semanticUnionSurface,
  summarizeCandidateSurface,
  SURFACE_POLICY_ID,
} from "./execution-substitution.js";

describe("v1G-1 execution substitution", () => {
  it("freezes the v1E-3 one-slot hedge", () => {
    expect(EXECUTION_HEDGE_ID).toBe("qwen3.5-9b-substitution-v1");
    expect(SURFACE_POLICY_ID).toBe("semantic-union-1");
    expect(EXECUTION_HEDGE_MODEL_ID).toBe("qwen/qwen3.5-9b");
    expect(EXECUTION_HEDGE_TRAINING_BATCH).toBe("v1e-3-surface-valid");
    expect(EXECUTION_HEDGE_SELECTION_BATCH).toBe("v1f-2-surface-valid");
    expect(EXECUTION_HEDGE_MIN_OPPORTUNITIES).toBe(8);
    expect(EXECUTION_HEDGE_MAX_ADDED_TOOLS).toBe(1);
    expect(FROZEN_EXECUTION_SUBSTITUTIONS).toHaveLength(101);
    for (const edge of FROZEN_EXECUTION_SUBSTITUTIONS) {
      expect(edge.modelId).toBe(EXECUTION_HEDGE_MODEL_ID);
      expect(edge.opportunities).toBeGreaterThanOrEqual(8);
      expect(edge.executionCount).toBeGreaterThan(0);
      expect(edge.semanticTool).not.toBe(edge.executedTool);
    }
    expect(FROZEN_EXECUTION_SUBSTITUTIONS[0]).toMatchObject({
      semanticTool: "message",
      executedTool: "sessions_spawn",
      opportunities: 119,
      executionCount: 59,
    });
  });

  it("adds one triggered substitute and refuses a global fallback", () => {
    const choice = selectExecutionSubstitution({
      modelId: EXECUTION_HEDGE_MODEL_ID,
      semanticSurface: ["message", "automations"],
      authorizedTools: ["message", "automations", "sessions_spawn", "sessions_list", "read"],
    });
    expect(choice).toMatchObject({
      hedgeTool: "sessions_spawn",
      hedgeTriggeredBy: "message",
      opportunities: 119,
      executionCount: 59,
    });
    expect(
      semanticUnionSurface(["message", "automations"], choice),
    ).toEqual(["message", "automations", "sessions_spawn"]);
    expect(
      selectExecutionSubstitution({
        modelId: "other-model",
        semanticSurface: ["message"],
        authorizedTools: ["message", "sessions_spawn", "read"],
      }),
    ).toBeUndefined();
    expect(
      selectExecutionSubstitution({
        modelId: EXECUTION_HEDGE_MODEL_ID,
        semanticSurface: ["message", "sessions_spawn", "sessions_list"],
        authorizedTools: ["message", "sessions_spawn", "sessions_list", "read"],
      })?.hedgeTool,
    ).not.toBe("sessions_spawn");
    expect(
      selectExecutionSubstitution({
        modelId: EXECUTION_HEDGE_MODEL_ID,
        semanticSurface: ["camera"],
        authorizedTools: ["camera", "read", "sessions_list"],
      }),
    ).toBeUndefined();
    expect(
      selectExecutionSubstitution({
        modelId: EXECUTION_HEDGE_MODEL_ID,
        semanticSurface: ["message"],
        authorizedTools: ["message", "sessions_spawn"],
        table: [
          {
            semanticTool: "message",
            executedTool: "sessions_spawn",
            opportunities: 7,
            executionCount: 7,
            modelId: EXECUTION_HEDGE_MODEL_ID,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("does not call the semantic ranker", () => {
    const before = rankAgentTools(
      [
        { name: "message", description: "Send a message" },
        { name: "read", description: "Read a file" },
      ],
      "send a message",
    ).map((entry) => entry.name);
    selectExecutionSubstitution({
      modelId: EXECUTION_HEDGE_MODEL_ID,
      semanticSurface: before,
      authorizedTools: ["message", "read", "sessions_list"],
    });
    const after = rankAgentTools(
      [
        { name: "message", description: "Send a message" },
        { name: "read", description: "Read a file" },
      ],
      "send a message",
    ).map((entry) => entry.name);
    expect(after).toEqual(before);
  });

  it("counts a recovery separately from an unused hedge", () => {
    const summary = summarizeCandidateSurface([
      {
        semanticSurface: ["message", "automations"],
        hedgeTool: "sessions_spawn",
        executions: [
          { tool: "message", requiredProvenance: true },
          { tool: "sessions_spawn", requiredProvenance: false },
        ],
      },
      {
        semanticSurface: ["write", "edit"],
        hedgeTool: "read",
        executions: [{ tool: "write", requiredProvenance: true }],
      },
    ]);
    expect(summary.semanticContained).toBe(2);
    expect(summary.candidateContained).toBe(3);
    expect(summary.semanticRequiredContained).toBe(2);
    expect(summary.candidateRequiredContained).toBe(2);
    expect(summary.hedgeActivations).toBe(2);
    expect(summary.hedgeRecoveries).toBe(1);
    expect(summary.hedgeFalseAdditions).toBe(1);
    expect(summary.averageSemanticSize).toBe(2);
    expect(summary.averageCandidateSize).toBe(3);
  });
});
