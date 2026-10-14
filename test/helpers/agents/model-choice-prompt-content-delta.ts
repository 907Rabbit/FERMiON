import { createHash } from "node:crypto";

export type V1JPromptContentDelta = {
  classification:
    | "unchanged"
    | "line-ending-normalization"
    | "trailing-newline-change"
    | "trailing-whitespace-normalization"
    | "leading-whitespace-normalization"
    | "unicode-normalization"
    | "byte-content-change";
  beforeBytes: number;
  afterBytes: number;
  prefixCommonBytes: number;
  suffixCommonBytes: number;
  insertedByteCount: number;
  deletedByteCount: number;
  substitutedByteCount: number;
  firstDifferenceOffset: number | null;
  lastDifferenceOffset: number | null;
  beforeTailSha256: string;
  afterTailSha256: string;
  newlineCountBefore: number;
  newlineCountAfter: number;
  crCountBefore: number;
  crCountAfter: number;
  lfCountBefore: number;
  lfCountAfter: number;
  utf8CodepointCountBefore: number;
  utf8CodepointCountAfter: number;
};

export type V1JPromptMessageContent = {
  role: string | null;
  content: string | null;
};

export const V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER = [
  "prompt-context-built",
  "prompt-submit-enter",
  "prompt-history-normalized",
  "model-prompt-transform-enter",
  "model-prompt-transform-complete",
  "agent-llm-boundary-input",
  "agent-llm-boundary-normalized",
  "agent-llm-boundary-relocated",
  "agent-llm-boundary-converted",
  "provider-adapter-input",
  "provider-message-conversion-input",
  "provider-message-conversion-output",
  "provider-request-object-constructed",
  "provider-onPayload-transform-enter",
] as const;

export type V1JPromptMaterializationBoundary = {
  stage: (typeof V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER)[number];
  identity: {
    runOneAttemptId: string;
    embeddedRunId: string | null;
    sessionIdSha256: string | null;
    promptSubmissionIndex: number;
    modelLoopIterationIndex: number;
  };
  messages: readonly (V1JPromptMessageContent & { index: number })[];
};

export type V1JPromptMaterializationContentDelta = {
  sourceBoundary: string | null;
  destinationBoundary: string;
  role: string | null;
  ordinalWithinRole: number;
  beforeIndex: number | null;
  afterIndex: number | null;
  pairingStatus: "PAIRED" | "DELTA_PAIRING_UNAVAILABLE";
  pairingReason?: string;
  beforeContentSha256?: string;
  afterContentSha256?: string;
  delta?: V1JPromptContentDelta;
};

export type V1JPromptMaterializationDeltaSummary = {
  pairingStatus: "PAIRED" | "DELTA_PAIRING_UNAVAILABLE";
  sourceBoundary: string | null;
  destinationBoundary: string;
  transitionInstanceId?: string | number;
  pairingReason?: string;
  deltas: V1JPromptMaterializationContentDelta[];
};

export type V1JPromptMaterializationTransition = {
  transitionInstanceId: string | number;
  sourceBoundary: string;
  destinationBoundary: string;
  inputMessages?: readonly (V1JPromptMessageContent & { index: number })[];
  outputMessages?: readonly (V1JPromptMessageContent & { index: number })[];
};

export type V1JPromptSectionFingerprint = {
  sectionName: string;
  present: boolean;
  sha256: string | null;
  utf8Bytes: number | null;
};

type V1JNormalizationOperationTrace = {
  messageIndex: number;
  normalizerBranch: string;
  normalizerPath: string;
  wrapperOperations: {
    mediaFallbackInjected: boolean;
    inboundMetadataRemoved: boolean;
    timestampEnvelopePreserved: boolean;
    timestampPrefixAdded: boolean;
    suffixWrapperAdded: boolean;
  };
  replacementOrCloningPath: boolean;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function countByte(bytes: Uint8Array, target: number): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === target) {
      count += 1;
    }
  }
  return count;
}

function classify(before: string, after: string): V1JPromptContentDelta["classification"] {
  if (before === after) {
    return "unchanged";
  }
  if (before.replaceAll("\r\n", "\n") === after.replaceAll("\r\n", "\n")) {
    return "line-ending-normalization";
  }
  const withoutTrailingNewlines = (value: string) => value.replace(/[\r\n]+$/u, "");
  if (withoutTrailingNewlines(before) === withoutTrailingNewlines(after)) {
    return "trailing-newline-change";
  }
  if (before.trimEnd() === after.trimEnd()) {
    return "trailing-whitespace-normalization";
  }
  if (before.trimStart() === after.trimStart()) {
    return "leading-whitespace-normalization";
  }
  if (before.normalize("NFC") === after.normalize("NFC")) {
    return "unicode-normalization";
  }
  return "byte-content-change";
}

