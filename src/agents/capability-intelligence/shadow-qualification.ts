import {
  ACTIVE_FILTERING_ENABLED,
  SHADOW_CONTAINMENT_SCHEMA_VERSION,
  SHADOW_RANKER_VERSION,
  SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS,
  isRecognizedQualificationPolicy,
  summarizeShadowTraffic,
  type ShadowContainmentEvent,
  type ShadowSampleVersion,
  type ShadowTrafficQualification,
  type ShadowTrafficQualificationInput,
  type ShadowTrafficStratum,
} from "./shadow-traffic.js";

function ratioAtLeast(numerator: number, denominator: number, threshold: number): boolean {
  if (denominator <= 0) {
    return false;
  }
  const scaledThreshold = Math.round(threshold * 1000);
  return numerator * 1000 >= denominator * scaledThreshold;
}

function versionKey(version: ShadowSampleVersion): string {
  return (
    version.schemaVersion +
    "\0" +
    version.rankerVersion +
    "\0" +
    version.qualificationPolicyVersion
  );
}

function sampleStrata(events: readonly ShadowContainmentEvent[]): ShadowTrafficStratum[] {
  const groups = new Map<string, ShadowContainmentEvent[]>();
  const versions = new Map<string, ShadowSampleVersion>();
  for (const event of events) {
    const version = {
      schemaVersion: event.schemaVersion,
      rankerVersion: event.rankerVersion,
      qualificationPolicyVersion: event.qualificationPolicyVersion,
    };
    const key = versionKey(version);
    const existing = groups.get(key);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(key, [event]);
      versions.set(key, version);
    }
  }
  const strata: ShadowTrafficStratum[] = [];
  for (const [key, group] of groups) {
    const version = versions.get(key);
    if (!version) {
      continue;
    }
    strata.push({ version, summary: summarizeShadowTraffic(group) });
  }
  return strata;
}

/**
 * Trial gate for a future filtered mode. A pass still requires the full
 * sample. An anytime-valid bound cannot set `passed`. v1F-2 failure
 * sufficiency lives in the collector decision and does not change this flag.
 * Kept-surface and trial containment are reported and do not relax top-8
 * containment. Passing leaves filtering off. Unknown role sources are not
 * required-tool evidence.
 */
export function qualifyShadowTraffic(
  input: ShadowTrafficQualificationInput,
): ShadowTrafficQualification {
  const summary = summarizeShadowTraffic(input.events);
  const strata = sampleStrata(input.events);
  const sampleCompatible = strata.length <= 1;
  const onlyVersion = strata[0]?.version;
  const recognizedPolicy =
    sampleCompatible &&
    onlyVersion?.schemaVersion === SHADOW_CONTAINMENT_SCHEMA_VERSION &&
    onlyVersion?.rankerVersion === SHADOW_RANKER_VERSION &&
    isRecognizedQualificationPolicy(onlyVersion?.qualificationPolicyVersion ?? "");
  const thresholds = SHADOW_TRAFFIC_QUALIFICATION_THRESHOLDS;
  const executedContainmentPassed = ratioAtLeast(
    summary.executedInTop8,
    summary.executedCalls,
    thresholds.executedContainment,
  );
  const requiredContainmentPassed = ratioAtLeast(
    summary.requiredInTop8,
    summary.requiredExecutedCalls,
    thresholds.requiredContainment,
  );
  const executedCallsPassed = summary.executedCalls >= thresholds.minExecutedCalls;
  const multiToolTurnsPassed = summary.multiToolTurns >= thresholds.minMultiToolTurns;
  const familyRepresentationPassed =
    summary.representedFamilies.length >= thresholds.minRepresentedFamilies;
  const simulatedClausesEvaluable = summary.simulatedFilterEvaluable;
  const simulatedRequiredBlocksPassed =
    simulatedClausesEvaluable && summary.simulatedRequiredBlocks === 0;
  const simulatedTaskCriticalBlocksPassed =
    simulatedClausesEvaluable && summary.simulatedTaskCriticalBlocks === 0;
  const authorizationRegressionsPassed =
    summary.authorizationUnevaluableEvents === 0 &&
    summary.authorizationRegressions === 0 &&
    summary.executedCalls > 0;
  const passed =
    input.offlineRequiredRecallPassed &&
    input.offlineNdcgPassed &&
    executedContainmentPassed &&
    requiredContainmentPassed &&
    simulatedRequiredBlocksPassed &&
    simulatedTaskCriticalBlocksPassed &&
    authorizationRegressionsPassed &&
    executedCallsPassed &&
    multiToolTurnsPassed &&
    familyRepresentationPassed &&
    sampleCompatible &&
    recognizedPolicy;
  return {
    ...summary,
    passed,
    activeFilteringEnabled: ACTIVE_FILTERING_ENABLED,
    offlineRequiredRecallPassed: input.offlineRequiredRecallPassed,
    offlineNdcgPassed: input.offlineNdcgPassed,
    executedCallsPassed,
    executedContainmentPassed,
    requiredContainmentPassed,
    multiToolTurnsPassed,
    familyRepresentationPassed,
    simulatedRequiredBlocksPassed,
    simulatedTaskCriticalBlocksPassed,
    authorizationRegressionsPassed,
    sampleCompatible,
    recognizedPolicy,
    strata,
  };
}
