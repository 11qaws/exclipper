import { describe, expect, it } from "vitest";
import { calculateTemporalEventDensity } from "./temporalPointProcess";

describe("Temporal Point Process (Poisson Density)", () => {
  it("calculates expected event counts and diagnoses bursts", () => {
    // 30 min duration = 6 bins of 5 minutes (300,000ms)
    const sourceDurationMs = 30 * 60 * 1000;
    
    // Create timestamps:
    // Bin 0 (0-5m): 1 event
    // Bin 1 (5-10m): 2 events
    // Bin 2 (10-15m): 10 events (burst!)
    // Bin 3 (15-20m): 0 events
    // Bin 4 (20-25m): 1 event
    // Bin 5 (25-30m): 1 event
    const events = [
      1 * 60 * 1000,
      6 * 60 * 1000, 7 * 60 * 1000,
      ...Array(10).fill(0).map((_, i) => 12 * 60 * 1000 + i * 1000),
      22 * 60 * 1000,
      27 * 60 * 1000
    ];

    const result = calculateTemporalEventDensity(events, sourceDurationMs);

    expect(result.diagnostics.totalEventCount).toBe(15);
    expect(result.diagnostics.meanEventCount).toBe(15 / 6);
    expect(result.diagnostics.dispersionIndex).toBeGreaterThan(1); // Variance > Mean indicates bursty behavior

    expect(result.bins.length).toBe(6);
    
    // Check Burst Bin 2
    expect(result.bins[2]!.eventCount).toBe(10);
    expect(result.bins[2]!.densityClass).toBe("burst");
    expect(result.bins[2]!.poissonTailProbability).toBeLessThan(0.05);

    // Check empty Bin 3
    expect(result.bins[3]!.eventCount).toBe(0);
    expect(result.bins[3]!.densityClass).toBe("quiet");
  });

  it("handles empty arrays", () => {
    const result = calculateTemporalEventDensity([], 30 * 60 * 1000);
    expect(result.diagnostics.totalEventCount).toBe(0);
    expect(result.diagnostics.dispersionIndex).toBeNull();
    expect(result.bins[0]!.densityClass).toBe("quiet");
  });
});
