import { describe, expect, it, vi } from "vitest";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence as recordExactBroadcastTranscriptResolvedEvidence,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceReason,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  BroadcastTranscriptVisualInspectionRunnerError,
  createBroadcastTranscriptVisualInspectionRunnerCheckpoint,
  runBroadcastTranscriptVisualInspection,
  type BroadcastTranscriptVisualInspectionPersistTransition,
  type BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualProviderAdapterResult,
  type BroadcastTranscriptVisualProviderAttemptRequest,
  type RunBroadcastTranscriptVisualInspectionOptions,
} from "./broadcastTranscriptVisualInspectionRunner";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;

function recordBroadcastTranscriptResolvedEvidence(
  current: BroadcastTranscriptResolvedEvidenceCheckpoint,
  chunkId: string,
  reason: BroadcastTranscriptResolvedEvidenceReason,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  const cell = current.plannedCells.find(
    (candidate) => candidate.chunkId === chunkId,
  );
  if (cell === undefined || reason === "no-audio") {
    return recordExactBroadcastTranscriptResolvedEvidence(
      current,
      chunkId,
      "no-audio",
      null,
    );
  }
  return recordExactBroadcastTranscriptResolvedEvidence(
    current,
    chunkId,
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(
      current.sourceDurationMs,
      cell.sourceStartMs,
      cell.sourceEndMs,
    ),
  );
}

function inspectionPlan(
  chunkIds: readonly string[] = ["asr-a", "asr-b", "asr-c"],
): BroadcastTranscriptVisualInspectionPlan {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: chunkIds.length * 30_000,
    transcriptInputSignature: "transcript-plan-v1",
    modelRevision: "qwen-asr-v1",
    plannedCells: chunkIds.map((chunkId, index) => ({
      chunkId,
      sourceStartMs: index * 30_000,
      sourceEndMs: (index + 1) * 30_000,
    })),
  });
  for (const [index, chunkId] of chunkIds.entries()) {
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      chunkId,
      index % 2 === 0 ? "no-speech" : "no-audio",
    );
  }
  return createBroadcastTranscriptVisualInspectionPlan(evidence);
}

function frameFingerprints(
  cellId: string,
): BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"] {
  const alphabet = "123456789abcdef";
  const seed =
    [...cellId].reduce((total, character) => total + character.charCodeAt(0), 0) %
    alphabet.length;
  return [0, 1, 2, 3].map(
    (offset) =>
      `sha256:${alphabet[(seed + offset) % alphabet.length]!.repeat(64)}`,
  ) as unknown as BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];
}

function completedResults(
  requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
): readonly BroadcastTranscriptVisualProviderAdapterResult[] {
  return requests.map((request, index) => ({
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome: "completed",
    editorialFinding: index % 2 === 0 ? "quiet-success" : "visual-event",
    summaryKo: "네 장의 화면과 무발화 근거를 함께 검토해 장면의 의미를 확인했다.",
    providerResponseFingerprint: `sha256:${index
      .toString(16)
      .repeat(64)
      .slice(0, 64)}`,
  }));
}

function exactMemoryPersistence(
  initial: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  transitions: BroadcastTranscriptVisualInspectionPersistTransition[] = [],
): {
  readonly persist: RunBroadcastTranscriptVisualInspectionOptions["persistAndReadback"];
  readonly read: () => BroadcastTranscriptVisualInspectionRunnerCheckpoint;
} {
  let durable = structuredClone(initial);
  return {
    persist: (checkpoint, transition) => {
      transitions.push(structuredClone(transition));
      durable = structuredClone(checkpoint);
      return Promise.resolve(structuredClone(durable));
    },
    read: () => structuredClone(durable),
  };
}

