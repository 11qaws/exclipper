import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./boundedAsyncMap";

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
