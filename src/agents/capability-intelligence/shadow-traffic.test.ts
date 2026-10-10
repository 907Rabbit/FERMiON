import { describe, expect, it } from "vitest";
import {
  ACTIVE_FILTERING_ENABLED,
  createShadowContainmentEvent,
  DISCOVERY_CONTROL_TOOLS,
  exposeAuthorizedTools,
  FILTERED_TRIAL_RECOVERY_RULES,
  FILTERED_TRIAL_ROLLBACK_TRIGGERS,
  shadowContainmentEventData,
  SHADOW_CONTAINMENT_SCHEMA_VERSION,
  SHADOW_MISS_SEVERITIES,
  SHADOW_QUALIFICATION_POLICY_VERSION,
  SHADOW_RANKER_VERSION,
  SHADOW_TRAFFIC_MODES,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  shadowRateSequences,
  summarizeShadowTraffic,
  type ShadowContainmentEvent,
  type ShadowContainmentInput,
  type ToolRoleSource,
} from "./shadow-traffic.js";
import { qualifyShadowTraffic } from "./shadow-qualification.js";

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

function sample(
  turns: number,
  callsPerTurn: number,
  role: ShadowContainmentInput["role"] = "required",
  roleSource: ToolRoleSource = "benchmark",
) {
  const events: ShadowContainmentEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const turnId = `run:${turn + 1}`;
    for (let call = 0; call < callsPerTurn; call += 1) {
      events.push(
        eventFor({
          turnId,
          role,
          roleSource,
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

function qualify(events: readonly ShadowContainmentEvent[], offline = true) {
  return qualifyShadowTraffic({
    events,
    offlineRequiredRecallPassed: offline,
    offlineNdcgPassed: offline,
  });
}

describe("shadow traffic exposure", () => {
  it("returns the same authorized tools for every mode, including active", () => {
    const tools = [{ name: "web_search" }, { name: "read_file" }];
    for (const mode of SHADOW_TRAFFIC_MODES) {
      expect(exposeAuthorizedTools(tools, mode)).toBe(tools);
    }
    expect(ACTIVE_FILTERING_ENABLED).toBe(false);
  });

  it("keeps the later trial rules out of the simulated kept set", () => {
    expect(FILTERED_TRIAL_RECOVERY_RULES).toEqual([
      "ranking confidence low → full authorized surface",
      "empty ranking → full authorized surface",
      "required runtime condition detected → preserve required tool",
      "tool-search available → retain discovery controls",
    ]);
    expect(FILTERED_TRIAL_ROLLBACK_TRIGGERS).toEqual([
      "required tool omitted",
      "task failure attributable to filtering",
      "authorization/policy mismatch",
      "unexpected tool-search dead end",
      "containment falls below threshold",
    ]);
    const blocked = eventFor({
      turnId: "run:1",
      selectedTool: "pytest",
      role: "required",
      rankedTop8: [],
    });
    expect(blocked.wouldBlockRequiredTool).toBe(true);
    expect(blocked.taskCriticalBlock).toBe(true);
    expect(blocked.inTop8).toBe(false);
  });
});

describe("shadow containment events", () => {
  it("does not record an event while the mode is off", () => {
    expect(
      createShadowContainmentEvent({
        mode: "off",
        runId: "run",
        turnId: "run:1",
        authorizedCount: 1,
        rankedTop8: ["read"],
        selectedTool: "read",
        executionStarted: true,
        success: true,
      }),
    ).toBeUndefined();
  });

  it("stores names only and omits prompt text from the trajectory payload", () => {
    const event = eventFor({ turnId: "run:1", selectedTool: "web_search" });
    const data = shadowContainmentEventData(event);
    expect(data).not.toHaveProperty("query");
    expect(data).not.toHaveProperty("prompt");
    expect(data).not.toHaveProperty("arguments");
    expect(data).not.toHaveProperty("description");
    expect(data.rankedTop8).toEqual(TOP8);
    expect(data).toMatchObject({
      schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION,
      rankerVersion: SHADOW_RANKER_VERSION,
      qualificationPolicyVersion: SHADOW_QUALIFICATION_POLICY_VERSION,
      roleSource: "benchmark",
      inKept: true,
      inTrialSurface: true,
    });
    expect(JSON.stringify(data)).not.toContain("search the web");
  });

  it("does not keep a ninth ranked name or a discovery control outside the proposed surface", () => {
    const ranked = [...TOP8, "pytest"];
    const ninth = eventFor({ turnId: "run:1", selectedTool: "pytest", rankedTop8: ranked });
    expect(ninth.rankedTop8).toEqual(TOP8);
    expect(ninth.inTop8).toBe(false);
    expect(ninth.wouldBlockSelectedTool).toBe(true);

    const discovery = eventFor({
      turnId: "run:1",
      selectedTool: "tool_search",
      role: "unknown",
      success: true,
    });
    expect(discovery.inTop8).toBe(false);
    expect(discovery.wouldBlockExecutedTool).toBe(true);
    expect(discovery.wouldBlockRequiredTool).toBe(false);
    expect(discovery.taskCriticalBlock).toBe(false);
    expect(discovery.missSeverity).toBe("top-8 miss, task still succeeds");
    expect(discovery.family).toBe("tooling");
  });

  it("preserves runtime-mandatory tools without counting them as top-8 hits", () => {
    const event = eventFor({
      turnId: "run:1",
      selectedTool: "pytest",
      role: "required",
      runtimeMandatory: ["pytest"],
    });
    expect(event.inTop8).toBe(false);
    expect(event.wouldBlockSelectedTool).toBe(false);
    expect(event.wouldBlockExecutedTool).toBe(false);
    expect(event.wouldBlockRequiredTool).toBe(false);
    expect(event.taskCriticalBlock).toBe(false);
  });

  it("separates miss severity without hiding an observed failure", () => {
    const recovered = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      role: "optional",
      success: true,
    });
    const failed = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      role: "required",
      success: false,
    });
    const degraded = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      role: "optional",
      success: false,
      degraded: true,
    });
    const succeededWithoutDiscovery = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      role: "optional",
      success: true,
      authorizedNames: TOP8,
    });
    const notExecuted = eventFor({
      turnId: "run:1",
      selectedTool: "browser",
      executionStarted: false,
      success: false,
    });

    expect(recovered.missSeverity).toBe("top-8 miss, fallback/tool-search would recover");
    expect(failed.missSeverity).toBe("top-8 miss, task failed");
    expect(degraded.missSeverity).toBe("top-8 miss, task degraded");
    expect(succeededWithoutDiscovery.missSeverity).toBe("top-8 miss, task still succeeds");
    expect(notExecuted.missSeverity).toBeUndefined();
    expect(SHADOW_MISS_SEVERITIES).toHaveLength(4);
  });
});

