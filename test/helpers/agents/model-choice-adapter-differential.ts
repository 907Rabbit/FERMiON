import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import {
  getGlobalPluginRegistry,
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../../../src/plugins/hook-runner-global.js";
import { createMockPluginRegistry } from "../../../src/plugins/hooks.test-fixtures.js";
import type { PluginRegistry } from "../../../src/plugins/registry-types.js";
import { getPluginRuntimeGenerationRegistry } from "../../../src/plugins/runtime/generation-scope.js";
import {
  runV1JProviderTransportControls,
  type V1JProviderControlFetch,
  type V1JProviderControlResult,
} from "./model-choice-provider-isolation.js";

export const V1J_ADAPTER_DIFFERENTIAL_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_ADAPTER_DIFFERENTIAL_PREFIX = "adapter-differential-";
export const V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG = "OPENCLAW_V1J_ADAPTER_DIFFERENTIAL";
export const V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG =
  "OPENCLAW_V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED";
export const V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG = "OPENCLAW_V1J_ADAPTER_DIFFERENTIAL_COMMIT";

export type V1JAdapterDifferentialJournal = {
  root: string;
  filePath: string;
  record: (event: string, details?: Record<string, unknown>) => void;
  close: () => void;
};

export type V1JAdapterDifferentialRequestMetrics = {
  requestJsonBytes: number;
  messageCount: number;
  totalMessageContentBytes: number;
  toolCount: number;
  toolSchemaJsonBytes: number;
  requestSha256: string;
  canonicalRequestSha256: string;
  messagesCanonicalSha256: string;
  toolsCanonicalSha256: string;
  messages: V1JAdapterDifferentialMessageFingerprint[];
  providerOptions: V1JAdapterDifferentialOptionFingerprint[];
};

export type V1JAdapterDifferentialMessageFingerprint = {
  index: number;
  role: string;
  contentSha256: string;
  contentBytes: number;
};

export type V1JAdapterDifferentialOptionFingerprint = {
  name: string;
  valueType: string;
  valueSha256: string;
  safeValue?: string | number | boolean;
};

export type V1JAdapterDifferentialRequestComparison = {
  rawRequestSha256: string;
  adapterRequestSha256: string;
  rawCanonicalRequestSha256: string;
  adapterCanonicalRequestSha256: string;
  requestMatch: boolean;
  canonicalMatch: boolean;
  differingPaths: string[];
};

export type V1JAdapterDifferentialFieldFingerprint = {
  present: boolean;
  valueType: "missing" | "null" | "array" | "object" | "string" | "number" | "boolean";
  valueSha256: string | null;
  valueBytes: number;
};

export type V1JAdapterDifferentialDispatchContext = {
  preparedRuntimeReadyAtMs?: number;
  schemaPreflightCompletedAtMs: number;
  modelDiscoveryStatus: string;
  requestTimeoutMs: number;
};

export const V1J_ADAPTER_DIFFERENTIAL_MAX_RAW_REQUESTS = 1;
export const V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS = 2;
export const V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS = 3;
export const V1J_ADAPTER_DIFFERENTIAL_HEARTBEAT_MS = 25_000;

export type V1JAdapterDifferentialProgressEvent = {
  event: "stage-start" | "checkpoint" | "heartbeat" | "stage-complete" | "stage-failed";
  stage: string;
  elapsedMs: number;
};

export function reportV1JAdapterDifferentialProgress(
  event: V1JAdapterDifferentialProgressEvent,
  write: (line: string) => void = (line) => process.stdout.write(line),
): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(event.stage)) {
    throw new Error("v1J adapter differential progress stage is invalid");
  }
  write(`[v1J adapter differential] ${JSON.stringify(event)}\n`);
}

