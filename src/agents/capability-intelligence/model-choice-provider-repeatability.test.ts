import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
  V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
  V1J_PROVIDER_CONTROL_SCHEMA_BASELINE,
  type V1JProviderControlFetch,
} from "../../../test/helpers/agents/model-choice-provider-isolation.js";
import {
  assertV1JRawRepeatabilityPreflight,
  createV1JRawRepeatabilityJournal,
  readV1JProviderBoundBodyArtifact,
  runV1JRawRepeatabilityFromArtifact,
  runV1JPreflightWithHeartbeat,
  runV1JRawRepeatabilityTransport,
  summarizeV1JRawRepeatabilityRequest,
  writeV1JProviderBoundBodyArtifact,
  V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG,
  V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG,
  V1J_RAW_REPEATABILITY_COMMIT_FLAG,
  V1J_RAW_REPEATABILITY_PARENT,
  V1J_RAW_REPEATABILITY_PREFIX,
  V1J_RAW_REPEATABILITY_REQUEST_COUNT,
  V1J_RAW_REPEATABILITY_RUN_FLAG,
  type V1JRawRepeatabilityCapture,
} from "../../../test/helpers/agents/model-choice-provider-repeatability.js";

const commit = "b".repeat(40);
const captureCommit = "c".repeat(40);
const authorization = {
  [V1J_RAW_REPEATABILITY_RUN_FLAG]: "1",
  [V1J_RAW_REPEATABILITY_AUTHORIZED_FLAG]: "1",
  [V1J_RAW_REPEATABILITY_COMMIT_FLAG]: commit,
  [V1J_RAW_REPEATABILITY_CAPTURE_COMMIT_FLAG]: captureCommit,
};

function makeCapture(): V1JRawRepeatabilityCapture {
  const requestObject = {
    model: "qwen/qwen3.5-9b",
    messages: [
      { role: "system", content: "PRIVATE_PROMPT_SYSTEM" },
      { role: "user", content: "PRIVATE_PROMPT_USER" },
    ],
    tools: Array.from({ length: 15 }, (_, index) => ({
      type: "function",
      function: {
        name: `diagnostic_tool_${index}`,
        parameters: { type: "object", properties: { value: { type: "string" } } },
      },
    })),
    stream: true,
    max_tokens: 512,
    temperature: 0,
  };
  return {
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    rawBody: JSON.stringify(requestObject),
    requestObject,
  };
}

function exportProviderBoundBody(repoRoot: string, sourceCommit = captureCommit) {
  const capture = makeCapture();
  const summary = summarizeV1JRawRepeatabilityRequest(capture);
  const exported = writeV1JProviderBoundBodyArtifact({
    repoRoot,
    captureCommit: sourceCommit,
    provider: "lmstudio",
    model: "qwen/qwen3.5-9b",
    rawBody: capture.rawBody,
    expectedCanonicalRequestSha256: summary.requestCanonicalSha256,
  });
  return { capture, summary, exported, sourceCommit };
}

function responseWithMarker(marker: string, onComplete?: () => void): Response {
  let emitted = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          emitted = true;
          controller.enqueue(new TextEncoder().encode(marker));
        } else {
          onComplete?.();
          controller.close();
        }
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function preflightInput() {
  return {
    env: { ...authorization },
    head: commit,
    captureCommit,
    trackedTreeClean: true,
    activeFilteringEnabled: false,
    modelId: "qwen/qwen3.5-9b",
    provider: "lmstudio",
    contextLength: 262_144,
    modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
    preregistrationHash: V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
    detachedPreregistrationHash: `${V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256} preregistration-v2.json`,
    schemaBaseline: { ...V1J_PROVIDER_CONTROL_SCHEMA_BASELINE },
    provenanceAccepted: true,
    artifactExists: false,
    formalStateExists: false,
    normalSmokeStateExists: false,
  };
}