describe("shadow traffic metrics", () => {
  it("does not let per-tool containment hide a multi-tool required miss", () => {
    const events = [
      eventFor({ turnId: "turn-a", selectedTool: "git_status" }),
      eventFor({ turnId: "turn-a", selectedTool: "pytest", role: "required" }),
      eventFor({ turnId: "turn-b", selectedTool: "read" }),
      eventFor({ turnId: "turn-c", selectedTool: "exec", role: "unknown" }),
      eventFor({ turnId: "turn-d", selectedTool: "web_search", success: false }),
      eventFor({ turnId: "turn-e", selectedTool: "edit" }),
      eventFor({ turnId: "turn-e", selectedTool: "browser", role: "optional" }),
      eventFor({
        turnId: "turn-f",
        selectedTool: "message",
        degraded: true,
        rankedTop8: ["git_status"],
      }),
    ];
    const summary = summarizeShadowTraffic(events);

    expect(summary.executedCalls).toBe(8);
    expect(summary.executedInTop8).toBe(5);
    expect(summary.requiredExecutedCalls).toBe(6);
    expect(summary.requiredInTop8).toBe(4);
    expect(summary.turnContainment).toBeCloseTo(2 / 3);
    expect(summary.successfulEvaluatedTurns).toBe(3);
    expect(summary.unevaluatedSuccessfulTurns).toBe(1);
    expect(summary.multiToolTurns).toBe(2);
    expect(summary.missSeverity["top-8 miss, task degraded"]).toBe(1);
    expect(summary.missSeverity["top-8 miss, fallback/tool-search would recover"]).toBe(2);
  });

  it("separates ranker purity from kept-surface and trial-surface safety", () => {
    const summary = summarizeShadowTraffic([
      eventFor({ turnId: "turn", selectedTool: "git_status" }),
      eventFor({
        turnId: "turn",
        selectedTool: "pytest",
        roleSource: "runtime-invariant",
        runtimeMandatory: ["pytest"],
      }),
      eventFor({
        turnId: "turn",
        selectedTool: "tool_search",
        role: "unknown",
        roleSource: "unknown",
      }),
    ]);

    expect(summary.executedContainment).toBeCloseTo(1 / 3);
    expect(summary.keptContainment).toBeCloseTo(2 / 3);
    expect(summary.trialContainment).toBe(1);
    expect(summary.discoveryControlsBlocked).toBe(1);
    expect(summary.simulatedRequiredBlocks).toBe(0);
  });

  it("does not count an unproven required label toward required containment or blocks", () => {
    const summary = summarizeShadowTraffic([
      eventFor({ turnId: "turn", selectedTool: "git_status", roleSource: "workflow-contract" }),
      eventFor({ turnId: "turn", selectedTool: "pytest", role: "required", roleSource: "unknown" }),
    ]);

    expect(summary.executedContainment).toBe(0.5);
    expect(summary.requiredExecutedCalls).toBe(1);
    expect(summary.requiredContainment).toBe(1);
    expect(summary.turnContainment).toBe(1);
    expect(summary.simulatedRequiredBlocks).toBe(0);
    expect(summary.simulatedTaskCriticalBlocks).toBe(0);
    expect(summary.unevaluatedSuccessfulTurns).toBe(0);
  });

  it("builds rate sequences in event order from the same calls the summary counts", () => {
    const events = [
      eventFor({ turnId: "t1", selectedTool: "git_status" }),
      eventFor({ turnId: "t1", selectedTool: "pytest", executionStarted: false }),
      eventFor({ turnId: "t2", selectedTool: "pytest", role: "required", roleSource: "unknown" }),
      eventFor({ turnId: "t3", selectedTool: "read", role: "relevant", roleSource: "benchmark" }),
    ];
    const summary = summarizeShadowTraffic(events);
    const sequences = shadowRateSequences(events);
    expect(sequences.executed).toEqual([1, 0, 1]);
    expect(sequences.required).toEqual([1]);
    expect(sequences.executed.length).toBe(summary.executedCalls);
    expect(sequences.executed.reduce<number>((sum, value) => sum + value, 0)).toBe(
      summary.executedInTop8,
    );
    expect(sequences.required.length).toBe(summary.requiredExecutedCalls);
    expect(sequences.required.reduce<number>((sum, value) => sum + value, 0)).toBe(
      summary.requiredInTop8,
    );
  });

  it("does not treat a turn as successful when a top-8 miss was marked degraded", () => {
    const summary = summarizeShadowTraffic([
      eventFor({
        turnId: "turn-degraded",
        selectedTool: "browser",
        degraded: true,
        success: true,
      }),
    ]);
    expect(summary.successfulEvaluatedTurns).toBe(0);
    expect(summary.turnContainment).toBeNull();
  });
});

