import { describe, expect, it } from "vitest";
import { cosineSim } from "../bill-similarity";

describe("cosineSim", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSim([3, 4, 0], [3, 4, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(cosineSim([0, 1, 0], [0, 0, 1])).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSim([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
    expect(cosineSim([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6);
  });

  it("is symmetric: sim(a, b) === sim(b, a)", () => {
    const a = [0.1, 0.5, 0.9, -0.3];
    const b = [0.2, 0.4, 0.7, 0.1];
    expect(cosineSim(a, b)).toBeCloseTo(cosineSim(b, a), 10);
  });

  it("is invariant to vector scale (only direction matters)", () => {
    // Scaling either vector by a positive scalar shouldn't change cosine.
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const base = cosineSim(a, b);
    expect(cosineSim(a.map(x => x * 7), b)).toBeCloseTo(base, 6);
    expect(cosineSim(a, b.map(x => x * 0.001))).toBeCloseTo(base, 6);
  });

  it("returns 0 when vectors have different lengths", () => {
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSim([1], [1, 2, 3])).toBe(0);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosineSim([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSim([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSim([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("returns 0.5 for vectors at 60 degrees apart", () => {
    // [1, 0] and [0.5, sqrt(3)/2] make a 60° angle
    const a = [1, 0];
    const b = [0.5, Math.sqrt(3) / 2];
    expect(cosineSim(a, b)).toBeCloseTo(0.5, 6);
  });

  it("handles 768-dim embeddings without precision loss", () => {
    // Simulate the actual embedding size (nomic-embed-text)
    const a = Array.from({ length: 768 }, (_, i) => Math.sin(i) * 0.1);
    const b = [...a]; // exact copy
    expect(cosineSim(a, b)).toBeCloseTo(1, 6);

    // Slightly perturbed copy should be very-close-to-1
    const c = a.map(x => x + 0.001);
    expect(cosineSim(a, c)).toBeGreaterThan(0.99);
  });

  it("handles empty arrays without throwing", () => {
    expect(cosineSim([], [])).toBe(0);
  });
});