export async function withV1JAdapterDifferentialProgress<T>(input: {
  stage: string;
  operation: (checkpoint: (stage: string) => void) => Promise<T> | T;
  heartbeatMs?: number;
  onProgress?: (event: V1JAdapterDifferentialProgressEvent) => void;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}): Promise<T> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.stage)) {
    throw new Error("v1J adapter differential progress stage is invalid");
  }
  const heartbeatMs = input.heartbeatMs ?? V1J_ADAPTER_DIFFERENTIAL_HEARTBEAT_MS;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error("v1J adapter differential heartbeat interval is invalid");
  }
  const now = input.now ?? (() => performance.now());
  const setIntervalFn = input.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = input.clearInterval ?? globalThis.clearInterval;
  const startedAt = now();
  let activeStage = input.stage;
  const report = (event: V1JAdapterDifferentialProgressEvent["event"], stage = activeStage) => {
    const progressEvent = {
      event,
      stage,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
    } satisfies V1JAdapterDifferentialProgressEvent;
    (input.onProgress ?? reportV1JAdapterDifferentialProgress)(progressEvent);
  };
  report("stage-start");
  const interval = setIntervalFn(() => report("heartbeat"), heartbeatMs);
  interval.unref?.();
  try {
    const result = await input.operation((stage) => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(stage)) {
        throw new Error("v1J adapter differential progress stage is invalid");
      }
      activeStage = stage;
      report("checkpoint");
    });
    report("stage-complete", input.stage);
    return result;
  } catch (error) {
    report("stage-failed");
    throw error;
  } finally {
    clearIntervalFn(interval);
  }
}

export type V1JAdapterDifferentialToolGuard = {
  ensureInstalled: () => void;
  restore: () => void;
  readDispatches: () => number;
  blockedToolCalls: () => number;
};

/** Installs a diagnostic-only pre-execution policy without changing tool exposure. */
export function installV1JAdapterDifferentialToolGuard(input: {
  workspaceRoot: string;
  journal?: V1JAdapterDifferentialJournal;
}): V1JAdapterDifferentialToolGuard {
  const workspaceRoot = fs.realpathSync(input.workspaceRoot);
  const expectedTarget = path.join(workspaceRoot, "smoke-reference.txt");
  let priorRegistry = getGlobalPluginRegistry();
  let installedRegistry: PluginRegistry | undefined;
  const generationRegistries = new Map<PluginRegistry, PluginRegistry["typedHooks"][number]>();
  let readDispatchCount = 0;
  let blockedCount = 0;
  let blocked = false;
  let restored = false;

  const allowExactRead = (toolName: unknown, params: unknown): boolean => {
    if (blocked || toolName !== "read" || !isRecord(params)) {
      return false;
    }
    const keys = Object.keys(params);
    if (keys.length !== 1 || keys[0] !== "path" || params.path !== "smoke-reference.txt") {
      return false;
    }
    try {
      const target = fs.lstatSync(expectedTarget);
      return (
        target.isFile() &&
        !target.isSymbolicLink() &&
        fs.realpathSync(expectedTarget) === expectedTarget &&
        path.dirname(expectedTarget) === workspaceRoot &&
        path.resolve(workspaceRoot, params.path) === expectedTarget
      );
    } catch {
      return false;
    }
  };

  const guardRegistry = createMockPluginRegistry([
    {
      pluginId: "v1j-adapter-differential-guard",
      hookName: "before_tool_call",
      registrationId: "v1j-adapter-differential-guard",
      priority: Number.MAX_SAFE_INTEGER,
      handler: (event: unknown) => {
        const allowed = isRecord(event) && allowExactRead(event.toolName, event.params);
        if (allowed) {
          readDispatchCount += 1;
          input.journal?.record("adapter-tool-execution-guard", {
            outcome: "read-allowed",
            allowedReadDispatches: readDispatchCount,
          });
          return { params: { path: "smoke-reference.txt" } };
        }
        blocked = true;
        blockedCount += 1;
        input.journal?.record("adapter-tool-execution-guard", {
          outcome: "blocked",
          blockedToolCalls: blockedCount,
        });
        return {
          block: true,
          blockReason: "This diagnostic permits only reading its smoke reference file.",
        };
      },
    },
  ]);

  const ensureInstalled = () => {
    if (restored) {
      throw new Error("v1J adapter differential tool guard was already restored");
    }
    const generationRegistry = getPluginRuntimeGenerationRegistry();
    if (generationRegistry && !generationRegistries.has(generationRegistry)) {
      generationRegistry.typedHooks.push(...guardRegistry.typedHooks);
      generationRegistry.plugins.push(...guardRegistry.plugins);
      generationRegistries.set(generationRegistry, guardRegistry.typedHooks[0]!);
      if (
        !generationRegistry.typedHooks.some(
          (hook) => hook.registrationId === "v1j-adapter-differential-guard",
        )
      ) {
        throw new Error("v1J adapter differential guard did not bind to the active runtime");
      }
    }
    const activeRegistry = getGlobalPluginRegistry();
    if (installedRegistry && activeRegistry === installedRegistry) {
      return;
    }
    priorRegistry = activeRegistry;
    const registry = activeRegistry
      ? ({
          ...activeRegistry,
          hooks: [...activeRegistry.hooks],
          typedHooks: [...activeRegistry.typedHooks, ...guardRegistry.typedHooks],
          plugins: [...activeRegistry.plugins, ...guardRegistry.plugins],
        } as PluginRegistry)
      : guardRegistry;
    installedRegistry = registry;
    initializeGlobalHookRunner(registry);
  };

  ensureInstalled();
  return {
    ensureInstalled,
    readDispatches: () => readDispatchCount,
    blockedToolCalls: () => blockedCount,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      for (const [registry, hook] of generationRegistries) {
        const hookIndex = registry.typedHooks.indexOf(hook);
        if (hookIndex >= 0) {
          registry.typedHooks.splice(hookIndex, 1);
        }
        const pluginIndex = registry.plugins.findIndex(
          (plugin) => plugin.id === "v1j-adapter-differential-guard",
        );
        if (pluginIndex >= 0) {
          registry.plugins.splice(pluginIndex, 1);
        }
      }
      if (getGlobalPluginRegistry() !== installedRegistry) {
        return;
      }
      if (priorRegistry) {
        initializeGlobalHookRunner(priorRegistry);
      } else {
        resetGlobalHookRunner();
      }
    },
  };
}

