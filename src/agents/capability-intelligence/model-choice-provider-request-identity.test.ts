import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  identifyV1JProviderRequest,
  type V1JAgentSessionTimestampDecoration,
  type V1JRawRepeatabilityCapture,
} from "../../../test/helpers/agents/model-choice-provider-repeatability.js";

function captureAt(timestampPrefix: string, userText = "private user text") {
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
    const first = captureAt("[Mon 2026-10-12 09:30 AKDT] ");
    const second = captureAt("[Tue 2026-10-13 10:45 AKDT] ");
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
    const baseline = captureAt("[Mon 2026-10-12 09:30 AKDT] ");
    const expected = identifyV1JProviderRequest({
      capture: baseline.capture,
      provider: "lmstudio",
      timestampDecoration: baseline.timestampDecoration,
    }).stableProviderRequestSha256;
    const changedUser = captureAt("[Tue 2026-10-13 10:45 AKDT] ", "different user text");
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

  it("rejects untrusted or mismatched timestamp provenance", () => {
    const timestamped = captureAt("[Mon 2026-10-12 09:30 AKDT] ");
    const unknownSource = {
      ...timestamped.timestampDecoration,
      source: "generic-leading-prefix" as unknown as V1JAgentSessionTimestampDecoration["source"],
    };
    expect(() =>
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: unknownSource,
      }),
    ).toThrow(/unknown timestamp provenance/);

    const altered = recapture(timestamped.capture, (body) => {
      const messages = body.messages as Array<Record<string, unknown>>;
      messages[1] = { ...messages[1], content: "[Mon 2026-10-12 09:30 AKDT] altered" };
    });
    expect(() =>
      identifyV1JProviderRequest({
        capture: altered,
        provider: "lmstudio",
        timestampDecoration: timestamped.timestampDecoration,
      }),
    ).toThrow(/does not match the provider user message/);

    expect(() =>
      identifyV1JProviderRequest({
        capture: timestamped.capture,
        provider: "lmstudio",
        timestampDecoration: {
          ...timestamped.timestampDecoration,
          prefixSha256: "0".repeat(64),
        },
      }),
    ).toThrow(/does not match the provider user message/);
  });
});
