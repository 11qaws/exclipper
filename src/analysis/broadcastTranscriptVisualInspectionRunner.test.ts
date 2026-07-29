import { describe, expect, it, vi } from "vitest";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence as recordExactBroadcastTranscriptResolvedEvidence,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceReason,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
} from "./broadcastTranscriptVisualInspectionQueue";
import type {
  BroadcastTranscriptVisualHydratedMediaEvidence,
  BroadcastTranscriptVisualMediaFingerprinter,
} from "./broadcastTranscriptVisualMediaEvidence";
import {
  BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
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
const MEDIA_TEXT_ENCODER = new TextEncoder();
const MEDIA_TEXT_DECODER = new TextDecoder();
const NO_PARTICIPANTS = {
  presence: "none-present",
  summaryKo: "등장인물이 확인되지 않았습니다.",
  participants: [],
} as const;

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

function cellIdForChunk(
  plan: BroadcastTranscriptVisualInspectionPlan,
  chunkId: string,
): string {
  const cell = plan.cells.find(
    ({ transcriptChunkId }) => transcriptChunkId === chunkId,
  );
  if (cell === undefined) {
    throw new TypeError(`Missing visual inspection cell for ${chunkId}.`);
  }
  return cell.cellId;
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function frameFingerprints(
  cellId: string,
): BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"] {
  const alphabet = "123456789abcdef";
  const seed =
    [...cellId].reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % alphabet.length;
  return [0, 1, 2, 3].map(
    (offset) =>
      `sha256:${alphabet[(seed + offset) % alphabet.length]!.repeat(64)}`,
  ) as unknown as BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];
}

function audioFingerprint(cellId: string): string {
  const alphabet = "abcdef123456789";
  const seed =
    [...cellId].reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % alphabet.length;
  return `sha256:${alphabet[seed]!.repeat(64)}`;
}

function hydratedMediaEvidence(
  request: Parameters<
    RunBroadcastTranscriptVisualInspectionOptions["mediaEvidence"]["hydrate"]
  >[0],
): BroadcastTranscriptVisualHydratedMediaEvidence {
  return {
    planFingerprint: request.planFingerprint,
    sourceFingerprint: request.sourceFingerprint,
    cellId: request.task.cellId,
    sourceStartMs: request.task.sourceStartMs,
    sourceEndMs: request.task.sourceEndMs,
    frames: request.preparedReceipt.frameTimestampsMs.map(
      (timestampMs, index) => ({
        timestampMs,
        contentType: "image/jpeg",
        bytes: MEDIA_TEXT_ENCODER.encode(
          request.preparedReceipt.frameContentFingerprints[index],
        ),
      }),
    ) as unknown as BroadcastTranscriptVisualHydratedMediaEvidence["frames"],
    audio:
      request.preparedReceipt.audioEvidence === null
        ? null
        : {
            sourceStartMs: request.preparedReceipt.audioEvidence.sourceStartMs,
            sourceEndMs: request.preparedReceipt.audioEvidence.sourceEndMs,
            codec: request.preparedReceipt.audioEvidence.codec,
            extractionRevision:
              request.preparedReceipt.audioEvidence.extractionRevision,
            bytes: MEDIA_TEXT_ENCODER.encode(
              request.preparedReceipt.audioEvidence.contentFingerprint,
            ),
          },
  };
}

const decodePreparedFingerprint: BroadcastTranscriptVisualMediaFingerprinter =
  ({ bytes }) => MEDIA_TEXT_DECODER.decode(bytes);

