import { createHash } from "node:crypto";
import type { EmbeddedCapabilityIntelligenceExperimentHooks } from "./params.js";

type PromptMessageTraceHook = NonNullable<
  EmbeddedCapabilityIntelligenceExperimentHooks["onPromptMessageTrace"]
>;

export type PromptTextFingerprint = {
  sha256: string;
  utf8Bytes: number;
};

export function fingerprintPromptText(
  value: string | undefined,
): PromptTextFingerprint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return {
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
    utf8Bytes: Buffer.byteLength(value, "utf8"),
  };
}

export function countRuntimeContextCarriers(messages: readonly unknown[]): number {
  return messages.filter(
    (message) =>
      message !== null &&
      typeof message === "object" &&
      (message as { runtimeContextCarrier?: unknown }).runtimeContextCarrier === true,
  ).length;
}

function providerPayloadMessages(payload: unknown): readonly unknown[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const messages = (payload as Record<string, unknown>).messages;
  return Array.isArray(messages) ? messages : [];
}

function providerPayloadSystemPromptFingerprint(
  payload: unknown,
): PromptTextFingerprint | undefined {
  const systemMessage = providerPayloadMessages(payload).find((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return false;
    }
    const role = (message as Record<string, unknown>).role;
    return role === "system" || role === "developer";
  });
  if (!systemMessage || typeof systemMessage !== "object" || Array.isArray(systemMessage)) {
    return undefined;
  }
  const content = (systemMessage as Record<string, unknown>).content;
  return typeof content === "string" ? fingerprintPromptText(content) : undefined;
}

type MaterializationTraceStage = {
  stage: string;
  source: string;
  promptAssemblySource?: string;
};

function traceMaterializationStage(
  trace: PromptMessageTraceHook | undefined,
  event: MaterializationTraceStage,
  messages: readonly unknown[],
  systemPromptFingerprint?: PromptTextFingerprint,
  callbackIndex?: number,
) {
  trace?.({
    stage: event.stage,
    messages,
    source: event.source,
    ...(systemPromptFingerprint ? { systemPromptFingerprint } : {}),
    ...(callbackIndex === undefined ? {} : { callbackIndex }),
    ...(event.promptAssemblySource ? { promptAssemblySource: event.promptAssemblySource } : {}),
  });
}

export function traceProviderAdapterInput(
  trace: PromptMessageTraceHook | undefined,
  messages: readonly unknown[],
  systemPrompt: string | undefined,
): void {
  const fingerprint = fingerprintPromptText(systemPrompt);
  for (const event of [
    { stage: "provider-adapter-input", source: "streamFn Context" },
    {
      stage: "provider-message-conversion-input",
      source: "provider message conversion input Context",
    },
  ]) {
    traceMaterializationStage(trace, event, messages, fingerprint);
  }
}

export function traceProviderPayloadStages(
  trace: PromptMessageTraceHook | undefined,
  payload: unknown,
  callbackIndex: number,
  stages: readonly MaterializationTraceStage[],
): void {
  const messages = providerPayloadMessages(payload);
  const systemFingerprint = providerPayloadSystemPromptFingerprint(payload);
  for (const stage of stages) {
    traceMaterializationStage(trace, stage, messages, systemFingerprint, callbackIndex);
  }
}
