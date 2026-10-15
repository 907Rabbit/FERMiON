import { createHash } from "node:crypto";
import { buildTimestampPrefix } from "../../../src/gateway/server-methods/agent-timestamp.js";
import {
  createV1JTimestampVariantCapture,
  identifyV1JProviderRequest,
  summarizeV1JRawRepeatabilityRequest,
  type V1JAgentSessionTimestampDecoration,
  type V1JProviderControlEvent,
  type V1JRawRepeatabilityRequestSummary,
} from "./model-choice-provider-repeatability.js";

export type V1JProviderMaterializationRequest = {
  request: { url: string; body: Record<string, unknown> };
  rawBody: string;
};

export type V1JTimestampProvenanceResult = {
  decoration?: V1JAgentSessionTimestampDecoration;
  reason:
    | "verified"
    | "producer-input-unavailable"
    | "transition-input-mismatch"
    | "timestamp-stamping-not-observed"
    | "timestamp-policy-not-active"
    | "timestamp-override-present"
    | "timestamp-source-unavailable"
    | "expected-prefix-unavailable"
    | "expected-prefix-length-mismatch"
    | "message-pair-mismatch";
  producerTimestampMs?: number;
  timezone?: string;
};

export type V1JStableIdentityReference = {
  available: boolean;
  reason: string;
  providerRequestSha256?: string;
  stableProviderRequestSha256?: string;
  stableIdentityMatches: boolean;
};

export type V1JProviderMaterializationTraceResult = V1JRawRepeatabilityRequestSummary & {
  identities: ReturnType<typeof identifyV1JProviderRequest>;
  stableIdentityReference: V1JStableIdentityReference;
};

type TraceMessage = { role?: unknown; content?: unknown; timestamp?: unknown };

/** Derives identity provenance only from the normalizer's adjacent in-memory input/output. */
export function captureV1JTimestampProvenance(input: {
  producerMessages?: readonly unknown[];
  transitionInputMessages?: readonly unknown[];
  normalizedMessages: readonly unknown[];
  normalizationDiagnostics?: readonly {
    messageIndex: number;
    wrapperOperations?: { timestampPrefixAdded?: boolean };
  }[];
  timezone: string;
  timestampPolicyActive: boolean;
  timestampOverridePresent: boolean;
}): V1JTimestampProvenanceResult {
  if (!input.producerMessages || !input.transitionInputMessages) {
    return { reason: "producer-input-unavailable" };
  }
  if (input.producerMessages.length !== input.transitionInputMessages.length) {
    return { reason: "transition-input-mismatch" };
  }
  const candidates = (input.normalizationDiagnostics ?? []).filter(
    (diagnostic) => diagnostic.wrapperOperations?.timestampPrefixAdded === true,
  );
  if (candidates.length !== 1) {
    return { reason: "timestamp-stamping-not-observed" };
  }
  if (!input.timestampPolicyActive) {
    return { reason: "timestamp-policy-not-active" };
  }
  if (input.timestampOverridePresent) {
    return { reason: "timestamp-override-present" };
  }

  const { messageIndex } = candidates[0]!;
  const source = asTraceMessage(input.producerMessages[messageIndex]);
  const before = asTraceMessage(input.transitionInputMessages[messageIndex]);
  const after = asTraceMessage(input.normalizedMessages[messageIndex]);
  if (
    !source ||
    !before ||
    !after ||
    source.role !== "user" ||
    before.role !== source.role ||
    after.role !== "user" ||
    !sameContent(source.content, before.content)
  ) {
    return { reason: "message-pair-mismatch" };
  }
  if (typeof source.timestamp !== "number" || !Number.isFinite(source.timestamp)) {
    return { reason: "timestamp-source-unavailable" };
  }
  const originalText = singleTextValue(before.content);
  const normalizedText = typeof after.content === "string" ? after.content : undefined;
  if (originalText === undefined || normalizedText === undefined) {
    return { reason: "message-pair-mismatch" };
  }
  const expectedPrefix = buildTimestampPrefix(new Date(source.timestamp), {
    timezone: input.timezone,
  });
  if (!expectedPrefix) {
    return { reason: "expected-prefix-unavailable" };
  }
  const prefixBytes = Buffer.from(expectedPrefix, "utf8");
  if (prefixBytes.byteLength !== 28) {
    return { reason: "expected-prefix-length-mismatch" };
  }
  if (normalizedText !== `${expectedPrefix}${originalText}`) {
    return { reason: "message-pair-mismatch" };
  }
  return {
    decoration: {
      source: "normalizeMessagesForLlmBoundary.stampUserTextWithMessageTimestamp",
      messageIndex,
      prefixSha256: hash(prefixBytes),
      producerTimestampSha256: hash(String(source.timestamp)),
      timezoneSha256: hash(input.timezone),
      originalContentSha256: hash(Buffer.from(originalText, "utf8")),
      originalContentBytes: Buffer.byteLength(originalText, "utf8"),
      prefixBytes: prefixBytes.byteLength,
    },
    reason: "verified",
    producerTimestampMs: source.timestamp,
    timezone: input.timezone,
  };
}

