import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertV1JProviderControlPreflight,
  createV1JProviderControlJournal,
  runV1JProviderTransportControls,
  sha256V1JProviderControl,
  V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG,
  V1J_PROVIDER_CONTROL_COMMIT_FLAG,
  V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
  V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
  V1J_PROVIDER_CONTROL_PROMPT,
  V1J_PROVIDER_CONTROL_RUN_FLAG,
  V1J_PROVIDER_CONTROL_SCHEMA_BASELINE,
} from "../../../test/helpers/agents/model-choice-provider-isolation.js";

const head = "a".repeat(40);
const preflightInput = () => ({
  env: {
    [V1J_PROVIDER_CONTROL_RUN_FLAG]: "1",
    [V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG]: "1",
    [V1J_PROVIDER_CONTROL_COMMIT_FLAG]: head,
  },
  head,
  trackedTreeClean: true,
  activeFilteringEnabled: false,
  modelId: "qwen/qwen3.5-9b",
  modelConfigHash: V1J_PROVIDER_CONTROL_MODEL_CONFIG_SHA256,
  preregistrationHash: V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
  detachedPreregistrationHash: `${V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256}  preregistration-v2.json`,
  schemaBaseline: { ...V1J_PROVIDER_CONTROL_SCHEMA_BASELINE },
  provenanceAccepted: true,
  artifactExists: false,
});

