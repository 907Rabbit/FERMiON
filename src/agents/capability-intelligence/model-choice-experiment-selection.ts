import {
  missingV1ICells,
  requiredV1ICells,
  v1ICellKey,
  type V1IMode,
  type V1IRequiredCell,
} from "./model-choice-experiment-evidence.js";
import type { ToolRankingBenchmarkCase } from "./tool-ranking-benchmark-cases.js";

export const V1I_CELL_ALLOWLIST_ENV = "OPENCLAW_V1I_CELL_ALLOWLIST";
export const V1I_MAX_CELLS_ENV = "OPENCLAW_V1I_MAX_CELLS";
export const V1I_MAX_CELLS = 48;

export type V1IResumeSelection = {
  requestedCellAllowlist: string | null;
  requestedCells: readonly V1IRequiredCell[];
  alreadyValidCells: readonly V1IRequiredCell[];
  resolvedMissingCells: readonly V1IRequiredCell[];
  selectedCells: readonly V1IRequiredCell[];
  maxCells: number | null;
  hasExplicitControl: boolean;
};

export type V1IResumeSelectionReport = {
  requestedCellAllowlist: string | null;
  requestedCells: readonly string[];
  alreadyValidCells: readonly string[];
  resolvedMissingCells: readonly string[];
  selectedCells: readonly string[];
  maxCells: number | null;
  selectedCount: number;
  selectedAttemptCount?: number;
  completedValidCount?: number;
  remainingInvalidCount?: number;
  modelRequestsSent?: number;
};

export function resolveV1IResumeSelection(input: {
  mode: V1IMode;
  cases: readonly ToolRankingBenchmarkCase[];
  completedCells: ReadonlySet<string>;
  rawCellAllowlist?: string;
  rawMaxCells?: string;
}): V1IResumeSelection {
  const hasAllowlist = input.rawCellAllowlist !== undefined;
  const hasMax = input.rawMaxCells !== undefined;
  const hasExplicitControl = hasAllowlist || hasMax;
  if (hasExplicitControl && input.mode !== "real-exact") {
    throw new Error(
      `${V1I_CELL_ALLOWLIST_ENV} and ${V1I_MAX_CELLS_ENV} are only valid for real-exact`,
    );
  }
  const maxCells = parseMaxCells(input.rawMaxCells);
  const requiredCells = requiredV1ICells(input.mode, input.cases);
  const requestedCells = hasAllowlist
    ? parseCellAllowlist(input.rawCellAllowlist, requiredCells)
    : requiredCells;
  const requestedKeys = new Set(requestedCells.map(v1ICellKey));
  const alreadyValidCells = requestedCells.filter((cell) =>
    input.completedCells.has(v1ICellKey(cell)),
  );
  const resolvedMissingCells = missingV1ICells(
    input.mode,
    input.cases,
    input.completedCells,
  ).filter((cell) => requestedKeys.has(v1ICellKey(cell)));
  const selectedCells = (
    maxCells === null ? resolvedMissingCells : resolvedMissingCells.slice(0, maxCells)
  ) as readonly V1IRequiredCell[];
  if (hasAllowlist && requestedCells.length === 0) {
    throw new Error(`${V1I_CELL_ALLOWLIST_ENV} resolved no cells`);
  }
  return {
    requestedCellAllowlist: input.rawCellAllowlist ?? null,
    requestedCells,
    alreadyValidCells,
    resolvedMissingCells,
    selectedCells,
    maxCells,
    hasExplicitControl,
  };
}

export function buildV1IResumeSelectionReport(
  selection: V1IResumeSelection,
  extra: Omit<
    V1IResumeSelectionReport,
    | "requestedCellAllowlist"
    | "requestedCells"
    | "alreadyValidCells"
    | "resolvedMissingCells"
    | "selectedCells"
    | "maxCells"
    | "selectedCount"
  > = {},
): V1IResumeSelectionReport {
  return {
    requestedCellAllowlist: selection.requestedCellAllowlist,
    requestedCells: selection.requestedCells.map(v1ICellKey),
    alreadyValidCells: selection.alreadyValidCells.map(v1ICellKey),
    resolvedMissingCells: selection.resolvedMissingCells.map(v1ICellKey),
    selectedCells: selection.selectedCells.map(v1ICellKey),
    maxCells: selection.maxCells,
    selectedCount: selection.selectedCells.length,
    ...extra,
  };
}

function parseCellAllowlist(
  rawAllowlist: string | undefined,
  requiredCells: readonly V1IRequiredCell[],
): readonly V1IRequiredCell[] {
  if (rawAllowlist === undefined || rawAllowlist.trim() === "") {
    throw new Error(`${V1I_CELL_ALLOWLIST_ENV} must contain one or more exact cells`);
  }
  const byKey = new Map(requiredCells.map((cell) => [selectorKey(cell), cell]));
  const seen = new Set<string>();
  return rawAllowlist.split(",").map((rawCell) => {
    const value = rawCell.trim();
    const cell = parseCellSelector(value, byKey);
    if (seen.has(value)) {
      throw new Error(`duplicate ${V1I_CELL_ALLOWLIST_ENV} cell: ${value}`);
    }
    seen.add(value);
    return cell;
  });
}

function parseCellSelector(
  value: string,
  byKey: ReadonlyMap<string, V1IRequiredCell>,
): V1IRequiredCell {
  const parts = value.split(":");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error(`invalid ${V1I_CELL_ALLOWLIST_ENV} cell: ${value}`);
  }
  const arm = parts[1];
  const repetitionText = parts[2] ?? "";
  const replicate = Number(repetitionText);
  if (arm !== "A" && arm !== "B") {
    throw new Error(`invalid ${V1I_CELL_ALLOWLIST_ENV} arm: ${value}`);
  }
  if (
    !/^\d+$/.test(repetitionText) ||
    !Number.isSafeInteger(replicate) ||
    replicate < 1 ||
    replicate > 3
  ) {
    throw new Error(`invalid ${V1I_CELL_ALLOWLIST_ENV} repetition: ${value}`);
  }
  const cell = byKey.get(`${parts[0]}:${arm}:${replicate}`);
  if (!cell) {
    throw new Error(`unknown or non-real-exact ${V1I_CELL_ALLOWLIST_ENV} cell: ${value}`);
  }
  return cell;
}

function parseMaxCells(rawMaxCells: string | undefined): number | null {
  if (rawMaxCells === undefined) {
    return null;
  }
  if (!/^\d+$/.test(rawMaxCells)) {
    throw new Error(
      `${V1I_MAX_CELLS_ENV} must be a positive integer no greater than ${V1I_MAX_CELLS}`,
    );
  }
  const maxCells = Number(rawMaxCells);
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > V1I_MAX_CELLS) {
    throw new Error(
      `${V1I_MAX_CELLS_ENV} must be a positive integer no greater than ${V1I_MAX_CELLS}`,
    );
  }
  return maxCells;
}

function selectorKey(cell: V1IRequiredCell): string {
  return `${cell.caseId}:${cell.arm}:${cell.replicate}`;
}
