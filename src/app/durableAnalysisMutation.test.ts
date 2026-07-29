import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyDurableAnalysisBridgeRejection,
  runDurableAnalysisMutation,
  type DurableAnalysisMutationPolicy,
} from "./durableAnalysisMutation";

const identity = {
  runId: "run-current",
  operationToken: "publish-context-3",
} as const;

const smallPolicy: DurableAnalysisMutationPolicy = {
  maximumAttempts: 3,
  mutationTimeoutMs: 50,
  readbackTimeoutMs: 50,
  initialBackoffMs: 10,
  maximumBackoffMs: 20,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("runDurableAnalysisMutation", () => {
  it("publishes only after the durable readback matches the expected value", async () => {
    const mutate = vi.fn(() =>
      Promise.resolve({ kind: "accepted" } as const),
    );
    const readback = vi.fn(() =>
      Promise.resolve({ stage: "context", revision: 3 }),
    );
    const reconcile = vi.fn(
      ({
        expected,
        readback: persisted,
      }: {
        expected: { stage: string; revision: number };
        readback: { stage: string; revision: number };
      }) =>
        expected.stage === persisted.stage &&
        expected.revision === persisted.revision
          ? ({ kind: "succeeded", value: persisted } as const)
          : ({ kind: "retry", reasonCode: "readback_mismatch" } as const),
    );

    const result = await runDurableAnalysisMutation({
      identity,
      expected: { stage: "context", revision: 3 },
      isCurrent: () => true,
      mutate,
      readback,
      reconcile,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: { stage: "context", revision: 3 },
      attempts: 1,
      recovered: false,
    });
    expect(mutate).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        identity,
        attemptNumber: 1,
        mutationIssue: null,
      }),
    );
  });

  it("recovers an outcome-unknown storage failure from matching readback without writing twice", async () => {
    const mutate = vi.fn(
      () =>
        Promise.resolve(
        ({
          kind: "retry",
          reasonCode: "analysis_job_storage_failure",
        }) as const,
        ),
    );
    const readback = vi.fn(() => Promise.resolve("committed"));

    const result = await runDurableAnalysisMutation({
      identity,
      expected: "committed",
      isCurrent: () => true,
      mutate,
      readback,
      reconcile: ({ expected, readback: persisted, mutationIssue }) => {
        expect(mutationIssue).toEqual({
          kind: "retry",
          reasonCode: "analysis_job_storage_failure",
        });
        return expected === persisted
          ? { kind: "succeeded", value: persisted }
          : { kind: "retry", reasonCode: "readback_mismatch" };
      },
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: "committed",
      attempts: 1,
      recovered: true,
    });
    expect(mutate).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("resolves a commit conflict by readback before deciding whether to retry", async () => {
    const mutate = vi.fn(
      () =>
        Promise.resolve(
        ({
          kind: "conflict",
          reasonCode: "analysis_job_commit_conflict",
        }) as const,
        ),
    );
    const readback = vi.fn(() => Promise.resolve({ cursor: 4 }));

    const result = await runDurableAnalysisMutation({
      identity,
      expected: { cursor: 4 },
      isCurrent: () => true,
      mutate,
      readback,
      reconcile: ({ expected, readback: persisted, mutationIssue }) => {
        expect(mutationIssue?.kind).toBe("conflict");
        return expected.cursor === persisted.cursor
          ? { kind: "succeeded", value: persisted.cursor }
          : { kind: "retry", reasonCode: "commit_conflict_unresolved" };
      },
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: 4,
      attempts: 1,
      recovered: true,
    });
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("rejects a stale run/token fence before any mutation", async () => {
    const mutate = vi.fn(() =>
      Promise.resolve({ kind: "accepted" } as const),
    );
    const readback = vi.fn(() => Promise.resolve("unused"));

    const result = await runDurableAnalysisMutation({
      identity,
      expected: "unused",
      isCurrent: () => false,
      mutate,
      readback,
      reconcile: () => ({ kind: "succeeded", value: "unused" }),
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "stale",
      reasonCode: "analysis_mutation_fence_stale",
      attempts: 0,
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(readback).not.toHaveBeenCalled();
  });

  it("stops when the run/token fence changes after mutation", async () => {
    const isCurrent = vi
      .fn<
        (candidate: {
          readonly runId: string;
          readonly operationToken: string;
        }) => boolean
      >()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const readback = vi.fn(() => Promise.resolve("unused"));

    const result = await runDurableAnalysisMutation({
      identity,
      expected: "unused",
      isCurrent,
      mutate: () => Promise.resolve({ kind: "accepted" }),
      readback,
      reconcile: () => ({ kind: "succeeded", value: "unused" }),
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "stale",
      reasonCode: "analysis_mutation_fence_stale",
      attempts: 1,
    });
    expect(readback).not.toHaveBeenCalled();
  });

  it.each([
    [
      { kind: "stale", reasonCode: "bridge_run_fence_mismatch" } as const,
      {
        status: "stale",
        reasonCode: "bridge_run_fence_mismatch",
        attempts: 1,
      },
    ],
    [
      { kind: "permanent", reasonCode: "invalid_transition" } as const,
      {
        status: "permanent-failure",
        reasonCode: "invalid_transition",
        attempts: 1,
      },
    ],
  ])(
    "returns immediately for the terminal mutation outcome $kind",
    async (mutationOutcome, expectedResult) => {
      const readback = vi.fn(() => Promise.resolve("unused"));

      const result = await runDurableAnalysisMutation({
        identity,
        expected: "unused",
        isCurrent: () => true,
        mutate: () => Promise.resolve(mutationOutcome),
        readback,
        reconcile: () => ({ kind: "succeeded", value: "unused" }),
        policy: smallPolicy,
      });

      expect(result).toEqual(expectedResult);
      expect(readback).not.toHaveBeenCalled();
    },
  );

  it("uses exponential backoff capped by the configured maximum", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mutationTimes: number[] = [];

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "ready",
      isCurrent: () => true,
      mutate: () => {
        mutationTimes.push(Date.now());
        return Promise.resolve({ kind: "accepted" });
      },
      readback: () => Promise.resolve("not-ready"),
      reconcile: ({ attemptNumber }) =>
        attemptNumber === 4
          ? { kind: "succeeded", value: "ready" }
          : { kind: "retry", reasonCode: "readback_mismatch" },
      policy: {
        ...smallPolicy,
        maximumAttempts: 4,
      },
    });

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: "ready",
      attempts: 4,
      recovered: true,
    });
    expect(mutationTimes).toEqual([0, 10, 30, 50]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns retry-exhausted after the bounded number of attempts", async () => {
    vi.useFakeTimers();

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "ready",
      isCurrent: () => true,
      mutate: () => Promise.resolve({ kind: "accepted" }),
      readback: () => Promise.resolve("not-ready"),
      reconcile: () => ({
        kind: "retry",
        reasonCode: "readback_mismatch",
      }),
      policy: smallPolicy,
    });

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "retry-exhausted",
      reasonCode: "readback_mismatch",
      attempts: 3,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a mutation watchdog as outcome-unknown and reconciles readback", async () => {
    vi.useFakeTimers();
    let childSignalAborted = false;

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "committed",
      isCurrent: () => true,
      mutate: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              childSignalAborted = true;
            },
            { once: true },
          );
          void resolve;
        }),
      readback: () => Promise.resolve("committed"),
      reconcile: ({ expected, readback, mutationIssue }) => {
        expect(mutationIssue).toEqual({
          kind: "retry",
          reasonCode: "mutation_timeout",
        });
        return expected === readback
          ? { kind: "succeeded", value: readback }
          : { kind: "retry", reasonCode: "readback_mismatch" };
      },
      policy: {
        ...smallPolicy,
        mutationTimeoutMs: 5,
      },
    });

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: "committed",
      attempts: 1,
      recovered: true,
    });
    expect(childSignalAborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds readback separately and retries it on the next attempt", async () => {
    vi.useFakeTimers();
    let readbackCalls = 0;

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "committed",
      isCurrent: () => true,
      mutate: () => Promise.resolve({ kind: "accepted" }),
      readback: ({ signal }) => {
        readbackCalls += 1;
        if (readbackCalls === 1) {
          return new Promise((resolve) => {
            signal.addEventListener("abort", () => void resolve, {
              once: true,
            });
          });
        }
        return Promise.resolve("committed");
      },
      reconcile: ({ expected, readback }) =>
        expected === readback
          ? { kind: "succeeded", value: readback }
          : { kind: "retry", reasonCode: "readback_mismatch" },
      policy: {
        ...smallPolicy,
        readbackTimeoutMs: 5,
      },
    });

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: "committed",
      attempts: 2,
      recovered: true,
    });
    expect(readbackCalls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight mutation and clears its watchdog", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let childSignalAborted = false;

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "unused",
      isCurrent: () => true,
      mutate: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              childSignalAborted = true;
            },
            { once: true },
          );
          void resolve;
        }),
      readback: () => Promise.resolve("unused"),
      reconcile: () => ({ kind: "succeeded", value: "unused" }),
      signal: controller.signal,
      policy: smallPolicy,
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "aborted",
      attempts: 1,
    });
    expect(childSignalAborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts during backoff without starting another attempt", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const mutate = vi.fn(() =>
      Promise.resolve({ kind: "accepted" } as const),
    );

    const pending = runDurableAnalysisMutation({
      identity,
      expected: "ready",
      isCurrent: () => true,
      mutate,
      readback: () => Promise.resolve("not-ready"),
      reconcile: () => ({
        kind: "retry",
        reasonCode: "readback_mismatch",
      }),
      signal: controller.signal,
      policy: smallPolicy,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mutate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "aborted",
      attempts: 1,
    });
    expect(mutate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats unclassified exceptions as permanent but permits explicit storage retry classification", async () => {
    const readback = vi.fn(() => Promise.resolve("committed"));

    const permanentResult = await runDurableAnalysisMutation({
      identity,
      expected: "committed",
      isCurrent: () => true,
      mutate: () => Promise.reject(new Error("programming error")),
      readback,
      reconcile: () => ({ kind: "succeeded", value: "committed" }),
      policy: smallPolicy,
    });

    expect(permanentResult).toEqual({
      status: "permanent-failure",
      reasonCode: "mutation_exception",
      attempts: 1,
    });
    expect(readback).not.toHaveBeenCalled();

    const recoveredResult = await runDurableAnalysisMutation({
      identity,
      expected: "committed",
      isCurrent: () => true,
      mutate: () => Promise.reject(new Error("indexeddb unavailable")),
      readback,
      reconcile: ({ mutationIssue }) => {
        expect(mutationIssue?.kind).toBe("retry");
        return { kind: "succeeded", value: "committed" };
      },
      classifyThrown: (_cause, phase) => ({
        kind: "retry",
        reasonCode: `${phase}_storage_failure`,
      }),
      policy: smallPolicy,
    });

    expect(recoveredResult).toEqual({
      status: "succeeded",
      value: "committed",
      attempts: 1,
      recovered: true,
    });
    expect(readback).toHaveBeenCalledOnce();
  });

  it("rejects invalid identities and retry policies before calling storage", async () => {
    const mutate = vi.fn(() =>
      Promise.resolve({ kind: "accepted" } as const),
    );

    await expect(
      runDurableAnalysisMutation({
        identity: { ...identity, operationToken: " " },
        expected: "unused",
        isCurrent: () => true,
        mutate,
        readback: () => Promise.resolve("unused"),
        reconcile: () => ({ kind: "succeeded", value: "unused" }),
        policy: smallPolicy,
      }),
    ).rejects.toThrow("operationToken must not be empty");

    await expect(
      runDurableAnalysisMutation({
        identity,
        expected: "unused",
        isCurrent: () => true,
        mutate,
        readback: () => Promise.resolve("unused"),
        reconcile: () => ({ kind: "succeeded", value: "unused" }),
        policy: { ...smallPolicy, maximumAttempts: 0 },
      }),
    ).rejects.toThrow("maximumAttempts must be a positive safe integer");

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("classifyDurableAnalysisBridgeRejection", () => {
  it.each([
    [
      {
        failure: "storage",
        retryable: true,
        reason: "write_failed",
      } as const,
      { kind: "retry", reasonCode: "analysis_job_storage_failure" },
    ],
    [
      {
        failure: "storage",
        retryable: false,
        reason: "INVALID_PAYLOAD",
      } as const,
      { kind: "permanent", reasonCode: "analysis_job_storage_rejected" },
    ],
    [
      {
        failure: "transition",
        retryable: false,
        reason: "stage_order_violation",
      } as const,
      { kind: "conflict", reasonCode: "analysis_job_commit_conflict" },
    ],
    [
      {
        failure: "conflict",
        retryable: false,
        reason: "cas_mismatch",
      } as const,
      { kind: "conflict", reasonCode: "analysis_job_commit_conflict" },
    ],
    [
      {
        failure: "transition",
        retryable: false,
        reason: "run_fence_mismatch",
      } as const,
      { kind: "stale", reasonCode: "analysis_job_run_fence_mismatch" },
    ],
    [
      {
        failure: "transition",
        retryable: false,
        reason: "undefined_transition",
      } as const,
      {
        kind: "permanent",
        reasonCode: "analysis_job_transition_rejected",
      },
    ],
  ])("maps $failure/$reason to $kind", (rejection, expected) => {
    expect(classifyDurableAnalysisBridgeRejection(rejection)).toEqual(expected);
  });
});
