import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  runV1JProviderTransportControls,
  V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
  V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
  V1J_PROVIDER_CONTROL_SCHEMA_BASELINE,
  type V1JProviderControlEvent,
  type V1JProviderControlFetch,
  type V1JProviderControlResult,
} from "./model-choice-provider-isolation.js";

export const V1J_RAW_REPEATABILITY_RUN_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY";
export const V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY_AUTHORIZED";
export const V1J_RAW_REPEATABILITY_COMMIT_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY_COMMIT";
export const V1J_RAW_REPEATABILITY_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_RAW_REPEATABILITY_PREFIX = "raw-repeatability-";
export const V1J_RAW_REPEATABILITY_REQUEST_COUNT = 3;

export type V1JRawRepeatabilityCapture = {
  endpoint: string;
  rawBody: string;
  requestObject: Record<string, unknown>;
};

export type V1JRawRepeatabilityRequestSummary = {
  requestSha256: string;
  requestCanonicalSha256: string;
  requestJsonBytes: number;
  messageCount: number;
  messageHashes: readonly {
    index: number;
    role: string;
    contentSha256: string;
    contentBytes: number;
  }[];
  toolCount: number;
  toolSchemaJsonBytes: number;
};

export type V1JRawRepeatabilityJournal = {
  artifactRoot: string;
  record: (event: V1JProviderControlEvent) => void;
};

export function assertV1JRawRepeatabilityPreflight(input: {
  env: Record<string, string | undefined>;
  head: string;
  trackedTreeClean: boolean;
  activeFilteringEnabled: boolean;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  preregistrationHash: string;
  detachedPreregistrationHash: string;
  schemaBaseline: Record<string, unknown> | undefined;
  provenanceAccepted: boolean;
  artifactExists: boolean;
  formalStateExists: boolean;
  normalSmokeStateExists: boolean;
}): void {
  const allowedFlags = new Set([
    V1J_RAW_REPEATABILITY_RUN_FLAG,
    V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG,
    V1J_RAW_REPEATABILITY_COMMIT_FLAG,
  ]);
  if (
    input.env[V1J_RAW_REPEATABILITY_RUN_FLAG] !== "1" ||
    input.env[V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG] !== "1" ||
    input.env[V1J_RAW_REPEATABILITY_COMMIT_FLAG] !== input.head
  ) {
    throw new Error("v1J raw repeatability requires exact commit-bound authorization flags");
  }
  const conflictingFlags = Object.entries(input.env)
    .filter(
      ([key, value]) =>
        value !== undefined && /^(OPENCLAW_V1[IJ]_)/.test(key) && !allowedFlags.has(key),
    )
    .map(([key]) => key);
  if (conflictingFlags.length > 0) {
    throw new Error(`v1J raw repeatability cannot share live modes: ${conflictingFlags.join(",")}`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.head) || !input.trackedTreeClean) {
    throw new Error("v1J raw repeatability requires a clean committed harness HEAD");
  }
  if (input.activeFilteringEnabled !== false) {
    throw new Error("v1J raw repeatability requires active filtering to remain disabled");
  }
  if (
    input.modelId !== "qwen/qwen3.5-9b" ||
    input.provider !== "lmstudio" ||
    input.contextLength !== 262_144 ||
    input.modelConfigHash !== V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256
  ) {
    throw new Error("v1J raw repeatability model/provider/configuration drifted");
  }
  const detachedHash = input.detachedPreregistrationHash.trim().split(/\s+/)[0]?.toLowerCase();
  if (
    input.preregistrationHash !== V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256 ||
    detachedHash !== V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256
  ) {
    throw new Error("accepted v1J preregistration hash mismatch");
  }
  if (
    !input.schemaBaseline ||
    Object.entries(V1J_PROVIDER_CONTROL_SCHEMA_BASELINE).some(
      ([key, value]) => input.schemaBaseline?.[key] !== value,
    )
  ) {
    throw new Error("accepted v1J schema fingerprints do not match the frozen baseline");
  }
  if (!input.provenanceAccepted) {
    throw new Error("v1J raw repeatability provenance amendment is not accepted");
  }
  if (input.formalStateExists || input.normalSmokeStateExists) {
    throw new Error("v1J raw repeatability refuses existing formal or normal smoke state");
  }
  if (input.artifactExists) {
    throw new Error("v1J raw repeatability artifact directory already exists");
  }
}

