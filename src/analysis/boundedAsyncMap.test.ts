import { describe, expect, it } from "vitest";
import {
  mapSettledWithConcurrency,
  mapWithConcurrency,
} from "./boundedAsyncMap";

describe("mapWithConcurrency", () => {
  it("preserves input order while bounding active requests", async () => {
    let activeCount = 0;
    let maximumActiveCount = 0;
    const outputs = await mapWithConcurrency([30, 5, 20, 1], 2, async (delayMs) => {
      activeCount += 1;
      maximumActiveCount = Math.max(maximumActiveCount, activeCount);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
      activeCount -= 1;
      return delayMs * 2;
    });

    expect(outputs).toEqual([60, 10, 40, 2]);
    expect(maximumActiveCount).toBe(2);
  });

  it("rejects an invalid concurrency limit", async () => {
    await expect(mapWithConcurrency([1], 0, (value) => Promise.resolve(value))).rejects.toThrow(
      RangeError,
    );
  });
});

describe("mapSettledWithConcurrency", () => {
  it("continues after one mapper rejects while preserving order and the concurrency bound", async () => {
    let activeCount = 0;
    let maximumActiveCount = 0;
    const started: number[] = [];
    const failure = new Error("candidate failed");

    const results = await mapSettledWithConcurrency(
      [20, 1, 5, 2],
      2,
      async (delayMs, index) => {
        started.push(index);
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        try {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delayMs);
          });
          if (index === 1) {
            throw failure;
          }
          return `candidate-${index}`;
        } finally {
          activeCount -= 1;
        }
      },
    );

    expect(started.sort((left, right) => left - right)).toEqual([0, 1, 2, 3]);
    expect(maximumActiveCount).toBe(2);
    expect(results).toEqual([
      { status: "fulfilled", value: "candidate-0" },
      { status: "rejected", reason: failure },
      { status: "fulfilled", value: "candidate-2" },
      { status: "fulfilled", value: "candidate-3" },
    ]);
  });

  it("uses the same concurrency validation as mapWithConcurrency", async () => {
    await expect(
      mapSettledWithConcurrency([1], Number.NaN, (value) =>
        Promise.resolve(value),
      ),
    ).rejects.toThrow(RangeError);
  });
});
