import { createHash, randomUUID } from "node:crypto";
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
export type { V1JProviderControlEvent } from "./model-choice-provider-isolation.js";

export const V1J_RAW_REPEATABILITY_RUN_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY";
export const V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY_AUTHORIZED";
export const V1J_RAW_REPEATABILITY_COMMIT_FLAG = "OPENCLAW_V1J_RAW_REPEATABILITY_COMMIT";
export const V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG =
  "OPENCLAW_V1J_RAW_REPEATABILITY_CAPTURE_COMMIT";
export const V1J_RAW_REPEATABILITY_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_RAW_REPEATABILITY_PREFIX = "raw-repeatability-";
export const V1J_RAW_REPEATABILITY_REQUEST_COUNT = 3;
export const V1J_PROVIDER_BOUND_BODY_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation/provider-bound-request";
export const V1J_PROVIDER_BOUND_REQUEST_CANONICAL_SHA256 =
  "66ea318a79db06b91146e433ed7765f9b4edc14a0d73d744db57aa80b500fd7a";

export type V1JProviderBoundBodyMetadata = {
  bodyBytes: number;
  rawBodySha256: string;
  canonicalRequestSha256: string;
  messageCount: number;
  toolCount: number;
  captureCommit: string;
  provider: string;
  model: string;
};

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

export function writeV1JProviderBoundBodyArtifact(input: {
  repoRoot: string;
  captureCommit: string;
  provider: string;
  model: string;
  rawBody: string;
  expectedCanonicalRequestSha256: string;
}): { artifactRoot: string; metadata: V1JProviderBoundBodyMetadata } {
  const metadata = summarizeProviderBoundBody(input);
  const repoRoot = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(repoRoot, V1J_PROVIDER_BOUND_BODY_PARENT);
  assertNoSymlinkComponents(repoRoot, parent);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.realpathSync(parent) !== parent || !parent.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("v1J provider-bound body artifact parent escapes the repository");
  }

  const artifactRoot = path.join(parent, input.captureCommit);
  const stagingRoot = path.join(parent, `.capture-${input.captureCommit}-${randomUUID()}.tmp`);
  const bodyBytes = Buffer.from(input.rawBody, "utf8");
  const stagedBodyPath = path.join(stagingRoot, "request-body.bin");
  const stagedMetadataPath = path.join(stagingRoot, "request-body-metadata.json");
  fs.mkdirSync(stagingRoot, { recursive: false });
  try {
    writeExclusiveDurably(stagedBodyPath, bodyBytes);
    writeExclusiveDurably(
      stagedMetadataPath,
      Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    );
    // Publish the pair together: readers never see a body without its matching metadata.
    fs.renameSync(stagingRoot, artifactRoot);
    return { artifactRoot, metadata };
  } finally {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

export function readV1JProviderBoundBodyArtifact(input: {
  repoRoot: string;
  captureCommit: string;
  endpoint: string;
  expectedCanonicalRequestSha256: string;
}): {
  artifactRoot: string;
  capture: V1JRawRepeatabilityCapture;
  metadata: V1JProviderBoundBodyMetadata;
} {
  assertCommitSha(input.captureCommit);
  const repoRoot = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(repoRoot, V1J_PROVIDER_BOUND_BODY_PARENT);
  const artifactRoot = path.join(parent, input.captureCommit);
  if (
    fs.realpathSync(parent) !== parent ||
    !parent.startsWith(`${repoRoot}${path.sep}`) ||
    fs.realpathSync(artifactRoot) !== artifactRoot
  ) {
    throw new Error("v1J provider-bound body artifact path is missing or aliased");
  }

  const bodyPath = path.join(artifactRoot, "request-body.bin");
  const metadataPath = path.join(artifactRoot, "request-body-metadata.json");
  if (fs.realpathSync(bodyPath) !== bodyPath || fs.realpathSync(metadataPath) !== metadataPath) {
    throw new Error("v1J provider-bound body artifact files are missing or aliased");
  }
  const bodyBytes = fs.readFileSync(bodyPath);
  const persistedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as unknown;
  if (!isProviderBoundBodyMetadata(persistedMetadata)) {
    throw new Error("v1J provider-bound body metadata is invalid");
  }
  const rawBodySha256 = sha256(bodyBytes);
  if (
    bodyBytes.byteLength !== persistedMetadata.bodyBytes ||
    rawBodySha256 !== persistedMetadata.rawBodySha256 ||
    persistedMetadata.captureCommit !== input.captureCommit
  ) {
    throw new Error("v1J provider-bound body raw-byte integrity check failed");
  }
  const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  const body = parseProviderBoundBody(rawBody);
  const canonicalRequestSha256 = sha256(canonicalJson(body));
  if (
    canonicalRequestSha256 !== input.expectedCanonicalRequestSha256 ||
    canonicalRequestSha256 !== persistedMetadata.canonicalRequestSha256 ||
    body.model !== persistedMetadata.model ||
    persistedMetadata.provider !== "lmstudio" ||
    persistedMetadata.model !== "qwen/qwen3.5-9b" ||
    !Array.isArray(body.messages) ||
    body.messages.length !== persistedMetadata.messageCount ||
    !Array.isArray(body.tools) ||
    body.tools.length !== persistedMetadata.toolCount
  ) {
    throw new Error("v1J provider-bound body canonical integrity check failed");
  }
  return {
    artifactRoot,
    capture: {
      endpoint: input.endpoint,
      rawBody,
      requestObject: body,
    },
    metadata: persistedMetadata,
  };
}

export async function runV1JPreflightWithHeartbeat<T>(input: {
  operation: () => Promise<T>;
  stage: () => string;
  record: (event: V1JProviderControlEvent) => void;
  heartbeat?: (event: { stage: string; elapsedMs: number }) => void;
  heartbeatMs?: number;
  now?: () => number;
}): Promise<T> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  let currentStage = input.stage();
  let stageStartedAt = startedAt;
  const timer = setInterval(() => {
    const nextStage = input.stage();
    if (nextStage !== currentStage) {
      currentStage = nextStage;
      stageStartedAt = now();
    }
    const event = {
      stage: currentStage,
      elapsedMs: Math.max(0, now() - stageStartedAt),
    };
    input.record({ event: "preflight-heartbeat", details: event });
    input.heartbeat?.(event);
  }, input.heartbeatMs ?? 25_000);
  try {
    return await input.operation();
  } finally {
    clearInterval(timer);
  }
}