describe("shadow traffic qualification", () => {
  it("passes only when every clause holds and still leaves filtering off", () => {
    const qualification = qualify(passingSample());
    expect(qualification.passed).toBe(true);
    expect(qualification.activeFilteringEnabled).toBe(false);
    expect(qualification.executedCalls).toBe(500);
    expect(qualification.executedContainment).toBe(1);
    expect(qualification.requiredContainment).toBe(1);
    expect(qualification.requiredContainmentPerfect).toBe(true);
    expect(qualification.turnContainment).toBe(1);
    expect(qualification.multiToolTurns).toBe(100);
    expect(qualification.representedFamilies).toEqual([
      "git",
      "filesystem",
      "shell",
      "coding",
      "web",
    ]);
    expect(qualification.simulatedRequiredBlocks).toBe(0);
    expect(qualification.simulatedTaskCriticalBlocks).toBe(0);
    expect(qualification.authorizationRegressions).toBe(0);
    expect(qualification.discoveryControlsBlocked).toBe(0);
    expect(qualification.keptContainment).toBe(1);
    expect(qualification.trialContainment).toBe(1);
    expect(qualification.maxDomainShare).toBeCloseTo(0.2);
    expect(qualification.maxDomainShareWithinLimit).toBe(true);
    expect(qualification.sampleCompatible).toBe(true);
    expect(qualification.recognizedPolicy).toBe(true);
    expect(qualification.strata).toHaveLength(1);
  });

  it("does not pass from offline flags or from a small perfect sample", () => {
    expect(qualify(passingSample(), false).passed).toBe(false);
    expect(qualify(sample(4, 5)).passed).toBe(false);
    expect(qualify([]).executedContainment).toBeNull();
    expect(qualify([]).requiredContainmentPassed).toBe(false);
  });

  it("does not treat an unproven required label as a required sample", () => {
    const qualification = qualify(sample(100, 5, "required", "unknown"));
    expect(qualification.executedContainmentPassed).toBe(true);
    expect(qualification.requiredExecutedCalls).toBe(0);
    expect(qualification.requiredContainment).toBeNull();
    expect(qualification.requiredContainmentPassed).toBe(false);
    expect(qualification.passed).toBe(false);
  });

  it("does not treat an empty required-role sample as contained", () => {
    const qualification = qualify(sample(100, 5, "unknown"));
    expect(qualification.executedContainmentPassed).toBe(true);
    expect(qualification.requiredExecutedCalls).toBe(0);
    expect(qualification.requiredContainment).toBeNull();
    expect(qualification.requiredContainmentPassed).toBe(false);
    expect(qualification.requiredContainmentPerfect).toBe(false);
    expect(qualification.passed).toBe(false);
  });

  it("accepts exactly 99% required containment and rejects the call below it", () => {
    const atThreshold = passingSample();
    for (let index = 0; index < 5; index += 1) {
      const current = atThreshold[index];
      if (!current) {
        throw new Error("missing sample event");
      }
      atThreshold[index] = eventFor({
        turnId: current.turnId,
        selectedTool: "pytest",
        role: "required",
        policyPreserved: ["pytest"],
      });
    }
    const below = passingSample();
    for (let index = 0; index < 6; index += 1) {
      const current = below[index];
      if (!current) {
        throw new Error("missing sample event");
      }
      below[index] = eventFor({
        turnId: current.turnId,
        selectedTool: "pytest",
        role: "required",
        policyPreserved: ["pytest"],
      });
    }

    const thresholdQualification = qualify(atThreshold);
    expect(thresholdQualification.requiredContainment).toBeCloseTo(0.99);
    expect(thresholdQualification.requiredContainmentPassed).toBe(true);
    expect(thresholdQualification.requiredContainmentPerfect).toBe(false);
    expect(thresholdQualification.executedContainmentPassed).toBe(true);
    expect(thresholdQualification.simulatedRequiredBlocks).toBe(0);
    expect(thresholdQualification.passed).toBe(true);

    const belowQualification = qualify(below);
    expect(belowQualification.requiredContainmentPassed).toBe(false);
    expect(belowQualification.executedContainmentPassed).toBe(true);
    expect(belowQualification.passed).toBe(false);
  });

  it("rejects executed containment below 98% even when every required tool was kept", () => {
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
      });
      replaced += 1;
    }

    const qualification = qualify(events);
    expect(replaced).toBe(11);
    expect(qualification.executedContainmentPassed).toBe(false);
    expect(qualification.requiredContainmentPassed).toBe(true);
    expect(qualification.simulatedRequiredBlocks).toBe(0);
    expect(qualification.passed).toBe(false);
  });

  it("rejects one required block even when containment stays above the ratio gates", () => {
    const events = passingSample();
    events.push(
      eventFor({
        turnId: "run:extra",
        selectedTool: "pytest",
        role: "required",
        roleSource: "workflow-contract",
      }),
    );
    const qualification = qualify(events);
    expect(qualification.executedContainmentPassed).toBe(true);
    expect(qualification.requiredContainmentPassed).toBe(true);
    expect(qualification.simulatedRequiredBlocks).toBe(1);
    expect(qualification.simulatedTaskCriticalBlocks).toBe(1);
    expect(qualification.passed).toBe(false);
  });

  it("fails closed when authorization cannot be judged or the surface disagrees", () => {
    const unevaluable = passingSample();
    const first = unevaluable[0];
    if (!first) {
      throw new Error("missing sample event");
    }
    unevaluable[0] = eventFor({
      turnId: first.turnId,
      selectedTool: first.selectedTool,
      authorizedNames: undefined,
    });
    expect(qualify(unevaluable).authorizationRegressionsPassed).toBe(false);

    const unauthorized = passingSample();
    unauthorized.push(
      eventFor({ turnId: "run:unauthorized", selectedTool: "frobnicate", role: "unknown" }),
    );
    const unauthorizedQualification = qualify(unauthorized);
    expect(unauthorizedQualification.authorizationRegressions).toBe(1);
    expect(unauthorizedQualification.requiredContainmentPassed).toBe(true);
    expect(unauthorizedQualification.passed).toBe(false);

    const mismatch = passingSample();
    const preserved = mismatch[1];
    if (!preserved) {
      throw new Error("missing sample event");
    }
    mismatch[1] = eventFor({
      turnId: preserved.turnId,
      selectedTool: preserved.selectedTool,
      policyPreserved: ["not-authorized"],
    });
    expect(qualify(mismatch).authorizationRegressions).toBe(1);
    expect(qualify(mismatch).passed).toBe(false);
  });

  it("requires simulated-filter evidence, family coverage, and enough multi-tool turns", () => {
    const shadowEvents = passingSample().map((event) =>
      eventFor({
        turnId: event.turnId,
        selectedTool: event.selectedTool,
        mode: "shadow",
      }),
    );
    expect(qualify(shadowEvents).simulatedFilterEvaluable).toBe(false);
    expect(qualify(shadowEvents).passed).toBe(false);

    const oneFamily = sample(100, 5).map((event) =>
      eventFor({ turnId: event.turnId, selectedTool: "git_status" }),
    );
    const oneFamilyQualification = qualify(oneFamily);
    expect(oneFamilyQualification.representedFamilies).toEqual(["git"]);
    expect(oneFamilyQualification.familyRepresentationPassed).toBe(false);
    expect(oneFamilyQualification.passed).toBe(false);

    const fewMultiToolTurns = qualify(sample(50, 10));
    expect(fewMultiToolTurns.executedCalls).toBe(500);
    expect(fewMultiToolTurns.multiToolTurns).toBe(50);
    expect(fewMultiToolTurns.multiToolTurnsPassed).toBe(false);
    expect(fewMultiToolTurns.passed).toBe(false);
    expect(SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.minExecutedCalls).toBe(500);
    expect(SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.minMultiToolTurns).toBe(100);
    expect(SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS.maxKnownDomainShare).toBe(0.7);
  });

  it("does not let kept-surface coverage satisfy the top-8 gate", () => {
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
        policyPreserved: ["browser"],
      });
      replaced += 1;
    }

    const qualification = qualify(events);
    expect(qualification.executedContainmentPassed).toBe(false);
    expect(qualification.keptContainment).toBe(1);
    expect(qualification.trialContainment).toBe(1);
    expect(qualification.requiredContainmentPassed).toBe(true);
    expect(qualification.simulatedRequiredBlocks).toBe(0);
    expect(qualification.passed).toBe(false);
  });

  it("reports domain concentration without making 70% a hard gate", () => {
    const events: ShadowContainmentEvent[] = [];
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
          events.push(eventFor({ turnId: `run:${turn}`, selectedTool: entry.tool }));
        }
      }
    }

    const qualification = qualify(events);
    expect(qualification.executedCalls).toBe(500);
    expect(qualification.multiToolTurns).toBe(100);
    expect(qualification.representedFamilies).toEqual(["git", "filesystem", "shell", "coding"]);
    expect(qualification.maxDomainShare).toBeCloseTo(0.7);
    expect(qualification.maxDomainShareWithinLimit).toBe(false);
    expect(qualification.passed).toBe(true);
  });

  it("rejects mixed or unrecognized event versions", () => {
    const mixed = passingSample();
    const first = mixed[0];
    if (!first) {
      throw new Error("missing sample event");
    }
    mixed[0] = { ...first, schemaVersion: SHADOW_CONTAINMENT_SCHEMA_VERSION + 1 };
    const mixedQualification = qualify(mixed);
    expect(mixedQualification.sampleCompatible).toBe(false);
    expect(mixedQualification.recognizedPolicy).toBe(false);
    expect(mixedQualification.strata).toHaveLength(2);
    expect(mixedQualification.passed).toBe(false);

    const foreign = passingSample();
    for (const event of foreign) {
      event.qualificationPolicyVersion = "v1D-0";
    }
    const foreignQualification = qualify(foreign);
    expect(foreignQualification.sampleCompatible).toBe(true);
    expect(foreignQualification.recognizedPolicy).toBe(false);
    expect(foreignQualification.passed).toBe(false);
    expect(foreignQualification.executedContainmentPassed).toBe(true);
  });
});
