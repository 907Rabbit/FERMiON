import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertV1JProviderControlPreflight,
  createV1JProviderControlJournal,
  runV1JProviderTransportControls,
  V1J_PROVIDER_CONTROL_ARTIFACT_ROOT,
  V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG,
  V1J_PROVIDER_CONTROL_COMMIT_FLAG,
  V1J_PROVIDER_CONTROL_MAX_TOKENS,
  V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
  V1J_PROVIDER_CONTROL_RUN_FLAG,
  V1J_PROVIDER_CONTROL_TIMEOUT_MS,
} from "../../../test/helpers/agents/model-choice-provider-isolation.js";
import { hashV1ICanonical } from "./model-choice-experiment-evidence.js";
import {
  V1I_HARNESS_CONTROL_AMENDMENT_TYPE,
  isV1IProvenanceAmendment,
} from "./model-choice-experiment-provenance.js";
import {
  CONTEXT_LENGTH,
  LM_STUDIO_BASE_URL,
  MODEL_ID,
  PROVIDER,
  modelConfigIdentity,
} from "./model-choice-experiment-support.js";
import { ACTIVE_FILTERING_ENABLED } from "./shadow-traffic.js";

const repoRoot = process.cwd();
const preregistrationDirectory = path.join(
  repoRoot,
  "artifacts/capability-intelligence/v1j-action-initiation",
);
const v2Path = path.join(preregistrationDirectory, "preregistration-v2.json");
const v2HashPath = path.join(preregistrationDirectory, "preregistration-v2.sha256");
const provenancePath = path.join(preregistrationDirectory, "provenance-amendment.json");
const enabled = process.env[V1J_PROVIDER_CONTROL_RUN_FLAG] === "1";
const anyGate = [
  V1J_PROVIDER_CONTROL_RUN_FLAG,
  V1J_PROVIDER_CONTROL_AUTHORIZED_FLAG,
  V1J_PROVIDER_CONTROL_COMMIT_FLAG,
].some((name) => process.env[name] !== undefined);

if (anyGate && !enabled) {
  throw new Error("LM Studio provider controls require the dedicated run flag");
}

function readTrackedTreeClean(): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["diff", "--cached", "--quiet", "HEAD", "--"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function currentHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function validateLivePreflight(head: string, artifactPath: string): void {
  const preregistrationBytes = fs.readFileSync(v2Path);
  const detachedHash = fs.readFileSync(v2HashPath, "utf8");
  const amendment = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as {
    amendmentType?: unknown;
    baseHarnessCommit?: unknown;
  };
  const provenanceAccepted =
    amendment.amendmentType === V1I_HARNESS_CONTROL_AMENDMENT_TYPE &&
    typeof amendment.baseHarnessCommit === "string" &&
    isV1IProvenanceAmendment(amendment, amendment.baseHarnessCommit, head);
  assertV1JProviderControlPreflight({
    env: process.env,
    head,
    trackedTreeClean: readTrackedTreeClean(),
    activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
    modelId: MODEL_ID,
    modelConfigHash: hashV1ICanonical(modelConfigIdentity()),
    preregistrationHash: sha256V1JProviderControl(preregistrationBytes),
    detachedPreregistrationHash: detachedHash,
    schemaBaseline: (
      JSON.parse(Buffer.from(preregistrationBytes).toString("utf8")) as {
        schemaBaseline?: Record<string, unknown>;
      }
    ).schemaBaseline,
    provenanceAccepted,
    artifactExists: fs.existsSync(artifactPath),
  });
  if (PROVIDER !== "lmstudio" || CONTEXT_LENGTH !== 262_144) {
    throw new Error("LM Studio provider/context identity changed for transport controls");
  }
}

function sha256V1JProviderControl(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(!enabled)("v1J LM Studio transport controls (non-scientific)", () => {
  it("sends exactly one minimal no-tool request for each streaming mode", async () => {
    const head = currentHead();
    const artifactRelativePath = `${V1J_PROVIDER_CONTROL_ARTIFACT_ROOT}-${head}`;
    const artifactAbsolutePath = path.resolve(repoRoot, artifactRelativePath);
    validateLivePreflight(head, artifactAbsolutePath);
    const manifest = {
      artifactKind: "v1J-lmstudio-transport-controls",
      harnessCommit: head,
      modelId: MODEL_ID,
      configuredModelConfigHash: hashV1ICanonical(modelConfigIdentity()),
      provider: PROVIDER,
      contextLength: CONTEXT_LENGTH,
      preregistrationSha256: V1J_PROVIDER_CONTROL_PREREGISTRATION_SHA256,
      schemaBaseline: V1J_PROVIDER_CONTROL_SCHEMA_BASELINE,
      activeFilteringEnabled: false,
      controls: ["stream-false", "stream-true"],
      requestSettings: {
        maxTokens: V1J_PROVIDER_CONTROL_MAX_TOKENS,
        messageCount: 1,
        toolCount: 0,
        toolSchemaJsonBytes: 0,
      },
      requestPromptPersisted: false,
      responseContentPersisted: false,
      credentialsPersisted: false,
      formalExperimentStateAccessed: false,
      startedAt: new Date().toISOString(),
    };
    const journal = createV1JProviderControlJournal({
      repoRoot,
      artifactRoot: artifactRelativePath,
      manifest,
    });
    const token = process.env.LM_API_TOKEN ?? "lmstudio";
    let dispatches = 0;
    const results = await runV1JProviderTransportControls({
      endpoint: `${LM_STUDIO_BASE_URL}/chat/completions`,
      model: MODEL_ID,
      authorization: `Bearer ${token}`,
      fetchImpl: (request, init) => {
        dispatches += 1;
        if (dispatches > 2) {
          throw new Error("provider-control dispatch limit exceeded");
        }
        return fetch(request, init);
      },
      record: journal.record,
      heartbeat: (event) => {
        process.stdout.write(
          `LM Studio control awaiting body mode=${event.mode} elapsedMs=${event.elapsedMs} chunks=${event.chunkCount} bytes=${event.byteCount}\n`,
        );
      },
    });
    expect(dispatches).toBe(2);
    expect(results.map((result) => result.mode)).toEqual(["stream-false", "stream-true"]);
    expect(results.every((result) => result.toolCount === 0)).toBe(true);
    expect(results.every((result) => result.requestDispatchStarted)).toBe(true);
    expect(
      results.every((result) => result.elapsedMs <= V1J_PROVIDER_CONTROL_TIMEOUT_MS + 1_000),
    ).toBe(true);
    process.stdout.write(
      `${JSON.stringify(
        results.map(
          ({
            mode,
            requestJsonBytes,
            messageCount,
            totalMessageContentBytes,
            toolCount,
            toolSchemaJsonBytes,
            httpStatus,
            contentType,
            responseFirstByteMs,
            responseChunkCount,
            responseByteCount,
            lastChunkMs,
            streamEnd,
            streamError,
            streamCancel,
            timedOut,
            errorName,
          }) => ({
            mode,
            requestJsonBytes,
            messageCount,
            totalMessageContentBytes,
            toolCount,
            toolSchemaJsonBytes,
            httpStatus,
            contentType,
            responseFirstByteMs,
            responseChunkCount,
            responseByteCount,
            lastChunkMs,
            streamEnd,
            streamError,
            streamCancel,
            timedOut,
            errorName,
          }),
        ),
      )}\n`,
    );
  }, 300_000);
});
