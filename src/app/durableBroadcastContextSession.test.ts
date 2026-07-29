import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisResultStoreError,
  type AnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  cloneBroadcastContextSessionRecord,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import {
  loadDurableBroadcastContextSession,
  transformDurableBroadcastContextSession,
  type DurableBroadcastContextSessionIdentity,
  type DurableBroadcastContextSessionStore,
} from "./durableBroadcastContextSession";
import type { DurableAnalysisMutationPolicy } from "./durableAnalysisMutation";

const RUN_ID = "run-context-shell-current";
const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;

const identity: DurableBroadcastContextSessionIdentity = {
  runId: RUN_ID,
  inputSignature: INPUT_SIGNATURE,
  operationToken: "whole-context-ledger:3",
};

const smallPolicy: DurableAnalysisMutationPolicy = {
  maximumAttempts: 3,
  mutationTimeoutMs: 50,
  readbackTimeoutMs: 50,
  initialBackoffMs: 10,
  maximumBackoffMs: 20,
};

function makeSession(
  recordedAt = "2026-07-29T00:00:00.000Z",
  overrides: Partial<BroadcastContextSessionRecord> = {},
): BroadcastContextSessionRecord {
  return cloneBroadcastContextSessionRecord({
    kind: "broadcastContextSession",
    runId: RUN_ID,
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    sourceDurationMs: 60_000,
    completeAudioCoverage: true,
    chapters: [
      {
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 60_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "방송 대사 지도",
      },
    ],
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: null,
    transcriptEvidenceCheckpointJson: null,
    transcriptVisualInspectionCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: "qwen3-asr-current",
    sourceCastRosterId: null,
    transcriptSealOperationKey: `${RUN_ID}:source:event-boost:attempt-0`,
    participantGroundingInputSignature: null,
    participantGroundingPlanFingerprint: null,
    participantGroundingCheckpointJson: null,
    contextInputSignature: null,
    contextInputCheckpointJson: null,
    contextPhaseLedgerJson: null,
    contextResultJson: null,
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt,
    ...overrides,
  });
}

function readOnlyStore(
  read: () => Promise<BroadcastContextSessionRecord | null>,
): DurableBroadcastContextSessionStore {
  return {
    getBroadcastContextSession: read,
    replaceBroadcastContextSessionIfUnchanged: () =>
      Promise.reject(new Error("Unexpected session mutation.")),
  };
}