/** Computes a content-free byte edit summary; prompt text is never returned. */
export function summarizeV1JPromptContentDelta(
  before: string,
  after: string,
): V1JPromptContentDelta {
  const beforeBytes = Buffer.from(before, "utf8");
  const afterBytes = Buffer.from(after, "utf8");
  let prefixCommonBytes = 0;
  while (
    prefixCommonBytes < beforeBytes.length &&
    prefixCommonBytes < afterBytes.length &&
    beforeBytes[prefixCommonBytes] === afterBytes[prefixCommonBytes]
  ) {
    prefixCommonBytes += 1;
  }
  let suffixCommonBytes = 0;
  while (
    suffixCommonBytes < beforeBytes.length - prefixCommonBytes &&
    suffixCommonBytes < afterBytes.length - prefixCommonBytes &&
    beforeBytes[beforeBytes.length - suffixCommonBytes - 1] ===
      afterBytes[afterBytes.length - suffixCommonBytes - 1]
  ) {
    suffixCommonBytes += 1;
  }
  const beforeChangedBytes = beforeBytes.length - prefixCommonBytes - suffixCommonBytes;
  const afterChangedBytes = afterBytes.length - prefixCommonBytes - suffixCommonBytes;
  const alignedChangedBytes = Math.min(beforeChangedBytes, afterChangedBytes);
  let substitutedByteCount = 0;
  for (let index = 0; index < alignedChangedBytes; index += 1) {
    if (beforeBytes[prefixCommonBytes + index] !== afterBytes[prefixCommonBytes + index]) {
      substitutedByteCount += 1;
    }
  }
  const unmatchedBeforeBytes = beforeChangedBytes - alignedChangedBytes;
  const unmatchedAfterBytes = afterChangedBytes - alignedChangedBytes;
  const insertedByteCount = Math.max(0, unmatchedAfterBytes - unmatchedBeforeBytes);
  const deletedByteCount = Math.max(0, unmatchedBeforeBytes - unmatchedAfterBytes);
  const firstDifferenceOffset = beforeBytes.equals(afterBytes) ? null : prefixCommonBytes;
  const lastDifferenceOffset = beforeBytes.equals(afterBytes)
    ? null
    : Math.max(beforeBytes.length, afterBytes.length) - suffixCommonBytes - 1;
  const beforeTail = beforeBytes.subarray(Math.max(0, beforeBytes.length - 32));
  const afterTail = afterBytes.subarray(Math.max(0, afterBytes.length - 32));
  const crCountBefore = countByte(beforeBytes, 0x0d);
  const crCountAfter = countByte(afterBytes, 0x0d);
  const lfCountBefore = countByte(beforeBytes, 0x0a);
  const lfCountAfter = countByte(afterBytes, 0x0a);

  return {
    classification: classify(before, after),
    beforeBytes: beforeBytes.length,
    afterBytes: afterBytes.length,
    prefixCommonBytes,
    suffixCommonBytes,
    insertedByteCount,
    deletedByteCount,
    substitutedByteCount,
    firstDifferenceOffset,
    lastDifferenceOffset,
    beforeTailSha256: sha256(beforeTail),
    afterTailSha256: sha256(afterTail),
    newlineCountBefore: lfCountBefore,
    newlineCountAfter: lfCountAfter,
    crCountBefore,
    crCountAfter,
    lfCountBefore,
    lfCountAfter,
    utf8CodepointCountBefore: Array.from(before).length,
    utf8CodepointCountAfter: Array.from(after).length,
  };
}

