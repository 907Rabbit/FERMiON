import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  captureV1JTimestampProvenance,
  recordV1JProviderMaterializationTrace,
} from "../../../test/helpers/agents/model-choice-provider-materialization-trace.js";
import {
  identifyV1JProviderRequest,
  type V1JAgentSessionTimestampDecoration,
  type V1JRawRepeatabilityCapture,
} from "../../../test/helpers/agents/model-choice-provider-repeatability.js";
import { buildTimestampPrefix } from "../../gateway/server-methods/agent-timestamp.js";

function captureAt(
  producerTimestampMs: number,
  userText = "private user text",
  timezone = "America/Anchorage",
) {
  const timestampPrefix = buildTimestampPrefix(new Date(producerTimestampMs), { timezone });
  if (!timestampPrefix) {
    throw new Error("offline timestamp fixture could not be formatted");
  }
  const requestObject = {
    model: "qwen/qwen3.5-9b",
    messages: [
      { role: "system", content: "private system text" },
      { role: "user", content: `${timestampPrefix}${userText}` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "read a diagnostic fixture",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ],
    stream: true,
    max_tokens: 128,
    temperature: 0,
  };
  const capture: V1JRawRepeatabilityCapture = {
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    rawBody: JSON.stringify(requestObject),
    requestObject,
  };
  const timestampDecoration: V1JAgentSessionTimestampDecoration = {
    source: "normalizeMessagesForLlmBoundary.stampUserTextWithMessageTimestamp",
    messageIndex: 1,
    prefixSha256: createHash("sha256").update(timestampPrefix, "utf8").digest("hex"),
    producerTimestampSha256: createHash("sha256")
      .update(String(producerTimestampMs), "utf8")
      .digest("hex"),
    timezoneSha256: createHash("sha256").update(timezone, "utf8").digest("hex"),
    originalContentSha256: createHash("sha256").update(userText, "utf8").digest("hex"),
    originalContentBytes: Buffer.byteLength(userText, "utf8"),
    prefixBytes: Buffer.byteLength(timestampPrefix, "utf8"),
  };
  return { capture, timestampDecoration };
}

function recapture(
  capture: V1JRawRepeatabilityCapture,
  mutate: (body: Record<string, unknown>) => void,
): V1JRawRepeatabilityCapture {
  const requestObject = structuredClone(capture.requestObject);
  mutate(requestObject);
  return { ...capture, requestObject, rawBody: JSON.stringify(requestObject) };
}

describe("v1J stable provider request identity", () => {
  it("normalizes only the proven timestamp and preserves exact-instance identities", () => {
    const first = captureAt(Date.UTC(2026, 9, 12, 17, 30));
    const second = captureAt(Date.UTC(2026, 9, 13, 18, 45));
    expect(first.timestampDecoration.prefixBytes).toBe(28);
    expect(second.timestampDecoration.prefixBytes).toBe(28);

    const firstIdentity = identifyV1JProviderRequest({
      capture: first.capture,
      provider: "lmstudio",
      timestampDecoration: first.timestampDecoration,
    });
    const secondIdentity = identifyV1JProviderRequest({
      capture: second.capture,
      provider: "lmstudio",
      timestampDecoration: second.timestampDecoration,
    });
    expect(firstIdentity.rawBodySha256).not.toBe(secondIdentity.rawBodySha256);
    expect(firstIdentity.historicalExactCanonicalSha256).not.toBe(
      secondIdentity.historicalExactCanonicalSha256,
    );
    expect(firstIdentity.providerRequestSha256).not.toBe(secondIdentity.providerRequestSha256);
    expect(firstIdentity.stableProviderRequestSha256).toBe(
      secondIdentity.stableProviderRequestSha256,
    );
    expect(firstIdentity.stableNormalizationApplied).toBe(true);
    expect(firstIdentity.stableNormalizationReason).toBe("applied");
    expect(
      identifyV1JProviderRequest({
        capture: first.capture,
        provider: "other-provider",
        timestampDecoration: first.timestampDecoration,
      }).providerRequestSha256,
    ).not.toBe(firstIdentity.providerRequestSha256);
    expect(JSON.stringify(firstIdentity)).not.toContain("private user text");

    // Without producer provenance, even timestamp-shaped user text remains exact identity.
    expect(
      identifyV1JProviderRequest({ capture: first.capture, provider: "lmstudio" })
        .stableProviderRequestSha256,
    ).not.toBe(firstIdentity.stableProviderRequestSha256);
  });

  it("keeps every non-timestamp provider request field identity-bearing", () => {
    const baseline = captureAt(Date.UTC(2026, 9, 12, 17, 30));
    const expected = identifyV1JProviderRequest({
      capture: baseline.capture,
      provider: "lmstudio",
      timestampDecoration: baseline.timestampDecoration,
    }).stableProviderRequestSha256;
    const changedUser = captureAt(Date.UTC(2026, 9, 13, 18, 45), "different user text");
    const variants: Array<{
      capture?: V1JRawRepeatabilityCapture;
      provider?: string;
      mutate?: (body: Record<string, unknown>) => void;
    }> = [
      { capture: changedUser.capture },
      {
        mutate: (body) => {
          const messages = body.messages as Array<Record<string, unknown>>;
          messages[0] = { ...messages[0], content: "changed static system prompt" };
        },
      },
      {
        mutate: (body) => {
          const tools = body.tools as Array<{ function: Record<string, unknown> }>;
          tools[0]!.function.description = "changed tool schema";
        },
      },
      { mutate: (body) => void (body.model = "other/provider-model") },
      { mutate: (body) => void (body.temperature = 0.5) },
      { mutate: (body) => void delete body.max_tokens },
      { provider: "other-provider" },
    ];

    for (const variant of variants) {
      const capture =
        variant.capture ??
        (variant.mutate ? recapture(baseline.capture, variant.mutate) : baseline.capture);
      const identity = identifyV1JProviderRequest({
        capture,
        provider: variant.provider ?? "lmstudio",
        timestampDecoration: variant.capture
          ? changedUser.timestampDecoration
          : baseline.timestampDecoration,
      });
      expect(identity.stableProviderRequestSha256).not.toBe(expected);
    }
  });

  it("leaves identity exact when timestamp provenance is missing or mismatched", () => {
    const timestamped = captureAt(Date.UTC(2026, 9, 12, 17, 30));
    const unknownSource = {
      ...timestamped.timestampDecoration,
      source: "generic-leading-prefix" as unknown as V1JAgentSessionTimestampDecoration["source"],
    };
    expect(
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: unknownSource,
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "unknown-timestamp-source",
    });

    const altered = recapture(timestamped.capture, (body) => {
      const messages = body.messages as Array<Record<string, unknown>>;
      const original = messages[1]!.content as string;
      messages[1] = { ...messages[1], content: `${original} altered` };
    });
    expect(
      identifyV1JProviderRequest({
        capture: altered,
        provider: "lmstudio",
        timestampDecoration: timestamped.timestampDecoration,
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "original-user-content-mismatch",
    });

    expect(
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: {
          ...timestamped.timestampDecoration,
          prefixSha256: "0".repeat(64),
        },
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "prefix-hash-mismatch",
    });

    expect(
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: {
          ...timestamped.timestampDecoration,
          prefixBytes: 27,
        },
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "prefix-length-mismatch",
    });

    expect(
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: {
          ...timestamped.timestampDecoration,
          originalContentSha256: "0".repeat(64),
        },
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "original-user-content-mismatch",
    });

    expect(
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: {
          ...timestamped.timestampDecoration,
          originalContentBytes: 999,
        },
      }),
    ).toMatchObject({
      stableNormalizationApplied: false,
      stableNormalizationReason: "original-user-content-mismatch",
    });
  });

  it("captures producer provenance and journals four identities against an offline time variant", () => {
    const timezone = "America/Anchorage";
    const producerTimestampMs = Date.UTC(2026, 9, 12, 17, 30);
    const userText = "private live-shaped user text";
    const expectedPrefix = buildTimestampPrefix(new Date(producerTimestampMs), { timezone });
    expect(expectedPrefix).toBeDefined();
    expect(Buffer.byteLength(expectedPrefix!, "utf8")).toBe(28);

    const inputMessages = [
      { role: "system", content: "private system prompt" },
      {
        role: "user",
        content: [{ type: "text", text: userText }],
        timestamp: producerTimestampMs,
      },
    ];
    const normalizedMessages = [
      inputMessages[0],
      { role: "user", content: `${expectedPrefix}${userText}`, timestamp: producerTimestampMs },
    ];
    const provenance = captureV1JTimestampProvenance({
      producerMessages: inputMessages,
      transitionInputMessages: structuredClone(inputMessages),
      normalizedMessages,
      normalizationDiagnostics: [
        { messageIndex: 1, wrapperOperations: { timestampPrefixAdded: true } },
      ],
      timezone,
      timestampPolicyActive: true,
      timestampOverridePresent: false,
    });
    expect(provenance.reason).toBe("verified");
    expect(provenance.decoration).toMatchObject({
      source: "normalizeMessagesForLlmBoundary.stampUserTextWithMessageTimestamp",
      messageIndex: 1,
      prefixBytes: 28,
      originalContentBytes: Buffer.byteLength(userText, "utf8"),
    });

    const requestObject = {
      model: "qwen/qwen3.5-9b",
      messages: [normalizedMessages[0], normalizedMessages[1]],
      tools: Array.from({ length: 15 }, (_, index) => ({
        type: "function",
        function: {
          name: `offline-tool-${index}`,
          description: "offline identity fixture",
          parameters: { type: "object", properties: { value: { type: "string" } } },
        },
      })),
      stream: true,
      max_tokens: 128,
      temperature: 0,
    };
    const journalRows: Array<{ event: string; details: Record<string, unknown> }> = [];
    const trace = recordV1JProviderMaterializationTrace({
      capture: {
        request: {
          url: "http://127.0.0.1:1234/v1/chat/completions",
          body: requestObject,
        },
        rawBody: JSON.stringify(requestObject),
      },
      provider: "lmstudio",
      expectedCanonicalSha256: "0".repeat(64),
      timestampDecoration: provenance.decoration,
      timestampVariant: { producerTimestampMs, timezone },
      record: (event, details) => journalRows.push({ event, details }),
    });

    expect(trace.identities).toMatchObject({
      rawBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      historicalExactCanonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      stableProviderRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      stableNormalizationApplied: true,
      stableNormalizationReason: "applied",
    });
    expect(trace.stableIdentityReference).toMatchObject({
      available: true,
      stableIdentityMatches: true,
    });
    expect(trace.stableIdentityReference.providerRequestSha256).not.toBe(
      trace.identities.providerRequestSha256,
    );
    expect(journalRows).toHaveLength(1);
    expect(journalRows[0]?.details).toMatchObject({
      rawBodySha256: trace.identities.rawBodySha256,
      historicalExactCanonicalSha256: trace.identities.historicalExactCanonicalSha256,
      providerRequestSha256: trace.identities.providerRequestSha256,
      stableProviderRequestSha256: trace.identities.stableProviderRequestSha256,
      stableNormalizationApplied: true,
      stableNormalizationReason: "applied",
      stableIdentityReference: {
        available: true,
        stableIdentityMatches: true,
      },
      bodyPublicationCalls: 0,
      bodyArtifactCreated: false,
    });
    expect(JSON.stringify(journalRows)).not.toContain(userText);
    expect(JSON.stringify(journalRows)).not.toContain("private system prompt");
  });

  it.each([
    ["timestamp policy disabled", { timestampPolicyActive: false }, "timestamp-policy-not-active"],
    ["timestamp override", { timestampOverridePresent: true }, "timestamp-override-present"],
  ])("does not derive provenance when %s", (_label, overrides, expectedReason) => {
    const timezone = "America/Anchorage";
    const producerTimestampMs = Date.UTC(2026, 9, 12, 17, 30);
    const prefix = buildTimestampPrefix(new Date(producerTimestampMs), { timezone })!;
    const producerMessages = [
      { role: "user", content: "same text", timestamp: producerTimestampMs },
    ];
    const result = captureV1JTimestampProvenance({
      producerMessages,
      transitionInputMessages: structuredClone(producerMessages),
      normalizedMessages: [{ role: "user", content: `${prefix}same text` }],
      normalizationDiagnostics: [
        { messageIndex: 0, wrapperOperations: { timestampPrefixAdded: true } },
      ],
      timezone,
      timestampPolicyActive: true,
      timestampOverridePresent: false,
      ...overrides,
    });
    expect(result.decoration).toBeUndefined();
    expect(result.reason).toBe(expectedReason);
  });

  it("refuses producer pairing when the adjacent input or generated prefix disagrees", () => {
    const timezone = "America/Anchorage";
    const timestamp = Date.UTC(2026, 9, 12, 17, 30);
    const prefix = buildTimestampPrefix(new Date(timestamp), { timezone })!;
    const input = [{ role: "user", content: "original", timestamp }];
    const base = {
      producerMessages: input,
      transitionInputMessages: structuredClone(input),
      normalizedMessages: [{ role: "user", content: `${prefix}original` }],
      normalizationDiagnostics: [
        { messageIndex: 0, wrapperOperations: { timestampPrefixAdded: true } },
      ],
      timezone,
      timestampPolicyActive: true,
      timestampOverridePresent: false,
    } as const;
    expect(
      captureV1JTimestampProvenance({
        ...base,
        transitionInputMessages: [{ role: "user", content: "different", timestamp }],
      }).reason,
    ).toBe("message-pair-mismatch");
    expect(
      captureV1JTimestampProvenance({
        ...base,
        normalizedMessages: [{ role: "user", content: `${prefix}rewritten` }],
      }).reason,
    ).toBe("message-pair-mismatch");
    expect(
      captureV1JTimestampProvenance({
        ...base,
        producerMessages: [{ role: "user", content: "original", timestamp: timestamp + 60_000 }],
      }).reason,
    ).toBe("message-pair-mismatch");
  });
});
