import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertV1JFormalStateEmpty,
  assertV1JSmokeProvenance,
  buildV1JSmokeSchedule,
  resolveV1JSmokeRoot,
  V1J_SMOKE_PROVENANCE_PATH,
  type V1JSmokeCell,
} from "./model-choice-action-initiation-smoke.js";
import {
  assertV1JRuntimeGate,
  V1J_PREREGISTRATION_PATH,
  v1jInstructionForArm,
  type V1JCapturedSchemaSurface,
  type V1JProtocol,
} from "./model-choice-action-initiation.js";
import {
  assertV1JPayloadDecompositionPreflight,
  buildV1JPayloadDecompositionRequests,
  createV1JPayloadDecompositionJournal,
  runV1JPayloadDecompositionControls,
  V1J_PAYLOAD_DECOMPOSITION_PARENT,
  V1J_PAYLOAD_DECOMPOSITION_PREFIX,
} from "./model-choice-provider-payload-decomposition.js";

export async function runV1JPayloadDecompositionDiagnostic(input: {
  repoRoot: string;
  env: Record<string, string | undefined>;
  protocol: V1JProtocol;
  head: string;
  trackedTreeClean: boolean;
  modelId: string;
  modelConfigHash: string;
  provider: string;
  contextLength: number;
  activeFilteringEnabled: boolean;
  endpoint: string;
  authorization: string;
  captureArmARequest: (input: {
    protocol: V1JProtocol;
    head: string;
    smokeCell: V1JSmokeCell;
  }) => Promise<{
    bodies: readonly Record<string, unknown>[];
    surface: V1JCapturedSchemaSurface;
    smokePrompt: string;
  }>;
  fetchImpl: Parameters<typeof runV1JPayloadDecompositionControls>[0]["fetchImpl"];
}): Promise<void> {
  const { repoRoot, head, protocol } = input;
  const formalRoot = path.resolve(repoRoot, V1J_PAYLOAD_DECOMPOSITION_PARENT, "real-exact-run1");
  const smokeRoot = resolveV1JSmokeRoot(repoRoot, head);
  const artifactRoot = path.resolve(
    repoRoot,
    V1J_PAYLOAD_DECOMPOSITION_PARENT,
    `${V1J_PAYLOAD_DECOMPOSITION_PREFIX}${head}`,
  );
  assertV1JFormalStateEmpty(repoRoot);
  if (fs.existsSync(smokeRoot)) {
    throw new Error("v1J payload decomposition refuses the normal smoke artifact path");
  }

  const protocolPath = path.resolve(repoRoot, V1J_PREREGISTRATION_PATH);
  const protocolBytes = fs.readFileSync(protocolPath);
  const detachedHash = fs.readFileSync(protocolPath.replace(/\.json$/u, ".sha256"), "utf8");
  const protocolHash = createHash("sha256").update(protocolBytes).digest("hex");
  const amendment = JSON.parse(
    fs.readFileSync(path.resolve(repoRoot, V1J_SMOKE_PROVENANCE_PATH), "utf8"),
  ) as unknown;
  assertV1JSmokeProvenance(amendment, protocol, head);
  assertV1JPayloadDecompositionPreflight({
    env: input.env,
    head,
    trackedTreeClean: input.trackedTreeClean,
    activeFilteringEnabled: input.activeFilteringEnabled,
    modelId: input.modelId,
    modelConfigHash: input.modelConfigHash,
    protocolHash,
    detachedProtocolHash: detachedHash,
    provenanceAccepted: true,
    artifactExists: fs.existsSync(artifactRoot),
  });
  if (
    input.provider !== protocol.model.provider ||
    input.contextLength !== protocol.model.contextLength ||
    input.modelId !== protocol.model.id
  ) {
    throw new Error("v1J payload decomposition provider/model/context identity drifted");
  }
  const smokeCell = buildV1JSmokeSchedule(protocol).find(
    (cell) => cell.cellId === "smoke-tool-required:A:1",
  );
  if (!smokeCell) {
    throw new Error("frozen v1J smoke tool-required Arm A cell is unavailable");
  }

  const captured = await input.captureArmARequest({
    protocol: input.protocol,
    head: input.head,
    smokeCell,
  });
  if (
    captured.bodies.length < 1 ||
    captured.bodies.some((body) => JSON.stringify(body) !== JSON.stringify(captured.bodies[0]))
  ) {
    throw new Error("Arm A smoke request capture was absent or non-equivalent");
  }
  const capturedBody = captured.bodies[0]!;
  const messages = Array.isArray(capturedBody.messages) ? capturedBody.messages : [];
  const userPromptPresent = messages.some(
    (message) =>
      Boolean(message) &&
      typeof message === "object" &&
      (message as { role?: unknown }).role === "user" &&
      typeof (message as { content?: unknown }).content === "string" &&
      (message as { content: string }).content.includes(captured.smokePrompt),
  );
  if (
    capturedBody.model !== protocol.model.id ||
    !userPromptPresent ||
    systemMessageText(capturedBody).includes(v1jInstructionForArm(protocol, "C"))
  ) {
    throw new Error("captured request is not the exact full Arm-A smoke prompt shape");
  }
  const requests = buildV1JPayloadDecompositionRequests({ capturedArmARequest: capturedBody });
  assertV1JRuntimeGate(protocol, {
    modelId: input.modelId,
    provider: input.provider,
    contextLength: input.contextLength,
    modelConfigHash: input.modelConfigHash,
    rankerVersion: protocol.base.productionFrozen.rankerVersion,
    topK: protocol.base.productionFrozen.topK,
    activeFilteringEnabled: input.activeFilteringEnabled,
    surface: captured.surface,
  });

  const journal = createV1JPayloadDecompositionJournal({
    repoRoot,
    harnessCommit: head,
    modelId: input.modelId,
    modelConfigHash: input.modelConfigHash,
    provider: input.provider,
    contextLength: input.contextLength,
    schemaFingerprint: captured.surface,
    startedAt: new Date().toISOString(),
  });
  let dispatches = 0;
  try {
    const results = await runV1JPayloadDecompositionControls({
      endpoint: input.endpoint,
      authorization: input.authorization,
      requests,
      fetchImpl: (request, init) => {
        dispatches += 1;
        if (dispatches > 3) {
          throw new Error("v1J payload decomposition dispatch limit exceeded");
        }
        return input.fetchImpl(request, init);
      },
      record: journal.record,
      heartbeat: (event) => {
        process.stdout.write(
          `v1J payload control awaiting stream control=${event.control} elapsedMs=${event.elapsedMs} chunks=${event.chunkCount} bytes=${event.byteCount}\n`,
        );
      },
    });
    if (dispatches !== 3 || results.length !== 3) {
      throw new Error("v1J payload decomposition did not execute exactly three controls");
    }
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } finally {
    journal.close();
  }
  assertV1JFormalStateEmpty(repoRoot);
  if (fs.existsSync(smokeRoot) || fs.existsSync(formalRoot)) {
    throw new Error("v1J payload decomposition touched formal or normal smoke state");
  }
}

function systemMessageText(body: Record<string, unknown>): string {
  if (!Array.isArray(body.messages)) {
    return "";
  }
  return body.messages
    .filter(
      (message): message is { role: string; content: unknown } =>
        Boolean(message) && typeof message === "object" && "role" in message,
    )
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content as string)
    .join("\n");
}