function fingerprintNormalizationContent(content: unknown) {
  const kind =
    typeof content === "string" ? "string" : Array.isArray(content) ? "content-parts" : "other";
  const parts = Array.isArray(content)
    ? content.map((part) => {
        const row = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
        let serialized: string;
        try {
          serialized = typeof row.text === "string" ? row.text : (JSON.stringify(part) ?? "");
        } catch {
          serialized = "";
        }
        return {
          type: typeof row.type === "string" ? row.type : null,
          sha256: sha256(Buffer.from(serialized, "utf8")),
          utf8Bytes: Buffer.byteLength(serialized, "utf8"),
        };
      })
    : [];
  let aggregate: string | null = null;
  if (typeof content === "string") {
    aggregate = content;
  } else if (Array.isArray(content)) {
    try {
      aggregate = JSON.stringify(content) ?? null;
    } catch {
      aggregate = null;
    }
  }
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) &&
          content.length === 1 &&
          content[0] &&
          typeof content[0] === "object" &&
          (content[0] as { type?: unknown }).type === "text" &&
          typeof (content[0] as { text?: unknown }).text === "string"
        ? (content[0] as { text: string }).text
        : undefined;
  return {
    representationType: Array.isArray(content) ? "array" : typeof content,
    contentKind: kind,
    partCount: Array.isArray(content) ? content.length : null,
    parts,
    aggregate: {
      sha256: aggregate === null ? null : sha256(Buffer.from(aggregate, "utf8")),
      utf8Bytes: aggregate === null ? null : Buffer.byteLength(aggregate, "utf8"),
    },
    ...(text === undefined
      ? {}
      : {
          textFingerprint: {
            sha256: sha256(Buffer.from(text, "utf8")),
            utf8Bytes: Buffer.byteLength(text, "utf8"),
          },
        }),
  };
}

function normalizationSemanticText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (
    Array.isArray(content) &&
    content.length === 1 &&
    content[0] &&
    typeof content[0] === "object" &&
    (content[0] as { type?: unknown }).type === "text" &&
    typeof (content[0] as { text?: unknown }).text === "string"
  ) {
    return (content[0] as { text: string }).text;
  }
  return undefined;
}

/** Attributes one normalizer event using its exact in-event input/output snapshots. */
export function buildV1JNormalizationCauseAttribution(params: {
  inputMessages?: readonly { role?: unknown; content?: unknown }[];
  outputMessages: readonly { role?: unknown; content?: unknown }[];
  operation: V1JNormalizationOperationTrace;
}) {
  const before = params.inputMessages?.[params.operation.messageIndex];
  const after = params.outputMessages[params.operation.messageIndex];
  if (!before || !after || before.role !== "user" || after.role !== "user") {
    return {
      messageIndex: params.operation.messageIndex,
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE" as const,
    };
  }
  const input = fingerprintNormalizationContent(before.content);
  const output = fingerprintNormalizationContent(after.content);
  const inputText = normalizationSemanticText(before.content);
  const outputText = normalizationSemanticText(after.content);
  const flattened = params.operation.normalizerBranch === "single-text-block-array-to-string";
  return {
    messageIndex: params.operation.messageIndex,
    pairingStatus: "PAIRED" as const,
    input,
    output,
    normalizerBranch: params.operation.normalizerBranch,
    normalizerPath: params.operation.normalizerPath,
    joinOrFlattenOperation: flattened ? "single-text-part-collapse" : "none",
    joinSeparator: null,
    trimApplied: false,
    unicodeNormalizationApplied: false,
    serializationOrStringificationApplied: false,
    wrapperOperations: params.operation.wrapperOperations,
    replacementOrCloningPath: params.operation.replacementOrCloningPath,
    ...(typeof inputText === "string" && typeof outputText === "string"
      ? { semanticTextDelta: summarizeV1JPromptContentDelta(inputText, outputText) }
      : {}),
  };
}

function roleOrdinals(messages: V1JPromptMaterializationBoundary["messages"]) {
  const counts = new Map<string, number>();
  return messages.map((message) => {
    if (message.role === null) {
      return { message, ordinalWithinRole: message.index };
    }
    const ordinalWithinRole = counts.get(message.role) ?? 0;
    counts.set(message.role, ordinalWithinRole + 1);
    return { message, ordinalWithinRole };
  });
}

function sameMaterializationIdentity(
  left: V1JPromptMaterializationBoundary["identity"],
  right: V1JPromptMaterializationBoundary["identity"],
): boolean {
  return (
    left.runOneAttemptId === right.runOneAttemptId &&
    left.embeddedRunId === right.embeddedRunId &&
    left.sessionIdSha256 === right.sessionIdSha256 &&
    left.promptSubmissionIndex === right.promptSubmissionIndex &&
    left.modelLoopIterationIndex === right.modelLoopIterationIndex
  );
}

function roleCounts(messages: V1JPromptMaterializationBoundary["messages"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== null) {
      counts.set(message.role, (counts.get(message.role) ?? 0) + 1);
    }
  }
  return counts;
}

