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
  content: string;
};

export type V1JPromptMessageContentDelta = {
  index: number;
  beforeRole: string | null;
  afterRole: string | null;
  delta: V1JPromptContentDelta;
};

export type V1JPromptSectionFingerprint = {
  sectionName: string;
  present: boolean;
  sha256: string | null;
  utf8Bytes: number | null;
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

export function summarizeV1JPromptMessageContentDeltas(
  before: readonly V1JPromptMessageContent[],
  after: readonly V1JPromptMessageContent[],
): V1JPromptMessageContentDelta[] {
  const changes: V1JPromptMessageContentDelta[] = [];
  const count = Math.max(before.length, after.length);
  for (let index = 0; index < count; index += 1) {
    const previous = before[index];
    const current = after[index];
    if (
      previous &&
      current &&
      previous.content === current.content &&
      previous.role === current.role
    ) {
      continue;
    }
    changes.push({
      index,
      beforeRole: previous?.role ?? null,
      afterRole: current?.role ?? null,
      delta: summarizeV1JPromptContentDelta(previous?.content ?? "", current?.content ?? ""),
    });
  }
  return changes;
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