export function assertV1JAdapterDifferentialRequestBudget(input: {
  rawRequests: number;
  adapterRequests: number;
}): void {
  if (
    !Number.isSafeInteger(input.rawRequests) ||
    !Number.isSafeInteger(input.adapterRequests) ||
    input.rawRequests < 0 ||
    input.adapterRequests < 0 ||
    input.rawRequests > V1J_ADAPTER_DIFFERENTIAL_MAX_RAW_REQUESTS ||
    input.adapterRequests > V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS ||
    input.rawRequests + input.adapterRequests > V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS
  ) {
    throw new Error("v1J adapter differential exceeded its fixed model-request budget");
  }
}

export function assertV1JAdapterDifferentialRequestMatch(
  rawRequest: Record<string, unknown>,
  adapterRequest: Record<string, unknown>,
): V1JAdapterDifferentialRequestComparison {
  const comparison = compareV1JAdapterDifferentialRequests(rawRequest, adapterRequest);
  if (!comparison.canonicalMatch) {
    throw new Error(
      `v1J raw transport and adapter request bodies differ at: ${comparison.differingPaths.join(",")}`,
    );
  }
  return comparison;
}

export function compareV1JAdapterDifferentialRequests(
  rawRequest: Record<string, unknown>,
  adapterRequest: Record<string, unknown>,
  adapterRawBody?: string,
  rawRawBody?: string,
): V1JAdapterDifferentialRequestComparison {
  const raw = summarizeV1JAdapterDifferentialRequest(rawRequest, rawRawBody);
  const adapter = summarizeV1JAdapterDifferentialRequest(adapterRequest, adapterRawBody);
  const differingPaths: string[] = [];
  collectDifferingJsonPaths(rawRequest, adapterRequest, "", differingPaths);
  return {
    rawRequestSha256: raw.requestSha256,
    adapterRequestSha256: adapter.requestSha256,
    rawCanonicalRequestSha256: raw.canonicalRequestSha256,
    adapterCanonicalRequestSha256: adapter.canonicalRequestSha256,
    requestMatch: raw.requestSha256 === adapter.requestSha256,
    canonicalMatch: raw.canonicalRequestSha256 === adapter.canonicalRequestSha256,
    differingPaths,
  };
}

