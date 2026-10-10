import { describe, expect, it } from "vitest";
import {
  oneSidedBinomialUpperBound,
  upperBoundIsBelowGate,
} from "./binomial-bound.js";

describe("one-sided binomial upper bound", () => {
  it("returns no bound for an empty sample", () => {
    expect(oneSidedBinomialUpperBound(0, 0)).toBeNull();
    expect(upperBoundIsBelowGate(0, 0, 0.98)).toBe(false);
  });

  it("puts a perfect sample at 1, so it cannot fail a gate", () => {
    expect(oneSidedBinomialUpperBound(783, 783)).toBe(1);
    expect(upperBoundIsBelowGate(783, 783, 0.98)).toBe(false);
  });

  it("rejects 0/1 against a 98% gate at 95%", () => {
    expect(oneSidedBinomialUpperBound(0, 1)).toBeCloseTo(0.95, 8);
    expect(upperBoundIsBelowGate(0, 1, 0.98)).toBe(true);
  });

  it("keeps a 97/100 sample under the point gate but not yet decisive", () => {
    const bound = oneSidedBinomialUpperBound(97, 100);
    expect(bound).not.toBeNull();
    expect(bound as number).toBeGreaterThan(0.98);
    expect(97 / 100).toBeLessThan(0.98);
    expect(upperBoundIsBelowGate(97, 100, 0.98)).toBe(false);
  });

  it("places the v1E-3 containment counts decisively below 98%", () => {
    const bound = oneSidedBinomialUpperBound(710, 783);
    expect(bound).not.toBeNull();
    expect(bound as number).toBeGreaterThan(0.91);
    expect(bound as number).toBeLessThan(0.94);
    expect(upperBoundIsBelowGate(710, 783, 0.98)).toBe(true);
  });
});
