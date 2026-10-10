import { describe, expect, it } from "vitest";
import {
  buildShadowQualificationReport,
  formatShadowQualificationReport,
  renderShadowQualificationReport,
  type ShadowQualificationReport,
} from "./shadow-qualification-report.js";
import { qualifyShadowTraffic } from "./shadow-qualification.js";
import {
  createShadowContainmentEvent,
  DISCOVERY_CONTROL_TOOLS,
  SHADOW_CONTAINMENT_SCHEMA_VERSION,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  type ShadowContainmentEvent,
  type ShadowContainmentInput,
  type ShadowTrafficQualification,
} from "./shadow-traffic.js";

const TOP8 = ["git_status", "read", "exec", "edit", "web_search", "cron", "message", "email"];
const FAMILY_TOOLS = ["git_status", "read", "exec", "edit", "web_search"] as const;
const AUTHORIZED = [...TOP8, ...DISCOVERY_CONTROL_TOOLS, "pytest", "browser"];

function eventFor(
  input: Partial<ShadowContainmentInput> & Pick<ShadowContainmentInput, "turnId" | "selectedTool">,
): ShadowContainmentEvent {
  const event = createShadowContainmentEvent({
    mode: "simulated-filter",
    runId: "run",
    authorizedCount: AUTHORIZED.length,
    rankedTop8: TOP8,
    authorizedNames: AUTHORIZED,
    executionStarted: true,
    success: true,
    role: "required",
    roleSource: "benchmark",
    ...input,
  });
  if (!event) {
    throw new Error("expected a containment event");
  }
  return event;
}

function sample(turns: number, callsPerTurn: number): ShadowContainmentEvent[] {
  const events: ShadowContainmentEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const turnId = `run:${turn + 1}`;
    for (let call = 0; call < callsPerTurn; call += 1) {
      events.push(
        eventFor({
          turnId,
          selectedTool: FAMILY_TOOLS[call % FAMILY_TOOLS.length] ?? "git_status",
        }),
      );
    }
  }
  return events;
}

function passingSample(): ShadowContainmentEvent[] {
  return sample(100, FAMILY_TOOLS.length);
}

function qualify(
  events: readonly ShadowContainmentEvent[],
  offline = true,
): ShadowTrafficQualification {
  return qualifyShadowTraffic({
    events,
    offlineRequiredRecallPassed: offline,
    offlineNdcgPassed: offline,
  });
}

function render(events: readonly ShadowContainmentEvent[], offline = true) {
  const qualification = qualify(events, offline);
  const report = buildShadowQualificationReport(qualification, events);
  return { qualification, report, text: formatShadowQualificationReport(report) };
}

function expectStableReport(text: string, qualification: ShadowTrafficQualification) {
  const expected = qualification.passed ? "QUALIFICATION: PASS" : "QUALIFICATION: BLOCKED";
  expect(text.startsWith(`${expected}\n`)).toBe(true);
  expect(text.split("\n")[1]).toBe("");
  expect(text.split("\n").filter((line) => line.startsWith("QUALIFICATION:"))).toEqual([expected]);
  expect(text).toContain("INFO  active filtering = OFF");
  expect(text).not.toContain("active filtering = ON");
  expect(text).not.toMatch(
    /^(PASS|FAIL) {2}(Ckept|Ctrial|T8|Dmax|active filtering|discovery controls blocked|known-domain calls|known domains)\b/m,
  );
  expect(text).not.toMatch(/^WARN(?! {2}Dmax = )/m);
}

function expectMissesMatchSummary(
  report: ShadowQualificationReport,
  qualification: ShadowTrafficQualification,
) {
  let calls = 0;
  let outside = 0;
  let required = 0;
  for (const row of report.misses) {
    calls += row.calls;
    outside += row.outsideTop8;
    required += row.required;
    expect(row.inKept).toBeLessThanOrEqual(row.outsideTop8);
    expect(row.inTrial).toBeLessThanOrEqual(row.outsideTop8);
    expect(row.required).toBeLessThanOrEqual(row.calls);
  }
  expect(calls).toBe(qualification.executedCalls);
  expect(outside).toBe(qualification.executedCalls - qualification.executedInTop8);
  expect(required).toBe(qualification.requiredExecutedCalls);
}

