import fs from "node:fs";
import path from "node:path";

export const V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PARENT =
  "artifacts/capability-intelligence/v1j-action-initiation";
export const V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX = "provider-response-diagnostic-";
export const V1J_PROVIDER_RESPONSE_DIAGNOSTIC_CELL = "smoke-tool-required:A:1";
export const V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH =
  "artifacts/capability-intelligence/v1j-action-initiation/real-exact-run1";

const SAFE_DETAIL_KEYS = new Set([
  "requestId",
  "correlationId",
  "requestIndex",
  "httpStatus",
  "responseBytes",
  "responseChunkCount",
  "responseByteCount",
  "lastChunkAt",
  "streamElapsedMs",
  "contentType",
  "errorClass",
  "errorCode",
  "failureStage",
  "abortState",
  "abortReasonClass",
  "timeoutState",
  "providerResponseObserved",
  "terminalEvidenceComplete",
  "terminalEvidencePersisted",
  "cleanupExceptionClass",
  "cleanupSecondary",
  "modelLoopStatus",
  "parserOutcome",
  "toolCallCount",
  "executionCount",
  "correlationStatus",
  "invalidReason",
  "dispatchAttempt",
  "outcome",
  "adapterErrorClass",
  "adapterErrorCode",
]);

export type V1JProviderResponseDiagnosticJournal = {
  root: string;
  filePath: string;
  record: (event: string, details?: Record<string, unknown>) => void;
  close: () => void;
};

const DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS = 25_000;

/** Observes byte counts and liveness without retaining or decoding provider content. */
export function observeV1JProviderResponseBody(input: {
  body: ReadableStream<Uint8Array>;
  journal: V1JProviderResponseDiagnosticJournal;
  requestIndex: number;
  heartbeatIntervalMs?: number;
  writeHeartbeat?: (line: string) => void;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}): ReadableStream<Uint8Array> {
  const reader = input.body.getReader();
  const now = input.now ?? Date.now;
  const startedAt = now();
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS;
  const setIntervalFn =
    input.setInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const clearIntervalFn =
    input.clearInterval ?? ((handle) => globalThis.clearInterval(handle as NodeJS.Timeout));
  let chunks = 0;
  let bytes = 0;
  let firstByteRecorded = false;
  let lastChunkAt: string | undefined;
  let heartbeatTimer: unknown;
  let ended = false;

  const stopHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };
  const progressDetails = () => ({
    requestIndex: input.requestIndex,
    responseChunkCount: chunks,
    responseByteCount: bytes,
    ...(lastChunkAt === undefined ? {} : { lastChunkAt }),
    streamElapsedMs: Math.max(0, now() - startedAt),
  });
  const startHeartbeat = () => {
    if (!input.writeHeartbeat || heartbeatTimer !== undefined || ended) {
      return;
    }
    heartbeatTimer = setIntervalFn(() => {
      if (ended) {
        stopHeartbeat();
        return;
      }
      const elapsedMs = Math.max(0, now() - startedAt);
      input.journal.record("response-stream-heartbeat", progressDetails());
      input.writeHeartbeat?.(
        `v1J provider diagnostic still awaiting stream completion elapsedMs=${elapsedMs} chunks=${chunks} bytes=${bytes}\n`,
      );
    }, heartbeatIntervalMs);
  };
  const finish = (outcome: "complete" | "error" | "cancelled", error?: unknown) => {
    if (ended) {
      return;
    }
    ended = true;
    stopHeartbeat();
    const failure = error instanceof Error ? error : undefined;
    const code = failure && "code" in failure ? failure.code : undefined;
    input.journal.record("stream-end", {
      ...progressDetails(),
      outcome,
      ...(failure ? { errorClass: failure.name } : {}),
      ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
    });
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (ended) {
        return;
      }
      startHeartbeat();
      try {
        const part = await reader.read();
        stopHeartbeat();
        if (part.done) {
          finish("complete");
          controller.close();
          return;
        }
        chunks += 1;
        bytes += part.value.byteLength;
        lastChunkAt = new Date(now()).toISOString();
        if (!firstByteRecorded && part.value.byteLength > 0) {
          firstByteRecorded = true;
          input.journal.record("response-first-byte", {
            ...progressDetails(),
          });
        }
        input.journal.record("response-stream-progress", progressDetails());
        controller.enqueue(part.value);
      } catch (error) {
        finish("error", error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish("cancelled", reason);
      await reader.cancel(reason);
    },
  });
}

export async function observeV1JAdapterResponse<T>(input: {
  journal: V1JProviderResponseDiagnosticJournal;
  requestIndex: number;
  observe: () => T | Promise<T>;
}): Promise<T> {
  input.journal.record("adapter-response-enter", {
    requestIndex: input.requestIndex,
    outcome: "entered",
  });
  try {
    const response = await input.observe();
    input.journal.record("provider-response-hook-complete", {
      requestIndex: input.requestIndex,
      outcome: "completed",
    });
    return response;
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : "NonErrorThrown";
    const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
    input.journal.record("adapter-response-failed", {
      requestIndex: input.requestIndex,
      outcome: "rejected",
      errorClass,
      ...(typeof code === "string" || typeof code === "number" ? { errorCode: String(code) } : {}),
    });
    throw error;
  }
}

