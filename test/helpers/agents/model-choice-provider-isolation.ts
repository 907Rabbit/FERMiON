import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const V1J_PROVIDER_CONTROL_PROMPT = "Reply with exactly: ok";
export const V1J_PROVIDER_CONTROL_MAX_TOKENS = 8;
export const V1J_PROVIDER_CONTROL_TIMEOUT_MS = 120_000;
export const V1J_PROVIDER_CONTROL_HEARTBEAT_MS = 20_000;
export const V1J_PROVIDER_CONTROL_RUN_FLAG = "OPENCLAW_V1J_LMSTUDIO_CONTROLS";
export const V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG = "OPENCLAW_V1J_LMSTUDIO_CONTROLS_AUTHORIZED";
export const V1J_PROVIDER_CONTROL_COMMIT_FLAG = "OPENCLAW_V1J_LMSTUDIO_CONTROLS_COMMIT";
export const V1J_PROVIDER_CONTROL_ARTIFACT_ROOT =
  "artifacts/capability-intelligence/v1j-action-initiation/lmstudio-transport-controls";
export const V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256 =
  "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172";
export const V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256 =
  "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529";
export const V1J_PROVIDER_CONTROL_SCHEMA_BASELINE = {
  authorizedToolCount: 15,
  providerToolCount: 15,
  authorizedToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  providerToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  authorizedToolSchemaSha256: "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128",
  providerToolSchemaSha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
} as const;

export type V1JProviderControlMode = "stream-false" | "stream-true";

export type V1JProviderControlMetrics = {
  model: string;
  maxTokens: number;
  stream: boolean;
  requestJsonBytes: number;
  messageCount: number;
  totalMessageContentBytes: number;
  toolCount: 0;
  toolSchemaJsonBytes: 0;
};

export type V1JProviderControlResult = V1JProviderControlMetrics & {
  mode: V1JProviderControlMode;
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
  streamEnd: boolean;
  streamError: string | null;
  streamCancel: boolean;
  timedOut: boolean;
  providerResponseObserved: boolean;
  errorName: string | null;
};

export type V1JProviderControlEvent = {
  event: string;
  mode?: V1JProviderControlMode;
  elapsedMs?: number;
  chunkCount?: number;
  byteCount?: number;
  result?: V1JProviderControlResult;
};

