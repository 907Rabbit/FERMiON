import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertV1JAdapterDifferentialRequestMatch,
  assertV1JAdapterDifferentialPreflight,
  createV1JAdapterDifferentialJournal,
  runV1JAdapterDifferentialRawTransport,
  summarizeV1JAdapterDifferentialRequest,
  V1J_ADAPTER_DIFFERENTIAL_AUTHORIZED_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_COMMIT_FLAG,
  V1J_ADAPTER_DIFFERENTIAL_PARENT,
  V1J_ADAPTER_DIFFERENTIAL_PREFIX,
  V1J_ADAPTER_DIFFERENTIAL_RUN_FLAG,
} from "../../../test/helpers/agents/model-choice-adapter-differential.js";

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
  stream: true,
};

describe("v1J adapter differential diagnostics", () => {
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
    });
    expect(JSON.stringify(summary)).not.toContain("safe fixture prompt");
    expect(JSON.stringify(summary)).not.toContain("tool_0");
  });

  it("compares canonical request identity while preserving array order", () => {
    const reorderedKeys = {
      stream: true,
      tools: requestBody.tools,
      messages: requestBody.messages,
      model: requestBody.model,
    };
    expect(
      assertV1JAdapterDifferentialRequestMatch(requestBody, reorderedKeys).rawRequestSha256,
    ).toBe(
      assertV1JAdapterDifferentialRequestMatch(requestBody, reorderedKeys).adapterRequestSha256,
    );
    expect(() =>
      assertV1JAdapterDifferentialRequestMatch(requestBody, {
        ...reorderedKeys,
        tools: [...requestBody.tools].toReversed(),
      }),
    ).toThrow(/request bodies differ/);
  });

  it("runs one raw streaming request and records only response progress", async () => {
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
          return new Response('data: {"choices":[]}\n\n', {
            headers: { "content-type": "text/event-stream" },
          });
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
      expect(events).not.toContain("safe fixture prompt");
      expect(events).not.toContain("tool_0");
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
