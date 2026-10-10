/**
 * Read-only qualification report for shadow traffic.
 *
 * The header follows `qualification.passed`. Kept coverage, trial coverage,
 * turn containment, and domain concentration are diagnostics. A complete
 * kept surface does not pass top-8 containment.
 */
import { CAPABILITY_DOMAIN_IDS } from "./capability-catalog.js";
import { oneSidedAnytimeUpperBound } from "./confidence-sequence.js";
import { V1F2_EARLY_FAILURE_IDENTITY } from "./early-failure-policy.js";
import {
  MIN_C8_CALLS,
  MIN_CREQ8_CALLS,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  shadowRateSequences,
  type ShadowContainmentEvent,
  type ShadowTrafficQualification,
} from "./shadow-traffic.js";

export type ShadowMissImpact =
  | "none"
  | "unknown"
  | "recoverable"
  | "succeeded"
  | "degraded"
  | "failed"
  | "task-critical";

export type ShadowQualificationMissRow = {
  tool: string;
  calls: number;
  outsideTop8: number;
  /** Outside-top-8 executions that were still inside the simulated kept set. */
  inKept: number;
  /** Outside-top-8 executions that were inside the trial surface. */
  inTrial: number;
  /** Provenance-backed required executions. Unknown role sources stay at 0. */
  required: number;
  failureImpact: ShadowMissImpact;
};

export type ShadowQualificationReport = {
  /** `PASS` only when the qualification gate passed. Otherwise `BLOCKED`. */
  verdict: "PASS" | "BLOCKED";
  lines: readonly string[];
  misses: readonly ShadowQualificationMissRow[];
};

type ReportStatus = "PASS" | "FAIL" | "WARN" | "INFO";

const IMPACT_RANK = {
  none: 0,
  unknown: 1,
  recoverable: 2,
  succeeded: 3,
  degraded: 4,
  failed: 5,
  "task-critical": 6,
} as const satisfies Record<ShadowMissImpact, number>;

const MISS_HEADER =
  "| Tool | Calls | Outside top 8 | In kept | In trial | Required | Failure impact |";
const MISS_DIVIDER = "| --- | ---: | ---: | ---: | ---: | ---: | --- |";

function statusLine(status: ReportStatus, text: string): string {
  return `${status}  ${text}`;
}

