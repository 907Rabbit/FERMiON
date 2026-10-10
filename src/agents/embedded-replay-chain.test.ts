import fs from "node:fs";
// One mock-model turn through the real embedded loop into the v1D qualifier.
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const PROMPT = "Read note.txt from the workspace and stop.";
const HIDDEN_TOOL = "some_unrelated_tool";
const NOTE_TEXT = "qualification-note";

const scriptedState = vi.hoisted(() => ({
  requests: [] as Array<{ toolNames: string[]; material: string }>,
  readCallSent: false,
}));

function toolNamesFromRequest(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !("tools" in parsed)) {
    return [];
  }
  const tools = parsed.tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  const names: string[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") {
      continue;
    }
    if ("name" in tool && typeof tool.name === "string") {
      names.push(tool.name);
      continue;
    }
    if (
      "function" in tool &&
      tool.function &&
      typeof tool.function === "object" &&
      "name" in tool.function &&
      typeof tool.function.name === "string"
    ) {
      names.push(tool.function.name);
    }
  }
  return names;
}

function sseBody(events: readonly Record<string, unknown>[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

function completedEvents(
  id: string,
  output: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const response = {
    id,
    object: "response",
    status: "completed",
    model: "mock-replay",
    output,
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
  };
  return [
    {
      type: "response.created",
      response: { ...response, output: [], status: "in_progress" },
    },
    { type: "response.completed", response },
  ];
}

function scriptedModelBody(body: string): string {
  const toolNames = toolNamesFromRequest(body);
  scriptedState.requests.push({ toolNames, material: body });
  const sendRead = toolNames.includes("read") && !scriptedState.readCallSent;
  if (sendRead) {
    scriptedState.readCallSent = true;
    return sseBody(
      completedEvents("resp_read", [
        {
          type: "function_call",
          id: "fc_read",
          call_id: "call_read",
          name: "read",
          arguments: JSON.stringify({ path: "note.txt" }),
          status: "completed",
        },
      ]),
    );
  }
  return sseBody(
    completedEvents("resp_done", [
      {
        id: "msg_done",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "done", annotations: [] }],
      },
    ]),
  );
}

function listenOnLoopback(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("scripted model did not bind a port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

vi.mock("./prepared-model-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("./prepared-model-runtime.js")>(
    "./prepared-model-runtime.js",
  );
  const { AuthStorage } = await import("./sessions/auth-storage.js");
  const { ModelRegistry } = await import("./sessions/model-registry.js");
  const { buildInlineProviderModels } =
    await import("./embedded-agent-runner/model.inline-provider.js");
  const { createEmptyPluginRegistry } = await import("../plugins/registry-empty.js");
  const { createEmptyPluginMetadataSnapshot } =
    await import("./test-helpers/embedded-agent-runner-e2e-mocks.js");
  const acquire = async (input: {
    agentId?: string;
    agentDir: string;
    inheritedAuthDir?: string;
    workspaceDir?: string;
    allowGatewaySubagentBinding?: boolean;
    config: {
      models?: { providers?: Parameters<typeof buildInlineProviderModels>[0] };
    };
  }) => {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("openai", "sk-test");
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const providers = input.config.models?.providers ?? {};
    return {
      snapshot: {
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        agentDir: input.agentDir,
        ...(input.inheritedAuthDir !== undefined
          ? { inheritedAuthDir: input.inheritedAuthDir }
          : {}),
        ...(input.workspaceDir !== undefined ? { workspaceDir: input.workspaceDir } : {}),
        activeProjectKeys: [],
        config: input.config,
        authModes: {},
        metadataSnapshot: createEmptyPluginMetadataSnapshot(input.workspaceDir),
        pluginRegistry: createEmptyPluginRegistry(),
        allowGatewaySubagentBinding: input.allowGatewaySubagentBinding === true,
        modelCatalog: { entries: [], routeVariants: [] },
        configuredRuntimeModels: [],
        inlineProviderModels: buildInlineProviderModels(providers),
        createStores: () => ({ authStorage, modelRegistry }),
      },
      release: () => {},
    };
  };
  return {
    ...actual,
    acquireAgentRunPreparedModelRuntime: acquire,
    acquireReadOnlyPreparedModelRuntime: acquire,
  } as typeof actual;
});