export function summarizeV1JRawRepeatabilityRequest(
  capture: V1JRawRepeatabilityCapture,
): V1JRawRepeatabilityRequestSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(capture.rawBody);
  } catch {
    throw new Error("v1J raw repeatability captured provider request is not valid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    canonicalJson(parsed) !== canonicalJson(capture.requestObject)
  ) {
    throw new Error(
      "v1J raw repeatability captured request body does not match its provider object",
    );
  }
  const body = parsed as Record<string, unknown>;
  if (
    body.model !== "qwen/qwen3.5-9b" ||
    body.stream !== true ||
    !Array.isArray(body.messages) ||
    !Array.isArray(body.tools) ||
    body.tools.length !== V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolCount
  ) {
    throw new Error("v1J raw repeatability requires the frozen full streaming 15-tool request");
  }
  const messageHashes = body.messages.map((message, index) => {
    const row = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
    const content = row.content;
    const serialized = typeof content === "string" ? content : JSON.stringify(content ?? null);
    return {
      index,
      role: typeof row.role === "string" ? row.role : "unknown",
      contentSha256: sha256(serialized),
      contentBytes: Buffer.byteLength(serialized, "utf8"),
    };
  });
  return {
    requestSha256: sha256(capture.rawBody),
    requestCanonicalSha256: sha256(canonicalJson(body)),
    requestJsonBytes: Buffer.byteLength(capture.rawBody, "utf8"),
    messageCount: messageHashes.length,
    messageHashes,
    toolCount: body.tools.length,
    toolSchemaJsonBytes: Buffer.byteLength(JSON.stringify(body.tools), "utf8"),
  };
}

export function createV1JRawRepeatabilityJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  providerToolSchemaSha256: string;
  requestSummary: V1JRawRepeatabilityRequestSummary;
  startedAt: string;
}): V1JRawRepeatabilityJournal {
  if (!/^[0-9a-f]{40}$/.test(input.harnessCommit)) {
    throw new Error("v1J raw repeatability requires the actual full harness SHA");
  }
  const parent = path.resolve(input.repoRoot, V1J_RAW_REPEATABILITY_PARENT);
  const formalRoot = path.join(parent, "real-exact-run1");
  const smokeRoot = path.join(parent, `smoke-${input.harnessCommit}`);
  const artifactRoot = path.join(parent, `${V1J_RAW_REPEATABILITY_PREFIX}${input.harnessCommit}`);
  if (fs.existsSync(formalRoot) || fs.existsSync(smokeRoot)) {
    throw new Error("v1J raw repeatability refuses existing formal or normal smoke state");
  }
  if (fs.existsSync(artifactRoot)) {
    throw new Error("v1J raw repeatability artifact directory already exists");
  }
  fs.mkdirSync(parent, { recursive: true });
  const parentRealPath = fs.realpathSync(parent);
  const repoRealPath = fs.realpathSync(input.repoRoot);
  if (parentRealPath !== parent || !parentRealPath.startsWith(`${repoRealPath}${path.sep}`)) {
    throw new Error("v1J raw repeatability artifact parent escapes the repository");
  }
  const manifest = {
    artifactKind: "v1J-raw-provider-repeatability",
    harnessCommit: input.harnessCommit,
    modelId: input.modelId,
    provider: input.provider,
    contextLength: input.contextLength,
    modelConfigHash: input.modelConfigHash,
    providerToolCount: input.requestSummary.toolCount,
    providerToolSchemaSha256: input.providerToolSchemaSha256,
    requestSummary: input.requestSummary,
    requestCount: V1J_RAW_REPEATABILITY_REQUEST_COUNT,
    sequential: true,
    retries: 0,
    embeddedRunnerPreflightCount: 1,
    preflightProviderDispatches: 0,
    preflightToolExecutions: 0,
    rawTransportAdapterOrModelLoopDispatches: 0,
    activeFilteringEnabled: false,
    formalStateTouched: false,
    normalSmokeStateTouched: false,
    requestBodyPersisted: false,
    promptContentPersisted: false,
    responseContentPersisted: false,
    credentialsPersisted: false,
    startedAt: input.startedAt,
  };
  const journal = createProviderControlJournalAtRoot({
    repoRoot: input.repoRoot,
    root: artifactRoot,
    manifest,
  });
  return { artifactRoot: journal.artifactRoot, record: journal.record };
}