export function fingerprintV1JAdapterDifferentialField(
  body: Record<string, unknown>,
  jsonPath: string,
): V1JAdapterDifferentialFieldFingerprint {
  let value: unknown = body;
  for (const segment of jsonPath.split(".")) {
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment) || !Object.hasOwn(value, segment)) {
        return { present: false, valueType: "missing", valueSha256: null, valueBytes: 0 };
      }
      value = value[Number(segment)];
      continue;
    }
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return { present: false, valueType: "missing", valueSha256: null, valueBytes: 0 };
    }
    value = (value as Record<string, unknown>)[segment];
  }
  const canonicalValue = canonicalJson(value);
  let valueType: V1JAdapterDifferentialFieldFingerprint["valueType"];
  if (value === null) {
    valueType = "null";
  } else if (Array.isArray(value)) {
    valueType = "array";
  } else {
    switch (typeof value) {
      case "string":
        valueType = "string";
        break;
      case "number":
        valueType = "number";
        break;
      case "boolean":
        valueType = "boolean";
        break;
      case "object":
        valueType = "object";
        break;
      default:
        throw new Error("request field is not JSON serializable");
    }
  }
  return {
    present: true,
    valueType,
    valueSha256: createHash("sha256").update(canonicalValue, "utf8").digest("hex"),
    valueBytes: Buffer.byteLength(canonicalValue, "utf8"),
  };
}

export function recordV1JAdapterDifferentialRequestFingerprint(input: {
  journal: V1JAdapterDifferentialJournal;
  event: string;
  body: Record<string, unknown>;
  rawBody?: string;
  requestIndex?: number;
  dispatchOrdinal?: number;
  dispatched?: boolean;
}): V1JAdapterDifferentialRequestMetrics {
  const summary = summarizeV1JAdapterDifferentialRequest(input.body, input.rawBody);
  input.journal.record(input.event, {
    requestIndex: input.requestIndex,
    dispatchOrdinal: input.dispatchOrdinal,
    dispatched: input.dispatched,
    requestJsonBytes: summary.requestJsonBytes,
    messageCount: summary.messageCount,
    totalMessageContentBytes: summary.totalMessageContentBytes,
    toolCount: summary.toolCount,
    toolSchemaJsonBytes: summary.toolSchemaJsonBytes,
    requestSha256: summary.requestSha256,
    canonicalRequestSha256: summary.canonicalRequestSha256,
    messagesCanonicalSha256: summary.messagesCanonicalSha256,
    toolsCanonicalSha256: summary.toolsCanonicalSha256,
  });
  for (const message of summary.messages) {
    input.journal.record("request-message-fingerprint", {
      requestIndex: input.requestIndex,
      dispatchOrdinal: input.dispatchOrdinal,
      messageIndex: message.index,
      messageRole: message.role,
      messageContentSha256: message.contentSha256,
      messageContentBytes: message.contentBytes,
    });
  }
  for (const option of summary.providerOptions) {
    input.journal.record("request-option-fingerprint", {
      requestIndex: input.requestIndex,
      dispatchOrdinal: input.dispatchOrdinal,
      optionName: option.name,
      optionValueType: option.valueType,
      optionValueSha256: option.valueSha256,
      ...(typeof option.safeValue === "string" ? { optionValueString: option.safeValue } : {}),
      ...(typeof option.safeValue === "number" ? { optionValueNumber: option.safeValue } : {}),
      ...(typeof option.safeValue === "boolean" ? { optionValueBoolean: option.safeValue } : {}),
    });
  }
  return summary;
}

