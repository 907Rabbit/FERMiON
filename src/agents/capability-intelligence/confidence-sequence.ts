/**
 * One-sided anytime-valid upper bound for a Bernoulli rate.
 *
 * Predictable plug-in empirical Bernstein confidence sequence
 * (Waudby-Smith and Ramdas, Theorem 2). The two-sided theorem uses
 * log(2/α) because each side spends α/2. This upper bound spends α on
 * the upper side only, so both the radius and the recommended lambda
 * plug-in use log(1/α). Any predictable lambda in (0, 1) would stay
 * valid; the plug-in is the one-sided form of their equation (15)
 * with truncation c = 1/2.
 *
 * The value is the running minimum of the upper endpoints, intersected
 * with [0, 1]. It depends on the order of observations, not only on
 * the success count. P(for every n, p ≤ U_n) ≥ 1 - α when U_n is this
 * value. Callers that compare it with a gate after every new
 * observation keep that guarantee. A fixed-sample Clopper-Pearson
 * bound does not.
 */

export const ANYTIME_UPPER_ALPHA = 0.05;
/** Truncation c in the lambda schedule. Any value in (0, 1) is valid. */
export const ANYTIME_LAMBDA_CAP = 0.5;

/**
 * Running-minimum one-sided upper endpoint. Null when the sequence is
 * empty, alpha is outside (0, 1), or any observation is outside [0, 1].
 */
export function oneSidedAnytimeUpperBound(
  observations: readonly number[],
  alpha = ANYTIME_UPPER_ALPHA,
): number | null {
  if (!(alpha > 0 && alpha < 1) || observations.length === 0) {
    return null;
  }
  const logThreshold = Math.log(1 / alpha);
  let sumObservations = 0;
  let sumDeviationSquares = 0;
  let mean = 0.5;
  let variance = 0.25;
  let sumLambda = 0;
  let sumLambdaObservation = 0;
  let sumVariancePenalty = 0;
  let runningUpper = Number.POSITIVE_INFINITY;

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (observation === undefined || !Number.isFinite(observation) || observation < 0 || observation > 1) {
      return null;
    }
    const time = index + 1;
    const lambda = Math.min(
      ANYTIME_LAMBDA_CAP,
      Math.sqrt((2 * logThreshold) / (variance * time * Math.log(1 + time))),
    );
    if (!(lambda > 0) || lambda >= 1) {
      return null;
    }
    sumLambda += lambda;
    sumLambdaObservation += lambda * observation;
    const priorDeviation = observation - mean;
    sumVariancePenalty += priorDeviation * priorDeviation * (-Math.log(1 - lambda) - lambda);
    sumObservations += observation;
    mean = (0.5 + sumObservations) / (time + 1);
    const posteriorDeviation = observation - mean;
    sumDeviationSquares += posteriorDeviation * posteriorDeviation;
    variance = (0.25 + sumDeviationSquares) / (time + 1);
    const endpoint =
      sumLambdaObservation / sumLambda + (logThreshold + sumVariancePenalty) / sumLambda;
    const capped = Math.min(1, endpoint);
    if (capped < runningUpper) {
      runningUpper = capped;
    }
  }
  return runningUpper;
}
