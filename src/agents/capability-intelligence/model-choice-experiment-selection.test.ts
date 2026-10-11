import { describe, expect, it } from "vitest";
import { summarizeBenchmarkRealToolMappings } from "./benchmark-real-tool-mapping.js";
import { requiredV1ICells, v1ICellKey } from "./model-choice-experiment-evidence.js";
import {
  buildV1IResumeSelectionReport,
  resolveV1IResumeSelection,
  V1I_CELL_ALLOWLIST_ENV,
  V1I_MAX_CELLS_ENV,
} from "./model-choice-experiment-selection.js";
import { TOOL_RANKING_HELD_OUT_CASES } from "./tool-ranking-benchmark-cases.js";

const mappingSummary = summarizeBenchmarkRealToolMappings(TOOL_RANKING_HELD_OUT_CASES);
const realExactCases = TOOL_RANKING_HELD_OUT_CASES.filter((benchmarkCase) =>
  mappingSummary.cases.some(
    (entry) => entry.caseId === benchmarkCase.id && entry.mappingClass === "EXACT",
  ),
);
const realExactCells = requiredV1ICells("real-exact", realExactCases);

function selector(cell: (typeof realExactCells)[number]): string {
  return `${cell.caseId}:${cell.arm}:${cell.replicate}`;
}

function completed(...cells: readonly (typeof realExactCells)[number][]): ReadonlySet<string> {
  return new Set(cells.map(v1ICellKey));
}

describe("v1I bounded real-exact resume selection", () => {
  it("preserves legacy missing-cell selection when controls are absent", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: completed(realExactCells[0]!),
    });
    expect(selection.hasExplicitControl).toBe(false);
    expect(selection.selectedCells).toHaveLength(realExactCells.length - 1);
    expect(selection.selectedCells[0]).toEqual(realExactCells[1]);
  });

  it("accepts an exact allowlist and returns four canonical cells", () => {
    const requested = [
      realExactCells[5]!,
      realExactCells[0]!,
      realExactCells[9]!,
      realExactCells[1]!,
    ];
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: new Set(),
      rawCellAllowlist: requested.map(selector).join(","),
      rawMaxCells: "4",
    });
    expect(selection.selectedCells).toEqual([
      realExactCells[0],
      realExactCells[1],
      realExactCells[5],
      realExactCells[9],
    ]);
    expect(selection.selectedCells).toHaveLength(4);
  });

  it("applies the maximum to distinct design cells in canonical order", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: new Set(),
      rawMaxCells: "2",
    });
    expect(selection.selectedCells).toEqual(realExactCells.slice(0, 2));
    expect(selection.selectedCells).toHaveLength(2);
  });

  it("does not spend selection slots on retries", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: new Set(),
      rawCellAllowlist: [realExactCells[0]!, realExactCells[1]!].map(selector).join(","),
      rawMaxCells: "2",
    });
    expect(selection.selectedCells.map(v1ICellKey)).toEqual(
      [realExactCells[0]!, realExactCells[1]!].map(v1ICellKey),
    );
  });

  it("skips already-valid cells without selecting a replacement", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: completed(realExactCells[0]!, realExactCells[1]!),
      rawCellAllowlist: [realExactCells[0]!, realExactCells[1]!].map(selector).join(","),
      rawMaxCells: "2",
    });
    expect(selection.alreadyValidCells).toHaveLength(2);
    expect(selection.selectedCells).toHaveLength(0);
  });

  it("reports the bounded request before any execution", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: new Set(),
      rawCellAllowlist: selector(realExactCells[0]!),
      rawMaxCells: "1",
    });
    expect(buildV1IResumeSelectionReport(selection)).toMatchObject({
      requestedCellAllowlist: selector(realExactCells[0]!),
      resolvedMissingCells: [v1ICellKey(realExactCells[0]!)],
      selectedCells: [v1ICellKey(realExactCells[0]!)],
      selectedCount: 1,
    });
  });

  it.each([
    ["duplicate", `${selector(realExactCells[0]!)},${selector(realExactCells[0]!)}`],
    ["unknown case", "not-a-real-case:A:1"],
    ["invalid arm", `${realExactCells[0]!.caseId}:C:1`],
    ["invalid repetition", `${realExactCells[0]!.caseId}:A:4`],
    ["malformed", "not-a-cell"],
  ])("fails closed for %s allowlists", (_label, rawCellAllowlist) => {
    expect(() =>
      resolveV1IResumeSelection({
        mode: "real-exact",
        cases: realExactCases,
        completedCells: new Set(),
        rawCellAllowlist,
      }),
    ).toThrow(V1I_CELL_ALLOWLIST_ENV);
  });

  it.each(["", "0", "49", "1.5", "-1", "many"])(
    "fails closed for invalid %s maximums",
    (rawMaxCells) => {
      expect(() =>
        resolveV1IResumeSelection({
          mode: "real-exact",
          cases: realExactCases,
          completedCells: new Set(),
          rawMaxCells,
        }),
      ).toThrow(V1I_MAX_CELLS_ENV);
    },
  );

  it.each(["synthetic", "real-adapter"] as const)("rejects bounded selectors for %s", (mode) => {
    expect(() =>
      resolveV1IResumeSelection({
        mode,
        cases: realExactCases,
        completedCells: new Set(),
        rawCellAllowlist: selector(realExactCells[0]!),
      }),
    ).toThrow(`${V1I_CELL_ALLOWLIST_ENV} and ${V1I_MAX_CELLS_ENV}`);
  });

  it("cannot broaden an explicit selector to the missing universe", () => {
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells: new Set(),
      rawCellAllowlist: selector(realExactCells[0]!),
    });
    expect(selection.resolvedMissingCells).toHaveLength(1);
    expect(selection.selectedCells).toHaveLength(1);
  });

  it("does not mutate resume state or model-facing inputs", () => {
    const completedCells = completed(realExactCells[0]!);
    const casesBefore = JSON.stringify(realExactCases);
    const selection = resolveV1IResumeSelection({
      mode: "real-exact",
      cases: realExactCases,
      completedCells,
      rawCellAllowlist: selector(realExactCells[1]!),
      rawMaxCells: "1",
    });
    expect(completedCells).toEqual(completed(realExactCells[0]!));
    expect(JSON.stringify(realExactCases)).toBe(casesBefore);
    expect(selection.selectedCells).toEqual([realExactCells[1]]);
  });
});
