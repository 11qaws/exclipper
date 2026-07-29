import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
} from "../analysis/broadcastTranscriptVisualInspectionQueue";
import {
  BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
  createBroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualProviderAdapterResult,
  type BroadcastTranscriptVisualProviderAttemptRequest,
} from "../analysis/broadcastTranscriptVisualInspectionRunner";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "../analysis/broadcastTranscriptResolvedEvidence";
import { BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION } from "../analysis/broadcastTranscriptVisualProviderClient";
import type { createBroadcastTranscriptVisualProviderBatchAdapter } from "../analysis/broadcastTranscriptVisualProviderClient";
import type {
  createBroadcastTranscriptVisualBrowserMediaAdapter,
  BroadcastTranscriptVisualBrowserMediaAdapter,
} from "../analysis/broadcastTranscriptVisualBrowserMedia";
import type {
  BroadcastTranscriptVisualHydratedFrames,
  BroadcastTranscriptVisualHydratedMediaEvidence,
} from "../analysis/broadcastTranscriptVisualMediaEvidence";
import {
  parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson,
  serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "../analysis/broadcastTranscriptVisualContextProjection";
import {
  AnalysisResultStoreError,
  InMemoryAnalysisResultStore,
} from "../storage/analysisResultStore";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  checkpointBroadcastContextSessionVisualInspection,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  runDurableBroadcastVisualInspectionPhase,
  DurableBroadcastVisualInspectionPhaseError,
  type RunDurableBroadcastVisualInspectionPhaseOptions,
} from "./durableBroadcastVisualInspectionPhase";