function diffV1JPromptMessageContents(
  sourceBoundary: string,
  destinationBoundary: string,
  beforeMessages: V1JPromptMaterializationBoundary["messages"] | undefined,
  afterMessages: V1JPromptMaterializationBoundary["messages"] | undefined,
  transitionInstanceId?: string | number,
): V1JPromptMaterializationDeltaSummary {
  if (beforeMessages === undefined || afterMessages === undefined) {
    const unavailableReason =
      beforeMessages === undefined
        ? "transition-input-unavailable"
        : "transition-output-unavailable";
    const availableMessages = beforeMessages ?? afterMessages ?? [];
    const isBefore = beforeMessages !== undefined;
    return {
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      sourceBoundary,
      destinationBoundary,
      ...(transitionInstanceId === undefined ? {} : { transitionInstanceId }),
      pairingReason: unavailableReason,
      deltas: roleOrdinals(availableMessages).map(({ message, ordinalWithinRole }) => ({
        sourceBoundary,
        destinationBoundary,
        role: message.role,
        ordinalWithinRole,
        beforeIndex: isBefore ? message.index : null,
        afterIndex: isBefore ? null : message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: unavailableReason,
      })),
    };
  }

  const beforeByIdentity = new Map(
    roleOrdinals(beforeMessages).map(({ message, ordinalWithinRole }) => [
      `${message.role ?? "<unknown>"}\u0000${ordinalWithinRole}`,
      { message, ordinalWithinRole },
    ]),
  );
  const afterByIdentity = new Map(
    roleOrdinals(afterMessages).map(({ message, ordinalWithinRole }) => [
      `${message.role ?? "<unknown>"}\u0000${ordinalWithinRole}`,
      { message, ordinalWithinRole },
    ]),
  );
  const beforeRoleCounts = roleCounts(beforeMessages);
  const afterRoleCounts = roleCounts(afterMessages);
  const deltas: V1JPromptMaterializationContentDelta[] = [];
  for (const [key, before] of beforeByIdentity) {
    const after = afterByIdentity.get(key);
    if (!after) {
      deltas.push({
        sourceBoundary,
        destinationBoundary,
        role: before.message.role,
        ordinalWithinRole: before.ordinalWithinRole,
        beforeIndex: before.message.index,
        afterIndex: null,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: "message-identity-missing-at-destination",
      });
      continue;
    }
    if (
      before.message.role !== null &&
      beforeRoleCounts.get(before.message.role) !== afterRoleCounts.get(before.message.role)
    ) {
      deltas.push({
        sourceBoundary,
        destinationBoundary,
        role: before.message.role,
        ordinalWithinRole: before.ordinalWithinRole,
        beforeIndex: before.message.index,
        afterIndex: after.message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: "message-role-counts-changed",
      });
      continue;
    }
    if (before.message.role === null || after.message.role === null) {
      deltas.push({
        sourceBoundary,
        destinationBoundary,
        role: null,
        ordinalWithinRole: before.ordinalWithinRole,
        beforeIndex: before.message.index,
        afterIndex: after.message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: "message-role-unavailable",
      });
      continue;
    }
    if (before.message.content === null || after.message.content === null) {
      deltas.push({
        sourceBoundary,
        destinationBoundary,
        role: after.message.role,
        ordinalWithinRole: after.ordinalWithinRole,
        beforeIndex: before.message.index,
        afterIndex: after.message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: "message-content-is-not-a-string",
      });
      continue;
    }
    if (before.message.content === after.message.content) {
      continue;
    }
    deltas.push({
      sourceBoundary,
      destinationBoundary,
      role: after.message.role,
      ordinalWithinRole: after.ordinalWithinRole,
      beforeIndex: before.message.index,
      afterIndex: after.message.index,
      pairingStatus: "PAIRED",
      beforeContentSha256: sha256(Buffer.from(before.message.content, "utf8")),
      afterContentSha256: sha256(Buffer.from(after.message.content, "utf8")),
      delta: summarizeV1JPromptContentDelta(before.message.content, after.message.content),
    });
  }
  for (const [key, after] of afterByIdentity) {
    if (beforeByIdentity.has(key)) {
      continue;
    }
    deltas.push({
      sourceBoundary,
      destinationBoundary,
      role: after.message.role,
      ordinalWithinRole: after.ordinalWithinRole,
      beforeIndex: null,
      afterIndex: after.message.index,
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      pairingReason: "message-identity-missing-at-source",
    });
  }
  const pairingStatus = deltas.some((entry) => entry.pairingStatus !== "PAIRED")
    ? "DELTA_PAIRING_UNAVAILABLE"
    : "PAIRED";
  return {
    pairingStatus,
    sourceBoundary,
    destinationBoundary,
    ...(transitionInstanceId === undefined ? {} : { transitionInstanceId }),
    ...(pairingStatus === "DELTA_PAIRING_UNAVAILABLE"
      ? { pairingReason: "one-or-more-message-identities-could-not-be-paired" }
      : {}),
    deltas,
  };
}