describe("v1J raw-only provider repeatability", () => {
  it("requires the exact clean, commit-bound, isolated preflight", () => {
    expect(() => assertV1JRawRepeatabilityPreflight(preflightInput())).not.toThrow();
    expect(() =>
      assertV1JRawRepeatabilityPreflight({
        ...preflightInput(),
        env: { ...authorization, OPENCLAW_V1J_LIVE_TEST: "1" },
      }),
    ).toThrow(/cannot share live modes/);
    expect(() =>
      assertV1JRawRepeatabilityPreflight({ ...preflightInput(), activeFilteringEnabled: true }),
    ).toThrow(/filtering/);
    expect(() =>
      assertV1JRawRepeatabilityPreflight({ ...preflightInput(), formalStateExists: true }),
    ).toThrow(/formal or normal smoke/);
    expect(() =>
      assertV1JRawRepeatabilityPreflight({ ...preflightInput(), normalSmokeStateExists: true }),
    ).toThrow(/formal or normal smoke/);
    expect(() =>
      assertV1JRawRepeatabilityPreflight({ ...preflightInput(), trackedTreeClean: false }),
    ).toThrow(/clean committed/);
    expect(() =>
      assertV1JRawRepeatabilityPreflight({
        ...preflightInput(),
        captureCommit: "d".repeat(40),
      }),
    ).toThrow(/commit-bound authorization/);
  });

  it("exports exact provider bytes once with separate hashes and metadata-only stdout/journal shape", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-export-"));
    const stdoutWrite = vi.spyOn(process.stdout, "write");
    try {
      const { capture, summary, exported } = exportProviderBoundBody(repoRoot);
      const bodyPath = path.join(exported.artifactRoot, "request-body.bin");
      const metadataPath = path.join(exported.artifactRoot, "request-body-metadata.json");
      const bodyBytes = fs.readFileSync(bodyPath);
      const metadataText = fs.readFileSync(metadataPath, "utf8");
      expect(bodyBytes.equals(Buffer.from(capture.rawBody, "utf8"))).toBe(true);
      expect(exported.metadata).toEqual({
        bodyBytes: Buffer.byteLength(capture.rawBody, "utf8"),
        rawBodySha256: createHash("sha256").update(bodyBytes).digest("hex"),
        canonicalRequestSha256: summary.requestCanonicalSha256,
        messageCount: 2,
        toolCount: 15,
        captureCommit,
        provider: "lmstudio",
        model: "qwen/qwen3.5-9b",
      });
      expect(exported.metadata.rawBodySha256).not.toBe(exported.metadata.canonicalRequestSha256);
      expect(metadataText).not.toContain("PRIVATE_PROMPT_SYSTEM");
      expect(metadataText).not.toContain("PRIVATE_PROMPT_USER");
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(fs.readdirSync(exported.artifactRoot).toSorted()).toEqual([
        "request-body-metadata.json",
        "request-body.bin",
      ]);
      expect(() => exportProviderBoundBody(repoRoot)).toThrow();
      expect(fs.readFileSync(bodyPath)).toEqual(bodyBytes);
      expect(fs.readdirSync(path.dirname(exported.artifactRoot))).toEqual([captureCommit]);
    } finally {
      stdoutWrite.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("validates both digests and the frozen canonical hash before returning an artifact body", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-verify-"));
    try {
      const { capture, summary, exported } = exportProviderBoundBody(repoRoot);
      const loaded = readV1JProviderBoundBodyArtifact({
        repoRoot,
        captureCommit,
        endpoint: capture.endpoint,
        expectedCanonicalRequestSha256: summary.requestCanonicalSha256,
      });
      expect(loaded.capture.rawBody).toBe(capture.rawBody);
      expect(loaded.metadata.rawBodySha256).toBe(summary.requestSha256);
      expect(loaded.metadata.canonicalRequestSha256).toBe(summary.requestCanonicalSha256);
      expect(() =>
        readV1JProviderBoundBodyArtifact({
          repoRoot,
          captureCommit,
          endpoint: capture.endpoint,
          expectedCanonicalRequestSha256: "0".repeat(64),
        }),
      ).toThrow(/canonical integrity/);
      fs.writeFileSync(path.join(exported.artifactRoot, "request-body.bin"), "corrupt");
      expect(() =>
        readV1JProviderBoundBodyArtifact({
          repoRoot,
          captureCommit,
          endpoint: capture.endpoint,
          expectedCanonicalRequestSha256: summary.requestCanonicalSha256,
        }),
      ).toThrow(/raw-byte integrity/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each(["missing body", "corrupt body", "canonical hash mismatch"])(
    "%s blocks every raw send",
    async (failure) => {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-no-send-"));
      const capture = makeCapture();
      const summary = summarizeV1JRawRepeatabilityRequest(capture);
      let sends = 0;
      try {
        if (failure !== "missing body") {
          const { exported } = exportProviderBoundBody(repoRoot);
          if (failure === "corrupt body") {
            fs.writeFileSync(path.join(exported.artifactRoot, "request-body.bin"), "broken");
          }
        }
        await expect(
          runV1JRawRepeatabilityFromArtifact({
            repoRoot,
            captureCommit,
            endpoint: capture.endpoint,
            authorization: "Bearer PRIVATE_CREDENTIAL",
            expectedCanonicalRequestSha256:
              failure === "canonical hash mismatch"
                ? "0".repeat(64)
                : summary.requestCanonicalSha256,
            fetchImpl: async () => {
              sends += 1;
              return new Response(null, { status: 200 });
            },
            record: () => undefined,
          }),
        ).rejects.toThrow();
        expect(sends).toBe(0);
      } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
      }
    },
  );

  it("runs the later raw-only path directly from saved bytes with an immutable three-send cap", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-body-raw-only-"));
    const { capture, summary } = exportProviderBoundBody(repoRoot);
    const bodies: string[] = [];
    const events: { event: string }[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write");
    try {
      const results = await runV1JRawRepeatabilityFromArtifact({
        repoRoot,
        captureCommit,
        endpoint: capture.endpoint,
        authorization: "Bearer PRIVATE_CREDENTIAL",
        expectedCanonicalRequestSha256: summary.requestCanonicalSha256,
        fetchImpl: async (_input, init) => {
          bodies.push(String(init?.body));
          return responseWithMarker("PRIVATE_RESPONSE_BODY");
        },
        record: (event) => events.push({ event: event.event }),
      });
      expect(results).toHaveLength(V1J_RAW_REPEATABILITY_REQUEST_COUNT);
      expect(bodies).toEqual(Array(V1J_RAW_REPEATABILITY_REQUEST_COUNT).fill(capture.rawBody));
      expect(events.filter((event) => event.event === "repeatability-dispatch-start")).toHaveLength(
        V1J_RAW_REPEATABILITY_REQUEST_COUNT,
      );
      expect(events.at(-1)?.event).toBe("repeatability-complete");
      expect(JSON.stringify(events)).not.toContain("PRIVATE_PROMPT");
      expect(JSON.stringify(events)).not.toContain("PRIVATE_RESPONSE_BODY");
      expect(JSON.stringify(events)).not.toContain("PRIVATE_CREDENTIAL");
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sends exactly three sequential copies of the captured body and executes no adapter/tools", async () => {
    const capture = makeCapture();
    const requests: string[] = [];
    const events: unknown[] = [];
    let activeResponses = 0;
    let maximumActiveResponses = 0;
    const fetchImpl: V1JProviderControlFetch = async (_input, init) => {
      const body = String(init?.body);
      requests.push(body);
      activeResponses += 1;
      maximumActiveResponses = Math.max(maximumActiveResponses, activeResponses);
      return responseWithMarker("PRIVATE_RESPONSE_BODY", () => {
        activeResponses -= 1;
      });
    };

    const results = await runV1JRawRepeatabilityTransport({
      endpoint: capture.endpoint,
      authorization: "Bearer PRIVATE_CREDENTIAL",
      capture,
      fetchImpl,
      timeoutMs: 100,
      heartbeatMs: 1_000,
      record: (event) => events.push(event),
    });

    expect(results).toHaveLength(V1J_RAW_REPEATABILITY_REQUEST_COUNT);
    expect(requests).toHaveLength(3);
    expect(new Set(requests)).toEqual(new Set([capture.rawBody]));
    expect(maximumActiveResponses).toBe(1);
    expect(activeResponses).toBe(0);
    expect(new Set(results.map((result) => result.requestSha256)).size).toBe(1);
    expect(new Set(results.map((result) => result.requestCanonicalSha256)).size).toBe(1);
    expect(results.every((result) => result.toolCount === 15 && result.streamEnd)).toBe(true);
    expect(
      (events as { event: string }[]).some((event) =>
        ["adapter-dispatch-start", "tool-execution-start"].includes(event.event),
      ),
    ).toBe(false);
    expect(
      (events as { event: string }[]).filter(
        (event) => event.event === "repeatability-dispatch-start",
      ),
    ).toHaveLength(3);
  });

  it("records a timeout once and advances to the next scheduled raw request only after abort settles", async () => {
    const capture = makeCapture();
    const requests: string[] = [];
    const events: { event: string; mode?: string }[] = [];
    let firstAttempt = true;
    const fetchImpl: V1JProviderControlFetch = async (_input, init) => {
      requests.push(String(init?.body));
      if (firstAttempt) {
        firstAttempt = false;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("request aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return responseWithMarker("PRIVATE_RESPONSE_BODY");
    };
    const results = await runV1JRawRepeatabilityTransport({
      endpoint: capture.endpoint,
      authorization: "Bearer PRIVATE_CREDENTIAL",
      capture,
      fetchImpl,
      timeoutMs: 10,
      heartbeatMs: 1_000,
      record: (event) => events.push(event),
    });

    expect(requests).toHaveLength(3);
    expect(new Set(requests)).toEqual(new Set([capture.rawBody]));
    expect(results.map((result) => result.timedOut)).toEqual([true, false, false]);
    expect(results.map((result) => result.mode)).toEqual(["repeat-1", "repeat-2", "repeat-3"]);
    expect(new Set(results.map((result) => result.requestCanonicalSha256)).size).toBe(1);
    expect(events.filter((event) => event.event === "repeatability-dispatch-start")).toHaveLength(
      3,
    );
    expect(events.filter((event) => event.event === "control-complete")).toHaveLength(3);
  });

  it("writes metadata-only evidence beneath the commit-bound raw root and refuses formal/smoke state", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-raw-repeatability-test-"));
    const capture = makeCapture();
    const summary = summarizeV1JRawRepeatabilityRequest(capture);
    try {
      const journal = createV1JRawRepeatabilityJournal({
        repoRoot,
        harnessCommit: commit,
        captureCommit,
        modelId: "qwen/qwen3.5-9b",
        provider: "lmstudio",
        contextLength: 262_144,
        modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
        providerToolSchemaSha256: V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolSchemaSha256,
        requestSummary: summary,
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      await runV1JRawRepeatabilityTransport({
        endpoint: capture.endpoint,
        authorization: "Bearer PRIVATE_CREDENTIAL",
        capture,
        fetchImpl: async () => responseWithMarker("PRIVATE_RESPONSE_BODY"),
        timeoutMs: 100,
        heartbeatMs: 1_000,
        record: journal.record,
      });
      const manifestText = fs.readFileSync(
        path.join(journal.artifactRoot, "manifest.json"),
        "utf8",
      );
      const eventsText = fs.readFileSync(
        path.join(journal.artifactRoot, "transport-events.jsonl"),
        "utf8",
      );
      const persisted = `${manifestText}\n${eventsText}`;
      expect(journal.artifactRoot).toContain(
        path.join(V1J_RAW_REPEATABILITY_PARENT, `${V1J_RAW_REPEATABILITY_PREFIX}${commit}`),
      );
      expect(persisted).not.toContain("PRIVATE_PROMPT_SYSTEM");
      expect(persisted).not.toContain("PRIVATE_PROMPT_USER");
      expect(persisted).not.toContain("PRIVATE_RESPONSE_BODY");
      expect(persisted).not.toContain("PRIVATE_CREDENTIAL");
      expect(persisted).not.toContain(capture.rawBody);
      expect(
        fs.existsSync(path.join(repoRoot, V1J_RAW_REPEATABILITY_PARENT, "real-exact-run1")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(repoRoot, V1J_RAW_REPEATABILITY_PARENT, `smoke-${commit}`)),
      ).toBe(false);
      expect(() =>
        createV1JRawRepeatabilityJournal({
          repoRoot,
          harnessCommit: commit,
          captureCommit,
          modelId: "qwen/qwen3.5-9b",
          provider: "lmstudio",
          contextLength: 262_144,
          modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
          providerToolSchemaSha256: V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolSchemaSha256,
          requestSummary: summary,
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      ).toThrow(/already exists/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses a preexisting formal root before creating raw artifacts", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-raw-repeatability-guard-"));
    const formalRoot = path.join(repoRoot, V1J_RAW_REPEATABILITY_PARENT, "real-exact-run1");
    fs.mkdirSync(formalRoot, { recursive: true });
    fs.writeFileSync(path.join(formalRoot, "sentinel"), "untouched", "utf8");
    try {
      expect(() =>
        createV1JRawRepeatabilityJournal({
          repoRoot,
          harnessCommit: commit,
          captureCommit,
          modelId: "qwen/qwen3.5-9b",
          provider: "lmstudio",
          contextLength: 262_144,
          modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
          providerToolSchemaSha256: V1J_PROVIDER_CONTROL_SCHEMA_BASELINE.providerToolSchemaSha256,
          requestSummary: summarizeV1JRawRepeatabilityRequest(makeCapture()),
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      ).toThrow(/formal or normal smoke/);
      expect(fs.readFileSync(path.join(formalRoot, "sentinel"), "utf8")).toBe("untouched");
      expect(
        fs.existsSync(
          path.join(
            repoRoot,
            V1J_RAW_REPEATABILITY_PARENT,
            `${V1J_RAW_REPEATABILITY_PREFIX}${commit}`,
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { stage: "lmstudio-discovery", startEvent: "lmstudio-discovery-start" },
    { stage: "prepared-runtime-acquisition", startEvent: "prepared-runtime-start" },
    { stage: "provider-bound-capture", startEvent: "provider-bound-capture-start" },
  ])("durably heartbeats while $stage is stalled", async ({ stage, startEvent }) => {
    vi.useFakeTimers();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-preflight-heartbeat-"));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: { event: string; details?: Record<string, unknown> }[] = [];
    try {
      const journal = createV1JRawRepeatabilityJournal({
        repoRoot,
        harnessCommit: commit,
        captureCommit,
        modelId: "qwen/qwen3.5-9b",
        provider: "lmstudio",
        contextLength: 262_144,
        modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      journal.record({ event: "raw-repeatability-test-start" });
      journal.record({ event: "preregistration-loaded" });
      journal.record({ event: "repeatability-journal-created" });
      journal.record({ event: startEvent });
      const heartbeat = vi.fn();
      const operation = runV1JPreflightWithHeartbeat({
        operation: () => pending,
        stage: () => stage,
        record: (event) => {
          events.push(event);
          journal.record(event);
        },
        heartbeat,
        heartbeatMs: 25_000,
        now: () => Date.now(),
      });

      await vi.advanceTimersByTimeAsync(25_000);
      expect(heartbeat).toHaveBeenCalledWith({ stage, elapsedMs: 25_000 });
      expect(events.at(-1)).toEqual({
        event: "preflight-heartbeat",
        details: { stage, elapsedMs: 25_000 },
      });
      const journalText = fs.readFileSync(
        path.join(journal.artifactRoot, "transport-events.jsonl"),
        "utf8",
      );
      const lastJournalEvent = JSON.parse(journalText.trim().split("\n").at(-1) ?? "null") as {
        event: string;
        details?: { stage?: string };
      };
      expect(lastJournalEvent).toEqual({
        event: "preflight-heartbeat",
        details: { stage, elapsedMs: 25_000 },
      });
      expect(journalText).not.toContain("PRIVATE_PROMPT");
      const manifest = JSON.parse(
        fs.readFileSync(path.join(journal.artifactRoot, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(manifest.preflightProviderDispatches).toBe(0);
      expect(manifest.preflightToolExecutions).toBe(0);
      expect(manifest.providerToolSchemaSha256).toBeNull();

      // No transport work is started until the awaited preflight settles.
      let rawDispatches = 0;
      const afterPreflight = operation.then(async () => {
        await runV1JRawRepeatabilityTransport({
          endpoint: makeCapture().endpoint,
          authorization: "Bearer PRIVATE_CREDENTIAL",
          capture: makeCapture(),
          fetchImpl: async () => {
            rawDispatches += 1;
            return responseWithMarker("data: [DONE]\n\n");
          },
          timeoutMs: 100,
          heartbeatMs: 1_000,
          record: journal.record,
        });
      });
      expect(rawDispatches).toBe(0);
      release();
      await afterPreflight;
      expect(rawDispatches).toBe(V1J_RAW_REPEATABILITY_REQUEST_COUNT);
      expect(
        fs.existsSync(path.join(repoRoot, V1J_RAW_REPEATABILITY_PARENT, "real-exact-run1")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(repoRoot, V1J_RAW_REPEATABILITY_PARENT, `smoke-${commit}`)),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("records stage transitions without exposing request or prompt content", async () => {
    vi.useFakeTimers();
    let stage = "prepared-runtime-acquisition";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: { event: string; details?: Record<string, unknown> }[] = [];
    const operation = runV1JPreflightWithHeartbeat({
      operation: () => pending,
      stage: () => stage,
      record: (event) => events.push(event),
      heartbeatMs: 25_000,
    });
    try {
      await vi.advanceTimersByTimeAsync(25_000);
      stage = "provider-bound-capture";
      await vi.advanceTimersByTimeAsync(25_000);
      expect(events.map((event) => event.details?.stage)).toEqual([
        "prepared-runtime-acquisition",
        "provider-bound-capture",
      ]);
      expect(JSON.stringify(events)).not.toMatch(/prompt|message|credential|response body/iu);
      release();
      await operation;
      const completedEvents = events.length;
      await vi.advanceTimersByTimeAsync(50_000);
      expect(events).toHaveLength(completedEvents);
    } finally {
      vi.useRealTimers();
      release();
    }
  });
});
