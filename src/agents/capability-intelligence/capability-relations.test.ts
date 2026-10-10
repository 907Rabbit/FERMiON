import { describe, expect, it } from "vitest";
import {
  CAPABILITY_RELATIONS,
  propagateRelationScores,
  RELATION_SCORE_CAP,
} from "./capability-relations.js";

describe("capability relations", () => {
  it("keeps the relational boost capped below a strong lexical hit", () => {
    expect(RELATION_SCORE_CAP).toBe(0.3);
  });

  it("records observed task edges rather than a similarity neighborhood", () => {
    expect(CAPABILITY_RELATIONS).toEqual(
      expect.arrayContaining([
        { from: "pytest", to: "read", kind: "companion", weight: 0.35 },
        { from: "git_diff", to: "read", kind: "followup", weight: 0.25 },
        { from: "cron", to: "sessions_history", kind: "companion", weight: 0.2 },
        { from: "git_diff", to: "git_status", kind: "companion", weight: 0.3 },
      ]),
    );
  });

  it("propagates one hop and does not spread the boost onward", () => {
    const hits = propagateRelationScores({
      tools: [{ name: "pytest" }, { name: "read" }, { name: "write" }],
      base: [{ name: "pytest", score: 1 }],
      relations: [
        { from: "pytest", to: "read", kind: "companion", weight: 1 },
        { from: "read", to: "write", kind: "followup", weight: 1 },
      ],
      cap: 10,
    });

    expect(hits).toEqual([
      { name: "pytest", baseScore: 1, relationScore: 0, score: 1 },
      { name: "read", baseScore: 0, relationScore: 1, score: 1 },
    ]);
    expect(hits.map(({ name }) => name)).not.toContain("write");
  });

  it("caps a unit edge at the relation ceiling", () => {
    const hits = propagateRelationScores({
      tools: [{ name: "pytest" }, { name: "read" }, { name: "write" }],
      base: [{ name: "pytest", score: 1 }],
      relations: [
        { from: "pytest", to: "read", kind: "companion", weight: 1 },
        { from: "read", to: "write", kind: "followup", weight: 1 },
      ],
    });
    const read = hits.find((hit) => hit.name === "read");

    expect(read).toMatchObject({ baseScore: 0, relationScore: 0.3, score: 0.3 });
    expect(hits.map(({ name }) => name)).not.toContain("write");
  });

  it("uses the lexical score for both directions of a mutual edge", () => {
    const hits = propagateRelationScores({
      tools: [{ name: "git_diff" }, { name: "git_status" }],
      base: [
        { name: "git_diff", score: 1 },
        { name: "git_status", score: 0.5 },
      ],
      relations: [
        { from: "git_diff", to: "git_status", kind: "companion", weight: 1 },
        { from: "git_status", to: "git_diff", kind: "companion", weight: 1 },
      ],
      cap: 10,
    });

    expect(hits).toEqual([
      { name: "git_diff", baseScore: 1, relationScore: 0.5, score: 1.5 },
      { name: "git_status", baseScore: 0.5, relationScore: 1, score: 1.5 },
    ]);
  });

  it("does not add a related tool that is not authorized", () => {
    const hits = propagateRelationScores({
      tools: [{ name: "pytest" }],
      base: [{ name: "pytest", score: 1 }],
    });

    expect(hits.map(({ name }) => name)).toEqual(["pytest"]);
  });
});
