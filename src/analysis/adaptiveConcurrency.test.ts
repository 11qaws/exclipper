import { describe, expect, it } from "vitest";

import {
  AdaptiveConcurrency,
  DEFAULT_ADAPTIVE_CONCURRENCY,
  startAfterRequestSpacing,
} from "./adaptiveConcurrency";

function succeed(limiter: AdaptiveConcurrency, times: number): void {
  for (let i = 0; i < times; i += 1) limiter.onSuccess();
}

describe("adaptive concurrency", () => {
  it("starts at the last value known to work", () => {
    expect(new AdaptiveConcurrency().limit).toBe(4);
  });

  it("climbs only after a run of successes, not on the first one", () => {
    // 한 번의 성공으로 올리면 실패 직전에서 오르내리기를 반복하고, 그 진동
    // 자체가 실패를 만든다.
    const limiter = new AdaptiveConcurrency();
    succeed(limiter, DEFAULT_ADAPTIVE_CONCURRENCY.raiseAfterSuccesses - 1);
    expect(limiter.limit).toBe(4);
    limiter.onSuccess();
    expect(limiter.limit).toBe(5);
  });

  it("halves on a single failure rather than stepping down", () => {
    // 넘어서면 늦어지는 것이 아니라 진행 중인 작업을 **버린다.** 한 칸 아래는
    // 조금 느리고, 한 칸 위는 한 배치를 잃는다.
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 10,
      start: 8,
    });
    limiter.onFailure();
    expect(limiter.limit).toBe(4);
  });

  it("never returns to a value that failed", () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 10,
      start: 8,
    });
    limiter.onFailure();
    for (let i = 0; i < 200; i += 1) limiter.onSuccess();
    expect(limiter.limit).toBeLessThan(8);
  });

  it("settles just below the ceiling it found", () => {
    const limiter = new AdaptiveConcurrency({ ...DEFAULT_ADAPTIVE_CONCURRENCY, start: 6 });
    limiter.onFailure();
    for (let i = 0; i < 200; i += 1) limiter.onSuccess();
    expect(limiter.limit).toBe(5);
  });

  it("keeps the lowest ceiling it has seen", () => {
    // 두 번째 실패가 더 낮은 곳에서 났다면 그쪽이 진짜 벽이다.
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 10,
      start: 8,
    });
    limiter.onFailure();
    limiter.onFailure();
    for (let i = 0; i < 200; i += 1) limiter.onSuccess();
    expect(limiter.limit).toBe(3);
  });

  it("never drops below one, so the run still finishes", () => {
    const limiter = new AdaptiveConcurrency();
    for (let i = 0; i < 20; i += 1) limiter.onFailure();
    expect(limiter.limit).toBe(1);
  });

  it("respects the upper bound even with unbroken success", () => {
    // 상류가 실패 대신 조용히 느려지는 구간이 있으면 이 알고리즘은 계속 오른다.
    // 관측되지 않은 영역까지 올라가지 않는다.
    const limiter = new AdaptiveConcurrency();
    for (let i = 0; i < 500; i += 1) limiter.onSuccess();
    expect(limiter.limit).toBe(DEFAULT_ADAPTIVE_CONCURRENCY.maximum);
  });

  it("resets the success streak when a failure interrupts it", () => {
    const limiter = new AdaptiveConcurrency({ ...DEFAULT_ADAPTIVE_CONCURRENCY, start: 2 });
    succeed(limiter, 3);
    limiter.onFailure();
    succeed(limiter, 3);
    // 실패가 연속을 끊었으므로 아직 올라가지 않는다.
    expect(limiter.limit).toBe(1);
  });

  it("says what it found, for diagnosis", () => {
    const fresh = new AdaptiveConcurrency();
    expect(fresh.describe()).toContain("상한 미확인");
    fresh.onFailure();
    expect(fresh.describe()).toContain("에서 실패");
  });

  it("does not start the next request before its one-second slot", async () => {
    let nowMs = 10_000;
    const starts: number[] = [];
    const waits: number[] = [];
    const timing = {
      now: () => nowMs,
      wait: (delayMs: number) => {
        waits.push(delayMs);
        expect(starts).toEqual([]);
        nowMs += delayMs;
        return Promise.resolve();
      },
    };

    const paced = await startAfterRequestSpacing(
      11_000,
      1_000,
      () => {
        starts.push(nowMs);
        return Promise.resolve("started");
      },
      timing,
    );

    expect(waits).toEqual([1_000]);
    expect(starts).toEqual([11_000]);
    expect(paced.nextStartAtMs).toBe(12_000);
    await expect(paced.started).resolves.toBe("started");
  });
});