/** Compares against an offline clone whose only changed request field is its generated timestamp. */
export function compareV1JStableIdentityWithTimestampVariant(input: {
  capture: V1JProviderMaterializationRequest;
  provider: string;
  timestampDecoration: V1JAgentSessionTimestampDecoration;
  producerTimestampMs: number;
  timezone: string;
}): V1JStableIdentityReference {
  if (!Number.isFinite(input.producerTimestampMs)) {
    return {
      available: false,
      reason: "producer-timestamp-unavailable",
      stableIdentityMatches: false,
    };
  }
  const timestampVariantMs = input.producerTimestampMs + 24 * 60 * 60 * 1000;
  const replacementPrefix = buildTimestampPrefix(new Date(timestampVariantMs), {
    timezone: input.timezone,
  });
  if (!replacementPrefix || Buffer.byteLength(replacementPrefix, "utf8") !== 28) {
    return {
      available: false,
      reason: "timestamp-variant-prefix-invalid",
      stableIdentityMatches: false,
    };
  }
  const firstIdentity = identifyV1JProviderRequest({
    capture: {
      endpoint: input.capture.request.url,
      rawBody: input.capture.rawBody,
      requestObject: input.capture.request.body,
    },
    provider: input.provider,
    timestampDecoration: input.timestampDecoration,
  });
  if (!firstIdentity.stableNormalizationApplied) {
    return {
      available: false,
      reason: firstIdentity.stableNormalizationReason,
      stableIdentityMatches: false,
    };
  }
  const variant = createV1JTimestampVariantCapture({
    capture: {
      endpoint: input.capture.request.url,
      rawBody: input.capture.rawBody,
      requestObject: input.capture.request.body,
    },
    provider: input.provider,
    timestampDecoration: input.timestampDecoration,
    replacementPrefix,
    replacementTimestampSha256: hash(String(timestampVariantMs)),
  });
  const variantIdentity = identifyV1JProviderRequest({
    capture: variant.capture,
    provider: input.provider,
    timestampDecoration: variant.timestampDecoration,
  });
  return {
    available: true,
    reason: "independent-timestamp-variant-created-in-memory",
    providerRequestSha256: variantIdentity.providerRequestSha256,
    stableProviderRequestSha256: variantIdentity.stableProviderRequestSha256,
    stableIdentityMatches:
      firstIdentity.stableProviderRequestSha256 === variantIdentity.stableProviderRequestSha256,
  };
}

export function recordV1JProviderMaterializationTrace(input: {
  capture: V1JProviderMaterializationRequest;
  provider: string;
  expectedCanonicalSha256: string;
  timestampDecoration?: V1JAgentSessionTimestampDecoration;
  timestampVariant?: { producerTimestampMs: number; timezone: string };
  record: (event: string, details: Record<string, unknown>) => void;
  onStage?: (event: V1JProviderControlEvent) => void;
}): V1JProviderMaterializationTraceResult {
  const summary = summarizeV1JRawRepeatabilityRequest(
    {
      endpoint: input.capture.request.url,
      rawBody: input.capture.rawBody,
      requestObject: input.capture.request.body,
    },
    input.onStage,
  );
  const identities = identifyV1JProviderRequest({
    capture: {
      endpoint: input.capture.request.url,
      rawBody: input.capture.rawBody,
      requestObject: input.capture.request.body,
    },
    provider: input.provider,
    ...(input.timestampDecoration ? { timestampDecoration: input.timestampDecoration } : {}),
  });
  const stableIdentityReference =
    input.timestampDecoration && input.timestampVariant
      ? compareV1JStableIdentityWithTimestampVariant({
          capture: input.capture,
          provider: input.provider,
          timestampDecoration: input.timestampDecoration,
          ...input.timestampVariant,
        })
      : ({
          available: false,
          reason: input.timestampDecoration
            ? "timestamp-variant-input-unavailable"
            : "timestamp-provenance-unavailable",
          stableIdentityMatches: false,
        } satisfies V1JStableIdentityReference);
  input.record("provider-bound-materialization-fingerprints", {
    preflightMode: "materialization-trace-only",
    requestJsonBytes: summary.requestJsonBytes,
    rawBodySha256: identities.rawBodySha256,
    historicalExactCanonicalSha256: identities.historicalExactCanonicalSha256,
    providerRequestSha256: identities.providerRequestSha256,
    stableProviderRequestSha256: identities.stableProviderRequestSha256,
    stableNormalizationApplied: identities.stableNormalizationApplied,
    stableNormalizationReason: identities.stableNormalizationReason,
    stableIdentityReference,
    timestampProvenance: input.timestampDecoration
      ? {
          source: input.timestampDecoration.source,
          messageIndex: input.timestampDecoration.messageIndex,
          prefixBytes: input.timestampDecoration.prefixBytes,
          prefixSha256: input.timestampDecoration.prefixSha256,
          producerTimestampSha256: input.timestampDecoration.producerTimestampSha256,
          timezoneSha256: input.timestampDecoration.timezoneSha256,
          originalContentSha256: input.timestampDecoration.originalContentSha256,
          originalContentBytes: input.timestampDecoration.originalContentBytes,
        }
      : null,
    canonicalRequestSha256: identities.historicalExactCanonicalSha256,
    canonicalPinMatches: summary.requestCanonicalSha256 === input.expectedCanonicalSha256,
    bodyPublicationCalls: 0,
    bodyArtifactCreated: false,
    messageCount: summary.messageCount,
    messages: summary.messageHashes,
    toolCount: summary.toolCount,
    toolSchemaJsonBytes: summary.toolSchemaJsonBytes,
    components: summary.componentFingerprint.components,
  });
  return { ...summary, identities, stableIdentityReference };
}

function asTraceMessage(value: unknown): TraceMessage | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TraceMessage)
    : undefined;
}

function singleTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value) || value.length !== 1) {
    return undefined;
  }
  const block = value[0];
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return undefined;
  }
  const textBlock = block as { type?: unknown; text?: unknown };
  return textBlock.type === "text" && typeof textBlock.text === "string"
    ? textBlock.text
    : undefined;
}

function sameContent(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