function completedResults(
  requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
): readonly BroadcastTranscriptVisualProviderAdapterResult[] {
  return requests.map((request, index) => ({
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome: "completed",
    editorialFinding: index % 2 === 0 ? "quiet-success" : "visual-event",
    summaryKo:
      "네 장의 화면과 무발화 근거를 함께 검토해 장면의 의미를 확인했다.",
    providerResponseFingerprint: `sha256:${index
      .toString(16)
      .repeat(64)
      .slice(0, 64)}`,
    participantOutcome: NO_PARTICIPANTS,
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
  readonly prepareFrames?: (
    request: Parameters<
      RunBroadcastTranscriptVisualInspectionOptions["mediaEvidence"]["prepare"]
    >[0],
  ) => Promise<
    BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"]
  >;
  readonly hydrateMediaEvidence?: RunBroadcastTranscriptVisualInspectionOptions["mediaEvidence"]["hydrate"];
  readonly fingerprintMediaBytes?: BroadcastTranscriptVisualMediaFingerprinter;
  readonly executeProviderBatch?: RunBroadcastTranscriptVisualInspectionOptions["executeProviderBatch"];
  readonly maximumFrameConcurrency?: number;
  readonly maximumProviderBatchSize?: number;
  readonly maximumProviderAttemptCount?: number;
}): RunBroadcastTranscriptVisualInspectionOptions {
  return {
    plan: input.plan,
    checkpoint: input.checkpoint,
    providerModelRevision: "qwen-omni-visual-v1",
    mediaEvidence: {
      prepare: async (request) => {
        const frameContentFingerprints = await (
          input.prepareFrames ??
          (({ task }) => Promise.resolve(frameFingerprints(task.cellId)))
        )(request);
        return {
          frameContentFingerprints,
          audioEvidence:
            request.task.transcriptAbstentionReason === "no-audio"
              ? null
              : {
                  sourceStartMs: request.task.sourceStartMs,
                  sourceEndMs: request.task.sourceEndMs,
                  codec: "audio/wav;codecs=pcm_s16le",
                  extractionRevision:
                    BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
                  contentFingerprint: audioFingerprint(request.task.cellId),
                },
        };
      },
      hydrate:
        input.hydrateMediaEvidence ??
        ((request) => Promise.resolve(hydratedMediaEvidence(request))),
      fingerprint: input.fingerprintMediaBytes ?? decodePreparedFingerprint,
    },
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
          maximumProviderAttemptCount: input.maximumProviderAttemptCount,
        }),
  };
}