/** Diffs the two snapshots attached to one transformation event, without journal lookup. */
export function diffV1JPromptMaterializationTransition(
  transition: V1JPromptMaterializationTransition,
): V1JPromptMaterializationDeltaSummary {
  return diffV1JPromptMessageContents(
    transition.sourceBoundary,
    transition.destinationBoundary,
    transition.inputMessages,
    transition.outputMessages,
    transition.transitionInstanceId,
  );
}

/** Pairs only adjacent snapshots from the same run and role-relative message identity. */
export function diffV1JPromptMaterializationBoundaries(
  previous: V1JPromptMaterializationBoundary | undefined,
  current: V1JPromptMaterializationBoundary,
): V1JPromptMaterializationDeltaSummary {
  const destinationBoundary = current.stage;
  if (!previous) {
    return {
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      sourceBoundary: null,
      destinationBoundary,
      pairingReason: "no-adjacent-boundary-predecessor",
      deltas: roleOrdinals(current.messages).map(({ message, ordinalWithinRole }) => ({
        sourceBoundary: null,
        destinationBoundary,
        role: message.role,
        ordinalWithinRole,
        beforeIndex: null,
        afterIndex: message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: "no-adjacent-boundary-predecessor",
      })),
    };
  }
  const sourceBoundary = previous.stage;
  const sourceIndex = V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER.indexOf(previous.stage);
  const destinationIndex = V1J_PROMPT_MATERIALIZATION_BOUNDARY_ORDER.indexOf(current.stage);
  const unavailableReason = !sameMaterializationIdentity(previous.identity, current.identity)
    ? "materialization-identity-mismatch"
    : destinationIndex !== sourceIndex + 1
      ? "predecessor-is-not-adjacent-boundary"
      : undefined;

  if (unavailableReason) {
    return {
      pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
      sourceBoundary,
      destinationBoundary,
      pairingReason: unavailableReason,
      deltas: roleOrdinals(current.messages).map(({ message, ordinalWithinRole }) => ({
        sourceBoundary,
        destinationBoundary,
        role: message.role,
        ordinalWithinRole,
        beforeIndex: null,
        afterIndex: message.index,
        pairingStatus: "DELTA_PAIRING_UNAVAILABLE",
        pairingReason: unavailableReason,
      })),
    };
  }
  return diffV1JPromptMessageContents(
    sourceBoundary,
    destinationBoundary,
    previous.messages,
    current.messages,
  );
}

/** Fingerprints named system-prompt inputs without retaining their text. */
export function fingerprintV1JSystemPromptSections(
  sections: Readonly<Record<string, string | undefined>>,
): V1JPromptSectionFingerprint[] {
  return Object.keys(sections)
    .toSorted()
    .map((sectionName) => {
      const content = sections[sectionName];
      return content === undefined
        ? { sectionName, present: false, sha256: null, utf8Bytes: null }
        : {
            sectionName,
            present: true,
            sha256: sha256(Buffer.from(content, "utf8")),
            utf8Bytes: Buffer.byteLength(content, "utf8"),
          };
    });
}

/** Uses stable paragraph ordinals when the assembled prompt has no source labels at this boundary. */
export function fingerprintV1JSystemPromptParagraphs(
  systemPrompt: string | undefined,
): V1JPromptSectionFingerprint[] {
  if (systemPrompt === undefined) {
    return [];
  }
  const paragraphs = systemPrompt
    .split(/\r?\n(?:[ \t]*\r?\n)+/u)
    .filter((paragraph) => paragraph.length > 0);
  return fingerprintV1JSystemPromptSections(
    Object.fromEntries(paragraphs.map((paragraph, index) => [`paragraph-${index}`, paragraph])),
  );
}

export function diffV1JSystemPromptSectionFingerprints(
  before: readonly V1JPromptSectionFingerprint[],
  after: readonly V1JPromptSectionFingerprint[],
): string[] {
  const beforeByName = new Map(before.map((section) => [section.sectionName, section]));
  const afterByName = new Map(after.map((section) => [section.sectionName, section]));
  return [...new Set([...beforeByName.keys(), ...afterByName.keys()])]
    .filter((name) => {
      const previous = beforeByName.get(name);
      const current = afterByName.get(name);
      return (
        previous?.present !== current?.present ||
        previous?.sha256 !== current?.sha256 ||
        previous?.utf8Bytes !== current?.utf8Bytes
      );
    })
    .toSorted();
}