const SAFE_DETAIL_KEYS = new Set([
  "requestIndex",
  "stage",
  "outcome",
  "elapsedMs",
  "httpStatus",
  "contentType",
  "responseFirstByteMs",
  "responseChunkCount",
  "responseByteCount",
  "toolCallCount",
  "allowedReadDispatches",
  "blockedToolCalls",
  "executionCount",
  "correlationStatus",
  "modelLoopStatus",
  "terminalEvidenceComplete",
  "providerResponseObserved",
  "requestJsonBytes",
  "messageCount",
  "totalMessageContentBytes",
  "toolCount",
  "toolSchemaJsonBytes",
  "canonicalRequestSha256",
  "requestSha256",
  "messagesCanonicalSha256",
  "toolsCanonicalSha256",
  "rawRequestSha256",
  "adapterRequestSha256",
  "rawCanonicalRequestSha256",
  "adapterCanonicalRequestSha256",
  "requestMatch",
  "canonicalMatch",
  "differingPath",
  "rawValueSource",
  "adapterCandidateSource",
  "adapterWireSource",
  "rawValuePresent",
  "rawValueType",
  "rawValueSha256",
  "rawValueBytes",
  "adapterCandidateValuePresent",
  "adapterCandidateValueType",
  "adapterCandidateValueSha256",
  "adapterCandidateValueBytes",
  "adapterWireValuePresent",
  "adapterWireValueType",
  "adapterWireValueSha256",
  "adapterWireValueBytes",
  "messageIndex",
  "messageRole",
  "messageContentSha256",
  "messageContentBytes",
  "optionName",
  "optionValueType",
  "optionValueSha256",
  "optionValueString",
  "optionValueNumber",
  "optionValueBoolean",
  "dispatchOrdinal",
  "dispatchStartedAt",
  "timeSincePreparedRuntimeReadyMs",
  "timeSinceSchemaPreflightCompleteMs",
  "modelDiscoveryStatus",
  "requestTimeoutMs",
  "toolChoicePresent",
  "toolChoiceValueType",
  "toolChoiceSha256",
  "toolChoiceBytes",
  "dispatched",
  "errorClass",
  "errorCode",
  "timeoutState",
]);

