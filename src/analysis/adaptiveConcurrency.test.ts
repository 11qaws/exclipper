import { describe, expect, it } from "vitest";

import {
  AdaptiveConcurrency,
  type AdaptiveConcurrencyRequestStamp,
  DEFAULT_ADAPTIVE_CONCURRENCY,
  startAfterRequestSpacing,
  waitForAdaptiveConcurrencyCapacity,
} from "./adaptiveConcurrency";

function succeed(limiter: AdaptiveConcurrency, times: number): void {
  for (let i = 0; i < times; i += 1) {
    limiter.onSuccess(limiter.captureRequestWave());
  }
}

function succeedFromWave(
  limiter: AdaptiveConcurrency,
  requestWave: AdaptiveConcurrencyRequestStamp,
  times: number,
): void {
  for (let i = 0; i < times; i += 1) {
    limiter.onSuccess(requestWave);
  }
}

function fail(limiter: AdaptiveConcurrency): void {
  limiter.onFailure(limiter.captureRequestWave());
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
    limiter.onSuccess(limiter.captureRequestWave());
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
    fail(limiter);
    expect(limiter.limit).toBe(4);
  });

  it("reduces only once for failures from the same in-flight wave", () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      start: 6,
    });
    const failedWave = limiter.captureRequestWave();

    limiter.onFailure(failedWave);
    expect(limiter.limit).toBe(3);
    for (let i = 0; i < 5; i += 1) limiter.onFailure(failedWave);

    expect(limiter.limit).toBe(3);
  });

  it("recovers only from requests started after the failed wave", () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      start: 6,
    });
    const failedWave = limiter.captureRequestWave();

    limiter.onFailure(failedWave);
    succeedFromWave(
      limiter,
      failedWave,
      DEFAULT_ADAPTIVE_CONCURRENCY.raiseAfterSuccesses,
    );
    expect(limiter.limit).toBe(3);

    succeed(limiter, DEFAULT_ADAPTIVE_CONCURRENCY.raiseAfterSuccesses);
    expect(limiter.limit).toBe(4);
  });

  it("never returns to a value that failed", () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 10,
      start: 8,
    });
    fail(limiter);
    succeed(limiter, 200);
    expect(limiter.limit).toBeLessThan(8);
  });

  it("remembers the limit at which an older request actually failed", () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 6,
      start: 4,
    });
    const requestStartedAtFour = limiter.captureRequestWave();
    succeed(limiter, DEFAULT_ADAPTIVE_CONCURRENCY.raiseAfterSuccesses);
    expect(limiter.limit).toBe(5);

    limiter.onFailure(requestStartedAtFour);
    expect(limiter.limit).toBe(2);
    succeed(limiter, 200);
    expect(limiter.limit).toBe(3);
  });

  it("settles just below the ceiling it found", () => {
    const limiter = new AdaptiveConcurrency({ ...DEFAULT_ADAPTIVE_CONCURRENCY, start: 6 });
    fail(limiter);
    succeed(limiter, 200);
    expect(limiter.limit).toBe(5);
  });

  it("keeps the lowest ceiling it has seen", () => {
    // 두 번째 실패가 더 낮은 곳에서 났다면 그쪽이 진짜 벽이다.
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      maximum: 10,
      start: 8,
    });
    fail(limiter);
    fail(limiter);
    succeed(limiter, 200);
    expect(limiter.limit).toBe(3);
  });

  it("never drops below one, so the run still finishes", () => {
    const limiter = new AdaptiveConcurrency();
    for (let i = 0; i < 20; i += 1) fail(limiter);
    expect(limiter.limit).toBe(1);
  });

  it("respects the upper bound even with unbroken success", () => {
    // 상류가 실패 대신 조용히 느려지는 구간이 있으면 이 알고리즘은 계속 오른다.
    // 관측되지 않은 영역까지 올라가지 않는다.
    const limiter = new AdaptiveConcurrency();
    succeed(limiter, 500);
    expect(limiter.limit).toBe(DEFAULT_ADAPTIVE_CONCURRENCY.maximum);
  });

  it("resets the success streak when a failure interrupts it", () => {
    const limiter = new AdaptiveConcurrency({ ...DEFAULT_ADAPTIVE_CONCURRENCY, start: 2 });
    succeed(limiter, 3);
    fail(limiter);
    succeed(limiter, 3);
    // 실패가 연속을 끊었으므로 아직 올라가지 않는다.
    expect(limiter.limit).toBe(1);
  });

  it("says what it found, for diagnosis", () => {
    const fresh = new AdaptiveConcurrency();
    expect(fresh.describe()).toContain("상한 미확인");
    fail(fresh);
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

  it("rechecks a reduced limit after spacing before starting another request", async () => {
    const limiter = new AdaptiveConcurrency({
      ...DEFAULT_ADAPTIVE_CONCURRENCY,
      start: 6,
    });
    const failedRequest = limiter.captureRequestWave();
    const createDeferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const deferred = [
      createDeferred(),
      createDeferred(),
      createDeferred(),
      createDeferred(),
      createDeferred(),
    ] as const;
    const inFlight = new Set(deferred.map(({ promise }) => promise));
    for (const request of inFlight) {
      void request.then(() => inFlight.delete(request));
    }

    let nowMs = 0;
    let enteredCapacityGate!: () => void;
    const capacityGateEntered = new Promise<void>((resolve) => {
      enteredCapacityGate = resolve;
    });
    const starts: number[] = [];
    const pacedPromise = startAfterRequestSpacing(
      1_000,
      1_000,
      () => {
        starts.push(inFlight.size);
        return Promise.resolve();
      },
      {
        now: () => nowMs,
        wait: async (delayMs) => {
          nowMs += delayMs;
          limiter.onFailure(failedRequest);
          deferred[0].resolve();
          await deferred[0].promise;
        },
      },
      async () => {
        enteredCapacityGate();
        await waitForAdaptiveConcurrencyCapacity(inFlight, limiter);
      },
    );

    await capacityGateEntered;
    expect(limiter.limit).toBe(3);
    expect(inFlight.size).toBe(4);
    expect(starts).toEqual([]);

    deferred[1].resolve();
    await deferred[1].promise;
    await Promise.resolve();
    expect(inFlight.size).toBe(3);
    expect(starts).toEqual([]);

    deferred[2].resolve();
    const paced = await pacedPromise;
    expect(inFlight.size).toBe(2);
    expect(starts).toEqual([2]);
    await paced.started;

    deferred[3].resolve();
    deferred[4].resolve();
  });
});
