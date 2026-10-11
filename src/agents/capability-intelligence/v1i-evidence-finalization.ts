import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { isRecord } from "@openclaw/normalization-core/record-coerce";

export type V1ICleanupOutcome = {
  attempted: true;
  result: "SUCCESS" | "EPERM" | "ERROR";
  secondary: boolean;
  cleanupPath: string;
  cleanupAttempts: number;
  cleanupElapsedMs: number;
  cleanupErrorCode: string | null;
  cleanupErrorMessage: string | null;
};

export type V1IEvidenceFinalization = {
  serializationStarted: true;
  serializationComplete: boolean;
  serializationErrorName: string | null;
  serializationErrorMessage: string | null;
  cleanup: V1ICleanupOutcome;
};

export async function cleanupV1IWorkspace(input: {
  workspaceDir: string;
  evidenceComplete: boolean;
  serializationComplete: boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<V1ICleanupOutcome> {
  const startedAt = performance.now();
  const maxAttempts = input.maxAttempts ?? 3;
  const retryDelayMs = input.retryDelayMs ?? 50;
  let lastError: unknown;
  let attempts = 0;
  for (; attempts < maxAttempts; attempts += 1) {
    try {
      fs.rmSync(input.workspaceDir, { recursive: true, force: true, maxRetries: 0 });
      return {
        attempted: true,
        result: "SUCCESS",
        secondary: false,
        cleanupPath: input.workspaceDir,
        cleanupAttempts: attempts + 1,
        cleanupElapsedMs: Math.round(performance.now() - startedAt),
        cleanupErrorCode: null,
        cleanupErrorMessage: null,
      };
    } catch (error) {
      lastError = error;
      if (attempts + 1 < maxAttempts) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, retryDelayMs);
        });
      }
    }
  }
  const errorCode =
    isRecord(lastError) && typeof lastError.code === "string" ? lastError.code : null;
  const errorMessage = lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
  return {
    attempted: true,
    result: errorCode === "EPERM" ? "EPERM" : "ERROR",
    secondary: input.evidenceComplete && input.serializationComplete,
    cleanupPath: input.workspaceDir,
    cleanupAttempts: attempts,
    cleanupElapsedMs: Math.round(performance.now() - startedAt),
    cleanupErrorCode: errorCode,
    cleanupErrorMessage: errorMessage,
  };
}

export async function persistV1IEvidenceBeforeCleanup<T>(input: {
  record: T;
  evidenceComplete: boolean;
  serialize: (record: T) => void | Promise<void>;
  cleanup: (input: {
    evidenceComplete: boolean;
    serializationComplete: boolean;
  }) => Promise<V1ICleanupOutcome>;
}): Promise<V1IEvidenceFinalization> {
  let serializationComplete = false;
  let serializationError: unknown;
  try {
    await input.serialize(input.record);
    serializationComplete = true;
  } catch (error) {
    serializationError = error;
  }
  const cleanup = await input.cleanup({
    evidenceComplete: input.evidenceComplete,
    serializationComplete,
  });
  return {
    serializationStarted: true,
    serializationComplete,
    serializationErrorName:
      serializationError instanceof Error
        ? serializationError.name
        : serializationError
          ? "NonErrorThrown"
          : null,
    serializationErrorMessage:
      serializationError instanceof Error
        ? serializationError.message
        : serializationError
          ? JSON.stringify(serializationError)
          : null,
    cleanup,
  };
}