export function assertV1JAdapterDifferentialPreflight(input: {
  env: Record<string, string | undefined>;
  head: string;
  trackedTreeClean: boolean;
  activeFilteringEnabled: boolean;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  protocolSha256: string;
  detachedProtocolSha256: string;
  schema: Record<string, unknown>;
  provenanceAccepted: boolean;
  artifactExists: boolean;
}): void {
  const allowedFlags = new Set([
    V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG,
    V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG,
    V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG,
  ]);
  if (
    input.env[V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG] !== "1" ||
    input.env[V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG] !== "1" ||
    input.env[V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG] !== input.head
  ) {
    throw new Error("v1J adapter differential requires exact commit-bound authorization flags");
  }
  const conflictingFlags = Object.entries(input.env)
    .filter(
      ([key, value]) =>
        value !== undefined && /^(OPENCLAW_V1[IJ]_)/.test(key) && !allowedFlags.has(key),
    )
    .map(([key]) => key);
  if (conflictingFlags.length > 0) {
    throw new Error(
      `v1J adapter differential cannot share live modes: ${conflictingFlags.join(",")}`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(input.head) || !input.trackedTreeClean) {
    throw new Error("v1J adapter differential requires the clean committed harness HEAD");
  }
  if (input.activeFilteringEnabled !== false) {
    throw new Error("v1J adapter differential requires active filtering to remain disabled");
  }
  if (
    input.modelId !== "qwen/qwen3.5-9b" ||
    input.provider !== "lmstudio" ||
    input.contextLength !== 262_144 ||
    input.modelConfigHash !== "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529"
  ) {
    throw new Error("v1J adapter differential model configuration drifted");
  }
  const detached = input.detachedProtocolSha256.trim().split(/\s+/)[0]?.toLowerCase();
  if (
    input.protocolSha256 !== "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172" ||
    detached !== input.protocolSha256
  ) {
    throw new Error("accepted v1J preregistration hash mismatch");
  }
  const expected = {
    authorizedToolCount: 15,
    providerToolCount: 15,
    authorizedToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
    providerToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
    authorizedToolSchemaSha256: "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128",
    providerToolSchemaSha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
  };
  if (Object.entries(expected).some(([key, value]) => input.schema[key] !== value)) {
    throw new Error("v1J adapter differential schema fingerprints drifted");
  }
  if (!input.provenanceAccepted) {
    throw new Error("v1J adapter differential provenance amendment is not accepted");
  }
  if (input.artifactExists) {
    throw new Error("v1J adapter differential artifact directory already exists");
  }
}

export function summarizeV1JAdapterDifferentialRequest(
  body: Record<string, unknown>,
  rawBody = JSON.stringify(body),
): V1JAdapterDifferentialRequestMetrics {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const messageFingerprints = messages.map((message, index) => {
    const record =
      message && typeof message === "object" ? (message as Record<string, unknown>) : {};
    const content = record.content;
    const serializedContent =
      typeof content === "string" ? content : canonicalJson(content === undefined ? null : content);
    return {
      index,
      role: typeof record.role === "string" ? record.role : "unknown",
      contentSha256: createHash("sha256").update(serializedContent, "utf8").digest("hex"),
      contentBytes: Buffer.byteLength(serializedContent, "utf8"),
    };
  });
  const providerOptions = Object.entries(body)
    .filter(
      ([key]) =>
        key !== "messages" &&
        key !== "tools" &&
        !/(?:authorization|api.?key|secret|password|credential|access[_-]?token|refresh[_-]?token|^token$)/i.test(
          key,
        ),
    )
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => {
      const option: V1JAdapterDifferentialOptionFingerprint = {
        name,
        valueType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        valueSha256: createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"),
      };
      if (
        (typeof value === "string" && name === "model") ||
        (typeof value === "number" && ["max_tokens", "temperature", "top_p"].includes(name)) ||
        (typeof value === "boolean" && name === "stream")
      ) {
        option.safeValue = value;
      }
      return option;
    });
  const canonicalMessages = canonicalJson(messages);
  const canonicalTools = canonicalJson(tools);
  return {
    requestJsonBytes: Buffer.byteLength(rawBody, "utf8"),
    messageCount: messages.length,
    totalMessageContentBytes: messages.reduce((total, message) => {
      if (!message || typeof message !== "object" || !("content" in message)) {
        return total;
      }
      const content = (message as { content?: unknown }).content;
      return (
        total +
        Buffer.byteLength(typeof content === "string" ? content : JSON.stringify(content), "utf8")
      );
    }, 0),
    toolCount: tools.length,
    toolSchemaJsonBytes: Buffer.byteLength(JSON.stringify(tools), "utf8"),
    requestSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
    canonicalRequestSha256: createHash("sha256").update(canonicalJson(body), "utf8").digest("hex"),
    messagesCanonicalSha256: createHash("sha256").update(canonicalMessages, "utf8").digest("hex"),
    toolsCanonicalSha256: createHash("sha256").update(canonicalTools, "utf8").digest("hex"),
    messages: messageFingerprints,
    providerOptions,
  };
}

function collectDifferingJsonPaths(
  left: unknown,
  right: unknown,
  prefix: string,
  output: string[],
): void {
  if (Object.is(left, right)) {
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const jsonPath = prefix ? `${prefix}.${index}` : String(index);
      if (index >= left.length || index >= right.length) {
        output.push(jsonPath);
      } else {
        collectDifferingJsonPaths(left[index], right[index], jsonPath, output);
      }
    }
    return;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].toSorted();
    for (const key of keys) {
      const jsonPath = prefix ? `${prefix}.${key}` : key;
      if (!Object.hasOwn(leftRecord, key) || !Object.hasOwn(rightRecord, key)) {
        output.push(jsonPath);
      } else {
        collectDifferingJsonPaths(leftRecord[key], rightRecord[key], jsonPath, output);
      }
    }
    return;
  }
  output.push(prefix || "root");
}