describe("broadcastTranscriptVisualInspectionRunner", () => {
  it("prepares every exact four-frame task with bounded concurrency and sends only prepared cells", async () => {
    const plan = inspectionPlan();
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    expect(initial.transportMode).toBe(
      BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
    );
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
          maximumActiveFrames = Math.max(maximumActiveFrames, activeFrames);
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
            expect(request.mediaEvidence.verified).toBe(true);
            expect(request.mediaEvidence.frames).toHaveLength(4);
            expect(request.mediaEvidence.audio === null).toBe(
              request.task.transcriptAbstentionReason === "no-audio",
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
        providerCellExecutionCount: 3,
      },
    });
    expect(result.statistics.providerBatchExecutionCount).toBeGreaterThan(0);
    expect(result.statistics.providerBatchExecutionCount).toBeLessThanOrEqual(
      3,
    );
    expect(
      transitions.filter(({ cause }) => cause === "frame-prepared"),
    ).toHaveLength(3);
    expect(storage.read()).toEqual(result.checkpoint);
  });

  it("dispatches the first fully persisted cell while later frame extraction is still running", async () => {
    const plan = inspectionPlan();
    const firstCellId = cellIdForChunk(plan, "asr-a");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const transitions: BroadcastTranscriptVisualInspectionPersistTransition[] =
      [];
    const storage = exactMemoryPersistence(initial, transitions);
    const releaseSlowExtractions = deferred();
    const providerStarted =
      deferred<readonly BroadcastTranscriptVisualProviderAttemptRequest[]>();
    let completedExtractionCount = 0;

    const runPromise = runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        maximumFrameConcurrency: 2,
        maximumProviderBatchSize: 2,
        prepareFrames: async ({ task }) => {
          if (task.cellId !== firstCellId) {
            await releaseSlowExtractions.promise;
          }
          completedExtractionCount += 1;
          return frameFingerprints(task.cellId);
        },
        executeProviderBatch: (requests) => {
          providerStarted.resolve(requests);
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    const firstProviderRequests = await providerStarted.promise;
    expect(firstProviderRequests.map(({ task }) => task.cellId)).toEqual([
      firstCellId,
    ]);
    expect(completedExtractionCount).toBeLessThan(plan.cells.length);
    expect(
      storage
        .read()
        .preparedFrameReceipts.some(({ cellId }) => cellId === firstCellId),
    ).toBe(true);
    expect(
      transitions.some(
        ({ cause, cellIds }) =>
          cause === "frame-prepared" && cellIds.includes(firstCellId),
      ),
    ).toBe(true);
    expect(
      transitions.some(
        ({ cause, cellIds }) =>
          cause === "provider-dispatch-armed" && cellIds.includes(firstCellId),
      ),
    ).toBe(true);

    releaseSlowExtractions.resolve(undefined);
    const result = await runPromise;
    expect(result.status).toBe("completed");
    expect(completedExtractionCount).toBe(plan.cells.length);
  });

  it("applies backpressure so slow provider work cannot make extraction fill the whole plan", async () => {
    const plan = inspectionPlan(["asr-a", "asr-b", "asr-c", "asr-d", "asr-e"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const storage = exactMemoryPersistence(initial);
    const firstProviderStarted = deferred();
    const releaseFirstProvider = deferred();
    let firstProviderCall = true;
    let startedExtractionCount = 0;

    const runPromise = runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        maximumFrameConcurrency: 2,
        maximumProviderBatchSize: 1,
        prepareFrames: async ({ task }) => {
          startedExtractionCount += 1;
          await Promise.resolve();
          return frameFingerprints(task.cellId);
        },
        executeProviderBatch: async (requests) => {
          if (firstProviderCall) {
            firstProviderCall = false;
            firstProviderStarted.resolve(undefined);
            await releaseFirstProvider.promise;
          }
          return completedResults(requests);
        },
      }),
    );

    await firstProviderStarted.promise;
    await Promise.resolve();
    expect(startedExtractionCount).toBe(2);
    expect(startedExtractionCount).toBeLessThan(plan.cells.length);

    releaseFirstProvider.resolve(undefined);
    const result = await runPromise;
    expect(result.status).toBe("completed");
    expect(startedExtractionCount).toBe(plan.cells.length);
  });

  it("never exposes a complete-looking or unpersisted cell to the provider before exact readback", async () => {
    const plan = inspectionPlan(["asr-a", "asr-b"]);
    const firstCellId = cellIdForChunk(plan, "asr-a");
    const secondCellId = cellIdForChunk(plan, "asr-b");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const firstFrameWriteStarted = deferred();
    const allowFirstFrameReadback = deferred();
    const releaseSecondExtraction = deferred();
    const firstProviderDispatch =
      deferred<readonly BroadcastTranscriptVisualProviderAttemptRequest[]>();
    let durable = structuredClone(initial);
    let firstFrameReadbackBlocked = true;
    const provider = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ) => {
        for (const request of requests) {
          const receipt = durable.preparedFrameReceipts.find(
            ({ cellId }) => cellId === request.task.cellId,
          );
          expect(receipt).toBeDefined();
          expect(receipt?.frameContentFingerprints).toHaveLength(4);
          expect(receipt?.audioEvidence).toEqual(request.task.audioEvidence);
          expect(request.mediaEvidence.verified).toBe(true);
        }
        firstProviderDispatch.resolve(requests);
        return Promise.resolve(completedResults(requests));
      },
    );
    const createProviderOperationId = vi.fn(
      ({
        cellId,
        attemptOrdinal,
      }: {
        readonly cellId: string;
        readonly attemptOrdinal: number;
      }) => `visual-operation:${cellId}:${attemptOrdinal}`,
    );
    const options = baseOptions({
      plan,
      checkpoint: initial,
      maximumFrameConcurrency: 2,
      maximumProviderBatchSize: 2,
      prepareFrames: async ({ task }) => {
        if (task.cellId === secondCellId) {
          await releaseSecondExtraction.promise;
        }
        return frameFingerprints(task.cellId);
      },
      persistAndReadback: async (attempted, transition) => {
        if (
          firstFrameReadbackBlocked &&
          transition.cause === "frame-prepared" &&
          transition.cellIds.includes(firstCellId)
        ) {
          firstFrameWriteStarted.resolve(undefined);
          await allowFirstFrameReadback.promise;
          firstFrameReadbackBlocked = false;
        }
        durable = structuredClone(attempted);
        return structuredClone(durable);
      },
      executeProviderBatch: provider,
    });

    const runPromise = runBroadcastTranscriptVisualInspection({
      ...options,
      createProviderOperationId,
    });
    await firstFrameWriteStarted.promise;
    await Promise.resolve();
    expect(provider).not.toHaveBeenCalled();
    expect(createProviderOperationId).not.toHaveBeenCalled();
    expect(durable.preparedFrameReceipts).toHaveLength(0);

    allowFirstFrameReadback.resolve(undefined);
    const firstRequests = await firstProviderDispatch.promise;
    expect(firstRequests.map(({ task }) => task.cellId)).toEqual([firstCellId]);
    expect(firstRequests.some(({ task }) => task.cellId === secondCellId)).toBe(
      false,
    );

    releaseSecondExtraction.resolve(undefined);
    const result = await runPromise;
    expect(result.status).toBe("completed");
    expect(provider).toHaveBeenCalled();
  });

  it("preserves successful frame receipts on partial failure and never sends the missing cell", async () => {
    const plan = inspectionPlan();
    const firstCellId = cellIdForChunk(plan, "asr-a");
    const missingCellId = cellIdForChunk(plan, "asr-b");
    const thirdCellId = cellIdForChunk(plan, "asr-c");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const storage = exactMemoryPersistence(initial);
    const providerCells: string[] = [];

    const first = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        prepareFrames: ({ task }) => {
          if (task.cellId === missingCellId) {
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
        missingPreparedCellIds: [missingCellId],
      },
    });
    expect(first.framePreparationFailures.map(({ cellId }) => cellId)).toEqual([
      missingCellId,
    ]);
    expect(providerCells).toEqual([firstCellId, thirdCellId]);

    const resumedProviderCells: string[] = [];
    const resumed = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: storage.read(),
        persistAndReadback: storage.persist,
        prepareFrames: ({ task }) => {
          expect(task.cellId).toBe(missingCellId);
          return Promise.resolve(frameFingerprints(task.cellId));
        },
        executeProviderBatch: (requests) => {
          resumedProviderCells.push(...requests.map(({ task }) => task.cellId));
          return Promise.resolve(completedResults(requests));
        },
      }),
    );
    expect(resumed.status).toBe("completed");
    expect(resumedProviderCells).toEqual([missingCellId]);
    expect(resumed.statistics.resumedPreparedFrameCount).toBe(2);
  });

  it("rejects a three-frame adapter result and never reaches the provider", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const cellId = cellIdForChunk(plan, "asr-a");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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
          Promise.resolve([
            `sha256:${"1".repeat(64)}`,
            `sha256:${"2".repeat(64)}`,
            `sha256:${"3".repeat(64)}`,
          ] as unknown as BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"]),
        executeProviderBatch: provider,
      }),
    );

    expect(result).toMatchObject({
      status: "blocked-frame-preparation",
      complete: false,
      publication: {
        publicationReady: false,
        missingPreparedCellIds: [cellId],
      },
    });
    expect(result.framePreparationFailures).toHaveLength(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("verifies rehydrated bytes before allocating or arming a provider operation", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const cellId = cellIdForChunk(plan, "asr-a");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const storage = exactMemoryPersistence(initial);
    const provider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const createProviderOperationId = vi.fn(
      ({
        cellId,
        attemptOrdinal,
      }: {
        readonly cellId: string;
        readonly attemptOrdinal: number;
      }) => `visual-operation:${cellId}:${attemptOrdinal}`,
    );
    const options = baseOptions({
      plan,
      checkpoint: initial,
      persistAndReadback: storage.persist,
      hydrateMediaEvidence: (request) => {
        const exact = hydratedMediaEvidence(request);
        return Promise.resolve({
          ...exact,
          frames: exact.frames.map((frame, index) => ({
            ...frame,
            bytes:
              index === 0
                ? MEDIA_TEXT_ENCODER.encode("tampered after preparation")
                : frame.bytes,
          })) as unknown as BroadcastTranscriptVisualHydratedMediaEvidence["frames"],
        });
      },
      executeProviderBatch: provider,
    });

    const result = await runBroadcastTranscriptVisualInspection({
      ...options,
      createProviderOperationId,
    });

    expect(result).toMatchObject({
      status: "blocked-frame-preparation",
      complete: false,
      publication: {
        publicationReady: false,
        pendingProviderCellIds: [cellId],
      },
    });
    expect(result.framePreparationFailures).toHaveLength(1);
    expect(createProviderOperationId).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(result.checkpoint.activeProviderDispatches).toHaveLength(0);
  });

  it("persists every retryable settlement before the next bounded automatic retry", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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
    const cellId = cellIdForChunk(plan, "asr-a");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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
        retryableCellIds: [cellId],
      },
    });
    expect(result.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "retryable",
      attemptOrdinal: 1,
    });
  });

  it("resumes an exhausted checkpoint with a fresh bounded attempt budget", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const firstStorage = exactMemoryPersistence(initial);
    const firstProvider = vi.fn(
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
    const exhausted = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        maximumProviderAttemptCount: 2,
        persistAndReadback: firstStorage.persist,
        executeProviderBatch: firstProvider,
      }),
    );
    const durableReceipt = structuredClone(
      exhausted.checkpoint.preparedFrameReceipts[0],
    );
    const durableRevision = exhausted.checkpoint.revision;
    const resumeStorage = exactMemoryPersistence(exhausted.checkpoint);
    const resumedAttempts: number[] = [];

    const resumed = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: exhausted.checkpoint,
        maximumProviderAttemptCount: 1,
        persistAndReadback: resumeStorage.persist,
        executeProviderBatch: (requests) => {
          resumedAttempts.push(
            ...requests.map(({ attemptOrdinal }) => attemptOrdinal),
          );
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    expect(resumedAttempts).toEqual([2]);
    expect(resumed).toMatchObject({
      status: "completed",
      complete: true,
      publication: { publicationReady: true },
    });
    expect(resumed.checkpoint.revision).toBeGreaterThan(durableRevision);
    expect(resumed.checkpoint.preparedFrameReceipts[0]).toEqual(durableReceipt);
    expect(resumed.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "completed",
      attemptOrdinal: 2,
    });
  });

  it("never re-dispatches a completed cell when a later invocation repairs its neighbor", async () => {
    const plan = inspectionPlan(["asr-a", "asr-b"]);
    const completedCellId = cellIdForChunk(plan, "asr-a");
    const retryableCellId = cellIdForChunk(plan, "asr-b");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const firstStorage = exactMemoryPersistence(initial);
    const firstBatches: string[][] = [];
    const first = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        maximumProviderBatchSize: 2,
        maximumProviderAttemptCount: 3,
        persistAndReadback: firstStorage.persist,
        executeProviderBatch: (requests) => {
          firstBatches.push(requests.map(({ task }) => task.cellId));
          return Promise.resolve(
            requests.map((request) =>
              request.task.cellId === completedCellId
                ? completedResults([request])[0]!
                : {
                    cellId: request.task.cellId,
                    operationId: request.operationId,
                    outcome: "retryable" as const,
                    failureReason: "provider-unavailable" as const,
                  },
            ),
          );
        },
      }),
    );

    expect(first.status).toBe("blocked-retry-limit");
    expect(firstBatches).toEqual([
      [completedCellId, retryableCellId],
      [retryableCellId],
      [retryableCellId],
    ]);

    const resumedStorage = exactMemoryPersistence(first.checkpoint);
    const resumedBatches: string[][] = [];
    const resumed = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: first.checkpoint,
        maximumProviderAttemptCount: 1,
        persistAndReadback: resumedStorage.persist,
        prepareFrames: () =>
          Promise.reject(
            new Error("Durable frame receipts must survive a fresh invocation."),
          ),
        executeProviderBatch: (requests) => {
          resumedBatches.push(requests.map(({ task }) => task.cellId));
          return Promise.resolve(completedResults(requests));
        },
      }),
    );

    expect(resumed.status).toBe("completed");
    expect(resumedBatches).toEqual([[retryableCellId]]);
    expect(
      resumed.checkpoint.providerLedger.settlements.find(
        ({ cellId }) => cellId === completedCellId,
      ),
    ).toMatchObject({ outcome: "completed", attemptOrdinal: 0 });
  });

  it("retries a free-r2 outcome-unknown only from a fresh invocation", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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

    const resumedProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const recovered = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: storage.read(),
        persistAndReadback: storage.persist,
        executeProviderBatch: resumedProvider,
      }),
    );
    expect(resumedProvider).toHaveBeenCalledTimes(1);
    expect(recovered).toMatchObject({
      status: "completed",
      statistics: { freeOutcomeUnknownRetryCount: 1 },
    });
    expect(recovered.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "completed",
      attemptOrdinal: 1,
    });
  });

  it("seals an interrupted free-r2 batch, then replaces it once from the fresh recovery invocation", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    let durable = structuredClone(initial);
    let providerCalls = 0;

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
            providerCalls += 1;
            return Promise.resolve(completedResults(requests));
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
    });
    expect(providerCalls).toBe(1);
    expect(durable.activeProviderDispatches).toHaveLength(1);
    expect(durable.providerLedger.settlements).toHaveLength(0);

    const recoveryStorage = exactMemoryPersistence(durable);
    const recoveryProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedResults(requests)),
    );
    const recovered = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: durable,
        persistAndReadback: recoveryStorage.persist,
        executeProviderBatch: recoveryProvider,
      }),
    );

    expect(recoveryProvider).toHaveBeenCalledOnce();
    expect(recovered).toMatchObject({
      status: "completed",
      complete: true,
      statistics: {
        recoveredDispatchCount: 1,
        freeOutcomeUnknownRetryCount: 1,
      },
      publication: { publicationReady: true },
    });
    expect(recovered.checkpoint.activeProviderDispatches).toEqual([]);
    expect(recovered.checkpoint.providerLedger.settlements[0]).toMatchObject({
      outcome: "completed",
      attemptOrdinal: 1,
    });
  });

  it("does not issue a provider request unless dispatch persistence and exact readback succeed", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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

  it("seals an interrupted free-r2 request as unknown instead of retrying inside the same invocation", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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
    const firstCellId = cellIdForChunk(plan, "asr-a");
    const secondCellId = cellIdForChunk(plan, "asr-b");
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
    const storage = exactMemoryPersistence(initial);

    const result = await runBroadcastTranscriptVisualInspection(
      baseOptions({
        plan,
        checkpoint: initial,
        persistAndReadback: storage.persist,
        maximumProviderBatchSize: 2,
        executeProviderBatch: () => Promise.resolve([]),
      }),
    );

    expect(result).toMatchObject({
      status: "blocked-outcome-unknown",
      complete: false,
      publication: {
        publicationReady: false,
        outcomeUnknownCellIds: [firstCellId, secondCellId],
      },
    });
  });

  it("surfaces the structured runner error with the last confirmed checkpoint", async () => {
    const plan = inspectionPlan(["asr-a"]);
    const initial = createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
    });
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