describe("embedded replay chain", () => {
  afterEach(() => {
    scriptedState.requests.length = 0;
    scriptedState.readCallSent = false;
    vi.unstubAllEnvs();
  });

  it("carries one mock-model turn from runEmbeddedAgent into the qualifier", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-replay-chain-"));
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(scriptedModelBody(body));
      });
    });
    const baseUrl = await listenOnLoopback(server);
    const workspaceDir = path.join(tempRoot, "workspace");
    const agentDir = path.join(tempRoot, "agent");
    const configPath = path.join(tempRoot, "openclaw.json");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "note.txt"), NOTE_TEXT, "utf8");
    fs.writeFileSync(configPath, "{}\n", "utf8");
    vi.stubEnv("OPENCLAW_STATE_DIR", tempRoot);
    vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);

    const { createEmbeddedReplayRuntime } =
      await import("./capability-intelligence/embedded-replay-runtime.js");
    const { createShadowEvidenceBatch, runScheduledReplay, shadowEvidenceEvents } =
      await import("./capability-intelligence/shadow-evidence-collector.js");
    const { renderShadowQualificationReport } =
      await import("./capability-intelligence/shadow-qualification-report.js");
    const { ACTIVE_FILTERING_ENABLED } =
      await import("./capability-intelligence/shadow-traffic.js");
    const { qualifyShadowTraffic } =
      await import("./capability-intelligence/shadow-qualification.js");

    const config = {
      agents: {
        defaults: {
          model: { primary: "openai/mock-replay" },
          workspace: workspaceDir,
        },
        list: [{ id: "main", default: true, agentDir }],
      },
      session: { store: path.join(tempRoot, "sessions.json") },
      models: {
        providers: {
          openai: {
            api: "openai-responses" as const,
            apiKey: "sk-test",
            baseUrl,
            models: [
              {
                id: "mock-replay",
                name: "Mock replay",
                reasoning: false,
                input: ["text" as const],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 16_000,
                maxTokens: 2048,
              },
            ],
          },
        },
      },
    };
    const runtime = createEmbeddedReplayRuntime({
      workspaceDir,
      timeoutMs: 60_000,
      provider: "openai",
      model: "mock-replay",
      config,
      conversationToolPolicy: { deny: ["exec"] },
    });
    let failure = "";
    let collected: Awaited<ReturnType<typeof runScheduledReplay>> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      collected = await Promise.race([
        runScheduledReplay({
          cases: [
            {
              id: "read-note",
              prompt: PROMPT,
              domain: "filesystem",
              roleSource: "benchmark",
              requiredTools: ["read"],
              workflowContract: [HIDDEN_TOOL],
            },
          ],
          batch: createShadowEvidenceBatch("chain-batch"),
          runtime,
          toolsForCase: () => [
            { name: "read", description: "Read a file" },
            { name: "exec", description: "Run a command" },
          ],
          limit: 1,
        }),
        new Promise<never>((_resolve, reject) => {
          stallTimer = setTimeout(() => {
            reject(new Error("replay chain stalled"));
          }, 150_000);
          stallTimer.unref?.();
        }),
      ]);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      if (stallTimer) {
        clearTimeout(stallTimer);
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // The agent database can stay locked until this process exits.
      }
    }

    const material = scriptedState.requests.map((request) => request.material).join("\n");
    const toolNames = scriptedState.requests.flatMap((request) => request.toolNames);
    expect(failure, `${failure}\ntools=${toolNames.join(",")}\n${material.slice(0, 1500)}`).toBe(
      "",
    );
    expect(scriptedState.requests.length).toBeGreaterThan(0);
    expect(material).toContain(PROMPT);
    expect(material).toContain(NOTE_TEXT);
    expect(material).not.toContain(HIDDEN_TOOL);
    expect(material).not.toContain("requiredTools");
    expect(material).not.toContain("workflowContract");
    expect(material).not.toContain("roleSource");
    expect(material).not.toContain("expectedOutcome");
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");

    const batch = collected?.batch;
    if (!batch) {
      throw new Error("replay did not return a batch");
    }
    const events = shadowEvidenceEvents(batch);
    const readEvent = events.find((event) => event.selectedTool === "read");
    expect(readEvent).toMatchObject({
      executionStarted: true,
      success: true,
      role: "required",
      roleSource: "benchmark",
      schemaVersion: 1,
      rankerVersion: "v1C",
      qualificationPolicyVersion: "v1F-2",
      authorizationRegression: false,
    });
    const qualification = qualifyShadowTraffic({
      events,
      offlineRequiredRecallPassed: true,
      offlineNdcgPassed: true,
    });
    expect(qualification.executedCalls).toBeGreaterThan(0);
    expect(qualification.recognizedPolicy).toBe(true);
    expect(qualification.passed).toBe(false);
    expect(qualification.activeFilteringEnabled).toBe(false);
    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
    const report = renderShadowQualificationReport(qualification, events);
    expect(report.startsWith("QUALIFICATION: BLOCKED")).toBe(true);
    expect(report).toContain("INFO  active filtering = OFF");
  }, 210_000);
});