export async function runV1JAdapterDifferentialRawTransport(input: {
  endpoint: string;
  authorization: string;
  requestBody: Record<string, unknown>;
  serializedRequestBody: string;
  fetchImpl: V1JProviderControlFetch;
  journal: V1JAdapterDifferentialJournal;
  dispatchContext?: V1JAdapterDifferentialDispatchContext;
  timeoutMs?: number;
  heartbeatMs?: number;
}): Promise<V1JProviderControlResult> {
  let parsedRequestBody: unknown;
  try {
    parsedRequestBody = JSON.parse(input.serializedRequestBody);
  } catch {
    throw new Error("v1J adapter differential captured provider body is not valid JSON");
  }
  if (
    !isRecord(parsedRequestBody) ||
    canonicalJson(parsedRequestBody) !== canonicalJson(input.requestBody)
  ) {
    throw new Error("v1J adapter differential provider body does not match its captured request");
  }
  if (
    input.requestBody.stream !== true ||
    !Array.isArray(input.requestBody.tools) ||
    input.requestBody.tools.length !== 15
  ) {
    throw new Error("v1J adapter differential requires the captured streaming 15-tool request");
  }
  recordV1JAdapterDifferentialRequestFingerprint({
    journal: input.journal,
    event: "raw-transport-request-ready",
    body: input.requestBody,
    rawBody: input.serializedRequestBody,
    dispatched: false,
  });
  let dispatches = 0;
  const results = await runV1JProviderTransportControls({
    endpoint: input.endpoint,
    model: typeof input.requestBody.model === "string" ? input.requestBody.model : "",
    authorization: input.authorization,
    requests: [
      {
        mode: "C",
        requestObject: input.requestBody,
        serializedRequestBody: input.serializedRequestBody,
      },
    ],
    fetchImpl: (request, init) => {
      dispatches += 1;
      if (dispatches > V1J_ADAPTER_DIFFERENTIAL_MAX_RAW_REQUESTS) {
        throw new Error("v1J adapter differential raw transport exceeded its one-request limit");
      }
      const dispatchStartedAt = Date.now();
      input.journal.record("raw-request-dispatch-start", {
        dispatchOrdinal: dispatches,
        dispatchStartedAt: new Date(dispatchStartedAt).toISOString(),
        timeSincePreparedRuntimeReadyMs:
          input.dispatchContext?.preparedRuntimeReadyAtMs === undefined
            ? undefined
            : Math.max(0, dispatchStartedAt - input.dispatchContext.preparedRuntimeReadyAtMs),
        timeSinceSchemaPreflightCompleteMs: Math.max(
          0,
          dispatchStartedAt -
            (input.dispatchContext?.schemaPreflightCompletedAtMs ?? dispatchStartedAt),
        ),
        modelDiscoveryStatus: input.dispatchContext?.modelDiscoveryStatus ?? "unrecorded",
        requestTimeoutMs: input.dispatchContext?.requestTimeoutMs ?? input.timeoutMs ?? 120_000,
      });
      const requestBody = init?.body;
      const rawBody = typeof requestBody === "string" ? requestBody : undefined;
      if (rawBody !== undefined) {
        input.journal.record("raw-request-wire-fingerprint", {
          dispatchOrdinal: dispatches,
          requestSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
          requestJsonBytes: Buffer.byteLength(rawBody, "utf8"),
        });
      }
      return input.fetchImpl(request, init);
    },
    timeoutMs: input.timeoutMs,
    heartbeatMs: input.heartbeatMs,
    record: (event) => {
      const result = event.result;
      input.journal.record(`raw-${event.event}`, {
        requestIndex: 1,
        ...(result
          ? {
              httpStatus: result.httpStatus,
              contentType: result.contentType,
              responseFirstByteMs: result.responseFirstByteMs,
              responseChunkCount: result.responseChunkCount,
              responseByteCount: result.responseByteCount,
              outcome: result.errorName ? "error" : result.streamEnd ? "complete" : "pending",
              elapsedMs: result.elapsedMs,
              errorClass: result.errorName ?? undefined,
              errorCode: result.streamError ?? undefined,
            }
          : {
              elapsedMs: event.elapsedMs,
              responseChunkCount: event.chunkCount,
              responseByteCount: event.byteCount,
            }),
      });
    },
  });
  if (dispatches !== 1 || results.length !== 1) {
    throw new Error("v1J adapter differential raw transport did not complete exactly one request");
  }
  return results[0]!;
}

