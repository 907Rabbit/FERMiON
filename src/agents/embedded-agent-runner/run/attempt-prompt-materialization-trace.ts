import { createHash } from "node:crypto";
import type { EmbeddedCapabilityIntelligenceExperimentHooks } from "./params.js";

type PromptMessageTraceHook = NonNullable<
  EmbeddedCapabilityIntelligenceExperimentHooks["onPromptMessageTrace"]
>;

export type PromptTextFingerprint = {
  sha256: string;
  utf8Bytes: number;
};

export type PromptComponentFingerprint = {
  sectionName: string;
  present: boolean;
  sha256: string | null;
  utf8Bytes: number | null;
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

/** Fingerprints paragraph-sized prompt components without retaining prompt text. */
export function fingerprintPromptComponents(
  value: string | undefined,
): PromptComponentFingerprint[] {
  if (value === undefined) {
    return [];
  }
  const components = value.split(/\r?\n(?:[ \t]*\r?\n)+/u).filter((part) => part.length > 0);
  return components.map((part, index) => ({
    sectionName: `paragraph-${index}`,
    present: true,
    sha256: fingerprintPromptText(part)?.sha256 ?? null,
    utf8Bytes: Buffer.byteLength(part, "utf8"),
  }));
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

function providerPayloadSystemPrompt(payload: unknown): string | undefined {
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
  return typeof content === "string" ? content : undefined;
}

type MaterializationTraceStage = {
  stage: string;
  source: string;
  promptAssemblySource?: string;
  systemPromptComponents?: PromptComponentFingerprint[];
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
    ...(event.systemPromptComponents
      ? { systemPromptComponents: event.systemPromptComponents }
      : {}),
  });
}

export function traceProviderAdapterInput(
  trace: PromptMessageTraceHook | undefined,
  messages: readonly unknown[],
  systemPrompt: string | undefined,
): void {
  const fingerprint = fingerprintPromptText(systemPrompt);
  const systemPromptComponents = fingerprintPromptComponents(systemPrompt);
  for (const event of [
    { stage: "provider-adapter-input", source: "streamFn Context", systemPromptComponents },
    {
      stage: "provider-message-conversion-input",
      source: "provider message conversion input Context",
      systemPromptComponents,
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
  const systemPrompt = providerPayloadSystemPrompt(payload);
  const systemFingerprint = fingerprintPromptText(systemPrompt);
  const systemPromptComponents = fingerprintPromptComponents(systemPrompt);
  for (const stage of stages) {
    traceMaterializationStage(
      trace,
      { ...stage, systemPromptComponents },
      messages,
      systemFingerprint,
      callbackIndex,
    );
  }
}
