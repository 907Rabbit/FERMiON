import { describe, expect, it } from "vitest";
import { oneSidedAnytimeUpperBound } from "./confidence-sequence.js";

function ones(count: number): number[] {
  return Array.from({ length: count }, () => 1);
}

function zeros(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

/** Independent closed form for the hand check below. */
function referenceRawUpper(observations: readonly number[]): number {
  const logThreshold = Math.log(20);
  let sumObservations = 0;
  let sumDeviationSquares = 0;
  let mean = 0.5;
  let variance = 0.25;
  let sumLambda = 0;
  let sumLambdaObservation = 0;
  let sumVariancePenalty = 0;
  let runningUpper = Number.POSITIVE_INFINITY;
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index] ?? 0;
    const time = index + 1;
    const lambda = Math.min(
      0.5,
      Math.sqrt((2 * logThreshold) / (variance * time * Math.log(1 + time))),
    );
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
    if (endpoint < runningUpper) {
      runningUpper = endpoint;
    }
  }
  return runningUpper;
}

describe("one-sided anytime upper bound", () => {
  it("returns no bound for an empty or invalid sequence", () => {
    expect(oneSidedAnytimeUpperBound([])).toBeNull();
    expect(oneSidedAnytimeUpperBound([0], 0)).toBeNull();
    expect(oneSidedAnytimeUpperBound([0], 1)).toBeNull();
    expect(oneSidedAnytimeUpperBound([1.01])).toBeNull();
    expect(oneSidedAnytimeUpperBound([-0.01])).toBeNull();
    expect(oneSidedAnytimeUpperBound([Number.NaN])).toBeNull();
  });

  it("matches the one-sided PrPl-EB endpoint on the first zero", () => {
    const psi = -Math.log(0.5) - 0.5;
    const raw = (Math.log(20) + 0.25 * psi) / 0.5;
    expect(raw).toBeCloseTo(6.088038137387954, 12);
    expect(referenceRawUpper([0])).toBeCloseTo(raw, 12);
    expect(oneSidedAnytimeUpperBound([0])).toBe(1);
    expect(oneSidedAnytimeUpperBound(zeros(40))).toBeCloseTo(
      Math.min(1, referenceRawUpper(zeros(40))),
      12,
    );
  });

  it("keeps a perfect sample at 1, so the bound cannot fall below a rate gate", () => {
    expect(oneSidedAnytimeUpperBound(ones(1))).toBe(1);
    expect(oneSidedAnytimeUpperBound(ones(2))).toBe(1);
    expect(oneSidedAnytimeUpperBound(ones(500))).toBe(1);
    expect(oneSidedAnytimeUpperBound([1, 0])).toBe(1);
    expect(oneSidedAnytimeUpperBound([1, 1, 0])).toBe(1);
  });

  it("drops below 98% at seven zeros and stays below after the C8 floor", () => {
    expect(oneSidedAnytimeUpperBound(zeros(6))).toBe(1);
    const seven = oneSidedAnytimeUpperBound(zeros(7));
    expect(seven).toBeCloseTo(0.876780602316, 9);
    expect(seven as number).toBeLessThan(0.98);
    const fortyNine = oneSidedAnytimeUpperBound(zeros(49));
    expect(fortyNine as number).toBeLessThan(0.98);
    const fifty = oneSidedAnytimeUpperBound(zeros(50));
    expect(fifty).toBeCloseTo(0.122968189, 8);
    expect(fifty as number).toBeLessThan(0.98);
  });

  it("puts twenty required misses below the 99% gate and nineteen still below it", () => {
    const nineteen = oneSidedAnytimeUpperBound(zeros(19));
    const twenty = oneSidedAnytimeUpperBound(zeros(20));
    expect(nineteen).toBeCloseTo(0.323440543593, 9);
    expect(twenty).toBeCloseTo(0.307280588112, 9);
    expect(nineteen as number).toBeLessThan(0.99);
    expect(twenty as number).toBeLessThan(0.99);
  });

  it("depends on order for the same 710/783 counts", () => {
    const successesFirst = oneSidedAnytimeUpperBound([...ones(710), ...zeros(73)]);
    const failuresFirst = oneSidedAnytimeUpperBound([...zeros(73), ...ones(710)]);
    expect(successesFirst).toBeCloseTo(0.974715442221, 9);
    expect(failuresFirst).toBeCloseTo(0.084232983967, 9);
    expect(successesFirst as number).toBeLessThan(0.98);
    expect(failuresFirst as number).toBeLessThan(successesFirst as number);
  });

  it("keeps four hundred successes ahead of twenty failures at or above 98%", () => {
    const upper = oneSidedAnytimeUpperBound([...ones(400), ...zeros(20)]);
    expect(upper).toBeCloseTo(0.989676286645, 9);
    expect(upper as number).toBeGreaterThanOrEqual(0.98);
  });

  it("is the running intersection, so extending the sequence cannot raise it", () => {
    const observations = [...zeros(30), ...ones(30)];
    let previous = 1;
    for (let count = 1; count <= observations.length; count += 1) {
      const upper = oneSidedAnytimeUpperBound(observations.slice(0, count));
      expect(upper).not.toBeNull();
      expect(upper as number).toBeLessThanOrEqual(previous + 1e-12);
      previous = upper as number;
    }
  });
});
