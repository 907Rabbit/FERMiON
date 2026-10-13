import fs from "node:fs";
import path from "node:path";
import {
  runV1JProviderTransportControls,
  type V1JProviderControlEvent,
  type V1JProviderControlFetch,
} from "./model-choice-provider-isolation.js";

export const V1J_PAYLOAD_DECOMPOSITION_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_PAYLOAD_DECOMPOSITION_PREFIX = "payload-decomposition-";
export const V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG = "OPENCLAW_V1J_PAYLOAD_DECOMPOSITION";
export const V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG =
  "OPENCLAW_V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED";
export const V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG = "OPENCLAW_V1J_PAYLOAD_DECOMPOSITION_COMMIT";
export const V1J_PAYLOAD_DECOMPOSITION_MINIMAL_PROMPT = "Reply with exactly: ok";
export const V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256 =
  "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172";

export type V1JPayloadControlId = "A" | "B" | "C";
export type V1JPayloadRequest = {
  control: V1JPayloadControlId;
  body: Record<string, unknown>;
};

export type V1JPayloadControlMetrics = {
  control: V1JPayloadControlId;
  requestJsonBytes: number;
  messageCount: number;
  totalMessageContentBytes: number;
  toolCount: number;
  toolSchemaJsonBytes: number;
};

export type V1JPayloadControlResult = V1JPayloadControlMetrics & {
  startedAt: string;
  elapsedMs: number;
  requestDispatchStarted: boolean;
  requestDispatchCompleted: boolean;
  httpStatus: number | null;
  contentType: string | null;
  responseFirstByteMs: number | null;
  responseChunkCount: number;
  responseByteCount: number;
  lastChunkMs: number | null;
  bodyCompleted: boolean;
  timedOut: boolean;
  errorName: string | null;
  errorCode: string | null;
};

export type V1JPayloadControlEvent = {
  event: string;
  control?: V1JPayloadControlId;
  elapsedMs?: number;
  chunkCount?: number;
  byteCount?: number;
  metrics?: V1JPayloadControlMetrics;
  result?: V1JPayloadControlResult;
};

export function buildV1JPayloadDecompositionRequests(input: {
  capturedArmARequest: Record<string, unknown>;
}): V1JPayloadRequest[] {
  const full = cloneRequestBody(input.capturedArmARequest);
  if (!Array.isArray(full.messages) || !Array.isArray(full.tools) || full.tools.length !== 15) {
    throw new Error("v1J payload decomposition requires the captured 15-tool Arm A request");
  }
  const frozenTools = JSON.stringify(full.tools);
  const minimalWithTools = cloneRequestBody(full);
  minimalWithTools.messages = [{ role: "user", content: V1J_PAYLOAD_DECOMPOSITION_MINIMAL_PROMPT }];
  minimalWithTools.stream = true;

  const fullPromptWithoutTools = cloneRequestBody(full);
  delete fullPromptWithoutTools.tools;
  delete fullPromptWithoutTools.tool_choice;
  delete fullPromptWithoutTools.parallel_tool_calls;
  fullPromptWithoutTools.stream = true;

  const fullPromptWithTools = cloneRequestBody(full);
  fullPromptWithTools.stream = true;

  const requests: V1JPayloadRequest[] = [
    { control: "A", body: minimalWithTools },
    { control: "B", body: fullPromptWithoutTools },
    { control: "C", body: fullPromptWithTools },
  ];
  if (
    JSON.stringify(requests[0]!.body.tools) !== frozenTools ||
    JSON.stringify(requests[2]!.body.tools) !== frozenTools ||
    requests.some((request) => request.body.stream !== true) ||
    requests[1]!.body.tools !== undefined ||
    requests[1]!.body.tool_choice !== undefined ||
    requests[1]!.body.parallel_tool_calls !== undefined
  ) {
    throw new Error("v1J payload decomposition altered a frozen control dimension");
  }
  return requests;
}