function baseOptions(input: {
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint;
  readonly persistAndReadback: RunBroadcastTranscriptVisualInspectionOptions["persistAndReadback"];
  readonly prepareFrames?: RunBroadcastTranscriptVisualInspectionOptions["prepareFrames"];
  readonly executeProviderBatch?: RunBroadcastTranscriptVisualInspectionOptions["executeProviderBatch"];
  readonly maximumFrameConcurrency?: number;
  readonly maximumProviderBatchSize?: number;
  readonly maximumProviderAttemptCount?: number;
  readonly confirmedOutcomeUnknownOperationIds?: readonly string[];
}): RunBroadcastTranscriptVisualInspectionOptions {
  return {
    plan: input.plan,
    checkpoint: input.checkpoint,
    providerModelRevision: "qwen-omni-visual-v1",
    prepareFrames:
      input.prepareFrames ??
      (({ task }) => Promise.resolve(frameFingerprints(task.cellId))),
    executeProviderBatch:
      input.executeProviderBatch ??
      ((requests) => Promise.resolve(completedResults(requests))),
    classifyProviderFailure: () => ({
      outcome: "retryable",
      failureReason: "provider-unavailable",
    }),
    createProviderOperationId: ({ cellId, attemptOrdinal }) =>
      `visual-operation:${cellId}:${attemptOrdinal}`,
    persistAndReadback: input.persistAndReadback,
    ...(input.maximumFrameConcurrency === undefined
      ? {}
      : { maximumFrameConcurrency: input.maximumFrameConcurrency }),
    ...(input.maximumProviderBatchSize === undefined
      ? {}
      : { maximumProviderBatchSize: input.maximumProviderBatchSize }),
    ...(input.maximumProviderAttemptCount === undefined
      ? {}
      : {
          maximumProviderAttemptCount:
            input.maximumProviderAttemptCount,
        }),
    ...(input.confirmedOutcomeUnknownOperationIds === undefined
      ? {}
      : {
          confirmedOutcomeUnknownOperationIds:
            input.confirmedOutcomeUnknownOperationIds,
        }),
  };
}

