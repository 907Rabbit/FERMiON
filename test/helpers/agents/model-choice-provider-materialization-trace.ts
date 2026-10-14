import {
  summarizeV1JRawRepeatabilityRequest,
  type V1JProviderControlEvent,
  type V1JRawRepeatabilityRequestSummary,
} from "./model-choice-provider-repeatability.js";

export type V1JProviderMaterializationRequest = {
  request: { url: string; body: Record<string, unknown> };
  rawBody: string;
};

export function recordV1JProviderMaterializationTrace(input: {
  capture: V1JProviderMaterializationRequest;
  expectedCanonicalSha256: string;
  record: (event: string, details: Record<string, unknown>) => void;
  onStage?: (event: V1JProviderControlEvent) => void;
}): V1JRawRepeatabilityRequestSummary {
  const summary = summarizeV1JRawRepeatabilityRequest(
    {
      endpoint: input.capture.request.url,
      rawBody: input.capture.rawBody,
      requestObject: input.capture.request.body,
    },
    input.onStage,
  );
  input.record("provider-bound-materialization-fingerprints", {
    preflightMode: "materialization-trace-only",
    requestJsonBytes: summary.requestJsonBytes,
    rawBodySha256: summary.requestSha256,
    canonicalRequestSha256: summary.requestCanonicalSha256,
    canonicalPinMatches: summary.requestCanonicalSha256 === input.expectedCanonicalSha256,
    bodyPublicationCalls: 0,
    bodyArtifactCreated: false,
    messageCount: summary.messageCount,
    messages: summary.messageHashes,
    toolCount: summary.toolCount,
    toolSchemaJsonBytes: summary.toolSchemaJsonBytes,
    components: summary.componentFingerprint.components,
  });
  return summary;
}