export function assertV1JPayloadDecompositionPreflight(input: {
  env: Record<string, string | undefined>;
  head: string;
  trackedTreeClean: boolean;
  activeFilteringEnabled: boolean;
  modelId: string;
  modelConfigHash: string;
  protocolHash: string;
  detachedProtocolHash: string;
  provenanceAccepted: boolean;
  artifactExists: boolean;
}): void {
  if (
    input.env[V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG] !== "1" ||
    input.env[V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG] !== "1" ||
    input.env[V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG] !== input.head
  ) {
    throw new Error("v1J payload decomposition requires exact commit-bound live authorization");
  }
  const allowedFlags = new Set([
    V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG,
    V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG,
    V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG,
  ]);
  const conflictingFlags = Object.entries(input.env)
    .filter(
      ([key, value]) =>
        value !== undefined && /^(OPENCLAW_V1[IJ]_)/.test(key) && !allowedFlags.has(key),
    )
    .map(([key]) => key);
  if (conflictingFlags.length > 0) {
    throw new Error(
      `v1J payload decomposition cannot share live modes: ${conflictingFlags.join(",")}`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(input.head) || !input.trackedTreeClean) {
    throw new Error("v1J payload decomposition requires a clean committed harness");
  }
  if (input.activeFilteringEnabled !== false) {
    throw new Error("v1J payload decomposition requires active filtering to remain disabled");
  }
  if (
    input.modelId !== "qwen/qwen3.5-9b" ||
    input.modelConfigHash !== "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529"
  ) {
    throw new Error("v1J payload decomposition model configuration drifted");
  }
  if (
    input.protocolHash !== V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256 ||
    input.detachedProtocolHash.trim().split(/\s+/)[0]?.toLowerCase() !==
      V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256
  ) {
    throw new Error("accepted v1J preregistration hash mismatch");
  }
  if (!input.provenanceAccepted) {
    throw new Error("v1J payload decomposition provenance amendment is not accepted");
  }
  if (input.artifactExists) {
    throw new Error("v1J payload decomposition artifact directory already exists");
  }
}

export function createV1JPayloadDecompositionJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  modelId: string;
  modelConfigHash: string;
  provider: string;
  contextLength: number;
  schemaFingerprint: Record<string, unknown>;
  startedAt: string;
}): {
  artifactRoot: string;
  record: (event: V1JPayloadControlEvent) => void;
  close: () => void;
} {
  if (!/^[0-9a-f]{40}$/.test(input.harnessCommit)) {
    throw new Error("v1J payload decomposition requires the actual full harness SHA");
  }
  const repoRoot = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(repoRoot, V1J_PAYLOAD_DECOMPOSITION_PARENT);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.realpathSync(parent) !== parent) {
    throw new Error("v1J payload decomposition refuses an aliased artifact parent");
  }
  const artifactRoot = path.join(
    parent,
    `${V1J_PAYLOAD_DECOMPOSITION_PREFIX}${input.harnessCommit}`,
  );
  const formalRoot = path.resolve(repoRoot, V1J_PAYLOAD_DECOMPOSITION_PARENT, "real-exact-run1");
  const smokeRoot = path.resolve(
    repoRoot,
    V1J_PAYLOAD_DECOMPOSITION_PARENT,
    `smoke-${input.harnessCommit}`,
  );
  if (pathsOverlap(artifactRoot, formalRoot) || pathsOverlap(artifactRoot, smokeRoot)) {
    throw new Error("v1J payload decomposition path overlaps formal or smoke state");
  }
  if (fs.existsSync(formalRoot) || fs.existsSync(smokeRoot)) {
    throw new Error("v1J payload decomposition refuses existing formal or smoke state");
  }
  fs.mkdirSync(artifactRoot, { recursive: false });
  if (fs.realpathSync(artifactRoot) !== artifactRoot) {
    throw new Error("v1J payload decomposition refuses an aliased artifact root");
  }
  const manifest = {
    artifactKind: "v1J-payload-decomposition-transport-diagnostic",
    harnessCommit: input.harnessCommit,
    modelId: input.modelId,
    modelConfigHash: input.modelConfigHash,
    provider: input.provider,
    contextLength: input.contextLength,
    schemaFingerprint: input.schemaFingerprint,
    controls: ["A", "B", "C"],
    stream: true,
    toolExecutionEnabled: false,
    activeFilteringEnabled: false,
    formalStateTouched: false,
    smokeStateTouched: false,
    promptContentPersisted: false,
    messageContentPersisted: false,
    responseContentPersisted: false,
    credentialsPersisted: false,
    startedAt: input.startedAt,
  };
  writeExclusive(
    path.join(artifactRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const eventPath = path.join(artifactRoot, "transport-events.jsonl");
  const fd = fs.openSync(eventPath, "wx");
  const startedAt = Date.now();
  let eventIndex = 0;
  let closed = false;
  const record = (event: V1JPayloadControlEvent) => {
    if (closed) {
      throw new Error("v1J payload decomposition journal is closed");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(event.event)) {
      throw new Error("v1J payload diagnostic event name is invalid");
    }
    const row = {
      event: event.event,
      eventIndex: ++eventIndex,
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      pid: process.pid,
      harnessCommit: input.harnessCommit,
      ...(event.control ? { control: event.control } : {}),
      ...(event.elapsedMs === undefined ? {} : { controlElapsedMs: event.elapsedMs }),
      ...(event.chunkCount === undefined ? {} : { chunkCount: event.chunkCount }),
      ...(event.byteCount === undefined ? {} : { byteCount: event.byteCount }),
      ...(event.metrics ? { metrics: event.metrics } : {}),
      ...(event.result ? { result: event.result } : {}),
    };
    fs.writeSync(fd, `${JSON.stringify(row)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  };
  record({ event: "diagnostic-start" });
  return {
    artifactRoot,
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

export async function runV1JPayloadDecompositionControls(input: {
  endpoint: string;
  authorization: string;
  requests: readonly V1JPayloadRequest[];
  fetchImpl: V1JProviderControlFetch;
  record: (event: V1JPayloadControlEvent) => void;
  heartbeat?: (event: V1JPayloadControlEvent) => void;
  timeoutMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  wallNow?: () => string;
}): Promise<V1JPayloadControlResult[]> {
  if (input.requests.map((request) => request.control).join("") !== "ABC") {
    throw new Error("v1J payload decomposition requires exactly the ordered A/B/C controls");
  }
  const rawResults = await runV1JProviderTransportControls({
    endpoint: input.endpoint,
    model: typeof input.requests[0]?.body.model === "string" ? input.requests[0].body.model : "",
    authorization: input.authorization,
    fetchImpl: input.fetchImpl,
    requests: input.requests.map(({ control, body }) => ({ mode: control, requestObject: body })),
    timeoutMs: input.timeoutMs,
    heartbeatMs: input.heartbeatMs,
    now: input.now,
    wallNow: input.wallNow,
    record: (event) => input.record(mapControlEvent(event)),
    heartbeat: (event) => input.heartbeat?.(mapControlEvent(event)),
  });
  return rawResults.map((result) => ({
    control: result.mode as V1JPayloadControlId,
    requestJsonBytes: result.requestJsonBytes,
    messageCount: result.messageCount,
    totalMessageContentBytes: result.totalMessageContentBytes,
    toolCount: result.toolCount,
    toolSchemaJsonBytes: result.toolSchemaJsonBytes,
    startedAt: result.startedAt,
    elapsedMs: result.elapsedMs,
    requestDispatchStarted: result.requestDispatchStarted,
    requestDispatchCompleted: result.requestDispatchCompleted,
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    responseFirstByteMs: result.responseFirstByteMs,
    responseChunkCount: result.responseChunkCount,
    responseByteCount: result.responseByteCount,
    lastChunkMs: result.lastChunkMs,
    bodyCompleted: result.streamEnd,
    timedOut: result.timedOut,
    errorName: result.errorName,
    errorCode: result.streamError,
  }));
}

function mapControlEvent(event: V1JProviderControlEvent): V1JPayloadControlEvent {
  const mode = event.mode;
  const result = event.result;
  return {
    event: event.event,
    ...(mode === "A" || mode === "B" || mode === "C" ? { control: mode } : {}),
    ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
    ...(event.chunkCount === undefined ? {} : { chunkCount: event.chunkCount }),
    ...(event.byteCount === undefined ? {} : { byteCount: event.byteCount }),
    ...(result
      ? {
          metrics: {
            control: result.mode as V1JPayloadControlId,
            requestJsonBytes: result.requestJsonBytes,
            messageCount: result.messageCount,
            totalMessageContentBytes: result.totalMessageContentBytes,
            toolCount: result.toolCount,
            toolSchemaJsonBytes: result.toolSchemaJsonBytes,
          },
          result: {
            control: result.mode as V1JPayloadControlId,
            requestJsonBytes: result.requestJsonBytes,
            messageCount: result.messageCount,
            totalMessageContentBytes: result.totalMessageContentBytes,
            toolCount: result.toolCount,
            toolSchemaJsonBytes: result.toolSchemaJsonBytes,
            startedAt: result.startedAt,
            elapsedMs: result.elapsedMs,
            requestDispatchStarted: result.requestDispatchStarted,
            requestDispatchCompleted: result.requestDispatchCompleted,
            httpStatus: result.httpStatus,
            contentType: result.contentType,
            responseFirstByteMs: result.responseFirstByteMs,
            responseChunkCount: result.responseChunkCount,
            responseByteCount: result.responseByteCount,
            lastChunkMs: result.lastChunkMs,
            bodyCompleted: result.streamEnd,
            timedOut: result.timedOut,
            errorName: result.errorName,
            errorCode: result.streamError,
          },
        }
      : {}),
  };
}

function cloneRequestBody(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
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

function pathsOverlap(left: string, right: string): boolean {
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  return within(left, right) || within(right, left);
}
