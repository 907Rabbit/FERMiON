import { describe, expect, it, vi } from "vitest";
import type { ShadowContainmentEvent } from "./shadow-traffic.js";
import { createToolRankingShadowTracker } from "./tool-ranking-shadow.js";

describe("tool ranking shadow tracker", () => {
  it("correlates executed tool outcomes with the latest prompt ranking", () => {
    const tracker = createToolRankingShadowTracker();
    tracker.recordObservation(
      {
        authorizedCount: 3,
        rankedCount: 2,
        top: [{ name: "read", score: 1.5 }],
        durationMs: 0.4,
        queryTokenCount: 4,
      },
      [
        { name: "read", score: 1.5 },
        { name: "exec", score: 0.9 },
      ],
    );

    const recordEvent = vi.fn();
    expect(
      tracker.recordOutcome("exec", { executed: true, succeeded: false }, (outcome) =>
        recordEvent("tool-ranking.outcome", outcome),
      ),
    ).toEqual({
      toolName: "exec",
      shadowRank: 2,
      shadowScore: 0.9,
      selectedByModel: true,
      executed: true,
      succeeded: false,
    });
    expect(recordEvent).toHaveBeenCalledWith(
      "tool-ranking.outcome",
      expect.objectContaining({ shadowRank: 2, shadowScore: 0.9 }),
    );
    expect(tracker.snapshot().observation).toMatchObject({
      authorizedCount: 3,
      rankedCount: 2,
      queryTokenCount: 4,
    });
  });

  it("replaces prompt rankings and bounds retained outcomes", () => {
    const tracker = createToolRankingShadowTracker();
    tracker.recordObservation(
      { authorizedCount: 1, rankedCount: 1, top: [], durationMs: 0, queryTokenCount: 1 },
      [{ name: "old_tool", score: 1 }],
    );
    tracker.recordObservation(
      { authorizedCount: 1, rankedCount: 1, top: [], durationMs: 0, queryTokenCount: 1 },
      [{ name: "new_tool", score: 2 }],
    );

    expect(tracker.recordOutcome("old_tool", { executed: false, succeeded: false })).toMatchObject({
      selectedByModel: true,
      executed: false,
    });
    for (let index = 0; index < 130; index += 1) {
      tracker.recordOutcome("new_tool", { executed: true, succeeded: true });
    }

    const snapshot = tracker.snapshot();
    expect(snapshot.outcomes).toHaveLength(128);
    expect(snapshot.outcomes.at(-1)).toMatchObject({ shadowRank: 1, shadowScore: 2 });
  });

  it("keeps outcome correlation when containment recording is off", () => {
    const tracker = createToolRankingShadowTracker({ runId: "run-off", mode: "off" });
    const onContainment = vi.fn();
    tracker.recordObservation(
      {
        authorizedCount: 1,
        rankedCount: 1,
        top: [{ name: "read", score: 1 }],
        durationMs: 0,
        queryTokenCount: 1,
      },
      [{ name: "read", score: 1 }],
    );

    expect(
      tracker.recordOutcome("read", { executed: true, succeeded: true }, undefined, onContainment),
    ).toMatchObject({ shadowRank: 1, executed: true });
    expect(onContainment).not.toHaveBeenCalled();
    expect(tracker.snapshot().containment).toEqual([]);
  });

  it("marks rank 9 as outside the top 8 and does not infer a role", () => {
    const rankings = Array.from({ length: 9 }, (_, index) => ({
      name: `tool_${index}`,
      score: 9 - index,
    }));
    const tracker = createToolRankingShadowTracker({ runId: "run-rank", mode: "shadow" });
    tracker.recordObservation(
      {
        authorizedCount: 9,
        rankedCount: 9,
        top: rankings,
        durationMs: 1,
        queryTokenCount: 2,
      },
      rankings,
      { authorizedNames: rankings.map(({ name }) => name) },
    );

    const recorded: ShadowContainmentEvent[] = [];
    expect(
      tracker.recordOutcome("tool_8", { executed: true, succeeded: true }, undefined, (event) => {
        recorded.push(event);
      }),
    ).toMatchObject({ shadowRank: 9, shadowScore: 1, executed: true });
    const containment = recorded[0];
    if (!containment) {
      throw new Error("missing containment event");
    }
    expect(containment).toMatchObject({
      runId: "run-rank",
      turnId: "run-rank:1",
      inTop8: false,
      role: "unknown",
      roleSource: "unknown",
      schemaVersion: 1,
      rankerVersion: "v1C",
      qualificationPolicyVersion: "v1F-2",
      selectedTool: "tool_8",
    });
    expect(containment).not.toHaveProperty("wouldBlockSelectedTool");
    expect(containment).not.toHaveProperty("inKept");
    expect(containment.rankedTop8).toHaveLength(8);
    expect(containment.rankedTop8).not.toContain("tool_8");
    expect(JSON.stringify(recorded)).not.toContain("query");
    expect(tracker.snapshot().observation).not.toHaveProperty("authorizedNames");
  });

  it("emits every containment event while the in-memory buffer stays capped", () => {
    const tracker = createToolRankingShadowTracker({ runId: "run-cap" });
    tracker.recordObservation(
      {
        authorizedCount: 1,
        rankedCount: 1,
        top: [{ name: "read", score: 1 }],
        durationMs: 0,
        queryTokenCount: 1,
      },
      [{ name: "read", score: 1 }],
      { authorizedNames: ["read"] },
    );
    const seen: string[] = [];
    for (let index = 0; index < 130; index += 1) {
      tracker.recordOutcome("read", { executed: true, succeeded: true }, undefined, (event) => {
        seen.push(event.turnId);
      });
    }

    expect(seen).toHaveLength(130);
    expect(tracker.snapshot().containment).toHaveLength(128);
    expect(tracker.snapshot().outcomes).toHaveLength(128);
  });

  it("starts a new turn when the prompt ranking is replaced", () => {
    const tracker = createToolRankingShadowTracker({ runId: "run-turn", mode: "simulated-filter" });
    tracker.recordObservation(
      {
        authorizedCount: 2,
        rankedCount: 1,
        top: [{ name: "read", score: 1 }],
        durationMs: 0,
        queryTokenCount: 1,
      },
      [{ name: "read", score: 1 }],
      { authorizedNames: ["read", "exec"], runtimeMandatory: ["exec"] },
    );
    tracker.recordOutcome("exec", { executed: true, succeeded: true, role: "required" });
    tracker.recordObservation(
      {
        authorizedCount: 2,
        rankedCount: 1,
        top: [{ name: "exec", score: 2 }],
        durationMs: 0,
        queryTokenCount: 1,
      },
      [{ name: "exec", score: 2 }],
      { authorizedNames: ["read", "exec"] },
    );
    tracker.recordOutcome("exec", { executed: true, succeeded: true, role: "required" });

    const containment = tracker.snapshot().containment;
    expect(containment.map((event) => event.turnId)).toEqual(["run-turn:1", "run-turn:2"]);
    expect(containment[0]).toMatchObject({
      inTop8: false,
      wouldBlockSelectedTool: false,
      wouldBlockRequiredTool: false,
      taskCriticalBlock: false,
      inKept: true,
      role: "required",
      roleSource: "unknown",
    });
    expect(containment[1]).toMatchObject({ inTop8: true, wouldBlockRequiredTool: false });
  });

  it("returns undefined before any prompt ranking is recorded", () => {
    const tracker = createToolRankingShadowTracker();
    const onOutcome = vi.fn();
    const onContainment = vi.fn();
    expect(
      tracker.recordOutcome("read", { executed: true, succeeded: true }, onOutcome, onContainment),
    ).toBeUndefined();
    expect(onOutcome).not.toHaveBeenCalled();
    expect(onContainment).not.toHaveBeenCalled();
  });
});
