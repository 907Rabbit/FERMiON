/**
 * Frozen early-failure identity for qualification policy v1F-2.
 * Changing any field is a new policy version. A resumed v1F-2 batch must
 * carry this same identity.
 *
 * Each gate is its own 95% anytime-valid sequence. An erroneous early stop
 * on either gate therefore has union bound 0.10. That 90% family-wise
 * guarantee is the locked choice. A joint 5% budget would set both alphas
 * to 0.025 and would not be v1F-2.
 */
export const V1F2_EARLY_FAILURE_IDENTITY = {
  method: "predictable-plugin-empirical-bernstein",
  alphaC8: 0.05,
  alphaCreq8: 0.05,
  familyWiseUnionBound: 0.1,
  lambdaCap: 0.5,
  runningIntersection: true,
  c8Floor: 50,
  creq8Floor: 20,
  c8Gate: 0.98,
  creq8Gate: 0.99,
} as const;

export type V1F2EarlyFailureIdentity = typeof V1F2_EARLY_FAILURE_IDENTITY;

/** Early C8 failure is ineligible before this many executed calls. */
export const MIN_C8_CALLS = V1F2_EARLY_FAILURE_IDENTITY.c8Floor;

/** Early Creq8 failure is ineligible before this many provenance-backed required calls. */
export const MIN_CREQ8_CALLS = V1F2_EARLY_FAILURE_IDENTITY.creq8Floor;