export async function runV1JRawRepeatabilityTransport(input: {
  endpoint: string;
  authorization: string;
  capture: V1JRawRepeatabilityCapture;
  fetchImpl: V1JProviderControlFetch;
  timeoutMs?: number;
  heartbeatMs?: number;
  heartbeat?: (event: V1JProviderControlEvent) => void;
  record: (event: V1JProviderControlEvent) => void;
}): Promise<V1JProviderControlResult[]> {
  const summary = summarizeV1JRawRepeatabilityRequest(input.capture);
  const serializedRequestBody = input.capture.rawBody;
  const requestObject = JSON.parse(serializedRequestBody) as Record<string, unknown>;
  const modes = ["repeat-1", "repeat-2", "repeat-3"] as const;
  const requests = modes.map((mode) => ({
    mode,
    requestObject: structuredClone(requestObject),
    serializedRequestBody,
  }));
  if (
    requests.length !== V1J_RAW_REPEATABILITY_REQUEST_COUNT ||
    requests.some((request) => request.serializedRequestBody !== serializedRequestBody)
  ) {
    throw new Error("v1J raw repeatability request cap or exact-body invariant failed");
  }
  input.record({ event: "repeatability-request-ready", details: summary });
  let completedResults = 0;
  let inFlight = false;
  let dispatchCount = 0;
  const results = await runV1JProviderTransportControls({
    endpoint: input.endpoint,
    model: typeof requestObject.model === "string" ? requestObject.model : "",
    authorization: input.authorization,
    requests,
    fetchImpl: (request, init) => {
      if (inFlight || dispatchCount >= V1J_RAW_REPEATABILITY_REQUEST_COUNT) {
        throw new Error("v1J raw repeatability exceeded its sequential three-request bound");
      }
      inFlight = true;
      dispatchCount += 1;
      input.record({
        event: "repeatability-dispatch-start",
        mode: modes[dispatchCount - 1],
        details: { ...summary, requestIndex: dispatchCount },
      });
      try {
        return input.fetchImpl(request, init);
      } catch (error) {
        inFlight = false;
        throw error;
      }
    },
    timeoutMs: input.timeoutMs,
    heartbeatMs: input.heartbeatMs,
    heartbeat: input.heartbeat,
    record: (event) => {
      if (event.event === "control-complete") {
        completedResults += 1;
        inFlight = false;
      }
      input.record(event);
    },
  });
  const hashes = new Set(results.map((result) => result.requestCanonicalSha256));
  if (
    dispatchCount !== V1J_RAW_REPEATABILITY_REQUEST_COUNT ||
    completedResults !== V1J_RAW_REPEATABILITY_REQUEST_COUNT ||
    results.length !== V1J_RAW_REPEATABILITY_REQUEST_COUNT ||
    hashes.size !== 1 ||
    results.some((result) => result.requestSha256 !== summary.requestSha256)
  ) {
    throw new Error("v1J raw repeatability failed its fixed-count or identical-request invariant");
  }
  input.record({
    event: "repeatability-complete",
    details: {
      ...summary,
      requestCount: results.length,
      uniqueCanonicalRequestCount: hashes.size,
      timedOutCount: results.filter((result) => result.timedOut).length,
    },
  });
  return results;
}

function createProviderControlJournalAtRoot(input: {
  repoRoot: string;
  root: string;
  manifest: Record<string, unknown>;
}): { artifactRoot: string; record: (event: V1JProviderControlEvent) => void } {
  const repoRealPath = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(input.repoRoot, V1J_RAW_REPEATABILITY_PARENT);
  if (!input.root.startsWith(`${parent}${path.sep}`)) {
    throw new Error("v1J raw repeatability artifact path escapes its diagnostic parent");
  }
  if (fs.realpathSync(parent) !== parent || !parent.startsWith(`${repoRealPath}${path.sep}`)) {
    throw new Error("v1J raw repeatability refuses an aliased artifact parent");
  }
  const root = path.resolve(input.root);
  if (fs.existsSync(root)) {
    throw new Error("v1J raw repeatability artifact directory already exists");
  }
  fs.mkdirSync(root, { recursive: false });
  if (!fs.realpathSync(root).startsWith(`${repoRealPath}${path.sep}`)) {
    throw new Error("v1J raw repeatability artifact path resolves outside the repository");
  }
  const manifestPath = path.join(root, "manifest.json");
  const manifestFd = fs.openSync(manifestPath, "wx");
  try {
    fs.writeFileSync(manifestFd, `${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
    fs.fsyncSync(manifestFd);
  } finally {
    fs.closeSync(manifestFd);
  }
  const journalPath = path.join(root, "transport-events.jsonl");
  return {
    artifactRoot: root,
    record: (event) => {
      const fd = fs.openSync(journalPath, "a");
      try {
        fs.writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
