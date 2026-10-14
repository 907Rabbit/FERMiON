import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readV1JPreregistration,
  V1J_PREREGISTRATION_PATH,
} from "../../../test/helpers/agents/model-choice-action-initiation.js";
import {
  assertV1JAdapterDifferentialRequestBudget,
  assertV1JAdapterDifferentialRequestMatch,
  assertV1JAdapterDifferentialPreflight,
  compareV1JAdapterDifferentialRequests,
  createV1JAdapterDifferentialJournal,
  installV1JAdapterDifferentialToolGuard,
  reportV1JAdapterDifferentialProgress,
  runV1JAdapterDifferentialRawTransport,
  recordV1JAdapterDifferentialRequestFingerprint,
  summarizeV1JAdapterDifferentialRequest,
  withV1JAdapterDifferentialProgress,
  V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS,
  V1J_ADAPTER_DIFFERENTIAL_MAX_RAW_REQUESTS,
  V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS,
  V1J_ADAPTER_DIFFERENTIAL_PARENT,
  V1J_ADAPTER_DIFFERENTIAL_PREFIX,
  V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG,
} from "../../../test/helpers/agents/model-choice-adapter-differential.js";
import {
  createPluginMetadataSnapshot,
  makeRegistry,
} from "../../config/plugin-auto-enable.test-helpers.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { withPluginRuntimeGenerationScope } from "../../plugins/runtime/generation-scope.js";
import { wrapToolWithBeforeToolCallHook } from "../agent-tools.before-tool-call.js";
import type { AnyAgentTool } from "../tools/common.js";

const head = "a".repeat(40);
const schema = {
  authorizedToolCount: 15,
  providerToolCount: 15,
  authorizedToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  providerToolNameSha256: "741f7983e4ba7652384ee83fed16b67f81e567b2231cfccbba8f58c19ee6837b",
  authorizedToolSchemaSha256: "e82b1930002abb9d4784edcada56491af39420d36e292c9f9792256a2231f128",
  providerToolSchemaSha256: "e87b23c436597f65b0a76c5f91a49b53440178731718efdbc70a7a048cbf39b2",
};
const requestBody = {
  model: "qwen/qwen3.5-9b",
  messages: [{ role: "user", content: "safe fixture prompt" }],
  tools: Array.from({ length: 15 }, (_, index) => ({ function: { name: `tool_${index}` } })),
  max_tokens: 128,
  stream: true,
};