const RUN_ID = "run-visual-phase-current";
const INPUT_SIGNATURE = `sha256:${"a".repeat(64)}`;
const TRANSCRIPT_SEAL = `${RUN_ID}:source:event-boost:attempt-0`;
const SOURCE_DURATION_MS = 30_000;
const SOURCE_FILE = { name: "source.mp4" } as File;
const NO_PARTICIPANTS = {
  presence: "none-present",
  summaryKo: "검증된 네 화면에서 등장인물을 확인하지 못했습니다.",
  participants: [],
} as const;
const FRAME_FINGERPRINTS = [
  `sha256:${"1".repeat(64)}`,
  `sha256:${"2".repeat(64)}`,
  `sha256:${"3".repeat(64)}`,
  `sha256:${"4".repeat(64)}`,
] as const;
const AUDIO_FINGERPRINT = `sha256:${"5".repeat(64)}`;
const PROVIDER_FINGERPRINT = `sha256:${"6".repeat(64)}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createCurrentSession(): BroadcastContextSessionRecord {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: INPUT_SIGNATURE,
    sourceDurationMs: SOURCE_DURATION_MS,
    transcriptInputSignature: TRANSCRIPT_SEAL,
    modelRevision: "qwen3-asr-current",
    plannedCells: [
      {
        chunkId: "asr-no-speech-0",
        sourceStartMs: 0,
        sourceEndMs: SOURCE_DURATION_MS,
      },
    ],
  });
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "asr-no-speech-0",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(
      SOURCE_DURATION_MS,
      0,
      SOURCE_DURATION_MS,
    ),
  );
  return {
    kind: "broadcastContextSession",
    runId: RUN_ID,
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: INPUT_SIGNATURE,
    sourceDurationMs: SOURCE_DURATION_MS,
    completeAudioCoverage: true,
    chapters: [],
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: TRANSCRIPT_SEAL,
    transcriptEvidenceCheckpointJson:
      serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
    transcriptVisualInspectionCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: evidence.modelRevision,
    sourceCastRosterId: null,
    transcriptSealOperationKey: TRANSCRIPT_SEAL,
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
    recordedAt: "2026-07-29T00:00:00.000Z",
  };
}

function completedProviderResults(
  requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
): readonly BroadcastTranscriptVisualProviderAdapterResult[] {
  return requests.map((request) => ({
    cellId: request.task.cellId,
    operationId: request.operationId,
    outcome: "completed",
    editorialFinding: "quiet-success",
    summaryKo:
      "서로 다른 네 화면과 같은 구간의 오디오를 함께 검증해 조용한 사건을 확인했습니다.",
    providerResponseFingerprint: PROVIDER_FINGERPRINT,
    participantOutcome: NO_PARTICIPANTS,
  }));
}

function fakeMediaAdapterFactory(input: {
  readonly prepare?: BroadcastTranscriptVisualBrowserMediaAdapter["prepare"];
  readonly dispose?: BroadcastTranscriptVisualBrowserMediaAdapter["dispose"];
} = {}): typeof createBroadcastTranscriptVisualBrowserMediaAdapter {
  const factory: typeof createBroadcastTranscriptVisualBrowserMediaAdapter = ({
    plan,
  }) => {
    const prepare =
      input.prepare ??
      vi.fn<BroadcastTranscriptVisualBrowserMediaAdapter["prepare"]>(
        (): Promise<{
          readonly frameContentFingerprints: BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];
          readonly audioEvidence: NonNullable<
            BroadcastTranscriptVisualPreparedFrameReceipt["audioEvidence"]
          >;
        }> =>
          Promise.resolve({
            frameContentFingerprints: FRAME_FINGERPRINTS,
            audioEvidence: {
              sourceStartMs: 0,
              sourceEndMs: SOURCE_DURATION_MS,
              codec: "audio/wav;codecs=pcm_s16le",
              extractionRevision:
                BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
              contentFingerprint: AUDIO_FINGERPRINT,
            },
          }),
      );
    const adapter: BroadcastTranscriptVisualBrowserMediaAdapter = {
      planFingerprint: plan.planFingerprint,
      sourceFingerprint: plan.sourceFence.sourceFingerprint,
      prepare,
      hydrate: (request) => {
        const frames = request.preparedReceipt.frameTimestampsMs.map(
          (timestampMs, index) => ({
            timestampMs,
            contentType: "image/jpeg" as const,
            bytes: encoder.encode(
              request.preparedReceipt.frameContentFingerprints[index],
            ),
          }),
        ) as unknown as BroadcastTranscriptVisualHydratedFrames;
        const hydrated: BroadcastTranscriptVisualHydratedMediaEvidence = {
          planFingerprint: request.planFingerprint,
          sourceFingerprint: request.sourceFingerprint,
          cellId: request.task.cellId,
          sourceStartMs: request.task.sourceStartMs,
          sourceEndMs: request.task.sourceEndMs,
          frames,
          audio:
            request.preparedReceipt.audioEvidence === null
              ? null
              : {
                  sourceStartMs:
                    request.preparedReceipt.audioEvidence.sourceStartMs,
                  sourceEndMs:
                    request.preparedReceipt.audioEvidence.sourceEndMs,
                  codec: request.preparedReceipt.audioEvidence.codec,
                  extractionRevision:
                    request.preparedReceipt.audioEvidence.extractionRevision,
                  bytes: encoder.encode(
                    request.preparedReceipt.audioEvidence.contentFingerprint,
                  ),
                },
        };
        return Promise.resolve(hydrated);
      },
      fingerprint: ({ bytes }) => decoder.decode(bytes),
      clearCache: vi.fn<() => void>(() => undefined),
      dispose: input.dispose ?? vi.fn<() => void>(() => undefined),
    };
    return adapter;
  };
  return factory;
}

function fakeProviderAdapterFactory(
  executeProviderBatch: (
    requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
  ) => Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]>,
): typeof createBroadcastTranscriptVisualProviderBatchAdapter {
  const factory: typeof createBroadcastTranscriptVisualProviderBatchAdapter =
    () => ({
      transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
      providerModelRevision:
        BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
      executeProviderBatch,
    });
  return factory;
}

function phaseOptions(
  store: InMemoryAnalysisResultStore,
  overrides: Partial<RunDurableBroadcastVisualInspectionPhaseOptions> = {},
): RunDurableBroadcastVisualInspectionPhaseOptions {
  return {
    store,
    runId: RUN_ID,
    inputSignature: INPUT_SIGNATURE,
    operationToken: "visual-phase:attempt-0",
    transcriptSeal: TRANSCRIPT_SEAL,
    sourceDurationMs: SOURCE_DURATION_MS,
    sourceFile: SOURCE_FILE,
    participantId: "editor-local",
    castRosterId: null,
    outputLanguage: "ko",
    isCurrent: () => true,
    createMediaAdapter: fakeMediaAdapterFactory(),
    createProviderAdapter: fakeProviderAdapterFactory((requests) =>
      Promise.resolve(completedProviderResults(requests)),
    ),
    ...overrides,
  };
}

async function seededStore<
  Store extends InMemoryAnalysisResultStore = InMemoryAnalysisResultStore,
>(store: Store = new InMemoryAnalysisResultStore() as Store): Promise<Store> {
  await store.putBroadcastContextSession(createCurrentSession());
  return store;
}

function inspectionPlanForSession(session: BroadcastContextSessionRecord) {
  const evidence =
    session.transcriptEvidenceCheckpointJson === null
      ? null
      : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
          session.transcriptEvidenceCheckpointJson,
        );
  if (evidence === null) {
    throw new Error("The test session lost its transcript evidence.");
  }
  return createBroadcastTranscriptVisualInspectionPlan(evidence);
}

function preparedReceiptForPlan(
  plan: ReturnType<typeof inspectionPlanForSession>,
): BroadcastTranscriptVisualPreparedFrameReceipt {
  const cellId = plan.cells[0]?.cellId;
  if (cellId === undefined) {
    throw new Error("The test visual plan must contain one cell.");
  }
  return createBroadcastTranscriptVisualPreparedFrameReceipt({
    plan,
    cellId,
    frameContentFingerprints: FRAME_FINGERPRINTS,
    audioEvidence: {
      sourceStartMs: 0,
      sourceEndMs: SOURCE_DURATION_MS,
      codec: "audio/wav;codecs=pcm_s16le",
      extractionRevision:
        BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
      contentFingerprint: AUDIO_FINGERPRINT,
    },
  });
}

async function installRunnerCheckpoint(
  store: InMemoryAnalysisResultStore,
  checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  plan: ReturnType<typeof inspectionPlanForSession>,
): Promise<BroadcastContextSessionRecord> {
  const current = await store.getBroadcastContextSession(RUN_ID);
  if (current === null) {
    throw new Error("The test store lost its visual session.");
  }
  const replacement = checkpointBroadcastContextSessionVisualInspection(
    current,
    {
      transcriptVisualInspectionCheckpointJson:
        serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
          checkpoint,
          plan,
        ),
      recordedAt: "2026-07-29T00:01:00.000Z",
    },
  );
  await store.putBroadcastContextSession(replacement);
  return replacement;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runDurableBroadcastVisualInspectionPhase", () => {
  it("persists an exact current-schema frame and terminal checkpoint before completing", async () => {
    const store = await seededStore();
    const prepare =
      vi.fn<BroadcastTranscriptVisualBrowserMediaAdapter["prepare"]>(
        () =>
          Promise.resolve({
            frameContentFingerprints: FRAME_FINGERPRINTS,
            audioEvidence: {
              sourceStartMs: 0,
              sourceEndMs: SOURCE_DURATION_MS,
              codec: "audio/wav;codecs=pcm_s16le",
              extractionRevision:
                BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
              contentFingerprint: AUDIO_FINGERPRINT,
            },
          }),
      );
    const dispose = vi.fn<() => void>(() => undefined);
    const executeProviderBatch = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ) => Promise.resolve(completedProviderResults(requests)),
    );
    const progress = vi.fn();

    const result = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        createMediaAdapter: fakeMediaAdapterFactory({ prepare, dispose }),
        createProviderAdapter: fakeProviderAdapterFactory(
          executeProviderBatch,
        ),
        onProgress: progress,
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.projection?.publication).toMatchObject({
      plannedCellCount: 1,
      preparedCellCount: 1,
      completedCellIds: [result.plan.cells[0]?.cellId],
      publicationReady: true,
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(executeProviderBatch).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();

    const durable = await store.getBroadcastContextSession(RUN_ID);
    expect(durable).not.toBeNull();
    const exactCheckpointJson =
      serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
        result.projection!.runnerCheckpoint,
        result.plan,
      );
    expect(durable?.transcriptVisualInspectionCheckpointJson).toBe(
      exactCheckpointJson,
    );
    expect(
      parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
        durable!.transcriptVisualInspectionCheckpointJson!,
        result.plan,
      ),
    ).toEqual(result.projection?.runnerCheckpoint);
    const preparedReceipt =
      result.projection?.runnerCheckpoint.preparedFrameReceipts[0];
    expect(preparedReceipt?.frameContentFingerprints).toEqual(
      FRAME_FINGERPRINTS,
    );
    expect(preparedReceipt?.audioEvidence?.contentFingerprint).toBe(
      AUDIO_FINGERPRINT,
    );
    const terminalSettlement =
      result.projection?.runnerCheckpoint.providerLedger.settlements[0];
    expect(terminalSettlement).toMatchObject({
      outcome: "completed",
      providerResponseFingerprint: PROVIDER_FINGERPRINT,
      participantOutcome: NO_PARTICIPANTS,
    });
    expect(durable?.chapters).toEqual(result.projection?.chapters);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "analyzing",
        plannedCellCount: 1,
        preparedCellCount: 1,
        settledCellCount: 1,
      }),
    );
  });

  it("returns a publication-ready resumed checkpoint without decoding or dispatching again", async () => {
    const store = await seededStore();
    const first = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store),
    );
    expect(first.status).toBe("completed");
    const before = await store.getBroadcastContextSession(RUN_ID);
    const createMediaAdapter = vi.fn(() => {
      throw new Error("Completed work must not reopen media.");
    });
    const createProviderAdapter = vi.fn(() => {
      throw new Error("Completed work must not call the provider.");
    });

    const resumed = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:attempt-1",
        sourceFile: null,
        createMediaAdapter:
          createMediaAdapter as unknown as typeof createBroadcastTranscriptVisualBrowserMediaAdapter,
        createProviderAdapter:
          createProviderAdapter as unknown as typeof createBroadcastTranscriptVisualProviderBatchAdapter,
      }),
    );

    expect(resumed).toMatchObject({
      status: "completed",
      projection: {
        publication: { publicationReady: true },
      },
    });
    expect(createMediaAdapter).not.toHaveBeenCalled();
    expect(createProviderAdapter).not.toHaveBeenCalled();
    expect(await store.getBroadcastContextSession(RUN_ID)).toEqual(before);

  });

  it("automatically replaces a recovered active free-r2 dispatch after sealing its exact unknown operation", async () => {
    const store = await seededStore();
    const initialSession = await store.getBroadcastContextSession(RUN_ID);
    if (initialSession === null) {
      throw new Error("The test store lost its seeded session.");
    }
    const plan = inspectionPlanForSession(initialSession);
    const preparedReceipt = preparedReceiptForPlan(plan);
    const cellId = plan.cells[0]?.cellId;
    if (cellId === undefined) {
      throw new Error("The test visual plan must contain one cell.");
    }
    const activeOperationId = "visual-active-operation-0";
    const armedCheckpoint =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
        plan,
        revision: 2,
        preparedFrameReceipts: [preparedReceipt],
        activeProviderDispatches: [
          {
            transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
            cellId,
            operationId: activeOperationId,
            attemptOrdinal: 0,
            providerModelRevision:
              BROADCAST_TRANSCRIPT_VISUAL_PROVIDER_MODEL_REVISION,
            frameBundleKey: preparedReceipt.frameBundleKey,
            requestedFrameContentFingerprints:
              preparedReceipt.frameContentFingerprints,
            requestedAudioEvidence: preparedReceipt.audioEvidence,
            replacesOutcomeUnknown: false,
          },
        ],
      });
    await installRunnerCheckpoint(store, armedCheckpoint, plan);
    const prepare =
      vi.fn<BroadcastTranscriptVisualBrowserMediaAdapter["prepare"]>(() =>
        Promise.reject(
          new Error("A recovered prepared receipt must not be decoded again."),
        ),
      );
    const dispatched: BroadcastTranscriptVisualProviderAttemptRequest[] = [];
    const executeProviderBatch = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ) => {
        dispatched.push(...requests);
        return Promise.resolve(completedProviderResults(requests));
      },
    );

    const result = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:automatic-free-active",
        createMediaAdapter: fakeMediaAdapterFactory({ prepare }),
        createProviderAdapter: fakeProviderAdapterFactory(
          executeProviderBatch,
        ),
      }),
    );

    expect(result).toMatchObject({
      status: "completed",
      projection: {
        publication: { publicationReady: true },
      },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(executeProviderBatch).toHaveBeenCalledOnce();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.attemptOrdinal).toBe(1);
    expect(dispatched[0]?.task.cellId).toBe(cellId);
    expect(
      result.projection?.runnerCheckpoint.providerLedger.settlements,
    ).toEqual([
      expect.objectContaining({
        cellId,
        attemptOrdinal: 1,
        outcome: "completed",
      }),
    ]);
    expect(
      result.projection?.runnerCheckpoint.activeProviderDispatches,
    ).toEqual([]);
  });

  it("rejects a publication-ready settlement from any other provider model revision", async () => {
    const store = await seededStore();
    const first = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store),
    );
    if (first.status !== "completed" || first.projection === null) {
      throw new Error("The test setup did not produce a terminal checkpoint.");
    }
    const staleCheckpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint =
      {
        ...first.projection.runnerCheckpoint,
        providerLedger: {
          ...first.projection.runnerCheckpoint.providerLedger,
          settlements:
            first.projection.runnerCheckpoint.providerLedger.settlements.map(
              (settlement) => ({
                ...settlement,
                providerModelRevision: "retired-visual-model",
              }),
            ),
        },
      };
    await installRunnerCheckpoint(store, staleCheckpoint, first.plan);

    const pending = runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:stale-terminal",
        sourceFile: null,
      }),
    );

    await expect(pending).rejects.toBeInstanceOf(
      DurableBroadcastVisualInspectionPhaseError,
    );
    await expect(pending).rejects.toMatchObject({
      code: "VISUAL_CHECKPOINT_INVALID",
    });
  });

  it("rejects an armed dispatch from any other provider model revision before sealing or sending it", async () => {
    const store = await seededStore();
    const initialSession = await store.getBroadcastContextSession(RUN_ID);
    if (initialSession === null) {
      throw new Error("The test store lost its seeded session.");
    }
    const plan = inspectionPlanForSession(initialSession);
    const preparedReceipt = preparedReceiptForPlan(plan);
    const cellId = plan.cells[0]?.cellId;
    if (cellId === undefined) {
      throw new Error("The test visual plan must contain one cell.");
    }
    const staleCheckpoint =
      createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
        plan,
        revision: 2,
        preparedFrameReceipts: [preparedReceipt],
        activeProviderDispatches: [
          {
            transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
            cellId,
            operationId: "visual-stale-active-operation-0",
            attemptOrdinal: 0,
            providerModelRevision: "retired-visual-model",
            frameBundleKey: preparedReceipt.frameBundleKey,
            requestedFrameContentFingerprints:
              preparedReceipt.frameContentFingerprints,
            requestedAudioEvidence: preparedReceipt.audioEvidence,
            replacesOutcomeUnknown: false,
          },
        ],
      });
    const before = await installRunnerCheckpoint(
      store,
      staleCheckpoint,
      plan,
    );
    const createMediaAdapter = vi.fn();
    const createProviderAdapter = vi.fn();
    const pending = runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:stale-active",
        createMediaAdapter:
          createMediaAdapter as unknown as typeof createBroadcastTranscriptVisualBrowserMediaAdapter,
        createProviderAdapter:
          createProviderAdapter as unknown as typeof createBroadcastTranscriptVisualProviderBatchAdapter,
      }),
    );

    await expect(pending).rejects.toBeInstanceOf(
      DurableBroadcastVisualInspectionPhaseError,
    );
    await expect(pending).rejects.toMatchObject({
      code: "VISUAL_CHECKPOINT_INVALID",
    });
    expect(createMediaAdapter).not.toHaveBeenCalled();
    expect(createProviderAdapter).not.toHaveBeenCalled();
    expect(await store.getBroadcastContextSession(RUN_ID)).toEqual(before);

  });

  it("blocks a detached source while preserving every partial durable receipt and settlement", async () => {
    const store = await seededStore();
    const executeOutcomeUnknown = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ): Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]> =>
        Promise.resolve(
          requests.map((request) => ({
            cellId: request.task.cellId,
            operationId: request.operationId,
            outcome: "outcome-unknown",
            failureReason: "timeout-after-dispatch",
          })),
        ),
    );
    const partial = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        createProviderAdapter: fakeProviderAdapterFactory(
          executeOutcomeUnknown,
        ),
      }),
    );
    expect(partial).toMatchObject({
      status: "blocked",
      reason: "blocked-outcome-unknown",
      projection: {
        publication: {
          preparedCellCount: 1,
          outcomeUnknownCellIds: [partial.plan.cells[0]?.cellId],
          publicationReady: false,
        },
      },
    });
    const before = await store.getBroadcastContextSession(RUN_ID);
    expect(before?.transcriptVisualInspectionCheckpointJson).not.toBeNull();
    const createMediaAdapter = vi.fn();
    const createProviderAdapter = vi.fn();

    const detached = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:detached",
        sourceFile: null,
        createMediaAdapter:
          createMediaAdapter as unknown as typeof createBroadcastTranscriptVisualBrowserMediaAdapter,
        createProviderAdapter:
          createProviderAdapter as unknown as typeof createBroadcastTranscriptVisualProviderBatchAdapter,
      }),
    );

    expect(detached).toMatchObject({
      status: "blocked",
      reason: "source-file-required",
      projection: {
        publication: {
          preparedCellCount: 1,
          outcomeUnknownCellIds: [partial.plan.cells[0]?.cellId],
        },
      },
    });
    expect(createMediaAdapter).not.toHaveBeenCalled();
    expect(createProviderAdapter).not.toHaveBeenCalled();
    expect(await store.getBroadcastContextSession(RUN_ID)).toEqual(before);

    const resumedProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedProviderResults(requests)),
    );
    const resumed = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:automatic-free-resume",
        createMediaAdapter: fakeMediaAdapterFactory({
          prepare: () =>
            Promise.reject(
              new Error("The durable frame receipt must not be decoded again."),
            ),
        }),
        createProviderAdapter:
          fakeProviderAdapterFactory(resumedProvider),
      }),
    );
    expect(resumed.status).toBe("completed");
    expect(resumedProvider).toHaveBeenCalledOnce();
    expect(
      resumed.projection?.runnerCheckpoint.providerLedger.settlements[0],
    ).toMatchObject({ outcome: "completed", attemptOrdinal: 1 });
  });

  it("bounds a free-r2 invocation at three attempts, then resumes from the durable checkpoint", async () => {
    const store = await seededStore();
    const prepare = vi.fn<
      BroadcastTranscriptVisualBrowserMediaAdapter["prepare"]
    >((request) =>
      Promise.resolve({
        frameContentFingerprints: FRAME_FINGERPRINTS,
        audioEvidence: {
          sourceStartMs: request.task.sourceStartMs,
          sourceEndMs: request.task.sourceEndMs,
          codec: "audio/wav;codecs=pcm_s16le",
          extractionRevision:
            BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
          contentFingerprint: AUDIO_FINGERPRINT,
        },
      }),
    );
    const retryableProvider = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ): Promise<readonly BroadcastTranscriptVisualProviderAdapterResult[]> =>
        Promise.resolve(
          requests.map((request) => ({
            cellId: request.task.cellId,
            operationId: request.operationId,
            outcome: "retryable",
            failureReason: "rate-limited",
          })),
        ),
    );
    const first = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:g0",
        createMediaAdapter: fakeMediaAdapterFactory({ prepare }),
        createProviderAdapter:
          fakeProviderAdapterFactory(retryableProvider),
      }),
    );

    expect(first).toMatchObject({
      status: "blocked",
      reason: "blocked-retry-limit",
      projection: {
        runnerCheckpoint: {
          transportMode: BROADCAST_TRANSCRIPT_VISUAL_TRANSPORT_MODE,
        },
      },
    });
    expect(retryableProvider).toHaveBeenCalledTimes(3);
    expect(prepare).toHaveBeenCalledOnce();
    const preparedReceipt =
      first.projection?.runnerCheckpoint.preparedFrameReceipts[0];

    const completedProvider = vi.fn(
      (requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[]) =>
        Promise.resolve(completedProviderResults(requests)),
    );
    const resumed = await runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        operationToken: "visual-phase:g1",
        createMediaAdapter: fakeMediaAdapterFactory({ prepare }),
        createProviderAdapter:
          fakeProviderAdapterFactory(completedProvider),
      }),
    );

    expect(resumed.status).toBe("completed");
    expect(completedProvider).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(
      resumed.projection?.runnerCheckpoint.preparedFrameReceipts[0],
    ).toEqual(preparedReceipt);
    expect(
      resumed.projection?.runnerCheckpoint.providerLedger.settlements[0],
    ).toMatchObject({ outcome: "completed", attemptOrdinal: 3 });
  });

  it("recovers a transient CAS conflict and readback failure without repeating settled provider work", async () => {
    vi.useFakeTimers();
    class RecoveringStore extends InMemoryAnalysisResultStore {
      public casCallCount = 0;
      public readbackFailureCount = 0;
      private failCommittedReadback = false;

      public override replaceBroadcastContextSessionIfUnchanged(
        expected: BroadcastContextSessionRecord,
        replacement: BroadcastContextSessionRecord,
      ): Promise<boolean> {
        this.casCallCount += 1;
        if (this.casCallCount === 1) {
          return Promise.resolve(false);
        }
        return super
          .replaceBroadcastContextSessionIfUnchanged(expected, replacement)
          .then((replaced) => {
            if (replaced && this.readbackFailureCount === 0) {
              this.failCommittedReadback = true;
            }
            return replaced;
          });
      }

      public override getBroadcastContextSession(
        runId: string,
      ): Promise<BroadcastContextSessionRecord | null> {
        if (this.failCommittedReadback) {
          this.failCommittedReadback = false;
          this.readbackFailureCount += 1;
          return Promise.reject(
            new AnalysisResultStoreError(
              "TRANSACTION_FAILED",
              "Transient readback failure.",
            ),
          );
        }
        return super.getBroadcastContextSession(runId);
      }
    }
    const store = await seededStore(new RecoveringStore());
    const executeProviderBatch = vi.fn(
      (
        requests: readonly BroadcastTranscriptVisualProviderAttemptRequest[],
      ) => Promise.resolve(completedProviderResults(requests)),
    );

    const pending = runDurableBroadcastVisualInspectionPhase(
      phaseOptions(store, {
        createProviderAdapter: fakeProviderAdapterFactory(
          executeProviderBatch,
        ),
      }),
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toMatchObject({
      status: "completed",
      projection: {
        publication: { publicationReady: true },
      },
    });
    expect(executeProviderBatch).toHaveBeenCalledOnce();
    expect(store.casCallCount).toBe(4);
    expect(store.readbackFailureCount).toBe(1);
    expect(
      (await store.getBroadcastContextSession(RUN_ID))
        ?.transcriptVisualInspectionCheckpointJson,
    ).toBe(
      serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
        result.projection!.runnerCheckpoint,
        result.plan,
      ),
    );
  });
});