export function assertV1JRawRepeatabilityPreflight(input: {
  env: Record<string, string | undefined>;
  head: string;
  captureCommit: string;
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
    V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG,
  ]);
  if (
    input.env[V1J_RAW_REPEATABILITY_RUN_FLAG] !== "1" ||
    input.env[V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG] !== "1" ||
    input.env[V1J_RAW_REPEATABILITY_COMMIT_FLAG] !== input.head ||
    input.env[V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG] !== input.captureCommit
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
  assertCommitSha(input.captureCommit);
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
  onStage?: (event: V1JProviderControlEvent) => void,
): V1JRawRepeatabilityRequestSummary {
  const canonicalizationStartedAt = performance.now();
  onStage?.({ event: "request-canonicalization-start" });
  let parsed: unknown;
  let body: Record<string, unknown>;
  let requestCanonicalSha256: string;
  try {
    parsed = JSON.parse(capture.rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("v1J raw repeatability captured provider request is not a JSON object");
    }
    body = parsed as Record<string, unknown>;
    if (canonicalJson(parsed) !== canonicalJson(capture.requestObject)) {
      throw new Error(
        "v1J raw repeatability captured request body does not match its provider object",
      );
    }
    if (
      body.model !== "qwen/qwen3.5-9b" ||
      body.stream !== true ||
      !Array.isArray(body.messages) ||
      !Array.isArray(body.tools) ||
      body.tools.length !== V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolCount
    ) {
      throw new Error("v1J raw repeatability requires the frozen full streaming 15-tool request");
    }
    requestCanonicalSha256 = sha256(canonicalJson(body));
  } catch (error) {
    onStage?.({
      event: "request-canonicalization-failed",
      elapsedMs: Math.max(0, Math.round(performance.now() - canonicalizationStartedAt)),
      details: { errorName: error instanceof Error ? error.name : "NonErrorThrown" },
    });
    if (error instanceof SyntaxError) {
      throw new Error("v1J raw repeatability captured provider request is not valid JSON", {
        cause: error,
      });
    }
    throw error;
  }
  onStage?.({
    event: "request-canonicalization-complete",
    elapsedMs: Math.max(0, Math.round(performance.now() - canonicalizationStartedAt)),
    details: { canonicalRequestSha256: requestCanonicalSha256 },
  });
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
    requestCanonicalSha256,
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
  captureCommit: string;
  modelId: string;
  provider: string;
  contextLength: number;
  modelConfigHash: string;
  providerToolSchemaSha256?: string;
  requestSummary?: V1JRawRepeatabilityRequestSummary;
  startedAt: string;
}): V1JRawRepeatabilityJournal {
  if (!/^[0-9a-f]{40}$/.test(input.harnessCommit)) {
    throw new Error("v1J raw repeatability requires the actual full harness SHA");
  }
  assertCommitSha(input.captureCommit);
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
    captureCommit: input.captureCommit,
    modelId: input.modelId,
    provider: input.provider,
    contextLength: input.contextLength,
    modelConfigHash: input.modelConfigHash,
    providerToolCount: input.requestSummary?.toolCount ?? null,
    providerToolSchemaSha256: input.providerToolSchemaSha256 ?? null,
    requestSummary: input.requestSummary ?? null,
    requestCount: V1J_RAW_REPEATABILITY_REQUEST_COUNT,
    sequential: true,
    retries: 0,
    embeddedRunnerPreflightCount: 0,
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
  expectedCanonicalRequestSha256?: string;
  fetchImpl: V1JProviderControlFetch;
  timeoutMs?: number;
  heartbeatMs?: number;
  heartbeat?: (event: V1JProviderControlEvent) => void;
  record: (event: V1JProviderControlEvent) => void;
}): Promise<V1JProviderControlResult[]> {
  const summary = summarizeV1JRawRepeatabilityRequest(input.capture);
  if (
    input.expectedCanonicalRequestSha256 !== undefined &&
    summary.requestCanonicalSha256 !== input.expectedCanonicalRequestSha256
  ) {
    throw new Error("v1J raw repeatability request does not match the pinned canonical hash");
  }
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

export async function runV1JRawRepeatabilityFromArtifact(input: {
  repoRoot: string;
  captureCommit: string;
  endpoint: string;
  authorization: string;
  expectedCanonicalRequestSha256: string;
  fetchImpl: V1JProviderControlFetch;
  timeoutMs?: number;
  heartbeatMs?: number;
  heartbeat?: (event: V1JProviderControlEvent) => void;
  record: (event: V1JProviderControlEvent) => void;
}): Promise<V1JProviderControlResult[]> {
  const { capture, metadata } = readV1JProviderBoundBodyArtifact(input);
  input.record({
    event: "repeatability-body-verified",
    details: {
      bodyBytes: metadata.bodyBytes,
      rawBodySha256: metadata.rawBodySha256,
      canonicalRequestSha256: metadata.canonicalRequestSha256,
      captureCommit: metadata.captureCommit,
    },
  });
  return runV1JRawRepeatabilityTransport({ ...input, capture });
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeProviderBoundBody(input: {
  captureCommit: string;
  provider: string;
  model: string;
  rawBody: string;
  expectedCanonicalRequestSha256: string;
}): V1JProviderBoundBodyMetadata {
  assertCommitSha(input.captureCommit);
  if (input.provider !== "lmstudio" || input.model !== "qwen/qwen3.5-9b") {
    throw new Error("v1J provider-bound body provider or model drifted");
  }
  const body = parseProviderBoundBody(input.rawBody);
  if (
    body.model !== input.model ||
    body.stream !== true ||
    !Array.isArray(body.messages) ||
    !Array.isArray(body.tools) ||
    body.tools.length !== V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolCount
  ) {
    throw new Error("v1J provider-bound body does not match the frozen request surface");
  }
  const bodyBytes = Buffer.from(input.rawBody, "utf8");
  const canonicalRequestSha256 = sha256(canonicalJson(body));
  if (canonicalRequestSha256 !== input.expectedCanonicalRequestSha256) {
    throw new Error("v1J provider-bound body canonical request hash mismatch");
  }
  return {
    bodyBytes: bodyBytes.byteLength,
    rawBodySha256: sha256(bodyBytes),
    canonicalRequestSha256,
    messageCount: body.messages.length,
    toolCount: body.tools.length,
    captureCommit: input.captureCommit,
    provider: input.provider,
    model: input.model,
  };
}

function parseProviderBoundBody(rawBody: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("v1J provider-bound body is not valid JSON", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("v1J provider-bound body is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function isProviderBoundBodyMetadata(value: unknown): value is V1JProviderBoundBodyMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const metadata = value as Record<string, unknown>;
  return (
    Object.keys(metadata).toSorted().join(",") ===
      [
        "bodyBytes",
        "rawBodySha256",
        "canonicalRequestSha256",
        "messageCount",
        "toolCount",
        "captureCommit",
        "provider",
        "model",
      ]
        .toSorted()
        .join(",") &&
    typeof metadata.bodyBytes === "number" &&
    Number.isSafeInteger(metadata.bodyBytes) &&
    typeof metadata.rawBodySha256 === "string" &&
    /^[0-9a-f]{64}$/.test(metadata.rawBodySha256) &&
    typeof metadata.canonicalRequestSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(metadata.canonicalRequestSha256) &&
    typeof metadata.messageCount === "number" &&
    Number.isSafeInteger(metadata.messageCount) &&
    typeof metadata.toolCount === "number" &&
    Number.isSafeInteger(metadata.toolCount) &&
    typeof metadata.captureCommit === "string" &&
    typeof metadata.provider === "string" &&
    typeof metadata.model === "string"
  );
}

function assertCommitSha(commit: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("v1J provider-bound body requires a full lowercase commit SHA");
  }
}

function writeExclusiveDurably(filePath: string, contents: Buffer): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, "wx");
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(tempPath, filePath);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function assertNoSymlinkComponents(repoRoot: string, target: string): void {
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("v1J provider-bound body artifact parent escapes the repository");
  }
  let current = repoRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error("v1J provider-bound body artifact parent contains a symbolic link");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      break;
    }
  }
}