function flagLine(passed: boolean, text: string): string {
  return statusLine(passed ? "PASS" : "FAIL", text);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCountedRatio(value: number | null, numerator: number, denominator: number): string {
  if (value === null) {
    return `n/a (${numerator}/${denominator})`;
  }
  return `${formatPercent(value)} (${numerator}/${denominator})`;
}

function formatOptionalRatio(value: number | null, numerator: number, denominator: number): string {
  if (value === null) {
    return "n/a";
  }
  return formatCountedRatio(value, numerator, denominator);
}

function provenanceBackedRequired(event: ShadowContainmentEvent): boolean {
  return event.role === "required" && event.roleSource !== "unknown";
}

/**
 * Worst outside-top-8 call wins. Preservation is not a filtering failure.
 * Trial membership is recoverable only when the call is outside the kept set.
 * A missing kept or trial verdict stays unknown unless the call already failed,
 * was marked degraded, or was a task-critical block.
 */
function impactOfOutsideCall(event: ShadowContainmentEvent): ShadowMissImpact {
  if (event.taskCriticalBlock === true) {
    return "task-critical";
  }
  if (event.inKept === true) {
    return "none";
  }
  if (
    event.missSeverity === "top-8 miss, task failed" ||
    (event.success === false && event.missSeverity !== "top-8 miss, task degraded")
  ) {
    return "failed";
  }
  if (event.missSeverity === "top-8 miss, task degraded") {
    return "degraded";
  }
  if (event.inKept === undefined || event.inTrialSurface === undefined) {
    return "unknown";
  }
  if (event.inTrialSurface) {
    return "recoverable";
  }
  if (event.success === true || event.missSeverity === "top-8 miss, task still succeeds") {
    return "succeeded";
  }
  return "unknown";
}

function worseImpact(current: ShadowMissImpact, next: ShadowMissImpact): ShadowMissImpact {
  if (IMPACT_RANK[next] > IMPACT_RANK[current]) {
    return next;
  }
  return current;
}

function compareMissRows(
  left: ShadowQualificationMissRow,
  right: ShadowQualificationMissRow,
): number {
  if (right.outsideTop8 !== left.outsideTop8) {
    return right.outsideTop8 - left.outsideTop8;
  }
  if (right.calls !== left.calls) {
    return right.calls - left.calls;
  }
  if (left.tool < right.tool) {
    return -1;
  }
  if (left.tool > right.tool) {
    return 1;
  }
  return 0;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function buildShadowQualificationMisses(
  events: readonly ShadowContainmentEvent[],
): ShadowQualificationMissRow[] {
  const tallies = new Map<string, ShadowQualificationMissRow>();
  for (const event of events) {
    if (!event.executionStarted) {
      continue;
    }
    const current = tallies.get(event.selectedTool) ?? {
      tool: event.selectedTool,
      calls: 0,
      outsideTop8: 0,
      inKept: 0,
      inTrial: 0,
      required: 0,
      failureImpact: "none" as const,
    };
    const outside = !event.inTop8;
    tallies.set(event.selectedTool, {
      tool: event.selectedTool,
      calls: current.calls + 1,
      outsideTop8: current.outsideTop8 + (outside ? 1 : 0),
      inKept: current.inKept + (outside && event.inKept === true ? 1 : 0),
      inTrial: current.inTrial + (outside && event.inTrialSurface === true ? 1 : 0),
      required: current.required + (provenanceBackedRequired(event) ? 1 : 0),
      failureImpact: outside
        ? worseImpact(current.failureImpact, impactOfOutsideCall(event))
        : current.failureImpact,
    });
  }
  return [...tallies.values()].toSorted(compareMissRows);
}

function unrecognizedPolicyLine(qualification: ShadowTrafficQualification): string {
  const version = qualification.strata[0]?.version;
  const policy = `qualification policy is not ${SHADOW_QUALIFICATION_POLICY_VERSION}`;
  if (!version) {
    return statusLine("FAIL", policy);
  }
  return statusLine(
    "FAIL",
    `${policy} (${version.schemaVersion}/${version.rankerVersion}/${version.qualificationPolicyVersion})`,
  );
}

function versionLine(qualification: ShadowTrafficQualification): string {
  if (!qualification.sampleCompatible) {
    return statusLine("FAIL", "sample versions are mixed");
  }
  if (!qualification.recognizedPolicy) {
    return unrecognizedPolicyLine(qualification);
  }
  const version = qualification.strata[0]?.version.qualificationPolicyVersion;
  return statusLine("PASS", `event version = ${version ?? SHADOW_QUALIFICATION_POLICY_VERSION}`);
}

function simulatedCountLine(
  evaluable: boolean,
  passed: boolean,
  label: string,
  count: number,
): string {
  if (!evaluable) {
    return statusLine("FAIL", `${label} = unevaluable`);
  }
  return flagLine(passed, `${label} = ${count}`);
}

function authorizationLine(qualification: ShadowTrafficQualification): string {
  if (qualification.authorizationUnevaluableEvents > 0) {
    return statusLine("FAIL", "authorization regressions = unevaluable");
  }
  return flagLine(
    qualification.authorizationRegressionsPassed,
    `authorization regressions = ${qualification.authorizationRegressions}`,
  );
}

function requiredLine(qualification: ShadowTrafficQualification): string {
  if (qualification.requiredExecutedCalls === 0) {
    return statusLine("FAIL", "provenance-backed required calls = insufficient");
  }
  return flagLine(
    qualification.requiredContainmentPassed,
    `Creq8 = ${formatCountedRatio(qualification.requiredContainment, qualification.requiredInTop8, qualification.requiredExecutedCalls)}`,
  );
}

function domainsLine(qualification: ShadowTrafficQualification): string {
  const names = qualification.representedFamilies;
  const listed = names.length > 0 ? ` (${names.join(", ")})` : "";
  if (qualification.familyRepresentationPassed) {
    return statusLine("PASS", `domains = ${names.length}${listed}`);
  }
  const minimum = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.minRepresentedFamilies;
  return statusLine("FAIL", `domains = ${names.length} / ${minimum}${listed}`);
}

function largestKnownDomainCount(counts: Record<string, number>): number {
  let largest = 0;
  for (const domain of CAPABILITY_DOMAIN_IDS) {
    const count = counts[domain] ?? 0;
    if (count > largest) {
      largest = count;
    }
  }
  return largest;
}

/** Soft concentration signal. The qualifier flag decides; this is never a gate. */
function dmaxLine(qualification: ShadowTrafficQualification): string {
  if (qualification.maxDomainShare === null || qualification.maxDomainShareWithinLimit === null) {
    return statusLine("INFO", "Dmax = n/a");
  }
  const largest = largestKnownDomainCount(qualification.familyExecutionCounts);
  const text = `Dmax = ${formatPercent(qualification.maxDomainShare)} (${largest}/${qualification.knownDomainCalls})`;
  if (qualification.maxDomainShareWithinLimit) {
    return statusLine("INFO", text);
  }
  return statusLine("WARN", text);
}

function knownDomainsLine(counts: Record<string, number>): string {
  const names = CAPABILITY_DOMAIN_IDS.filter((domain) => (counts[domain] ?? 0) > 0);
  if (names.length === 0) {
    return statusLine("INFO", "known domains = 0");
  }
  return statusLine("INFO", `known domains = ${names.length} (${names.join(", ")})`);
}

function diagnosticLines(qualification: ShadowTrafficQualification): string[] {
  return [
    statusLine("INFO", `active filtering = ${qualification.activeFilteringEnabled ? "ON" : "OFF"}`),
    statusLine(
      "INFO",
      `Ckept = ${formatOptionalRatio(qualification.keptContainment, qualification.executedInKept, qualification.executedCalls)}`,
    ),
    statusLine(
      "INFO",
      `Ctrial = ${formatOptionalRatio(qualification.trialContainment, qualification.executedInTrialSurface, qualification.executedCalls)}`,
    ),
    statusLine(
      "INFO",
      `T8 = ${formatOptionalRatio(qualification.turnContainment, qualification.successfulTurnsAllRequiredInTop8, qualification.successfulEvaluatedTurns)}`,
    ),
    statusLine("INFO", `discovery controls blocked = ${qualification.discoveryControlsBlocked}`),
    statusLine("INFO", `known-domain calls = ${qualification.knownDomainCalls}`),
    knownDomainsLine(qualification.familyExecutionCounts),
  ];
}

function rateBoundLines(
  qualification: ShadowTrafficQualification,
  observations: readonly number[],
  label: string,
  gate: number,
  floor: number,
  alpha: number,
): string[] {
  const version = qualification.strata[0]?.version.qualificationPolicyVersion;
  if (version !== SHADOW_QUALIFICATION_POLICY_VERSION || observations.length === 0) {
    return [];
  }
  const bound = oneSidedAnytimeUpperBound(observations, alpha);
  if (bound === null) {
    return [];
  }
  let successes = 0;
  for (const observation of observations) {
    successes += observation;
  }
  const belowGate = bound < gate ? "yes" : "no";
  return [
    statusLine(
      "INFO",
      `${label} anytime 95% upper = ${formatPercent(bound)} (${successes}/${observations.length}) gate ${formatPercent(gate)} below gate ${belowGate} (${observations.length}/${floor} calls)`,
    ),
  ];
}

function reportLines(
  qualification: ShadowTrafficQualification,
  events: readonly ShadowContainmentEvent[],
): string[] {
  const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;
  const sequences = shadowRateSequences(events);
  return [
    versionLine(qualification),
    flagLine(qualification.offlineRequiredRecallPassed, "offline required recall"),
    flagLine(qualification.offlineNdcgPassed, "offline NDCG"),
    flagLine(
      qualification.executedContainmentPassed,
      `C8 = ${formatCountedRatio(qualification.executedContainment, qualification.executedInTop8, qualification.executedCalls)}`,
    ),
    ...rateBoundLines(
      qualification,
      sequences.executed,
      "C8",
      thresholds.executedContainment,
      MIN_C8_CALLS,
      V1F2_EARLY_FAILURE_IDENTITY.alphaC8,
    ),
    simulatedCountLine(
      qualification.simulatedFilterEvaluable,
      qualification.simulatedRequiredBlocksPassed,
      "simulated required blocks",
      qualification.simulatedRequiredBlocks,
    ),
    simulatedCountLine(
      qualification.simulatedFilterEvaluable,
      qualification.simulatedTaskCriticalBlocksPassed,
      "simulated task-critical blocks",
      qualification.simulatedTaskCriticalBlocks,
    ),
    authorizationLine(qualification),
    "",
    flagLine(
      qualification.executedCallsPassed,
      `executed calls = ${qualification.executedCalls} / ${thresholds.minExecutedCalls}`,
    ),
    flagLine(
      qualification.multiToolTurnsPassed,
      `multi-tool turns = ${qualification.multiToolTurns} / ${thresholds.minMultiToolTurns}`,
    ),
    requiredLine(qualification),
    ...rateBoundLines(
      qualification,
      sequences.required,
      "Creq8",
      thresholds.requiredContainment,
      MIN_CREQ8_CALLS,
      V1F2_EARLY_FAILURE_IDENTITY.alphaCreq8,
    ),
    domainsLine(qualification),
    dmaxLine(qualification),
    "",
    ...diagnosticLines(qualification),
  ];
}

function formatMissTable(rows: readonly ShadowQualificationMissRow[]): string {
  const body = rows.map(
    (row) =>
      `| ${escapeCell(row.tool)} | ${row.calls} | ${row.outsideTop8} | ${row.inKept} | ${row.inTrial} | ${row.required} | ${row.failureImpact} |`,
  );
  return [MISS_HEADER, MISS_DIVIDER, ...body].join("\n");
}

/**
 * `events` must be the sample behind `qualification`. Gate booleans are copied
 * from that result; this function does not judge them again.
 */
export function buildShadowQualificationReport(
  qualification: ShadowTrafficQualification,
  events: readonly ShadowContainmentEvent[],
): ShadowQualificationReport {
  return {
    verdict: qualification.passed ? "PASS" : "BLOCKED",
    lines: reportLines(qualification, events),
    misses: buildShadowQualificationMisses(events),
  };
}

export function formatShadowQualificationReport(report: ShadowQualificationReport): string {
  const parts = [`QUALIFICATION: ${report.verdict}`, "", ...report.lines];
  if (report.misses.length > 0) {
    parts.push("", "Counterfactual misses", formatMissTable(report.misses));
  }
  return parts.join("\n");
}

export function renderShadowQualificationReport(
  qualification: ShadowTrafficQualification,
  events: readonly ShadowContainmentEvent[],
): string {
  return formatShadowQualificationReport(buildShadowQualificationReport(qualification, events));
}
