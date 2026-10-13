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
import {
  assertV1JPayloadDecompositionPreflight,
  buildV1JPayloadDecompositionRequests,
  createV1JPayloadDecompositionJournal,
  runV1JPayloadDecompositionControls,
  V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG,
  V1J_PAYLOAD_DECOMPOSITION_MINIMAL_PROMPT,
  V1J_PAYLOAD_DECOMPOSITION_PREFIX,
  V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256,
  V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG,
} from "../../../test/helpers/agents/model-choice-provider-payload-decomposition.js";

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

describe("v1J payload-decomposition transport diagnostic", () => {
  it("constructs only the preregistered one-dimension A/B/C request variants", () => {
    const tools = Array.from({ length: 15 }, (_, index) => ({
      type: "function",
      function: { name: `tool_${index}`, parameters: { type: "object", properties: {} } },
    }));
    const captured = {
      model: "qwen/qwen3.5-9b",
      messages: [
        { role: "system", content: "frozen Arm A system context" },
        { role: "user", content: "the full Arm-A smoke request prompt" },
      ],
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      temperature: 0,
    };
    const requests = buildV1JPayloadDecompositionRequests({ capturedArmARequest: captured });
    expect(requests.map((request) => request.control)).toEqual(["A", "B", "C"]);
    expect(requests.every((request) => request.body.stream === true)).toBe(true);
    expect(requests[0]!.body.messages).toEqual([
      { role: "user", content: V1J_PAYLOAD_DECOMPOSITION_MINIMAL_PROMPT },
    ]);
    expect(requests[0]!.body.tools).toEqual(tools);
    expect(requests[1]!.body.messages).toEqual(captured.messages);
    expect(requests[1]!.body).not.toHaveProperty("tools");
    expect(requests[1]!.body).not.toHaveProperty("tool_choice");
    expect(requests[1]!.body).not.toHaveProperty("parallel_tool_calls");
    expect(requests[2]!.body.messages).toEqual(captured.messages);
    expect(requests[2]!.body.tools).toEqual(tools);
    expect(requests[2]!.body.tool_choice).toBe("auto");
    expect(captured.stream).toBeUndefined();
    expect(captured.messages[1]!.content).toBe("the full Arm-A smoke request prompt");
  });

  it("rejects a captured request that cannot prove the frozen 15-tool surface", () => {
    expect(() =>
      buildV1JPayloadDecompositionRequests({
        capturedArmARequest: { model: "model", messages: [], tools: [] },
      }),
    ).toThrow(/captured 15-tool Arm A request/);
  });

  it("requires exact commit-bound authorization and frozen runtime identity", () => {
    const input = {
      env: {
        [V1J_PAYLOAD_DECOMPOSITION_RUN_FLAG]: "1",
        [V1J_PAYLOAD_DECOMPOSITION_AUTHORIZED_FLAG]: "1",
        [V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG]: head,
      },
      head,
      trackedTreeClean: true,
      activeFilteringEnabled: false,
      modelId: "qwen/qwen3.5-9b",
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      protocolHash: V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256,
      detachedProtocolHash: `${V1J_PAYLOAD_DECOMPOSITION_PROTOCOL_SHA256} preregistration-v2.json`,
      provenanceAccepted: true,
      artifactExists: false,
    };
    expect(() => assertV1JPayloadDecompositionPreflight(input)).not.toThrow();
    expect(() =>
      assertV1JPayloadDecompositionPreflight({
        ...input,
        env: { ...input.env, OPENCLAW_V1J_LIVE_SMOKE: "1" },
      }),
    ).toThrow(/cannot share live modes/);
    expect(() =>
      assertV1JPayloadDecompositionPreflight({
        ...input,
        env: { ...input.env, [V1J_PAYLOAD_DECOMPOSITION_COMMIT_FLAG]: "b".repeat(40) },
      }),
    ).toThrow(/exact commit-bound/);
    expect(() =>
      assertV1JPayloadDecompositionPreflight({ ...input, activeFilteringEnabled: true }),
    ).toThrow(/filtering/);
  });

  it("records transport metrics without persisting prompts, response bytes, or credentials", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-payload-decomposition-"));
    const headCommit = "c".repeat(40);
    const tools = Array.from({ length: 15 }, (_, index) => ({
      type: "function",
      function: { name: `tool_${index}`, parameters: { type: "object", properties: {} } },
    }));
    const requests = buildV1JPayloadDecompositionRequests({
      capturedArmARequest: {
        model: "qwen/qwen3.5-9b",
        messages: [
          { role: "system", content: "secret full system prompt" },
          { role: "user", content: "secret full Arm-A user prompt" },
        ],
        tools,
      },
    });
    const journal = createV1JPayloadDecompositionJournal({
      repoRoot,
      harnessCommit: headCommit,
      modelId: "qwen/qwen3.5-9b",
      modelConfigHash: "d".repeat(64),
      provider: "lmstudio",
      contextLength: 262_144,
      schemaFingerprint: { providerToolCount: 15 },
      startedAt: "2026-10-13T00:00:00.000Z",
    });
    const sentBodies: Record<string, unknown>[] = [];
    try {
      const results = await runV1JPayloadDecompositionControls({
        endpoint: "http://127.0.0.1:1234/v1/chat/completions",
        authorization: "Bearer do-not-persist-this-token",
        requests,
        fetchImpl: async (_url, init) => {
          sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response("sensitive model response", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
        record: journal.record,
        timeoutMs: 5_000,
        heartbeatMs: 60_000,
      });
      expect(results).toHaveLength(3);
      expect(results.map((result) => result.control)).toEqual(["A", "B", "C"]);
      expect(results.map((result) => result.toolCount)).toEqual([15, 0, 15]);
      expect(results.every((result) => result.requestDispatchStarted && result.bodyCompleted)).toBe(
        true,
      );
      expect(sentBodies).toHaveLength(3);
      expect(sentBodies.map((body) => body.stream)).toEqual([true, true, true]);
      expect(sentBodies[0]!.tools).toEqual(tools);
      expect(sentBodies[1]!.tools).toBeUndefined();
      expect(sentBodies[2]!.tools).toEqual(tools);
      expect(sentBodies[1]!.messages).toEqual(sentBodies[2]!.messages);
      journal.close();
      const artifactText = [
        fs.readFileSync(path.join(journal.artifactRoot, "manifest.json"), "utf8"),
        fs.readFileSync(path.join(journal.artifactRoot, "transport-events.jsonl"), "utf8"),
      ].join("\n");
      expect(artifactText).not.toContain("secret full system prompt");
      expect(artifactText).not.toContain("secret full Arm-A user prompt");
      expect(artifactText).not.toContain("sensitive model response");
      expect(artifactText).not.toContain("do-not-persist-this-token");
      expect(journal.artifactRoot).toContain(`${V1J_PAYLOAD_DECOMPOSITION_PREFIX}${headCommit}`);
    } finally {
      journal.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses to create diagnostics over existing formal or same-commit smoke state", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-payload-path-guard-"));
    const headCommit = "e".repeat(40);
    const parent = path.join(repoRoot, "artifacts/capability-intelligence/v1j-action-initiation");
    fs.mkdirSync(path.join(parent, "real-exact-run1"), { recursive: true });
    try {
      expect(() =>
        createV1JPayloadDecompositionJournal({
          repoRoot,
          harnessCommit: headCommit,
          modelId: "qwen/qwen3.5-9b",
          modelConfigHash: "f".repeat(64),
          provider: "lmstudio",
          contextLength: 262_144,
          schemaFingerprint: {},
          startedAt: "2026-10-13T00:00:00.000Z",
        }),
      ).toThrow(/existing formal or smoke state/);
      fs.rmSync(path.join(parent, "real-exact-run1"), { recursive: true, force: true });
      fs.mkdirSync(path.join(parent, `smoke-${headCommit}`));
      expect(() =>
        createV1JPayloadDecompositionJournal({
          repoRoot,
          harnessCommit: headCommit,
          modelId: "qwen/qwen3.5-9b",
          modelConfigHash: "f".repeat(64),
          provider: "lmstudio",
          contextLength: 262_144,
          schemaFingerprint: {},
          startedAt: "2026-10-13T00:00:00.000Z",
        }),
      ).toThrow(/existing formal or smoke state/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
