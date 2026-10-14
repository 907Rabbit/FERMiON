import { describe, expect, it } from "vitest";
import {
  diffV1JPromptMaterializationBoundaries,
  diffV1JPromptMaterializationTransition,
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
  it("classifies bytes from the exact input and output attached to one transition", () => {
    const beforeText = "x".repeat(155);
    const afterText = `${beforeText}!`;
    const result = diffV1JPromptMaterializationTransition({
      transitionInstanceId: "attempt-a:loop-1:normalize-1",
      sourceBoundary: "agent-llm-boundary-input",
      destinationBoundary: "agent-llm-boundary-normalized",
      inputMessages: [{ index: 0, role: "user", content: beforeText }],
      outputMessages: [{ index: 0, role: "user", content: afterText }],
    });

    expect(result).toMatchObject({
      transitionInstanceId: "attempt-a:loop-1:normalize-1",
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
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(beforeText);
    expect(JSON.stringify(result)).not.toContain(afterText);
  });

  it.each([
    {
      name: "same-length substitution",
      before: "abc",
      after: "axc",
      expected: {
        classification: "byte-content-change",
        insertedByteCount: 0,
        deletedByteCount: 0,
        substitutedByteCount: 1,
      },
    },
    {
      name: "append",
      before: "abc",
      after: "abcd",
      expected: { insertedByteCount: 1, deletedByteCount: 0, substitutedByteCount: 0 },
    },
    {
      name: "prepend",
      before: "abc",
      after: "xabc",
      expected: { insertedByteCount: 1, deletedByteCount: 0, substitutedByteCount: 0 },
    },
    {
      name: "LF to CRLF",
      before: "a\nb",
      after: "a\r\nb",
      expected: {
        classification: "line-ending-normalization",
        insertedByteCount: 1,
        crCountBefore: 0,
        crCountAfter: 1,
        lfCountBefore: 1,
        lfCountAfter: 1,
      },
    },
    {
      name: "trailing newline",
      before: "tail",
      after: "tail\n",
      expected: {
        classification: "trailing-newline-change",
        insertedByteCount: 1,
        newlineCountBefore: 0,
        newlineCountAfter: 1,
      },
    },
    {
      name: "Unicode normalization",
      before: "é",
      after: "e\u0301",
      expected: { classification: "unicode-normalization" },
    },
  ])("classifies $name at the transition boundary", ({ before, after, expected }) => {
    const result = diffV1JPromptMaterializationTransition({
      transitionInstanceId: 1,
      sourceBoundary: "agent-llm-boundary-input",
      destinationBoundary: "agent-llm-boundary-normalized",
      inputMessages: [{ index: 0, role: "user", content: before }],
      outputMessages: [{ index: 0, role: "user", content: after }],
    });
    expect(result.pairingStatus).toBe("PAIRED");
    expect(result.deltas[0]?.delta).toMatchObject(expected);
  });

  it("pairs multiple user messages by role-relative ordinal", () => {
    const result = diffV1JPromptMaterializationTransition({
      transitionInstanceId: 4,
      sourceBoundary: "agent-llm-boundary-input",
      destinationBoundary: "agent-llm-boundary-normalized",
      inputMessages: [
        { index: 0, role: "user", content: "first private" },
        { index: 1, role: "assistant", content: "stable" },
        { index: 2, role: "user", content: "second before" },
      ],
      outputMessages: [
        { index: 0, role: "user", content: "first private" },
        { index: 1, role: "assistant", content: "stable" },
        { index: 2, role: "user", content: "second after" },
      ],
    });

    expect(result.pairingStatus).toBe("PAIRED");
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({ role: "user", ordinalWithinRole: 1 });
    expect(JSON.stringify(result)).not.toContain("second before");
    expect(JSON.stringify(result)).not.toContain("second after");
  });

  it("keeps loop iterations isolated by their transition instance ids", () => {
    const transition = (transitionInstanceId: number, before: string, after: string) =>
      diffV1JPromptMaterializationTransition({
        transitionInstanceId,
        sourceBoundary: "agent-llm-boundary-input",
        destinationBoundary: "agent-llm-boundary-normalized",
        inputMessages: [{ index: 0, role: "user", content: before }],
        outputMessages: [{ index: 0, role: "user", content: after }],
      });

    const first = transition(1, "loop one before", "loop one after");
    const second = transition(2, "loop two before", "loop two after");
    expect(first.transitionInstanceId).toBe(1);
    expect(second.transitionInstanceId).toBe(2);
    expect(first.deltas[0]?.beforeContentSha256).not.toBe(second.deltas[0]?.beforeContentSha256);
  });

  it.each([
    {
      side: "input",
      inputMessages: undefined,
      outputMessages: [{ index: 0, role: "user", content: "private" }],
    },
    {
      side: "output",
      inputMessages: [{ index: 0, role: "user", content: "private" }],
      outputMessages: undefined,
    },
  ])("fails closed when transition $side messages are unavailable", (messages) => {
    const result = diffV1JPromptMaterializationTransition({
      transitionInstanceId: 1,
      sourceBoundary: "agent-llm-boundary-input",
      destinationBoundary: "agent-llm-boundary-normalized",
      ...messages,
    });

    expect(result.pairingStatus).toBe("DELTA_PAIRING_UNAVAILABLE");
    expect(result.pairingReason).toBe(`transition-${messages.side}-unavailable`);
    expect(JSON.stringify(result)).not.toContain("private");
  });

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