describe("broadcastTranscriptVisualInspectionRunner", () => {
  it("prepares every exact four-frame task with bounded concurrency, then sends only prepared cells", async () => {
    const plan = inspectionPlan();
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const transitions: BroadcastTranscriptVisualInspectionPersistTransition[] =
      [];
    const storage = exactMemoryPersistence(initial, transitions);
    let activeFrames = 0;
    let maximumActiveFrames = 0;
    const preparedCells: string[] = [];
    const providerCells: string[] = [];

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        maximumFrameConcurrency: 2,
        maximumProviderBatchSize: 2,
        prepareFrames: async ({ task }) => {
          expect(task.frameTimestampsMs).toHaveLength(4);
          expect(new Set(task.frameTimestampsMs).size).toBe(4);
          preparedCells.push(task.cellId);
          activeFrames += 1;
          maximumActiveFrames = Math.max(
            maximumActiveFrames,
            activeFrames,
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 2);
          });
          activeFrames -= 1;
          return frameFingerprints(task.cellId);
        },
        executeProviderBatch: (requests) => {
          expect(requests.length).toBeLessThanOrEqual(2);
          for (const request of requests) {
            providerCells.push(request.task.cellId);
            expect(request.task.frameContentFingerprints).toEqual(
              frameFingerprints(request.task.cellId),
            );
          }
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    expect(maximumActiveFrames).toBe(2);
    expect(new Set(preparedCells)).toEqual(
      new Set(plan.cells.map(({ cellId }) => cellId)),
    );
    expect(new Set(providerCells)).toEqual(
      new Set(plan.cells.map(({ cellId }) => cellId)),
    );
    expect(result).toMatchObject({
      status: "completed",
      complete: true,
      publication: { publicationReady: true },
      statistics: {
        preparedFrameCount: 3,
        providerBatchExecutionCount: 2,
        providerCellExecutionCount: 3,
      },
    });
    expect(
      transitions.filter(({ cause }) => cause === "frame-prepared"),
    ).toHaveLength(3);
    expect(storage.read()).toEqual(result.checkpoint);
  });

  it("preserves successful frame receipts on partial failure and never sends the missing cell", async () => {
    const plan = inspectionPlan();
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    const providerCells: string[] = [];

    const first = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        prepareFrames: ({ task }) => {
          if (task.cellId === "visual:asr-b") {
            throw new Error("decoder failed");
          }
          return Promise.resolve(frameFingerprints(task.cellId));
        },
        executeProviderBatch: (requests) => {
          providerCells.push(...requests.map(({ task }) => task.cellId));
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    expect(first).toMatchObject({
      status: "blocked-frame-preparation",
      complete: false,
      publication: {
        publicationReady: false,
        missingPreparedCellIds: ["visual:asr-b"],
      },
    });
    expect(first.framePreparationFailures.map(({ cellId }) => cellId)).toEqual([
      "visual:asr-b",
    ]);
    expect(providerCells).toEqual(["visual:asr-a", "visual:asr-c"]);

    const resumedProviderCells: string[] = [];
    const resumed = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: storage.read(),
        persistAndReadback: storage.persist,
        prepareFrames: ({ task }) => {
          expect(task.cellId).toBe("visual:asr-b");
          return Promise.resolve(frameFingerprints(task.cellId));
        },
        executeProviderBatch: (requests) => {
          resumedProviderCells.push(
            ...requests.map(({ task }) => task.cellId),
          );
          return Promise.resolve(completedResults(requests));
        },
      }),
    );
    expect(resumed.status).toBe("completed");
    expect(resumedProviderCells).toEqual(["visual:asr-b"]);
    expect(resumed.statistics.resumedPreparedFrameCount).toBe(2);
  });

  it("rejects a three-frame adapter result and never reaches the provider", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    const provider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        prepareFrames: () =>
          Promise.resolve(
            [
              `sha256:${"1".repeat(64)}`,
              `sha256:${"2".repeat(64)}`,
              `sha256:${"3".repeat(64)}`,
            ] as unknown as BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"],
          ),
        executeProviderBatch: provider,
      }),
    );

    expect(result).toMatchObject({
      status: "blocked-frame-preparation",
      complete: false,
      publication: {
        publicationReady: false,
        missingPreparedCellIds: ["visual:asr-a"],
      },
    });
    expect(result.framePreparationFailures).toHaveLength(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("persists every retryable settlement before the next bounded automatic retry", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const order: string[] = [];
    let durable = structuredClone(initial);
    const attempts: number[] = [];

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        maximumProviderAttemptCount: 3,
        persistAndReadback: (checkpoint, transition) => {
          order.push(`persist:${transition.cause}`);
          durable = structuredClone(checkpoint);
          return Promise.resolve(structuredClone(durable));
        },
        executeProviderBatch: (requests) => {
          const [request] = requests;
          expect(request).toBeDefined();
          attempts.push(request!.attemptOrdinal);
          order.push(`provider:${request!.attemptOrdinal}`);
          if (request!.attemptOrdinal < 2) {
            return Promise.resolve([
              {
                cellId: request!.task.cellId,
                operationId: request!.operationId,
                outcome: "retryable" as const,
                failureReason: "rate-limited" as const,
              },
            ]);
          }
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    expect(attempts).toEqual([0, 1, 2]);
    expect(order).toEqual([
      "persist:frame-prepared",
      "persist:provider-dispatch-armed",
      "provider:0",
      "persist:provider-settled",
      "persist:provider-dispatch-armed",
      "provider:1",
      "persist:provider-settled",
      "persist:provider-dispatch-armed",
      "provider:2",
      "persist:provider-settled",
    ]);
    expect(result).toMatchObject({
      status: "completed",
      statistics: { automaticRetryCount: 2 },
    });
  });

  it("stops at the retry bound and cannot report completed", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    const provider = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ): Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]> =>
        Promise.resolve(
          requests.map((request) => ({
            cellId: request.task.cellId,
            operationId: request.operationId,
            outcome: "retryable" as const,
            failureReason: "rate-limited" as const,
          })),
        ),
    );

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        maximumProviderAttemptCount: 2,
        persistAndReadback: storage.persist,
        executeProviderBatch: provider,
      }),
    );

    expect(provider).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "blocked-retry-limit",
      complete: false,
      publication: {
        publicationReady: false,
        retryableCellIds: ["visual:asr-a"],
      },
    });
    expect(result.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "retryable",
      attemptOrdinal: 1,
    });
  });

  it("never retries outcome-unknown without confirmation bound to its exact operation", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    const unknownProvider = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ): Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]> =>
        Promise.resolve(
          requests.map((request) => ({
            cellId: request.task.cellId,
            operationId: request.operationId,
            outcome: "outcome-unknown" as const,
            failureReason: "timeout-after-dispatch" as const,
          })),
        ),
    );
    const first = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        executeProviderBatch: unknownProvider,
      }),
    );
    expect(first.status).toBe("blocked-outcome-unknown");
    expect(unknownProvider).toHaveBeenCalledTimes(1);
    const unknownOperationId =
      first.checkpoint.providerLedger.settlements[0]?.operationId;
    expect(unknownOperationId).toBeDefined();

    const forbiddenRetry = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const untouched = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: storage.read(),
        persistAndReadback: storage.persist,
        executeProviderBatch: forbiddenRetry,
      }),
    );
    expect(untouched.status).toBe("blocked-outcome-unknown");
    expect(forbiddenRetry).not.toHaveBeenCalled();

    const confirmedProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const recovered = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: storage.read(),
        persistAndReadback: storage.persist,
        confirmedOutcomeUnknownOperationIds: [unknownOperationId!],
        executeProviderBatch: confirmedProvider,
      }),
    );
    expect(confirmedProvider).toHaveBeenCalledTimes(1);
    expect(recovered).toMatchObject({
      status: "completed",
      statistics: { confirmedOutcomeUnknownRetryCount: 1 },
    });
    expect(recovered.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "completed",
      attemptOrdinal: 1,
    });
  });

  it("recovers an armed batch as outcome-unknown and prevents duplicate billing after settlement persistence fails", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    let durable = structuredClone(initial);
    let paidCalls = 0;

    await expect(
      runBroadcastTranscriptVisualInspection(
        baseOptions({
          plan,
          checkpoint: initial,
          persistAndReadback: (checkpoint, transition) => {
            if (transition.cause === "provider-settled") {
              throw new Error("disk unavailable after provider response");
            }
            durable = structuredClone(checkpoint);
            return Promise.resolve(structuredClone(durable));
          },
          executeProviderBatch: (requests) => {
            paidCalls += 1;
            return Promise.resolve(completedResults(requests));
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
    });
    expect(paidCalls).toBe(1);
    expect(durable.activeProviderDispatches).toHaveLength(1);
    expect(durable.providerLedger.settlements).toHaveLength(0);

    const recoveryStorage = exactMemoryPersistence(durable);
    const duplicateProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const recovered = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: durable,
        persistAndReadback: recoveryStorage.persist,
        executeProviderBatch: duplicateProvider,
      }),
    );

    expect(duplicateProvider).not.toHaveBeenCalled();
    expect(recovered).toMatchObject({
      status: "blocked-outcome-unknown",
      complete: false,
      statistics: { recoveredDispatchCount: 1 },
      publication: { publicationReady: false },
    });
    expect(recovered.checkpoint.activeProviderDispatches).toEqual([]);
    expect(recovered.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "outcome-unknown",
      failureReason: "operation-interrupted",
    });
  });

  it("does not issue a provider request unless dispatch persistence and exact readback succeed", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    let durable = structuredClone(initial);
    const provider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );

    await expect(
      runBroadcastTranscriptVisualInspection(
        baseOptions({
          plan,
          checkpoint: initial,
          persistAndReadback: (checkpoint, transition) => {
            if (transition.cause === "provider-dispatch-armed") {
              throw new Error("cannot verify dispatch intent");
            }
            durable = structuredClone(checkpoint);
            return Promise.resolve(structuredClone(durable));
          },
          executeProviderBatch: provider,
        }),
      ),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
    });
    expect(provider).not.toHaveBeenCalled();

    await expect(
      runBroadcastTranscriptVisualInspection(
        baseOptions({
          plan,
          checkpoint: durable,
          persistAndReadback: (checkpoint, transition) => {
            if (transition.cause === "provider-dispatch-armed") {
              return Promise.resolve({
                ...checkpoint,
                revision: checkpoint.revision - 1,
              });
            }
            return Promise.resolve(structuredClone(checkpoint));
          },
          executeProviderBatch: provider,
        }),
      ),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_READBACK_MISMATCH",
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it("seals an interrupted paid request as unknown instead of classifying it retryable", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    const controller = new AbortController();
    const classifier = vi.fn(() => ({
      outcome: "retryable" as const,
      failureReason: "provider-unavailable" as const,
    }));

    const result = await runBroadcastTranscriptVisualInspection({
      ...baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        executeProviderBatch: () => {
          controller.abort();
          throw new Error("aborted after dispatch");
        },
      }),
      signal: controller.signal,
      classifyProviderFailure: classifier,
    });

    expect(classifier).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "blocked-outcome-unknown",
      complete: false,
      publication: { publicationReady: false },
    });
    expect(result.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "outcome-unknown",
      failureReason: "operation-interrupted",
    });
  });

  it("never reports completion when a provider batch returns incomplete or unmappable results", async () => {
    const plan = inspectionPlan(["asr-a", "asr-b"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        maximumProviderBatchSize: 2,
        executeProviderBatch: (requests) =>
          Promise.resolve(completedResults(requests).slice(0, 1)),
      }),
    );

    expect(result).toMatchObject({
      status: "blocked-outcome-unknown",
      complete: false,
      publication: {
        publicationReady: false,
        outcomeUnknownCellIds: ["visual:asr-a", "visual:asr-b"],
      },
    });
  });

  it("surfaces the structured runner error with the last confirmed checkpoint", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({ plan });
    const storage = exactMemoryPersistence(initial);
    let caught: unknown;
    try {
      await runBroadcastTranscriptVisualInspection(
        baseOptions({
          plan,
          checkpoint: initial,
          persistAndReadback: (checkpoint, transition) => {
            if (transition.cause === "frame-prepared") {
              throw new Error("write failed");
            }
            return storage.persist(checkpoint, transition);
          },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(
      BroadcastTranscriptVisualInspectionRunnerError,
    );
    expect(caught).toMatchObject({
      code: "PERSISTENCE_FAILED",
      lastPersistedCheckpoint: initial,
    });
  });
});