function responseWithChunks(chunks: readonly string[], delayMs = 0): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), delayMs);
          });
        }
        const chunk = chunks[index++];
        if (chunk === undefined) {
          controller.close();
        } else {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("v1J LM Studio provider transport controls", () => {
  it("requires exact commit-bound authorization and frozen preflight values", () => {
    expect(() => assertV1JProviderControlPreflight(preflightInput())).not.toThrow();
    const unauthorizedInput = preflightInput();
    delete unauthorizedInput.env[V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG];
    expect(() => assertV1JProviderControlPreflight(unauthorizedInput)).toThrow(
      /exact commit-bound authorization flags/,
    );
    expect(() =>
      assertV1JProviderControlPreflight({
        ...preflightInput(),
        env: { ...preflightInput().env, OPENCLAW_V1J_LIVE_TEST: "1" },
      }),
    ).toThrow(/cannot share live modes/);
    expect(() =>
      assertV1JProviderControlPreflight({ ...preflightInput(), activeFilteringEnabled: true }),
    ).toThrow(/active filtering/);
    expect(() =>
      assertV1JProviderControlPreflight({ ...preflightInput(), modelConfigHash: "drift" }),
    ).toThrow(/configuration drifted/);
    expect(() =>
      assertV1JProviderControlPreflight({ ...preflightInput(), provenanceAccepted: false }),
    ).toThrow(/provenance amendment/);
    expect(() =>
      assertV1JProviderControlPreflight({ ...preflightInput(), artifactExists: true }),
    ).toThrow(/already exists/);
    expect(() =>
      assertV1JProviderControlPreflight({
        ...preflightInput(),
        schemaBaseline: { ...V1J_PROVIDER_CONTROL_SCHEMA_BASELINE, providerToolCount: 31 },
      }),
    ).toThrow(/schema fingerprints/);
  });

  it("captures exactly two no-tool requests and transport counts without response content", async () => {
    const requests: {
      body: Record<string, unknown>;
      rawBody: string;
      authorization: string | null;
    }[] = [];
    const events: unknown[] = [];
    const responses = [
      responseWithChunks(["secret-response-a"]),
      responseWithChunks(["secret-response-b"]),
    ];
    const results = await runV1JProviderTransportControls({
      endpoint: "http://127.0.0.1:1234/v1/chat/completions",
      model: "qwen/qwen3.5-9b",
      authorization: "Bearer private-token",
      timeoutMs: 100,
      heartbeatMs: 1_000,
      fetchImpl: async (_url, init) => {
        const rawBody = String(init?.body);
        requests.push({
          body: JSON.parse(rawBody) as Record<string, unknown>,
          rawBody,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return responses.shift()!;
      },
      record: (event) => events.push(event),
    });

    expect(requests).toHaveLength(2);
    expect(requests.map(({ body }) => body.stream)).toEqual([false, true]);
    expect(requests.every(({ body }) => body.max_tokens === 8)).toBe(true);
    expect(requests.every(({ body }) => !("tools" in body))).toBe(true);
    expect(requests.every(({ authorization }) => authorization === "Bearer private-token")).toBe(
      true,
    );
    expect(results.map((result) => result.mode)).toEqual(["stream-false", "stream-true"]);
    expect(results.every((result) => result.httpStatus === 200 && result.streamEnd)).toBe(true);
    expect(
      results.every((result) => result.toolCount === 0 && result.toolSchemaJsonBytes === 0),
    ).toBe(true);
    expect(results.every((result) => result.maxTokens === 8)).toBe(true);
    expect(results.every((result) => result.responseByteCount > 0)).toBe(true);
    expect(results[0]?.requestJsonBytes).toBe(Buffer.byteLength(requests[0]!.rawBody, "utf8"));
    expect(results[0]?.totalMessageContentBytes).toBe(
      Buffer.byteLength(V1J_PROVIDER_CONTROL_PROMPT, "utf8"),
    );
    const progress = (
      events as { event: string; mode?: string; chunkCount?: number; byteCount?: number }[]
    ).filter((event) => event.event === "response-progress");
    for (const mode of ["stream-false", "stream-true"]) {
      const perMode = progress.filter((event) => event.mode === mode);
      for (let index = 1; index < perMode.length; index += 1) {
        expect(perMode[index]!.chunkCount).toBeGreaterThan(perMode[index - 1]!.chunkCount!);
        expect(perMode[index]!.byteCount).toBeGreaterThan(perMode[index - 1]!.byteCount!);
      }
    }
    expect(
      (events as { event: string }[]).filter((event) => event.event === "stream-end"),
    ).toHaveLength(2);
    expect(JSON.stringify({ results, events })).not.toContain("secret-response");
    expect(JSON.stringify({ results, events })).not.toContain("private-token");
    expect(JSON.stringify({ results, events })).not.toContain(V1J_PROVIDER_CONTROL_PROMPT);
  });

  it("continues to the second control after one transport error without retrying the first", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("transport failed"))
      .mockResolvedValueOnce(responseWithChunks(["ok"]));
    const results = await runV1JProviderTransportControls({
      endpoint: "http://127.0.0.1:1234/v1/chat/completions",
      model: "qwen/qwen3.5-9b",
      authorization: "Bearer secret",
      fetchImpl,
      record: () => undefined,
      timeoutMs: 100,
      heartbeatMs: 1_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(results[0]?.errorName).toBe("TypeError");
    expect(results[1]?.httpStatus).toBe(200);
  });

  it("emits metadata-only heartbeats while open and stops them after completion", async () => {
    const heartbeats: unknown[] = [];
    await runV1JProviderTransportControls({
      endpoint: "http://127.0.0.1:1234/v1/chat/completions",
      model: "qwen/qwen3.5-9b",
      authorization: "Bearer secret",
      fetchImpl: async () => responseWithChunks(["ok"], 8),
      record: () => undefined,
      heartbeat: (event) => heartbeats.push(event),
      timeoutMs: 100,
      heartbeatMs: 2,
    });
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(JSON.stringify(heartbeats)).not.toContain("ok");
    const completedCount = heartbeats.length;
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 10);
    });
    expect(heartbeats).toHaveLength(completedCount);
  });

  it("aborts a timed-out control before starting the next one", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(
      runV1JProviderTransportControls({
        endpoint: "http://127.0.0.1:1234/v1/chat/completions",
        model: "qwen/qwen3.5-9b",
        authorization: "Bearer secret",
        fetchImpl,
        record: () => undefined,
        timeoutMs: 5,
        heartbeatMs: 1_000,
      }),
    ).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("writes a fresh diagnostic-only journal and rejects reuse or path escape", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-provider-controls-"));
    const relative =
      "artifacts/capability-intelligence/v1j-action-initiation/lmstudio-transport-controls-test";
    try {
      const journal = createV1JProviderControlJournal({
        repoRoot,
        artifactRoot: relative,
        manifest: { promptContentPersisted: false, credentialsPersisted: false },
      });
      journal.record({ event: "control-complete", mode: "stream-false", elapsedMs: 1 });
      expect(
        fs.readFileSync(path.join(journal.artifactRoot, "transport-events.jsonl"), "utf8"),
      ).toContain("control-complete");
      expect(() =>
        createV1JProviderControlJournal({ repoRoot, artifactRoot: relative, manifest: {} }),
      ).toThrow();
      expect(() =>
        createV1JProviderControlJournal({
          repoRoot,
          artifactRoot: "artifacts/elsewhere/out",
          manifest: {},
        }),
      ).toThrow(/escapes/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exports the request-side byte-count algorithm as UTF-8", async () => {
    const results = await runV1JProviderTransportControls({
      endpoint: "http://127.0.0.1:1234/v1/chat/completions",
      model: "qwen/qwen3.5-9b",
      authorization: "Bearer secret",
      fetchImpl: async () => responseWithChunks(["ok"]),
      record: () => undefined,
      timeoutMs: 100,
      heartbeatMs: 1_000,
    });
    expect(results[0]?.requestJsonBytes).toBeGreaterThan(results[0]?.totalMessageContentBytes ?? 0);
    expect(sha256V1JProviderControl("ok")).toBe(
      "2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df",
    );
  });
});
