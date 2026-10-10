/**
 * Fixed-sample binomial bound for a rate gate.
 * One-sided Clopper-Pearson upper bound: the p where the lower tail equals
 * 1 - confidence. A bound below the gate means the gate is not plausible
 * for this one completed sample. Recomputing it after every execution is
 * not a 5% sequential test. v1F-2 stopping uses confidence-sequence.ts.
 */

export const RATE_GATE_CONFIDENCE = 0.95;

export function oneSidedBinomialUpperBound(
  successes: number,
  trials: number,
  confidence = RATE_GATE_CONFIDENCE,
): number | null {
  if (!integerTrial(successes, trials) || confidence <= 0 || confidence >= 1) {
    return null;
  }
  if (successes === trials) {
    return 1;
  }
  const alpha = 1 - confidence;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 80; step += 1) {
    const mid = (low + high) / 2;
    if (binomialCdf(successes, trials, mid) <= alpha) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

/** True when the upper bound is strictly below the gate. Equality can still reach it. */
export function upperBoundIsBelowGate(
  successes: number,
  trials: number,
  gate: number,
  confidence = RATE_GATE_CONFIDENCE,
): boolean {
  if (!integerTrial(successes, trials) || !(gate > 0 && gate < 1)) {
    return false;
  }
  const alpha = 1 - confidence;
  return binomialCdf(successes, trials, gate) < alpha;
}

function integerTrial(successes: number, trials: number): boolean {
  return (
    Number.isInteger(successes) &&
    Number.isInteger(trials) &&
    trials > 0 &&
    successes >= 0 &&
    successes <= trials
  );
}

function binomialCdf(successes: number, trials: number, probability: number): number {
  if (successes >= trials) {
    return 1;
  }
  if (probability <= 0) {
    return 1;
  }
  if (probability >= 1) {
    return 0;
  }
  const logProbability = Math.log(probability);
  const logComplement = Math.log(1 - probability);
  const logTrials = logFactorial(trials);
  let maxLog = Number.NEGATIVE_INFINITY;
  const logs: number[] = [];
  for (let count = 0; count <= successes; count += 1) {
    const logTerm =
      logTrials -
      logFactorial(count) -
      logFactorial(trials - count) +
      count * logProbability +
      (trials - count) * logComplement;
    logs.push(logTerm);
    if (logTerm > maxLog) {
      maxLog = logTerm;
    }
  }
  let sum = 0;
  for (const logTerm of logs) {
    sum += Math.exp(logTerm - maxLog);
  }
  return Math.exp(maxLog + Math.log(sum));
}

function logFactorial(value: number): number {
  let total = 0;
  for (let factor = 2; factor <= value; factor += 1) {
    total += Math.log(factor);
  }
  return total;
}
