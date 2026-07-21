export interface TemporalEventDensityBin {
  readonly startMs: number;
  readonly endMs: number;
  readonly eventCount: number;
  readonly expectedEventCount: number;
  readonly poissonTailProbability: number | null;
  readonly densityClass: "quiet" | "normal" | "burst";
}

export interface TemporalEventDensityDiagnostics {
  readonly binSizeMs: number;
  readonly totalEventCount: number;
  readonly meanEventCount: number;
  readonly varianceEventCount: number;
  readonly dispersionIndex: number | null;
}

export interface TemporalEventDensityResult {
  readonly bins: readonly TemporalEventDensityBin[];
  readonly diagnostics: TemporalEventDensityDiagnostics;
}

// Factorial helper for Poisson calculation
function factorial(n: number): number {
  if (n < 0) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

// Compute the probability of observing exactly k events given expected mean lambda
function poissonProbability(k: number, lambda: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Upper tail probability P(X >= k)
function poissonUpperTail(k: number, lambda: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  let sum = 0;
  // Sum P(X = i) for i from 0 to k-1
  for (let i = 0; i < k; i++) {
    sum += poissonProbability(i, lambda);
  }
  return Math.max(0, 1 - sum);
}

export function calculateTemporalEventDensity(
  episodeCenterTimesMs: readonly number[],
  sourceDurationMs: number,
  binSizeMs = 300_000,
): TemporalEventDensityResult {
  const safeDurationMs = Math.max(0, sourceDurationMs);
  const binCount = Math.ceil(safeDurationMs / binSizeMs);
  
  if (binCount === 0) {
    return {
      bins: [],
      diagnostics: {
        binSizeMs,
        totalEventCount: 0,
        meanEventCount: 0,
        varianceEventCount: 0,
        dispersionIndex: null,
      },
    };
  }

  const rawCounts: number[] = new Array<number>(binCount).fill(0);
  let totalEventCount = 0;

  for (const timeMs of episodeCenterTimesMs) {
    if (timeMs >= 0 && timeMs < safeDurationMs) {
      const index = Math.floor(timeMs / binSizeMs);
      if (index >= 0 && index < binCount) {
        rawCounts[index]!++;
        totalEventCount++;
      }
    }
  }

  const globalMean = totalEventCount / binCount;

  // Calculate variance
  let sumSquaredDiff = 0;
  for (const count of rawCounts) {
    const diff = count - globalMean;
    sumSquaredDiff += diff * diff;
  }
  const varianceEventCount = sumSquaredDiff / binCount;
  const dispersionIndex = globalMean > 0 ? varianceEventCount / globalMean : null;

  const bins: TemporalEventDensityBin[] = [];
  const priorStrength = 2;

  for (let i = 0; i < binCount; i++) {
    const previous = i > 0 ? rawCounts[i - 1]! : rawCounts[i]!;
    const current = rawCounts[i]!;
    const next = i < binCount - 1 ? rawCounts[i + 1]! : rawCounts[i]!;

    const neighborObserved = 0.25 * previous + 0.5 * current + 0.25 * next;
    const expectedEventCount =
      (globalMean * priorStrength + neighborObserved) / (priorStrength + 1);

    // Poisson tail probability for burst detection
    // Only calculate if current > expected
    let poissonTailProbability: number | null = null;
    let densityClass: "quiet" | "normal" | "burst" = "normal";

    if (expectedEventCount > 0) {
      if (current > expectedEventCount) {
        poissonTailProbability = poissonUpperTail(current, expectedEventCount);
        if (poissonTailProbability < 0.05 || current / expectedEventCount >= 2.5) {
          densityClass = "burst";
        }
      } else if (current < expectedEventCount * 0.5) {
        densityClass = "quiet";
      }
    } else {
      if (current > 0) {
        densityClass = "burst";
      } else {
        densityClass = "quiet";
      }
    }

    bins.push({
      startMs: i * binSizeMs,
      endMs: Math.min((i + 1) * binSizeMs, safeDurationMs),
      eventCount: current,
      expectedEventCount,
      poissonTailProbability,
      densityClass,
    });
  }

  return {
    bins,
    diagnostics: {
      binSizeMs,
      totalEventCount,
      meanEventCount: globalMean,
      varianceEventCount,
      dispersionIndex,
    },
  };
}
