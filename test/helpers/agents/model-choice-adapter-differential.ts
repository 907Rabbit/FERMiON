import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  canonicalRequestSha256: string;
};

export function assertV1JAdapterDifferentialRequestMatch(
  rawRequest: Record<string, unknown>,
  adapterRequest: Record<string, unknown>,
): { rawRequestSha256: string; adapterRequestSha256: string } {
  const rawRequestSha256 =
    summarizeV1JAdapterDifferentialRequest(rawRequest).canonicalRequestSha256;
  const adapterRequestSha256 =
    summarizeV1JAdapterDifferentialRequest(adapterRequest).canonicalRequestSha256;
  if (rawRequestSha256 !== adapterRequestSha256) {
    throw new Error("v1J raw transport and adapter request bodies differ");
  }
  return { rawRequestSha256, adapterRequestSha256 };
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
  "rawRequestSha256",
  "adapterRequestSha256",
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
): V1JAdapterDifferentialRequestMetrics {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    requestJsonBytes: Buffer.byteLength(JSON.stringify(body), "utf8"),
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
    canonicalRequestSha256: createHash("sha256").update(canonicalJson(body), "utf8").digest("hex"),
  };
}

export async function runV1JAdapterDifferentialRawTransport(input: {
  endpoint: string;
  authorization: string;
  requestBody: Record<string, unknown>;
  fetchImpl: V1JProviderControlFetch;
  journal: V1JAdapterDifferentialJournal;
  timeoutMs?: number;
  heartbeatMs?: number;
}): Promise<V1JProviderControlResult> {
  if (
    input.requestBody.stream !== true ||
    !Array.isArray(input.requestBody.tools) ||
    input.requestBody.tools.length !== 15
  ) {
    throw new Error("v1J adapter differential requires the captured streaming 15-tool request");
  }
  const metrics = summarizeV1JAdapterDifferentialRequest(input.requestBody);
  input.journal.record("raw-transport-request-ready", metrics);
  let dispatches = 0;
  const results = await runV1JProviderTransportControls({
    endpoint: input.endpoint,
    model: typeof input.requestBody.model === "string" ? input.requestBody.model : "",
    authorization: input.authorization,
    requests: [{ mode: "C", requestObject: input.requestBody }],
    fetchImpl: (request, init) => {
      dispatches += 1;
      if (dispatches > 1) {
        throw new Error("v1J adapter differential raw transport exceeded its one-request limit");
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
    maxModelRequests: 3,
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