export function resolveV1JProviderResponseDiagnosticRoot(
  repoRoot: string,
  harnessCommit: string,
): string {
  if (!/^[0-9a-f]{40}$/i.test(harnessCommit)) {
    throw new Error("v1J provider-response diagnostics require the actual full harness SHA");
  }
  return path.resolve(
    repoRoot,
    V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PARENT,
    `${V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX}${harnessCommit}`,
  );
}

export function createV1JProviderResponseDiagnosticJournal(input: {
  repoRoot: string;
  harnessCommit: string;
  modelId: string;
  modelConfigHash: string;
  schemaFingerprint: {
    authorizedToolCount: number;
    providerToolCount: number;
    authorizedToolNameSha256: string;
    providerToolNameSha256: string;
    authorizedToolSchemaSha256: string;
    providerToolSchemaSha256: string;
  };
  startedAt: string;
}): V1JProviderResponseDiagnosticJournal {
  const repoRoot = fs.realpathSync(input.repoRoot);
  const parent = path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PARENT);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.realpathSync(parent) !== parent) {
    throw new Error("v1J provider-response diagnostics refuse an aliased artifact parent");
  }
  const root = resolveV1JProviderResponseDiagnosticRoot(repoRoot, input.harnessCommit);
  const formalRoot = path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH);
  const smokeRoot = path.resolve(parent, `smoke-${input.harnessCommit}`);
  if (pathsOverlap(root, formalRoot) || pathsOverlap(root, smokeRoot)) {
    throw new Error("v1J provider-response diagnostics overlap formal or smoke artifacts");
  }
  if (fs.existsSync(formalRoot)) {
    throw new Error("v1J provider-response diagnostics refuse existing formal state");
  }
  assertWithin(parent, root);
  fs.mkdirSync(root, { recursive: false });
  if (fs.realpathSync(root) !== root) {
    throw new Error("v1J provider-response diagnostics refuse an aliased diagnostic root");
  }
  const filePath = path.join(root, "lifecycle.jsonl");
  assertWithin(root, filePath);
  const fd = fs.openSync(filePath, "wx");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = {
    artifactKind: "v1J-provider-response-diagnostic",
    harnessCommit: input.harnessCommit,
    modelId: input.modelId,
    modelConfigHash: input.modelConfigHash,
    schemaFingerprint: input.schemaFingerprint,
    cellId: V1J_PROVIDER_RESPONSE_DIAGNOSTIC_CELL,
    activeFilteringEnabled: false,
    formalStateTouched: false,
    smokeStateTouched: false,
    promptContentPersisted: false,
    credentialsPersisted: false,
    startedAt: input.startedAt,
  };
  const manifestFd = fs.openSync(manifestPath, "wx");
  try {
    fs.writeFileSync(manifestFd, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.fsyncSync(manifestFd);
  } finally {
    fs.closeSync(manifestFd);
  }

  const startedAtMs = Date.now();
  let eventIndex = 0;
  let closed = false;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    if (closed) {
      throw new Error("v1J provider-response diagnostic journal is closed");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(event)) {
      throw new Error("v1J provider-response diagnostic event name is invalid");
    }
    const safeDetails = Object.fromEntries(
      Object.entries(details).filter(
        ([key, value]) => SAFE_DETAIL_KEYS.has(key) && isSafeValue(key, value),
      ),
    );
    const row = {
      event,
      eventIndex: ++eventIndex,
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      pid: process.pid,
      harnessCommit: input.harnessCommit,
      cellId: V1J_PROVIDER_RESPONSE_DIAGNOSTIC_CELL,
      ...safeDetails,
    };
    fs.writeSync(fd, `${JSON.stringify(row)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  };
  record("diagnostic-entrypoint-start", {
    outcome: "started",
    terminalEvidenceComplete: false,
    terminalEvidencePersisted: false,
  });
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

export function isV1JCleanupFailureSecondary(input: {
  terminalEvidenceComplete: boolean;
  terminalEvidencePersisted: boolean;
}): boolean {
  return input.terminalEvidenceComplete && input.terminalEvidencePersisted;
}

function isSafeValue(key: string, value: unknown): value is string | number | boolean | null {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "string" || value.length > 160) {
    return false;
  }
  if (key === "contentType") {
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value);
  }
  if (key === "errorCode") {
    return /^[a-z0-9_-]{1,40}$/i.test(value);
  }
  if (key.endsWith("Class")) {
    return /^[a-z][a-z0-9_.-]{0,79}$/i.test(value);
  }
  if (key === "failureStage") {
    return /^[a-z0-9_.-]{1,120}$/i.test(value);
  }
  if (key === "requestId" || key === "correlationId") {
    return /^[a-z0-9_.:-]{1,120}$/i.test(value);
  }
  return true;
}

function assertWithin(parent: string, target: string): void {
  const relative = path.relative(parent, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("v1J provider-response diagnostic path escaped its artifact root");
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const within = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  return within(left, right) || within(right, left);
}