describe("v1J adapter differential diagnostics", () => {
  it("resolves the frozen preregistration while an unauthorized config remains fail-closed", () => {
    const protocolPath = path.resolve(process.cwd(), V1J_PREREGISTRATION_PATH);
    expect(fs.existsSync(protocolPath)).toBe(true);
    expect(readV1JPreregistration().experimentId).toBe("v1J-ACTION-INITIATION");

    expect(() =>
      assertV1JAdapterDifferentialPreflight({
        env: {
          [V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG]: "1",
          [V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG]: head,
        },
        head,
        trackedTreeClean: true,
        activeFilteringEnabled: false,
        modelId: "qwen/qwen3.5-9b",
        provider: "lmstudio",
        contextLength: 262_144,
        modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
        protocolSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
        detachedProtocolSha256:
          "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172  preregistration-v2.json",
        schema,
        provenanceAccepted: true,
        artifactExists: false,
      }),
    ).toThrow(/exact commit-bound authorization flags/);
  });

  it("requires exact commit-bound, protocol, model, schema, and filtering gates", () => {
    const input = {
      env: {
        [V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG]: "1",
        [V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG]: "1",
        [V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG]: head,
      },
      head,
      trackedTreeClean: true,
      activeFilteringEnabled: false,
      modelId: "qwen/qwen3.5-9b",
      provider: "lmstudio",
      contextLength: 262_144,
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      protocolSha256: "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172",
      detachedProtocolSha256:
        "72f0d7c2c98038a09b767216a7a78c668b29971b8797a80c4f30a9d9c8af4172  preregistration-v2.json",
      schema,
      provenanceAccepted: true,
      artifactExists: false,
    };
    expect(() => assertV1JAdapterDifferentialPreflight(input)).not.toThrow();
    expect(() =>
      assertV1JAdapterDifferentialPreflight({
        ...input,
        env: { ...input.env, OPENCLAW_V1J_LIVE_TEST: "1" },
      }),
    ).toThrow(/cannot share live modes/);
    expect(() =>
      assertV1JAdapterDifferentialPreflight({ ...input, activeFilteringEnabled: true }),
    ).toThrow(/filtering/);
    expect(() =>
      assertV1JAdapterDifferentialPreflight({
        ...input,
        schema: { ...schema, providerToolCount: 14 },
      }),
    ).toThrow(/schema fingerprints drifted/);
  });

  it("summarizes request shape without retaining prompt or tool-schema content", () => {
    const summary = summarizeV1JAdapterDifferentialRequest(requestBody);
    expect(summary).toMatchObject({
      messageCount: 1,
      toolCount: 15,
      totalMessageContentBytes: Buffer.byteLength("safe fixture prompt"),
      messages: [
        {
          index: 0,
          role: "user",
          contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          contentBytes: Buffer.byteLength("safe fixture prompt"),
        },
      ],
      providerOptions: expect.arrayContaining([
        {
          name: "model",
          valueType: "string",
          valueSha256: expect.any(String),
          safeValue: requestBody.model,
        },
        {
          name: "max_tokens",
          valueType: "number",
          valueSha256: expect.any(String),
          safeValue: 128,
        },
        { name: "stream", valueType: "boolean", valueSha256: expect.any(String), safeValue: true },
      ]),
    });
    expect(JSON.stringify(summary)).not.toContain("safe fixture prompt");
    expect(JSON.stringify(summary)).not.toContain("tool_0");
    expect(JSON.stringify(summary)).not.toContain("response-body-secret");
    expect(summary.requestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.messagesCanonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.toolsCanonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts canonical key-order parity while reporting wire-byte hashes separately", () => {
    const reorderedKeys = {
      stream: true,
      max_tokens: requestBody.max_tokens,
      tools: requestBody.tools,
      messages: requestBody.messages,
      model: requestBody.model,
    };
    const comparison = assertV1JAdapterDifferentialRequestMatch(requestBody, reorderedKeys);
    expect(comparison.canonicalMatch).toBe(true);
    expect(comparison.requestMatch).toBe(false);
    expect(comparison.rawRequestSha256).not.toBe(comparison.adapterRequestSha256);
    expect(comparison.differingPaths).toEqual([]);
    expect(() =>
      assertV1JAdapterDifferentialRequestMatch(requestBody, {
        ...reorderedKeys,
        tools: [...requestBody.tools].toReversed(),
      }),
    ).toThrow(/request bodies differ/);
  });

  it("reports only structural field paths for message, schema, and option differences", () => {
    const changedMessage = {
      ...requestBody,
      messages: [{ role: "user", content: "different private prompt" }],
    };
    const changedToolSchema = structuredClone(requestBody);
    changedToolSchema.tools[0] = {
      function: {
        name: "tool_0",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    };
    const changedGenerationOption = { ...requestBody, temperature: 0.25 };

    expect(
      compareV1JAdapterDifferentialRequests(requestBody, changedMessage).differingPaths,
    ).toEqual(["messages.0.content"]);
    expect(
      compareV1JAdapterDifferentialRequests(requestBody, changedToolSchema).differingPaths,
    ).toEqual(["tools.0.function.parameters"]);
    expect(
      compareV1JAdapterDifferentialRequests(requestBody, changedGenerationOption).differingPaths,
    ).toEqual(["temperature"]);
  });

  it("does not mistake a three-message follow-up candidate for the initial request", () => {
    const followup = {
      ...requestBody,
      messages: [
        ...requestBody.messages,
        { role: "assistant", content: "private response text" },
        { role: "user", content: "private follow-up text" },
      ],
    };
    const comparison = compareV1JAdapterDifferentialRequests(requestBody, followup);
    expect(summarizeV1JAdapterDifferentialRequest(followup).messageCount).toBe(3);
    expect(comparison.canonicalMatch).toBe(false);
    expect(comparison.differingPaths).toEqual(["messages.1", "messages.2"]);
    expect(JSON.stringify(comparison)).not.toContain("private");
  });

  it("keeps raw-plus-adapter dispatches within one raw and two adapter requests", () => {
    expect(V1J_ADAPTER_DIFFERENTIAL_MAX_RAW_REQUESTS).toBe(1);
    expect(V1J_ADAPTER_DIFFERENTIAL_MAX_ADAPTER_REQUESTS).toBe(2);
    expect(V1J_ADAPTER_DIFFERENTIAL_MAX_TOTAL_REQUESTS).toBe(3);
    expect(() =>
      assertV1JAdapterDifferentialRequestBudget({ rawRequests: 1, adapterRequests: 2 }),
    ).not.toThrow();
    for (const budget of [
      { rawRequests: 2, adapterRequests: 0 },
      { rawRequests: 1, adapterRequests: 3 },
      { rawRequests: 0, adapterRequests: 4 },
    ]) {
      expect(() => assertV1JAdapterDifferentialRequestBudget(budget)).toThrow(/request budget/);
    }
  });

  it("emits content-free progress heartbeats and clears them when a stage completes", async () => {
    const events: Array<{ event: string; stage: string; elapsedMs: number }> = [];
    let tick: (() => void) | undefined;
    let elapsedMs = 0;
    const pending = Promise.withResolvers<string>();
    const stage = withV1JAdapterDifferentialProgress({
      stage: "schema-preflight",
      operation: async (checkpoint) => {
        checkpoint("prepared-runtime-acquisition-entered");
        return await pending.promise;
      },
      heartbeatMs: 25_000,
      now: () => elapsedMs,
      setInterval: (callback) => {
        tick = callback;
        return { unref: vi.fn() } as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: vi.fn(),
      onProgress: (event) => events.push(event),
    });

    elapsedMs = 25_000;
    tick?.();
    pending.resolve("schema-ready");
    await expect(stage).resolves.toBe("schema-ready");

    expect(events.map(({ event, stage: name }) => [event, name])).toEqual([
      ["stage-start", "schema-preflight"],
      ["checkpoint", "prepared-runtime-acquisition-entered"],
      ["heartbeat", "prepared-runtime-acquisition-entered"],
      ["stage-complete", "schema-preflight"],
    ]);
    expect(events.map((event) => event.elapsedMs)).toEqual([0, 0, 25_000, 25_000]);

    const output: string[] = [];
    reportV1JAdapterDifferentialProgress(
      { event: "heartbeat", stage: "schema-preflight", elapsedMs: 25_000 },
      (line) => output.push(line),
    );
    expect(output.join("")).not.toMatch(/prompt|message|response|credential|secret/i);
    expect(() =>
      reportV1JAdapterDifferentialProgress(
        { event: "heartbeat", stage: "schema preflight", elapsedMs: 25_000 },
        (line) => output.push(line),
      ),
    ).toThrow(/stage is invalid/);
  });

  it("preserves stage failures and always stops its heartbeat", async () => {
    const events: Array<{ event: string; stage: string; elapsedMs: number }> = [];
    const failure = new Error("expected diagnostic failure");
    const clearInterval = vi.fn();
    const tick = vi.fn();
    const stage = withV1JAdapterDifferentialProgress({
      stage: "lmstudio-discovery",
      operation: (checkpoint) => {
        checkpoint("lmstudio-discovery-request");
        throw failure;
      },
      setInterval: () =>
        ({ unref: vi.fn(), tick }) as unknown as ReturnType<typeof globalThis.setInterval>,
      clearInterval,
      onProgress: (event) => events.push(event),
    });

    await expect(stage).rejects.toBe(failure);
    expect(events.at(-1)).toMatchObject({
      event: "stage-failed",
      stage: "lmstudio-discovery-request",
    });
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(tick).not.toHaveBeenCalled();
  });

  it("guards adapter tool execution before the tool body runs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-diff-tool-guard-"));
    fs.writeFileSync(path.join(root, "smoke-reference.txt"), "smoke-token-47\n", {
      encoding: "utf8",
      flag: "wx",
    });
    const guard = installV1JAdapterDifferentialToolGuard({ workspaceRoot: root });
    const config = {} as OpenClawConfig;
    const generationRegistry = createEmptyPluginRegistry();
    const metadataSnapshot = createPluginMetadataSnapshot({
      config,
      manifestRegistry: makeRegistry([]),
      workspaceDir: root,
    });
    const callTool = async (name: string, params: Record<string, unknown>) => {
      const execute = vi.fn(async () => ({ content: [], details: { executed: true } }));
      const tool = wrapToolWithBeforeToolCallHook({
        name,
        parameters: {},
        execute,
      } as unknown as AnyAgentTool);
      await tool.execute(
        `call-${name}`,
        params,
        undefined,
        {} as Parameters<typeof tool.execute>[3],
      );
      return execute;
    };
    try {
      await withPluginRuntimeGenerationScope(
        { config, metadataSnapshot, pluginRegistry: generationRegistry },
        async () => {
          guard.ensureInstalled();
          const read = await callTool("read", { path: "smoke-reference.txt" });
          expect(read).toHaveBeenCalledOnce();
          expect(
            generationRegistry.typedHooks.some(
              (hook) => hook.registrationId === "v1j-adapter-differential-guard",
            ),
          ).toBe(true);
        },
      );
      expect(guard.readDispatches()).toBe(1);
      guard.restore();
    } finally {
      guard.restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks out-of-workspace reads and every other tool before execution", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-diff-tool-block-"));
    fs.writeFileSync(path.join(root, "smoke-reference.txt"), "smoke-token-47\n", {
      encoding: "utf8",
      flag: "wx",
    });
    const guard = installV1JAdapterDifferentialToolGuard({ workspaceRoot: root });
    const callTool = async (name: string, params: Record<string, unknown>) => {
      const execute = vi.fn(async () => ({ content: [], details: { executed: true } }));
      const tool = wrapToolWithBeforeToolCallHook({
        name,
        parameters: {},
        execute,
      } as unknown as AnyAgentTool);
      await tool.execute(
        `call-${name}`,
        params,
        undefined,
        {} as Parameters<typeof tool.execute>[3],
      );
      return execute;
    };
    try {
      for (const blockedCall of [
        { name: "read", params: { path: "../artifacts/formal.jsonl" } },
        { name: "read", params: { path: path.resolve(root, "../smoke-result.json") } },
        {
          name: "read",
          params: {
            path: path.resolve(root, "../../real-exact-run1/observations.jsonl"),
          },
        },
        {
          name: "read",
          params: { path: path.resolve(root, "../../smoke-befc9628/smoke-result.json") },
        },
        { name: "write", params: { path: "smoke-reference.txt", content: "changed" } },
        { name: "edit", params: { path: "smoke-reference.txt" } },
        { name: "exec", params: { command: "whoami" } },
        { name: "apply_patch", params: { patch: "not permitted" } },
        { name: "process", params: { action: "list" } },
        { name: "sessions_list", params: {} },
        { name: "sessions_spawn", params: {} },
        { name: "memory_get", params: {} },
        { name: "memory_search", params: {} },
        { name: "web_fetch", params: { url: "https://example.com" } },
        { name: "web_search", params: { query: "not permitted" } },
        { name: "message", params: { text: "not permitted" } },
      ]) {
        const execute = await callTool(blockedCall.name, blockedCall.params);
        expect(execute).not.toHaveBeenCalled();
      }
      expect(guard.blockedToolCalls()).toBe(16);
      expect(guard.readDispatches()).toBe(0);
    } finally {
      guard.restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs one raw streaming request without any tool-execution path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-diff-raw-"));
    const journal = createV1JAdapterDifferentialJournal({
      repoRoot: root,
      harnessCommit: head,
      modelId: "qwen/qwen3.5-9b",
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      schemaFingerprint: schema,
      startedAt: new Date().toISOString(),
    });
    let calls = 0;
    try {
      const result = await runV1JAdapterDifferentialRawTransport({
        endpoint: "http://127.0.0.1:1234/v1/chat/completions",
        authorization: "Bearer test-only",
        requestBody,
        journal,
        fetchImpl: async (_request, init) => {
          calls += 1;
          expect(init?.method).toBe("POST");
          return new Response(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-raw-only","function":{"name":"exec","arguments":"{}"}}]}}]}\n\n',
            {
              headers: { "content-type": "text/event-stream" },
            },
          );
        },
        timeoutMs: 1_000,
        heartbeatMs: 1_000,
      });
      expect(calls).toBe(1);
      expect(result).toMatchObject({
        mode: "C",
        stream: true,
        toolCount: 15,
        requestDispatchStarted: true,
        requestDispatchCompleted: true,
        httpStatus: 200,
        streamEnd: true,
      });
      const events = fs.readFileSync(journal.filePath, "utf8");
      expect(events).toContain("raw-response-first-byte");
      expect(events).toContain("raw-control-complete");
      expect(events).not.toContain("adapter-tool-execution-guard");
      expect(events).not.toContain("safe fixture prompt");
      expect(events).not.toContain("tool_0");
      expect(events).not.toContain("call-raw-only");
      recordV1JAdapterDifferentialRequestFingerprint({
        journal,
        event: "adapter-initial-request-candidate",
        body: requestBody,
        requestIndex: 1,
        dispatched: false,
      });
      recordV1JAdapterDifferentialRequestFingerprint({
        journal,
        event: "adapter-followup-request-candidate",
        body: {
          ...requestBody,
          messages: [
            ...requestBody.messages,
            { role: "assistant", content: "response-secret" },
            { role: "user", content: "followup-secret" },
          ],
        },
        requestIndex: 2,
        dispatched: false,
      });
      const fingerprintEvents = fs.readFileSync(journal.filePath, "utf8");
      expect(fingerprintEvents).toContain('"event":"adapter-initial-request-candidate"');
      expect(fingerprintEvents).toContain('"event":"adapter-followup-request-candidate"');
      expect(fingerprintEvents).toContain('"messageCount":3');
      expect(fingerprintEvents).toContain('"dispatched":false');
      expect(fingerprintEvents).not.toContain("safe fixture prompt");
      expect(fingerprintEvents).not.toContain("response-secret");
      expect(fingerprintEvents).not.toContain("followup-secret");
    } finally {
      journal.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes only under its commit-bound isolated root and filters payload fields", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1j-adapter-diff-journal-"));
    const journal = createV1JAdapterDifferentialJournal({
      repoRoot: root,
      harnessCommit: head,
      modelId: "qwen/qwen3.5-9b",
      modelConfigHash: "2a219399da63b03057ceaf46a9dd1d74e76be20ead626f07af2b8ba45f37c529",
      schemaFingerprint: schema,
      startedAt: new Date().toISOString(),
    });
    try {
      expect(journal.root).toBe(
        path.resolve(
          root,
          V1J_ADAPTER_DIFFERENTIAL_PARENT,
          `${V1J_ADAPTER_DIFFERENTIAL_PREFIX}${head}`,
        ),
      );
      journal.record("adapter-parse-complete", {
        outcome: "parsed",
        toolCallCount: 1,
        prompt: "must not persist",
      });
      const manifest = fs.readFileSync(path.join(journal.root, "manifest.json"), "utf8");
      const event = fs.readFileSync(journal.filePath, "utf8");
      expect(manifest).toContain('"requestBodiesPersisted": false');
      expect(event).toContain('"toolCallCount":1');
      expect(event).not.toContain("must not persist");
      expect(
        fs.existsSync(path.join(root, V1J_ADAPTER_DIFFERENTIAL_PARENT, "real-exact-run1")),
      ).toBe(false);
    } finally {
      journal.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