function exactStore(
  initial: BroadcastContextSessionRecord,
): DurableBroadcastContextSessionStore & {
  current(): BroadcastContextSessionRecord;
} {
  let durable = cloneBroadcastContextSessionRecord(initial);
  return {
    getBroadcastContextSession: () =>
      Promise.resolve(cloneBroadcastContextSessionRecord(durable)),
    replaceBroadcastContextSessionIfUnchanged: (expected, replacement) => {
      if (JSON.stringify(durable) !== JSON.stringify(expected)) {
        return Promise.resolve(false);
      }
      durable = cloneBroadcastContextSessionRecord(replacement);
      return Promise.resolve(true);
    },
    current: () => cloneBroadcastContextSessionRecord(durable),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("loadDurableBroadcastContextSession", () => {
  it("loads only the exact current run and input snapshot", async () => {
    const session = makeSession();

    await expect(
      loadDurableBroadcastContextSession({
        store: readOnlyStore(() => Promise.resolve(session)),
        identity,
        isCurrent: (candidate) => candidate === identity,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: session,
      attempts: 1,
      recovered: false,
    });
  });

  it("retries transient IndexedDB failure and a missing snapshot", async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const read = vi
      .fn<() => Promise<BroadcastContextSessionRecord | null>>()
      .mockRejectedValueOnce(
        new AnalysisResultStoreError(
          "TRANSACTION_FAILED",
          "IndexedDB transaction was interrupted.",
        ),
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(session);

    const pending = loadDurableBroadcastContextSession({
      store: readOnlyStore(read),
      identity,
      isCurrent: () => true,
      policy: smallPolicy,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: session,
      attempts: 3,
      recovered: true,
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled read independently and retries it", async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const read = vi
      .fn<() => Promise<BroadcastContextSessionRecord | null>>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(session);

    const pending = loadDurableBroadcastContextSession({
      store: readOnlyStore(read),
      identity,
      isCurrent: () => true,
      policy: {
        ...smallPolicy,
        readbackTimeoutMs: 5,
      },
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: session,
      attempts: 2,
      recovered: true,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [
      makeSession("2026-07-29T00:00:00.000Z", { runId: "run-other" }),
      "broadcast_context_session_run_mismatch",
    ],
    [
      makeSession("2026-07-29T00:00:00.000Z", {
        inputSignature: `sha256:${"b".repeat(64)}`,
      }),
      "broadcast_context_session_input_mismatch",
    ],
  ])("treats a foreign current snapshot as stale", async (session, reasonCode) => {
    const result = await loadDurableBroadcastContextSession({
      store: readOnlyStore(() => Promise.resolve(session)),
      identity,
      isCurrent: () => true,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "stale",
      reasonCode,
      attempts: 1,
    });
  });

  it("rejects a non-current schema without migrating it", async () => {
    const legacy = {
      ...makeSession(),
      schemaVersion: "1.10.0",
    } as unknown as BroadcastContextSessionRecord;

    await expect(
      loadDurableBroadcastContextSession({
        store: readOnlyStore(() => Promise.resolve(legacy)),
        identity,
        isCurrent: () => true,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      reasonCode: "broadcast_context_session_schema_mismatch",
      attempts: 1,
    });
  });

  it("rejects an incomplete current-schema record instead of filling legacy fields", async () => {
    const incomplete = {
      ...makeSession(),
    } as unknown as Record<string, unknown>;
    delete incomplete.transcriptVisualInspectionCheckpointJson;

    await expect(
      loadDurableBroadcastContextSession({
        store: readOnlyStore(() =>
          Promise.resolve(
            incomplete as unknown as BroadcastContextSessionRecord,
          ),
        ),
        identity,
        isCurrent: () => true,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      reasonCode: "broadcast_context_session_record_invalid",
      attempts: 1,
    });
  });

  it("checks the run/token fence before reading storage", async () => {
    const read = vi.fn(() => Promise.resolve(makeSession()));

    await expect(
      loadDurableBroadcastContextSession({
        store: readOnlyStore(read),
        identity,
        isCurrent: () => false,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "stale",
      reasonCode: "analysis_mutation_fence_stale",
      attempts: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("transformDurableBroadcastContextSession", () => {
  it("commits one checkpoint and returns only its exact readback", async () => {
    const initial = makeSession();
    const store = exactStore(initial);
    const replacement = makeSession("2026-07-29T00:01:00.000Z", {
      modelRevision: "qwen3-asr-current|checkpoint",
    });

    const result = await transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform: () => replacement,
      isCurrent: () => true,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 1,
      recovered: false,
    });
    expect(store.current()).toEqual(replacement);
  });

  it("recovers an exact committed replacement when the token becomes stale after CAS", async () => {
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:01:30.000Z", {
      modelRevision: "qwen3-asr-current|committed-before-stale",
    });
    let durable = initial;
    let current = true;
    const replace = vi.fn(
      (
        _expected: BroadcastContextSessionRecord,
        next: BroadcastContextSessionRecord,
      ) => {
        durable = cloneBroadcastContextSessionRecord(next);
        current = false;
        return Promise.resolve(true);
      },
    );
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: replace,
      getBroadcastContextSession: () =>
        Promise.resolve(cloneBroadcastContextSessionRecord(durable)),
    };

    const result = await transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform: () => replacement,
      isCurrent: () => current,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 1,
      recovered: false,
    });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("reports a post-CAS stale conflict when exact readback is not the replacement", async () => {
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:01:40.000Z", {
      modelRevision: "qwen3-asr-current|attempted",
    });
    const concurrent = makeSession("2026-07-29T00:01:50.000Z", {
      modelRevision: "qwen3-asr-current|newer-operation",
    });
    let durable = initial;
    let current = true;
    const replace = vi.fn(() => {
      durable = concurrent;
      current = false;
      return Promise.resolve(true);
    });
    const transform = vi.fn(() => replacement);
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: replace,
      getBroadcastContextSession: () =>
        Promise.resolve(cloneBroadcastContextSessionRecord(durable)),
    };

    const result = await transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => current,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "stale",
      reasonCode:
        "broadcast_context_session_cas_conflict_after_fence_stale",
      attempts: 1,
    });
    expect(replace).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledOnce();
  });

  it("continues with readback only after a transient read failure and post-CAS stale token", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:01:55.000Z", {
      modelRevision: "qwen3-asr-current|readback-recovered",
    });
    let durable = initial;
    let current = true;
    let reads = 0;
    const replace = vi.fn(
      (
        _expected: BroadcastContextSessionRecord,
        next: BroadcastContextSessionRecord,
      ) => {
        durable = cloneBroadcastContextSessionRecord(next);
        current = false;
        return Promise.resolve(true);
      },
    );
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: replace,
      getBroadcastContextSession: () => {
        reads += 1;
        if (reads === 1) {
          return Promise.reject(
            new AnalysisResultStoreError(
              "TRANSACTION_FAILED",
              "Simulated transient readback failure.",
            ),
          );
        }
        return Promise.resolve(cloneBroadcastContextSessionRecord(durable));
      },
    };

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform: () => replacement,
      isCurrent: () => current,
      policy: smallPolicy,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 2,
      recovered: true,
    });
    expect(replace).toHaveBeenCalledOnce();
    expect(reads).toBe(2);
  });

  it("recovers a false CAS outcome when exact readback proves the replacement", async () => {
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:02:00.000Z", {
      refinementInputSignature: "semantic-refinement-v1",
      refinementCandidatesJson: "[]",
    });
    let durable = initial;
    const transform = vi.fn(() => replacement);
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: (_expected, next) => {
        durable = cloneBroadcastContextSessionRecord(next);
        return Promise.resolve(false);
      },
      getBroadcastContextSession: () => Promise.resolve(durable),
    };

    const result = await transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => true,
      policy: smallPolicy,
    });

    expect(result).toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 1,
      recovered: true,
    });
    expect(transform).toHaveBeenCalledOnce();
  });

  it("reuses one prepared replacement across a same-snapshot CAS retry", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    let durable = initial;
    let mutationCount = 0;
    const transform = vi.fn((expected: BroadcastContextSessionRecord) =>
      makeSession("2026-07-29T00:03:00.000Z", {
        modelRevision: `${expected.modelRevision}|checkpoint`,
      }),
    );
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: (expected, replacement) => {
        mutationCount += 1;
        if (mutationCount === 1) return Promise.resolve(false);
        if (JSON.stringify(durable) !== JSON.stringify(expected)) {
          return Promise.resolve(false);
        }
        durable = replacement;
        return Promise.resolve(true);
      },
      getBroadcastContextSession: () => Promise.resolve(durable),
    };

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => true,
      policy: smallPolicy,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      status: "succeeded",
      attempts: 2,
      recovered: true,
    });
    expect(transform).toHaveBeenCalledOnce();
    expect(mutationCount).toBe(2);
  });

  it("rebases the checkpoint builder only when conflict readback is a newer current snapshot", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    const concurrent = makeSession("2026-07-29T00:04:00.000Z", {
      modelRevision: "qwen3-asr-current|concurrent",
    });
    let durable = initial;
    let mutationCount = 0;
    const transformInputs: string[] = [];
    const transform = vi.fn((expected: BroadcastContextSessionRecord) => {
      transformInputs.push(expected.modelRevision);
      return makeSession("2026-07-29T00:05:00.000Z", {
        modelRevision: `${expected.modelRevision}|checkpoint`,
      });
    });
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: (expected, replacement) => {
        mutationCount += 1;
        if (mutationCount === 1) {
          durable = concurrent;
          return Promise.resolve(false);
        }
        if (JSON.stringify(durable) !== JSON.stringify(expected)) {
          return Promise.resolve(false);
        }
        durable = cloneBroadcastContextSessionRecord(replacement);
        return Promise.resolve(true);
      },
      getBroadcastContextSession: () =>
        Promise.resolve(cloneBroadcastContextSessionRecord(durable)),
    };

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => true,
      policy: smallPolicy,
    });
    await vi.runAllTimersAsync();

    const result = await pending;
    expect(result).toMatchObject({
      status: "succeeded",
      attempts: 2,
      recovered: true,
    });
    if (result.status !== "succeeded") {
      throw new Error("Expected a durable rebased session.");
    }
    expect(result.value.modelRevision).toBe(
      "qwen3-asr-current|concurrent|checkpoint",
    );
    expect(transformInputs).toEqual([
      "qwen3-asr-current",
      "qwen3-asr-current|concurrent",
    ]);
  });

  it("recovers a mutation timeout from exact readback without rebuilding", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:06:00.000Z", {
      refinementInputSignature: "semantic-refinement-v2",
      refinementCandidatesJson: "[]",
    });
    let durable = initial;
    const transform = vi.fn(() => replacement);
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: (_expected, next) => {
        durable = cloneBroadcastContextSessionRecord(next);
        return new Promise(() => undefined);
      },
      getBroadcastContextSession: () => Promise.resolve(durable),
    };

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => true,
      policy: {
        ...smallPolicy,
        mutationTimeoutMs: 5,
      },
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 1,
      recovered: true,
    });
    expect(transform).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient CAS storage failure without rebuilding the checkpoint", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    const replacement = makeSession("2026-07-29T00:07:00.000Z", {
      modelRevision: "qwen3-asr-current|storage-recovered",
    });
    let durable = initial;
    let mutationCount = 0;
    const transform = vi.fn(() => replacement);
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: (_expected, next) => {
        mutationCount += 1;
        if (mutationCount === 1) {
          return Promise.reject(
            new AnalysisResultStoreError(
              "TRANSACTION_FAILED",
              "IndexedDB transaction was interrupted.",
            ),
          );
        }
        durable = cloneBroadcastContextSessionRecord(next);
        return Promise.resolve(true);
      },
      getBroadcastContextSession: () => Promise.resolve(durable),
    };

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform,
      isCurrent: () => true,
      policy: smallPolicy,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      status: "succeeded",
      value: replacement,
      attempts: 2,
      recovered: true,
    });
    expect(transform).toHaveBeenCalledOnce();
    expect(mutationCount).toBe(2);
  });

  it("stops a CAS conflict when readback belongs to another input", async () => {
    const initial = makeSession();
    const foreign = makeSession("2026-07-29T00:08:00.000Z", {
      inputSignature: `sha256:${"e".repeat(64)}`,
    });
    const transform = vi.fn((expected: BroadcastContextSessionRecord) => ({
      ...expected,
      recordedAt: "2026-07-29T00:09:00.000Z",
    }));
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: () => Promise.resolve(false),
      getBroadcastContextSession: () => Promise.resolve(foreign),
    };

    await expect(
      transformDurableBroadcastContextSession({
        store,
        identity,
        expected: initial,
        transform,
        isCurrent: () => true,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "stale",
      reasonCode: "broadcast_context_session_input_mismatch",
      attempts: 1,
    });
    expect(transform).toHaveBeenCalledOnce();
  });

  it("stops a CAS conflict when readback is outside the current schema", async () => {
    const initial = makeSession();
    const legacy = {
      ...initial,
      schemaVersion: "1.10.0",
    } as unknown as BroadcastContextSessionRecord;
    const store: DurableBroadcastContextSessionStore = {
      replaceBroadcastContextSessionIfUnchanged: () => Promise.resolve(false),
      getBroadcastContextSession: () => Promise.resolve(legacy),
    };

    await expect(
      transformDurableBroadcastContextSession({
        store,
        identity,
        expected: initial,
        transform: (expected) => ({
          ...expected,
          recordedAt: "2026-07-29T00:10:00.000Z",
        }),
        isCurrent: () => true,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      reasonCode: "broadcast_context_session_schema_mismatch",
      attempts: 1,
    });
  });

  it("rejects a checkpoint builder that changes the durable input identity", async () => {
    const initial = makeSession();
    const store = exactStore(initial);

    await expect(
      transformDurableBroadcastContextSession({
        store,
        identity,
        expected: initial,
        transform: (expected) =>
          ({
            ...expected,
            inputSignature: `sha256:${"f".repeat(64)}`,
          }),
        isCurrent: () => true,
        policy: smallPolicy,
      }),
    ).resolves.toEqual({
      status: "permanent-failure",
      reasonCode: "broadcast_context_session_transform_identity_mismatch",
      attempts: 1,
    });
    expect(store.current()).toEqual(initial);
  });

  it("stops an in-flight operation when its AbortSignal is cancelled", async () => {
    vi.useFakeTimers();
    const initial = makeSession();
    const controller = new AbortController();
    const store = {
      getBroadcastContextSession: () => Promise.resolve(initial),
      replaceBroadcastContextSessionIfUnchanged: () =>
        new Promise<boolean>(() => undefined),
    } satisfies Pick<
      AnalysisResultStore,
      | "getBroadcastContextSession"
      | "replaceBroadcastContextSessionIfUnchanged"
    >;

    const pending = transformDurableBroadcastContextSession({
      store,
      identity,
      expected: initial,
      transform: (expected) => expected,
      isCurrent: () => true,
      signal: controller.signal,
      policy: smallPolicy,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "aborted",
      attempts: 1,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