describe("shadow qualification report", () => {
  it("shows each blocked clause and does not grade kept coverage as a pass", () => {
    const events = [
      eventFor({
        turnId: "run:1",
        selectedTool: "git_status",
        role: "unknown",
        roleSource: "unknown",
      }),
      eventFor({
        turnId: "run:1",
        selectedTool: "git_status",
        role: "unknown",
        roleSource: "unknown",
      }),
    ];
    const { qualification, report, text } = render(events);
    const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;

    expect(qualification.passed).toBe(false);
    expect(qualification.executedContainmentPassed).toBe(true);
    expect(qualification.keptContainment).toBe(1);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(text.split(/\r?\n/)).toEqual([
      "QUALIFICATION: BLOCKED",
      "",
      "PASS  event version = v1F-2",
      "PASS  offline required recall",
      "PASS  offline NDCG",
      "PASS  C8 = 100.0% (2/2)",
      "INFO  C8 anytime 95% upper = 100.0% (2/2) gate 98.0% below gate no (2/50 calls)",
      "PASS  simulated required blocks = 0",
      "PASS  simulated task-critical blocks = 0",
      "PASS  authorization regressions = 0",
      "",
      `FAIL  executed calls = 2 / ${thresholds.minExecutedCalls}`,
      `FAIL  multi-tool turns = 1 / ${thresholds.minMultiToolTurns}`,
      "FAIL  provenance-backed required calls = insufficient",
      `FAIL  domains = 0 / ${thresholds.minRepresentedFamilies}`,
      "WARN  Dmax = 100.0% (2/2)",
      "",
      "INFO  active filtering = OFF",
      "INFO  Ckept = 100.0% (2/2)",
      "INFO  Ctrial = 100.0% (2/2)",
      "INFO  T8 = n/a",
      "INFO  discovery controls blocked = 0",
      "INFO  known-domain calls = 2",
      "INFO  known domains = 1 (git)",
      "",
      "Counterfactual misses",
      "| Tool | Calls | Outside top 8 | In kept | In trial | Required | Failure impact |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
      "| git_status | 2 | 0 | 0 | 0 | 0 | none |",
    ]);
  });

  it("passes homogeneous evidence and warns when one domain holds the soft limit", () => {
    const balanced = render(passingSample());
    expect(balanced.qualification.passed).toBe(true);
    expectStableReport(balanced.text, balanced.qualification);
    expectMissesMatchSummary(balanced.report, balanced.qualification);
    expect(balanced.text).toContain("PASS  event version = v1F-2");
    expect(balanced.text).toContain(
      "INFO  C8 anytime 95% upper = 100.0% (500/500) gate 98.0% below gate no (500/50 calls)",
    );
    expect(balanced.text).toContain(
      "INFO  Creq8 anytime 95% upper = 100.0% (500/500) gate 99.0% below gate no (500/20 calls)",
    );
    expect(balanced.text).toContain("PASS  C8 = 100.0% (500/500)");
    expect(balanced.text).toContain("PASS  Creq8 = 100.0% (500/500)");
    expect(balanced.text).toContain("PASS  executed calls = 500 / 500");
    expect(balanced.text).toContain("PASS  multi-tool turns = 100 / 100");
    expect(balanced.text).toContain("PASS  domains = 5 (git, filesystem, shell, coding, web)");
    expect(balanced.text).toContain("INFO  Dmax = 20.0% (100/500)");
    expect(balanced.text).toContain("INFO  T8 = 100.0% (100/100)");
    expect(balanced.text).not.toMatch(/^WARN/m);
    const outside = render(
      Array.from({ length: 50 }, (_, index) =>
        eventFor({
          turnId: `outside:${index + 1}`,
          selectedTool: "pytest",
          role: "unknown",
          roleSource: "unknown",
        }),
      ),
    );
    expect(outside.text).toContain(
      "INFO  C8 anytime 95% upper = 12.3% (0/50) gate 98.0% below gate yes (50/50 calls)",
    );
    expect(outside.text).not.toContain("Creq8 anytime 95% upper");
    const earlyOutside = render(
      Array.from({ length: 7 }, (_, index) =>
        eventFor({
          turnId: `early:${index + 1}`,
          selectedTool: "pytest",
          role: "unknown",
          roleSource: "unknown",
        }),
      ),
    );
    expect(earlyOutside.text).toContain(
      "INFO  C8 anytime 95% upper = 87.7% (0/7) gate 98.0% below gate yes (7/50 calls)",
    );

    expect(balanced.report.misses.map((row) => row.tool)).toEqual([
      "edit",
      "exec",
      "git_status",
      "read",
      "web_search",
    ]);

    const concentrated: ShadowContainmentEvent[] = [];
    const plan = [
      { tool: "git_status", turns: 70 },
      { tool: "read", turns: 10 },
      { tool: "exec", turns: 10 },
      { tool: "edit", turns: 10 },
    ] as const;
    let turn = 0;
    for (const entry of plan) {
      for (let count = 0; count < entry.turns; count += 1) {
        turn += 1;
        for (let call = 0; call < 5; call += 1) {
          concentrated.push(eventFor({ turnId: `run:${turn}`, selectedTool: entry.tool }));
        }
      }
    }
    const skewed = render(concentrated);
    expect(skewed.qualification.passed).toBe(true);
    expect(skewed.qualification.maxDomainShareWithinLimit).toBe(false);
    expectStableReport(skewed.text, skewed.qualification);
    expect(skewed.text).toContain("QUALIFICATION: PASS");
    expect(skewed.text).toContain("WARN  Dmax = 70.0% (350/500)");
    expect(skewed.text).toContain("PASS  domains = 4 (git, filesystem, shell, coding)");
    expect(skewed.text).toContain("| git_status | 350 | 0 | 0 | 0 | 350 | none |");
  });

  it("stays blocked when top-8 containment fails even if the kept surface is complete", () => {
    const events = passingSample();
    let replaced = 0;
    for (let index = 0; index < events.length && replaced < 11; index += 1) {
      const current = events[index];
      if (current?.selectedTool !== "web_search") {
        continue;
      }
      events[index] = eventFor({
        turnId: current.turnId,
        selectedTool: "browser",
        role: "optional",
        roleSource: "unknown",
        policyPreserved: ["browser"],
      });
      replaced += 1;
    }

    const { qualification, report, text } = render(events);
    expect(replaced).toBe(11);
    expect(qualification.passed).toBe(false);
    expect(qualification.executedContainmentPassed).toBe(false);
    expect(qualification.keptContainment).toBe(1);
    expect(qualification.trialContainment).toBe(1);
    expect(qualification.requiredContainmentPassed).toBe(true);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(text.split("\n").filter((line) => line.startsWith("FAIL"))).toEqual([
      "FAIL  C8 = 97.8% (489/500)",
    ]);
    expect(text).toContain("INFO  Ckept = 100.0% (500/500)");
    expect(text).toContain("INFO  Ctrial = 100.0% (500/500)");
    expect(text).toContain("PASS  Creq8 = 100.0% (489/489)");
    expect(text).toContain("| browser | 11 | 11 | 11 | 11 | 0 | none |");
  });

  it("classifies preserved tools, trial recovery, and misses outside the trial surface", () => {
    const events: ShadowContainmentEvent[] = [];
    for (let index = 0; index < 3; index += 1) {
      events.push(
        eventFor({
          turnId: `search:${index}`,
          selectedTool: "tool_search",
          role: "unknown",
          roleSource: "unknown",
        }),
      );
    }
    for (let index = 0; index < 2; index += 1) {
      events.push(
        eventFor({
          turnId: "run:process",
          selectedTool: "process",
          role: "optional",
          roleSource: "unknown",
          runtimeMandatory: ["process"],
          authorizedNames: [...AUTHORIZED, "process"],
        }),
      );
    }
    const browser = eventFor({
      turnId: "run:browser",
      selectedTool: "browser",
      role: "optional",
      roleSource: "unknown",
    });
    events.push(browser);
    for (let index = 0; index < 4; index += 1) {
      events.push(
        eventFor({
          turnId: `git:${index}`,
          selectedTool: "git_status",
          role: "required",
          roleSource: "benchmark",
        }),
      );
    }
    for (let index = 0; index < 2; index += 1) {
      events.push(
        eventFor({
          turnId: `git-unknown:${index}`,
          selectedTool: "git_status",
          role: "required",
          roleSource: "unknown",
        }),
      );
    }
    events.push(
      eventFor({
        turnId: "run:email",
        selectedTool: "email",
        executionStarted: false,
        role: "required",
        roleSource: "benchmark",
      }),
    );

    const process = events.find((event) => event.selectedTool === "process");
    const { qualification, report, text } = render(events);
    expect(process?.missSeverity).toBe("top-8 miss, fallback/tool-search would recover");
    expect(browser.missSeverity).toBe("top-8 miss, fallback/tool-search would recover");
    expect(qualification.discoveryControlsBlocked).toBe(3);
    expect(qualification.requiredExecutedCalls).toBe(4);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(report.misses).toEqual([
      {
        tool: "tool_search",
        calls: 3,
        outsideTop8: 3,
        inKept: 0,
        inTrial: 3,
        required: 0,
        failureImpact: "recoverable",
      },
      {
        tool: "process",
        calls: 2,
        outsideTop8: 2,
        inKept: 2,
        inTrial: 2,
        required: 0,
        failureImpact: "none",
      },
      {
        tool: "browser",
        calls: 1,
        outsideTop8: 1,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "succeeded",
      },
      {
        tool: "git_status",
        calls: 6,
        outsideTop8: 0,
        inKept: 0,
        inTrial: 0,
        required: 4,
        failureImpact: "none",
      },
    ]);
    expect(text).toContain("PASS  Creq8 = 100.0% (4/4)");
    expect(text).toContain("INFO  discovery controls blocked = 3");
    expect(text).not.toContain("| email |");
  });

  it("does not treat an unknown role source as provenance-backed evidence", () => {
    const events = [
      eventFor({
        turnId: "run:1",
        selectedTool: "git_status",
        role: "required",
        roleSource: "unknown",
      }),
      eventFor({
        turnId: "run:1",
        selectedTool: "read",
        role: "required",
        roleSource: "unknown",
      }),
    ];
    const { qualification, report, text } = render(events);
    expect(qualification.requiredExecutedCalls).toBe(0);
    expect(qualification.requiredContainment).toBeNull();
    expect(qualification.requiredContainmentPassed).toBe(false);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(text).toContain("FAIL  provenance-backed required calls = insufficient");
    expect(text).not.toContain("Creq8");
    expect(report.misses).toEqual([
      {
        tool: "git_status",
        calls: 1,
        outsideTop8: 0,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "none",
      },
      {
        tool: "read",
        calls: 1,
        outsideTop8: 0,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "none",
      },
    ]);
  });

  it("omits the miss table when nothing executed", () => {
    const events = [
      eventFor({
        turnId: "run:1",
        selectedTool: "git_status",
        executionStarted: false,
        role: "required",
        roleSource: "benchmark",
      }),
    ];
    const { qualification, report, text } = render(events);
    expect(qualification.executedCalls).toBe(0);
    expect(qualification.requiredExecutedCalls).toBe(0);
    expect(report.misses).toEqual([]);
    expectStableReport(text, qualification);
    expect(text).not.toContain("| Tool |");
    expect(text).not.toContain("Counterfactual misses");
    expect(text).toContain("FAIL  provenance-backed required calls = insufficient");
    expect(text).toContain("FAIL  authorization regressions = 0");
    expect(text).not.toContain("PASS  authorization regressions = 0");
    expect(text).toContain("INFO  Dmax = n/a");
    expect(text).toContain("INFO  known domains = 0");
  });

  it("reports a provenance-backed required block as task-critical", () => {
    const event = eventFor({
      turnId: "run:1",
      selectedTool: "pytest",
      role: "required",
      roleSource: "workflow-contract",
    });
    const { qualification, report, text } = render([event]);
    expect(event.taskCriticalBlock).toBe(true);
    expect(event.wouldBlockRequiredTool).toBe(true);
    expect(event.inKept).toBe(false);
    expect(event.inTrialSurface).toBe(false);
    expect(event.missSeverity).toBe("top-8 miss, fallback/tool-search would recover");
    expect(qualification.simulatedRequiredBlocks).toBe(1);
    expect(qualification.simulatedTaskCriticalBlocks).toBe(1);
    expect(qualification.passed).toBe(false);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(text).toContain("FAIL  simulated required blocks = 1");
    expect(text).toContain("FAIL  simulated task-critical blocks = 1");
    expect(text).toContain("FAIL  Creq8 = 0.0% (0/1)");
    expect(report.misses).toEqual([
      {
        tool: "pytest",
        calls: 1,
        outsideTop8: 1,
        inKept: 0,
        inTrial: 0,
        required: 1,
        failureImpact: "task-critical",
      },
    ]);
  });

  it("does not treat shadow mode as a simulated pass", () => {
    const event = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      mode: "shadow",
      role: "optional",
      roleSource: "unknown",
    });
    const { qualification, report, text } = render([event]);
    expect(event.inKept).toBeUndefined();
    expect(event.inTrialSurface).toBeUndefined();
    expect(event.missSeverity).toBe("top-8 miss, fallback/tool-search would recover");
    expect(qualification.simulatedFilterEvaluable).toBe(false);
    expect(qualification.passed).toBe(false);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(text).toContain("FAIL  simulated required blocks = unevaluable");
    expect(text).toContain("FAIL  simulated task-critical blocks = unevaluable");
    expect(text).not.toContain("PASS  simulated required blocks = 0");
    expect(text).not.toContain("PASS  simulated task-critical blocks = 0");
    expect(text).toContain("INFO  Ckept = n/a");
    expect(text).toContain("INFO  Ctrial = n/a");
    expect(text).toContain("PASS  authorization regressions = 0");
    expect(report.misses).toEqual([
      {
        tool: "browser",
        calls: 1,
        outsideTop8: 1,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "unknown",
      },
    ]);
  });

  it("fails mixed samples and unrecognized policies without calling them current", () => {
    const mixedEvents = [
      eventFor({ turnId: "run:1", selectedTool: "git_status" }),
      eventFor({ turnId: "run:2", selectedTool: "read" }),
    ];
    const first = mixedEvents[0];
    if (!first) {
      throw new Error("missing sample event");
    }
    mixedEvents[0] = { ...first, schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION + 1 };
    const mixed = render(mixedEvents);
    expect(mixed.qualification.sampleCompatible).toBe(false);
    expect(mixed.qualification.passed).toBe(false);
    expectStableReport(mixed.text, mixed.qualification);
    expect(mixed.text).toContain("FAIL  sample versions are mixed");
    expect(mixed.text).not.toContain("qualification policy is not");
    expect(mixed.text).not.toContain("PASS  event version");

    const foreignEvents = [
      eventFor({ turnId: "run:1", selectedTool: "git_status" }),
      eventFor({ turnId: "run:2", selectedTool: "read" }),
    ];
    for (const event of foreignEvents) {
      event.qualificationPolicyVersion = "v1D-0";
    }
    const foreign = render(foreignEvents);
    expect(foreign.qualification.sampleCompatible).toBe(true);
    expect(foreign.qualification.recognizedPolicy).toBe(false);
    expect(foreign.qualification.executedContainmentPassed).toBe(true);
    expect(foreign.qualification.passed).toBe(false);
    expectStableReport(foreign.text, foreign.qualification);
    expect(foreign.text).toContain("FAIL  qualification policy is not v1F-2 (1/v1C/v1D-0)");
    expect(foreign.text).not.toContain("anytime 95% upper");
    expect(foreign.text).toContain("PASS  C8 = 100.0% (2/2)");
    expect(foreign.text).not.toContain("PASS  event version");

    const historical = sample(1, 1).map((event) =>
      Object.assign({}, event, { qualificationPolicyVersion: "v1D-1" }),
    );
    const preserved = render(historical);
    expect(preserved.qualification.recognizedPolicy).toBe(true);
    expect(preserved.text).toContain("PASS  event version = v1D-1");
    expect(preserved.text).not.toContain("anytime 95% upper");
  });

  it("keeps the worst outside-top-8 outcome for a tool", () => {
    const degraded = eventFor({
      turnId: "run:fetch",
      selectedTool: "web_fetch",
      role: "optional",
      roleSource: "unknown",
      success: false,
      degraded: true,
      authorizedNames: [...AUTHORIZED, "web_fetch"],
    });
    const events = [
      eventFor({
        turnId: "run:ok",
        selectedTool: "browser",
        role: "optional",
        roleSource: "unknown",
        success: true,
      }),
      eventFor({
        turnId: "run:bad",
        selectedTool: "browser",
        role: "optional",
        roleSource: "unknown",
        success: false,
      }),
      degraded,
    ];
    const { qualification, report, text } = render(events);
    expect(degraded.missSeverity).toBe("top-8 miss, task degraded");
    expect(degraded.success).toBe(false);
    expectStableReport(text, qualification);
    expectMissesMatchSummary(report, qualification);
    expect(report.misses).toEqual([
      {
        tool: "browser",
        calls: 2,
        outsideTop8: 2,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "failed",
      },
      {
        tool: "web_fetch",
        calls: 1,
        outsideTop8: 1,
        inKept: 0,
        inTrial: 0,
        required: 0,
        failureImpact: "degraded",
      },
    ]);
  });

  it("lets the containment boolean, not the rounded percent, grade C8", () => {
    const events = [eventFor({ turnId: "run:1", selectedTool: "git_status", role: "unknown" })];
    const qualification = qualify(events);
    const displayed = {
      ...qualification,
      passed: false,
      executedCalls: 10000,
      executedInTop8: 9795,
      executedContainment: 9795 / 10000,
    } satisfies ShadowTrafficQualification;
    const failing = formatShadowQualificationReport(
      buildShadowQualificationReport({ ...displayed, executedContainmentPassed: false }, events),
    );
    const grading = formatShadowQualificationReport(
      buildShadowQualificationReport({ ...displayed, executedContainmentPassed: true }, events),
    );
    expect(failing).toContain("QUALIFICATION: BLOCKED");
    expect(failing).toContain("FAIL  C8 = 98.0% (9795/10000)");
    expect(grading).toContain("QUALIFICATION: BLOCKED");
    expect(grading).toContain("PASS  C8 = 98.0% (9795/10000)");
    expect(renderShadowQualificationReport(qualification, events)).toContain(
      "QUALIFICATION: BLOCKED",
    );
  });
});