export function createV1JAdapterDifferentialJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  modelId: string;
  modelConfigHash: string;
  schemaFingerprint: Record<string, unknown>;
  startedAt: string;
}): V1JAdapterDifferentialJournal {
  if (!/^[0-9a-f]{40}$/.test(input.harnessCommit)) {
    throw new Error("v1J adapter differential requires the actual full harness SHA");
  }
  const repoRoot = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(repoRoot, V1J_ADAPTER_DIFFERENTIAL_PARENT);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.realpathSync(parent) !== parent) {
    throw new Error("v1J adapter differential refuses an aliased artifact parent");
  }
  const formalRoot = path.join(parent, "real-exact-run1");
  const smokeRoot = path.join(parent, `smoke-${input.harnessCommit}`);
  const root = path.join(parent, `${V1J_ADAPTER_DIFFERENTIAL_PREFIX}${input.harnessCommit}`);
  if (pathsOverlap(root, formalRoot) || pathsOverlap(root, smokeRoot)) {
    throw new Error("v1J adapter differential overlaps formal or normal smoke state");
  }
  if (fs.existsSync(formalRoot) || fs.existsSync(smokeRoot)) {
    throw new Error("v1J adapter differential refuses existing formal or normal smoke state");
  }
  assertWithin(parent, root);
  fs.mkdirSync(root, { recursive: false });
  if (fs.realpathSync(root) !== root) {
    throw new Error("v1J adapter differential refuses an aliased artifact root");
  }
  const manifest = {
    artifactKind: "v1J-transport-adapter-differential",
    harnessCommit: input.harnessCommit,
    modelId: input.modelId,
    modelConfigHash: input.modelConfigHash,
    schemaFingerprint: input.schemaFingerprint,
    comparisons: ["raw-transport", "adapter-model-loop"],
    maxModelRequests: V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS,
    activeFilteringEnabled: false,
    formalStateTouched: false,
    smokeStateTouched: false,
    requestBodiesPersisted: false,
    promptsPersisted: false,
    responseBodiesPersisted: false,
    credentialsPersisted: false,
    startedAt: input.startedAt,
  };
  writeExclusive(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const filePath = path.join(root, "events.jsonl");
  const fd = fs.openSync(filePath, "wx");
  const start = Date.now();
  let index = 0;
  let closed = false;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    if (closed || !/^[a-z][a-z0-9-]{0,63}$/.test(event)) {
      throw new Error("v1J adapter differential journal is closed or event name is invalid");
    }
    const safe = Object.fromEntries(
      Object.entries(details).filter(
        ([key, value]) => SAFE_DETAIL_KEYS.has(key) && isSafeValue(value),
      ),
    );
    const row = {
      event,
      eventIndex: ++index,
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      pid: process.pid,
      harnessCommit: input.harnessCommit,
      ...safe,
    };
    fs.writeSync(fd, `${JSON.stringify(row)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  };
  record("diagnostic-start", { outcome: "started" });
  return {
    root,
    filePath,
    record,
    close: () => {
      if (!closed) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        closed = true;
      }
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isSafeValue(value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "string" || value.length > 160) {
    return false;
  }
  if (value.length === 64) {
    return /^[0-9a-f]{64}$/i.test(value);
  }
  return /^[a-z0-9_.:/ -]*$/i.test(value);
}

function writeExclusive(filePath: string, contents: string): void {
  const fd = fs.openSync(filePath, "wx");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function assertWithin(parent: string, target: string): void {
  const relative = path.relative(parent, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("v1J adapter differential path escaped its artifact root");
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  return within(left, right) || within(right, left);
}
