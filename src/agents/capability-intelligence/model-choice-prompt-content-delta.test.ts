import { describe, expect, it } from "vitest";
import {
  diffV1JPromptMaterializationBoundaries,
  type V1JPromptMaterializationBoundary,
} from "../../../test/helpers/agents/model-choice-prompt-content-delta.js";

const identity = {
  runOneAttemptId: "attempt-a",
  embeddedRunId: "embedded-a",
  sessionIdSha256: "a".repeat(64),
  promptSubmissionIndex: 1,
  modelLoopIterationIndex: 1,
};

function boundary(
  stage: V1JPromptMaterializationBoundary["stage"],
  messages: V1JPromptMaterializationBoundary["messages"],
): V1JPromptMaterializationBoundary {
  return { stage, identity, messages };
}

describe("V1J prompt materialization content deltas", () => {
  it("pairs the exact 155-to-156 byte message across adjacent boundaries", () => {
    const beforeText = "x".repeat(155);
    const afterText = `${beforeText}!`;
    const result = diffV1JPromptMaterializationBoundaries(
      boundary("agent-llm-boundary-input", [{ index: 0, role: "user", content: beforeText }]),
      boundary("agent-llm-boundary-normalized", [{ index: 0, role: "user", content: afterText }]),
    );

    expect(result).toMatchObject({
      pairingStatus: "PAIRED",
      sourceBoundary: "agent-llm-boundary-input",
      destinationBoundary: "agent-llm-boundary-normalized",
      deltas: [
        {
          role: "user",
          ordinalWithinRole: 0,
          beforeIndex: 0,
          afterIndex: 0,
          pairingStatus: "PAIRED",
          delta: {
            beforeBytes: 155,
            afterBytes: 156,
            prefixCommonBytes: 155,
            suffixCommonBytes: 0,
            insertedByteCount: 1,
            deletedByteCount: 0,
            substitutedByteCount: 0,
            firstDifferenceOffset: 155,
            lastDifferenceOffset: 155,
            newlineCountBefore: 0,
            newlineCountAfter: 0,
            crCountBefore: 0,
            crCountAfter: 0,
            lfCountBefore: 0,
            lfCountAfter: 0,
            utf8CodepointCountBefore: 155,
            utf8CodepointCountAfter: 156,
          },
        },
      ],
    });
    expect(result.deltas[0]?.beforeContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.deltas[0]?.afterContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(beforeText);
    expect(JSON.stringify(result)).not.toContain(afterText);
  });

  it("pairs each role-relative message and reports only the changed message", () => {
    const result = diffV1JPromptMaterializationBoundaries(
      boundary("model-prompt-transform-complete", [
        { index: 0, role: "system", content: "stable system" },
        { index: 1, role: "user", content: "private before" },
      ]),
      boundary("agent-llm-boundary-input", [
        { index: 0, role: "system", content: "stable system" },
        { index: 1, role: "user", content: "private after" },
      ]),
    );

    expect(result.pairingStatus).toBe("PAIRED");
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({
      role: "user",
      ordinalWithinRole: 0,
      beforeIndex: 1,
      afterIndex: 1,
      pairingStatus: "PAIRED",
    });
    expect(JSON.stringify(result)).not.toContain("private before");
    expect(JSON.stringify(result)).not.toContain("private after");
  });

  it("fails closed when a predecessor or exact role-relative pairing is unavailable", () => {
    const current = boundary("agent-llm-boundary-normalized", [
      { index: 0, role: "user", content: "private prompt" },
    ]);

    expect(diffV1JPromptMaterializationBoundaries(undefined, current)).toMatchObject({
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      pairingReason: "no-adjacent-boundary-predecessor",
    });
    expect(
      diffV1JPromptMaterializationBoundaries(
        boundary("prompt-context-built", current.messages),
        current,
      ).pairingReason,
    ).toBe("predecessor-is-not-adjacent-boundary");
    expect(
      diffV1JPromptMaterializationBoundaries(
        {
          ...boundary("agent-llm-boundary-input", current.messages),
          identity: { ...identity, runOneAttemptId: "other" },
        },
        current,
      ).pairingReason,
    ).toBe("materialization-identity-mismatch");

    const insertedUser = diffV1JPromptMaterializationBoundaries(
      boundary("agent-llm-boundary-input", [{ index: 0, role: "user", content: "original user" }]),
      boundary("agent-llm-boundary-normalized", [
        { index: 0, role: "user", content: "new user" },
        { index: 1, role: "user", content: "original user" },
      ]),
    );
    expect(insertedUser).toMatchObject({
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
    });
    expect(insertedUser.deltas[0]).toMatchObject({
      role: "user",
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      pairingReason: "message-role-counts-changed",
    });

    const nonStringContent = diffV1JPromptMaterializationBoundaries(
      boundary("agent-llm-boundary-input", [{ index: 0, role: "user", content: null }]),
      current,
    );
    expect(nonStringContent.deltas[0]).toMatchObject({
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      pairingReason: "message-content-is-not-a-string",
    });
    expect(
      JSON.stringify(diffV1JPromptMaterializationBoundaries(undefined, current)),
    ).not.toContain("private prompt");
  });
});
