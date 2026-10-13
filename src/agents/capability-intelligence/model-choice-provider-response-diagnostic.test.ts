import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createV1JProviderResponseDiagnosticJournal,
  isV1JCleanupFailureSecondary,
  observeV1JAdapterResponse,
  observeV1JProviderResponseBody,
  resolveV1JProviderResponseDiagnosticRoot,
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH,
  V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX,
  type V1JProviderResponseDiagnosticJournal,
} from "../../../test/helpers/agents/model-choice-provider-response-diagnostic.js";

type TestJournal = V1JProviderResponseDiagnosticJournal & {
  readRows: () => Record<string, unknown>[];
  dispose: () => void;
};

describe("v1J provider-response diagnostic artifacts", () => {
  it("passes stream bytes through unchanged and durably records monotonic progress", async () => {
    const diagnostic = createTestJournal();
    const chunks = [new Uint8Array([0, 1, 2]), new Uint8Array([3, 4])];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    try {
      const observed = observeV1JProviderResponseBody({
        body: source,
        journal: diagnostic,
        requestIndex: 1,
      });
      const output = new Uint8Array(await new Response(observed).arrayBuffer());
      expect(Array.from(output)).toEqual([0, 1, 2, 3, 4]);
      const rows = readRows(diagnostic);
      const progress = rows.filter((row) => row.event === "response-stream-progress");
      expect(progress.map((row) => row.responseChunkCount)).toEqual([1, 2]);
      expect(progress.map((row) => row.responseByteCount)).toEqual([3, 5]);
      expect(rows.find((row) => row.event === "response-first-byte")).toMatchObject({
        responseChunkCount: 1,
        responseByteCount: 3,
      });
      expect(rows.find((row) => row.event === "stream-end")).toMatchObject({
        outcome: "complete",
        responseChunkCount: 2,
        responseByteCount: 5,
      });
      expect(JSON.stringify(rows)).not.toContain("0,1,2");
    } finally {
      diagnostic.dispose();
    }
  });

  it("heartbeats only while a read is pending and stops on stream completion", async () => {
    const diagnostic = createTestJournal();
    const manualTimer = createManualTimer();
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    const heartbeats: string[] = [];
    let now = 100;
    try {
      const observed = observeV1JProviderResponseBody({
        body: source,
        journal: diagnostic,
        requestIndex: 1,
        heartbeatIntervalMs: 25_000,
        writeHeartbeat: (line) => heartbeats.push(line),
        now: () => now,
        setInterval: manualTimer.setInterval,
        clearInterval: manualTimer.clearInterval,
      });
      const reader = observed.getReader();
      const firstRead = reader.read();
      await manualTimer.ready;
      now = 25_100;
      manualTimer.tick();
      expect(heartbeats).toEqual([
        "v1J provider diagnostic still awaiting stream completion elapsedMs=25000 chunks=0 bytes=0\n",
      ]);
      sourceController.enqueue(new Uint8Array([9, 8]));
      expect((await firstRead).value).toEqual(new Uint8Array([9, 8]));
      const endRead = reader.read();
      sourceController.close();
      expect(await endRead).toMatchObject({ done: true });
      const heartbeatCountAtEnd = heartbeats.length;
      manualTimer.tick();
      expect(heartbeats).toHaveLength(heartbeatCountAtEnd);
      expect(manualTimer.active).toBe(false);
      expect(readRows(diagnostic).find((row) => row.event === "stream-end")).toMatchObject({
        outcome: "complete",
        responseChunkCount: 1,
        responseByteCount: 2,
      });
    } finally {
      diagnostic.dispose();
    }
  });

  it("stops heartbeat on stream error and preserves the original failure", async () => {
    const diagnostic = createTestJournal();
    const manualTimer = createManualTimer();
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    try {
      const reader = observeV1JProviderResponseBody({
        body: source,
        journal: diagnostic,
        requestIndex: 1,
        writeHeartbeat: () => undefined,
        setInterval: manualTimer.setInterval,
        clearInterval: manualTimer.clearInterval,
      }).getReader();
      const pendingRead = reader.read();
      await manualTimer.ready;
      const streamError = Object.assign(new Error("private stream error"), {
        code: "ECONNRESET",
      });
      sourceController.error(streamError);
      await expect(pendingRead).rejects.toBe(streamError);
      expect(manualTimer.active).toBe(false);
      expect(readRows(diagnostic).find((row) => row.event === "stream-end")).toMatchObject({
        outcome: "error",
        errorClass: "Error",
        errorCode: "ECONNRESET",
      });
      expect(JSON.stringify(readRows(diagnostic))).not.toContain("private stream error");
    } finally {
      diagnostic.dispose();
    }
  });

  it("writes commit-bound diagnostics outside smoke/formal state and redacts payload fields", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-response-diagnostic-"));
    const commit = "a".repeat(40);
    try {
      const journal = createV1JProviderResponseDiagnosticJournal({
        repoRoot,
        harnessCommit: commit,
        modelId: "test-model",
        modelConfigHash: "b".repeat(64),
        schemaFingerprint: {
          authorizedToolCount: 15,
          providerToolCount: 15,
          authorizedToolNameSha256: "c".repeat(64),
          providerToolNameSha256: "c".repeat(64),
          authorizedToolSchemaSha256: "d".repeat(64),
          providerToolSchemaSha256: "e".repeat(64),
        },
        startedAt: "2026-10-13T00:00:00.000Z",
      });
      journal.record("http-response-headers", {
        requestId: "safe-correlation-id",
        httpStatus: 503,
        contentType: "application/json",
        prompt: "must-not-persist",
        responseBody: "must-not-persist",
        apiKey: "must-not-persist",
      });
      journal.close();

      const root = resolveV1JProviderResponseDiagnosticRoot(repoRoot, commit);
      const row = JSON.parse(
        fs.readFileSync(journal.filePath, "utf8").trim().split("\n").at(-1)!,
      ) as Record<string, unknown>;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(root).toContain(`${V1J_PROVIDER_RESPONSE_DIAGNOSTIC_PREFIX}${commit}`);
      expect(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH)).not.toBe(root);
      expect(row).toMatchObject({ event: "http-response-headers", httpStatus: 503 });
      expect(row).not.toHaveProperty("prompt");
      expect(row).not.toHaveProperty("responseBody");
      expect(row).not.toHaveProperty("apiKey");
      expect(manifest).toMatchObject({
        harnessCommit: commit,
        cellId: "smoke-tool-required:A:1",
        activeFilteringEnabled: false,
        formalStateTouched: false,
        smokeStateTouched: false,
        promptContentPersisted: false,
        credentialsPersisted: false,
      });
      expect(
        fs.existsSync(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH)),
      ).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses existing formal state and makes cleanup secondary only after durable complete evidence", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-diagnostic-formal-"));
    const commit = "b".repeat(40);
    try {
      fs.mkdirSync(path.resolve(repoRoot, V1J_PROVIDER_RESPONSE_DIAGNOSTIC_FORMAL_PATH), {
        recursive: true,
      });
      expect(() =>
        createV1JProviderResponseDiagnosticJournal({
          repoRoot,
          harnessCommit: commit,
          modelId: "test-model",
          modelConfigHash: "c".repeat(64),
          schemaFingerprint: {
            authorizedToolCount: 15,
            providerToolCount: 15,
            authorizedToolNameSha256: "d".repeat(64),
            providerToolNameSha256: "d".repeat(64),
            authorizedToolSchemaSha256: "e".repeat(64),
            providerToolSchemaSha256: "f".repeat(64),
          },
          startedAt: "2026-10-13T00:00:00.000Z",
        }),
      ).toThrow(/existing formal state/);
      expect(fs.existsSync(resolveV1JProviderResponseDiagnosticRoot(repoRoot, commit))).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: true,
        terminalEvidencePersisted: true,
      }),
    ).toBe(true);
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: false,
        terminalEvidencePersisted: true,
      }),
    ).toBe(false);
    expect(
      isV1JCleanupFailureSecondary({
        terminalEvidenceComplete: true,
        terminalEvidencePersisted: false,
      }),
    ).toBe(false);
  });

  it("distinguishes adapter rejection from a received provider response and preserves the error", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-adapter-error-"));
    const journal = createV1JProviderResponseDiagnosticJournal({
      repoRoot,
      harnessCommit: "f".repeat(40),
      modelId: "test-model",
      modelConfigHash: "a".repeat(64),
      schemaFingerprint: {
        authorizedToolCount: 15,
        providerToolCount: 15,
        authorizedToolNameSha256: "b".repeat(64),
        providerToolNameSha256: "b".repeat(64),
        authorizedToolSchemaSha256: "c".repeat(64),
        providerToolSchemaSha256: "d".repeat(64),
      },
      startedAt: "2026-10-13T00:00:00.000Z",
    });
    const providerError = Object.assign(new Error("private provider error"), {
      code: "PROVIDER_REJECTED",
    });
    try {
      journal.record("provider-response-observed", {
        providerResponseObserved: true,
        httpStatus: 400,
      });
      await expect(
        observeV1JAdapterResponse({
          journal,
          requestIndex: 1,
          observe: () => {
            throw providerError;
          },
        }),
      ).rejects.toBe(providerError);
      journal.close();
      const rows = fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows.find((row) => row.event === "provider-response-observed")).toMatchObject({
        providerResponseObserved: true,
        httpStatus: 400,
      });
      expect(rows.find((row) => row.event === "adapter-response-failed")).toMatchObject({
        errorClass: "Error",
        errorCode: "PROVIDER_REJECTED",
      });
      expect(JSON.stringify(rows)).not.toContain("private provider error");
    } finally {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function createTestJournal(): TestJournal {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-stream-progress-"));
  const journal = createV1JProviderResponseDiagnosticJournal({
    repoRoot,
    harnessCommit: "a".repeat(40),
    modelId: "test-model",
    modelConfigHash: "b".repeat(64),
    schemaFingerprint: {
      authorizedToolCount: 15,
      providerToolCount: 15,
      authorizedToolNameSha256: "c".repeat(64),
      providerToolNameSha256: "c".repeat(64),
      authorizedToolSchemaSha256: "d".repeat(64),
      providerToolSchemaSha256: "e".repeat(64),
    },
    startedAt: "2026-10-13T00:00:00.000Z",
  });
  return Object.assign(journal, {
    readRows: () =>
      fs
        .readFileSync(journal.filePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    dispose: () => {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  });
}

function readRows(journal: TestJournal): Record<string, unknown>[] {
  return journal.readRows();
}

function createManualTimer() {
  let callback: (() => void) | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let active = false;
  return {
    ready,
    get active() {
      return active;
    },
    setInterval: (next: () => void) => {
      callback = next;
      active = true;
      resolveReady();
      return 1;
    },
    clearInterval: () => {
      active = false;
      callback = undefined;
    },
    tick: () => {
      callback?.();
    },
  };
}