export type V1JProviderControlFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function assertV1JProviderControlPreflight(input: {
  env: Record<string, string | undefined>;
  head: string;
  trackedTreeClean: boolean;
  activeFilteringEnabled: boolean;
  modelId: string;
  modelConfigHash: string;
  preregistrationHash: string;
  detachedPreregistrationHash: string;
  schemaBaseline: Record<string, unknown> | undefined;
  provenanceAccepted: boolean;
  artifactExists: boolean;
}): void {
  const allowedFlags = new Set([
    V1J_PROVIDER_CONTROL_RUN_FLAG,
    V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG,
    V1J_PROVIDER_CONTROL_COMMIT_FLAG,
  ]);
  if (
    input.env[V1J_PROVIDER_CONTROL_RUN_FLAG] !== "1" ||
    input.env[V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG] !== "1" ||
    input.env[V1J_PROVIDER_CONTROL_COMMIT_FLAG] !== input.head
  ) {
    throw new Error("LM Studio transport controls require exact commit-bound authorization flags");
  }
  const conflictingFlags = Object.entries(input.env)
    .filter(
      ([key, value]) =>
        value !== undefined && /^(OPENCLAW_V1[IJ]_)/.test(key) && !allowedFlags.has(key),
    )
    .map(([key]) => key);
  if (conflictingFlags.length > 0) {
    throw new Error(
      `LM Studio transport controls cannot share live modes: ${conflictingFlags.join(",")}`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(input.head) || !input.trackedTreeClean) {
    throw new Error("LM Studio transport controls require a clean committed harness");
  }
  if (input.activeFilteringEnabled !== false) {
    throw new Error("active filtering must remain disabled for provider controls");
  }
  if (
    input.modelId !== "qwen/qwen3.5-9b" ||
    input.modelConfigHash !== V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256
  ) {
    throw new Error("LM Studio transport-control model configuration drifted");
  }
  const detachedHash = input.detachedPreregistrationHash.trim().split(/\s+/)[0]?.toLowerCase();
  if (
    input.preregistrationHash !== V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256 ||
    detachedHash !== V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256
  ) {
    throw new Error("accepted v1J preregistration hash mismatch");
  }
  const schema = input.schemaBaseline;
  if (
    !schema ||
    Object.entries(V1J_PROVIDER_CONTROL_SCHEMA_BASELINE).some(
      ([key, value]) => schema[key] !== value,
    )
  ) {
    throw new Error("accepted v1J schema fingerprints do not match the frozen baseline");
  }
  if (!input.provenanceAccepted) {
    throw new Error("LM Studio transport controls provenance amendment is not accepted");
  }
  if (input.artifactExists) {
    throw new Error("LM Studio transport-control artifact directory already exists");
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function safeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

function writeDurably(filePath: string, contents: string, exclusive: boolean): void {
  const fd = fs.openSync(filePath, exclusive ? "wx" : "a");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function createV1JProviderControlJournal(input: {
  repoRoot: string;
  artifactRoot: string;
  manifest: Record<string, unknown>;
}): {
  artifactRoot: string;
  record: (event: V1JProviderControlEvent) => void;
} {
  const root = path.resolve(input.repoRoot, input.artifactRoot);
  const repoRealPath = fs.realpathSync(input.repoRoot);
  const allowedParent = path.resolve(
    input.repoRoot,
    "artifacts/capability-intelligence/v1j-action-initiation",
  );
  if (!root.startsWith(`${allowedParent}${path.sep}`)) {
    throw new Error("provider-control artifact path escapes its diagnostic root");
  }
  fs.mkdirSync(allowedParent, { recursive: true });
  const allowedParentRealPath = fs.realpathSync(allowedParent);
  if (!allowedParentRealPath.startsWith(`${repoRealPath}${path.sep}`)) {
    throw new Error("provider-control diagnostic root resolves outside the repository");
  }
  const artifactRoot = path.join(allowedParentRealPath, path.basename(root));
  fs.mkdirSync(artifactRoot, { recursive: false });
  writeDurably(
    path.join(artifactRoot, "manifest.json"),
    `${JSON.stringify(input.manifest, null, 2)}\n`,
    true,
  );
  const journalPath = path.join(artifactRoot, "transport-events.jsonl");
  return {
    artifactRoot,
    record: (event) => writeDurably(journalPath, `${JSON.stringify(event)}\n`, false),
  };
}

export async function runV1JProviderTransportControls(input: {
  endpoint: string;
  model: string;
  authorization: string;
  fetchImpl: V1JProviderControlFetch;
  timeoutMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  wallNow?: () => string;
  heartbeat?: (event: V1JProviderControlEvent) => void;
  record: (event: V1JProviderControlEvent) => void;
}): Promise<V1JProviderControlResult[]> {
  const results: V1JProviderControlResult[] = [];
  for (const stream of [false, true]) {
    const mode: V1JProviderControlMode = stream ? "stream-true" : "stream-false";
    const requestObject = {
      model: input.model,
      messages: [{ role: "user", content: V1J_PROVIDER_CONTROL_PROMPT }],
      max_tokens: V1J_PROVIDER_CONTROL_MAX_TOKENS,
      stream,
    };
    const requestBody = JSON.stringify(requestObject);
    const startedAtMs = (input.now ?? Date.now)();
    const startedAt = (input.wallNow ?? (() => new Date().toISOString()))();
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? V1J_PROVIDER_CONTROL_TIMEOUT_MS;
    const heartbeatMs = input.heartbeatMs ?? V1J_PROVIDER_CONTROL_HEARTBEAT_MS;
    const result: V1JProviderControlResult = {
      model: input.model,
      maxTokens: requestObject.max_tokens,
      stream,
      mode,
      requestJsonBytes: Buffer.byteLength(requestBody, "utf8"),
      messageCount: requestObject.messages.length,
      totalMessageContentBytes: Buffer.byteLength(requestObject.messages[0]!.content, "utf8"),
      toolCount: 0,
      toolSchemaJsonBytes: 0,
      startedAt,
      elapsedMs: 0,
      requestDispatchStarted: false,
      requestDispatchCompleted: false,
      httpStatus: null,
      contentType: null,
      responseFirstByteMs: null,
      responseChunkCount: 0,
      responseByteCount: 0,
      lastChunkMs: null,
      streamEnd: false,
      streamError: null,
      streamCancel: false,
      timedOut: false,
      providerResponseObserved: false,
      errorName: null,
    };
    input.record({ event: "request-created", mode, result });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      result.requestDispatchStarted = true;
      input.record({ event: "request-dispatch-start", mode });
      const response = await input.fetchImpl(input.endpoint, {
        method: "POST",
        headers: {
          authorization: input.authorization,
          "content-type": "application/json",
        },
        body: requestBody,
        signal: controller.signal,
      });
      result.requestDispatchCompleted = true;
      result.httpStatus = response.status;
      result.contentType = response.headers.get("content-type");
      result.providerResponseObserved = true;
      input.record({ event: "request-dispatch-complete", mode });
      input.record({ event: "http-response-headers", mode });

      if (!response.body) {
        result.streamEnd = true;
        input.record({ event: "response-body-complete", mode });
        input.record({ event: "stream-end", mode });
        return;
      }
      const reader = response.body.getReader();
      input.record({ event: "response-body-start", mode });
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) {
            result.streamEnd = true;
            input.record({ event: "response-body-complete", mode });
            input.record({ event: "stream-end", mode });
            return;
          }
          const elapsedMs = (input.now ?? Date.now)() - startedAtMs;
          if (result.responseFirstByteMs === null) {
            result.responseFirstByteMs = elapsedMs;
            input.record({ event: "response-first-byte", mode, elapsedMs });
          }
          result.responseChunkCount += 1;
          result.responseByteCount += item.value.byteLength;
          result.lastChunkMs = elapsedMs;
          input.record({
            event: "response-progress",
            mode,
            elapsedMs,
            chunkCount: result.responseChunkCount,
            byteCount: result.responseByteCount,
          });
        }
      } catch (error) {
        result.streamError = safeErrorCode(error) ?? errorName(error);
        throw error;
      } finally {
        if (!result.streamEnd && controller.signal.aborted) {
          result.streamCancel = true;
        }
        try {
          reader.releaseLock();
        } catch {
          // The body reader may already have released its lock after an error.
        }
      }
    };

    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        result.timedOut = true;
        controller.abort();
        reject(Object.assign(new Error("provider control timed out"), { name: "TimeoutError" }));
      }, timeoutMs);
      timeout.unref?.();
    });
    let rejectHeartbeatFailure: ((error: unknown) => void) | undefined;
    let heartbeatFailed = false;
    const heartbeatFailure = new Promise<never>((_, reject) => {
      rejectHeartbeatFailure = reject;
    });
    const activeHeartbeatTimer = setInterval(() => {
      const event = {
        event: "heartbeat",
        mode,
        elapsedMs: (input.now ?? Date.now)() - startedAtMs,
        chunkCount: result.responseChunkCount,
        byteCount: result.responseByteCount,
      } satisfies V1JProviderControlEvent;
      try {
        input.record(event);
        input.heartbeat?.(event);
      } catch (error) {
        heartbeatFailed = true;
        controller.abort();
        rejectHeartbeatFailure?.(error);
      }
    }, heartbeatMs);
    activeHeartbeatTimer.unref?.();

    let operationSettled = false;
    let abortDidNotSettle = false;
    const work = operation().finally(() => {
      operationSettled = true;
    });
    try {
      await Promise.race([work, deadline, heartbeatFailure]);
    } catch (error) {
      result.errorName = errorName(error);
      if (!result.streamError) {
        result.streamError = safeErrorCode(error);
      }
      input.record({ event: "request-error", mode });
      if (result.timedOut) {
        await Promise.race([
          work.catch(() => undefined),
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 1_000);
          }),
        ]);
        abortDidNotSettle = !operationSettled;
        if (abortDidNotSettle) {
          input.record({ event: "abort-did-not-settle", mode });
        }
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      clearInterval(activeHeartbeatTimer);
      result.elapsedMs = (input.now ?? Date.now)() - startedAtMs;
      input.record({ event: "control-complete", mode, result });
    }
    results.push(result);
    if (abortDidNotSettle) {
      throw new Error(
        "timed-out LM Studio control did not settle after abort; second request skipped",
      );
    }
    if (heartbeatFailed) {
      throw new Error(
        "LM Studio control heartbeat could not be durably recorded; second request skipped",
      );
    }
  }
  return results;
}

export function sha256V1JProviderControl(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
