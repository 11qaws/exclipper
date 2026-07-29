import { describe, expect, it, vi } from "vitest";

import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import {
  createBroadcastRefinementTranscriptCheckpoint,
  recordBroadcastRefinementTranscriptGap,
  recordBroadcastRefinementTranscriptSuccess,
  serializeBroadcastRefinementTranscriptCheckpoint,
} from "../analysis/broadcastRefinementTranscriptCheckpoint";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
} from "../analysis/broadcastTranscriptQwen";
import type { BroadcastTranscriptVerifiedResult } from "../analysis/broadcastTranscriptRouteManifest";
import type { BroadcastTranscriptWorkerRunResult } from "../analysis/broadcastTranscriptWorkerClient";
import type { AnalysisResultStore } from "../storage/analysisResultStore";
import {
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import {
  runDurableBroadcastRefinementTranscriptPipeline,
  type DurableBroadcastRefinementTranscriptAttemptPersistence,
} from "./durableBroadcastRefinementTranscriptPipeline";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import { createCurrentVisualParticipantPipelineFixture } from "../testSupport/currentVisualParticipantPipelineFixture";

const chunks: readonly BroadcastContextTranscriptionChunk[] = [
  {
    chunkId: "refine-a",
    sourceStartMs: 10_000,
    sourceEndMs: 40_000,
    kind: "event",
  },
  {
    chunkId: "refine-b",
    sourceStartMs: 50_000,
    sourceEndMs: 80_000,
    kind: "event",
  },
];

/* Removed pre-visual participant fixture:
    summaryKo: "스트리머가 방송에서 여러 음식에 관해 이야기한다.",
*/

const currentSessionFixture =
  await createCurrentVisualParticipantPipelineFixture();

function transcript(
  chunk: BroadcastContextTranscriptionChunk,
): BroadcastTranscriptVerifiedResult {
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    providerReceipt: {
      schemaVersion: "1.0.0",
      routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
      provider: "qwen",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      fallbackUsed: false,
    },
    sourceStartMs: chunk.sourceStartMs,
    sourceEndMs: chunk.sourceEndMs,
    textKo: "스트리머가 조용히 문제를 해결하고 안도하며 웃었다.",
    detectedLanguage: "ko",
    emotion: "relief",
    billedSeconds: 30,
  };
}

function session(
  overrides: Partial<BroadcastContextSessionRecord> = {},
): BroadcastContextSessionRecord {
  const base: BroadcastContextSessionRecord = {
    ...currentSessionFixture.input.session,
    runId: "run-1",
    refinementTranscriptInputSignature: null,
    refinementTranscriptCheckpointJson: null,
    refinementEvidenceLedgerJson: null,
    refinementInputSignature: null,
    refinementCandidatesJson: null,
    recordedAt: "2026-07-29T00:00:00.000Z",
  };
  return {
    ...base,
    ...overrides,
  };
}

function storeFor(initial: BroadcastContextSessionRecord): {
  readonly store: Pick<
    AnalysisResultStore,
    "getBroadcastContextSession" | "replaceBroadcastContextSessionIfUnchanged"
  >;
  current: BroadcastContextSessionRecord;
} {
  const holder = {
    current: initial,
    store: {
      getBroadcastContextSession: vi.fn((runId: string) =>
        Promise.resolve(
          runId === holder.current.runId ? holder.current : null,
        ),
      ),
      replaceBroadcastContextSessionIfUnchanged: vi.fn(
        (
          expected: BroadcastContextSessionRecord,
          replacement: BroadcastContextSessionRecord,
        ) => {
          if (
            JSON.stringify(expected) !== JSON.stringify(holder.current)
          ) {
            return Promise.resolve(false);
          }
          holder.current = replacement;
          return Promise.resolve(true);
        },
      ),
    },
  };
  return holder;
}

function settled(
  requested: readonly BroadcastContextTranscriptionChunk[],
  kind: "success" | "retryable" | "unknown" | "no-speech" = "success",
): BroadcastTranscriptWorkerRunResult {
  const fragments =
    kind === "success"
      ? requested.map((chunk) => ({
          chunkId: chunk.chunkId,
          result: transcript(chunk),
        }))
      : [];
  const abstentions =
    kind === "no-speech"
      ? requested.map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "no-speech" as const,
          speechActivityReceipt: createVerifiedNoSpeechRunReceiptForTest(
            120_000,
            chunk.sourceStartMs,
            chunk.sourceEndMs,
          ),
        }))
      : [];
  const gaps =
    kind === "retryable" || kind === "unknown"
      ? requested.map(({ chunkId }) => ({
          chunkId,
          reason:
            kind === "retryable"
              ? ("transcription-failed" as const)
              : ("outcome-unknown" as const),
        }))
      : [];
  return {
    fragments,
    results: fragments.map(({ result }) => result),
    abstentions,
    abstainedChunkIds: abstentions.map(({ chunkId }) => chunkId),
    gaps,
    gapChunkIds: gaps.map(({ chunkId }) => chunkId),
    requestedCount: requested.length,
    concurrencyOutcome: "test",
  };
}

async function settleWithPersistence(
  requested: readonly BroadcastContextTranscriptionChunk[],
  quotaAttemptOrdinal: number,
  persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
  result: BroadcastTranscriptWorkerRunResult = settled(requested),
): Promise<BroadcastTranscriptWorkerRunResult> {
  const fragmentById = new Map(
    result.fragments.map((fragment) => [fragment.chunkId, fragment]),
  );
  const abstentionById = new Map(
    result.abstentions.map((abstention) => [abstention.chunkId, abstention]),
  );
  const gapById = new Map(result.gaps.map((gap) => [gap.chunkId, gap]));
  for (const chunk of requested) {
    const abstention = abstentionById.get(chunk.chunkId);
    if (abstention !== undefined) {
      await persistence.onChunkAbstention(abstention);
      continue;
    }
    await persistence.onDispatchIntent({
      operationId: `transcript-refinement-g${quotaAttemptOrdinal}-${chunk.chunkId}`,
      chunkId: chunk.chunkId,
      sourceStartMs: chunk.sourceStartMs,
      sourceEndMs: chunk.sourceEndMs,
      attemptOrdinal: quotaAttemptOrdinal,
      operationNamespace: "refinement",
      operationScope: null,
      routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
    });
    const fragment = fragmentById.get(chunk.chunkId);
    if (fragment !== undefined) {
      await persistence.onPartialResult(fragment.chunkId, fragment.result);
      continue;
    }
    const gap = gapById.get(chunk.chunkId);
    if (gap === undefined) {
      throw new Error("Test settlement fixture is incomplete.");
    }
    await persistence.onChunkGap(gap.chunkId, gap.reason);
  }
  return result;
}

describe("runDurableBroadcastRefinementTranscriptPipeline", () => {
  it("seals in-flight before dispatch and read-backs every successful settlement", async () => {
    const holder = storeFor(session());
    const runAttempt = vi.fn(
      async (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        ),
    );

    const result = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks,
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt,
    });

    expect(result.status).toBe("completed");
    expect(result.fragments).toHaveLength(2);
    expect(result.checkpoint.gaps).toEqual([]);
    expect(
      holder.store.replaceBroadcastContextSessionIfUnchanged,
    ).toHaveBeenCalledTimes(5);
  });

  it("resumes successful fragments and requests only a retryable gap", async () => {
    let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-transcript-v1",
      plannedChunks: chunks,
    });
    checkpoint = recordBroadcastRefinementTranscriptSuccess(
      checkpoint,
      "refine-a",
      transcript(chunks[0] as BroadcastContextTranscriptionChunk),
    );
    checkpoint = recordBroadcastRefinementTranscriptGap(checkpoint, {
      chunkId: "refine-b",
      reason: "rate-limited",
      attemptCount: 3,
    });
    const holder = storeFor(
      session({
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        refinementTranscriptCheckpointJson:
          serializeBroadcastRefinementTranscriptCheckpoint(checkpoint),
      }),
    );
    const runAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        ),
    );

    const result = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks,
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt,
    });

    expect(result.complete).toBe(true);
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(runAttempt.mock.calls[0]?.[0].map(({ chunkId }) => chunkId)).toEqual([
      "refine-b",
    ]);
  });

  it("continues after one bounded three-wave batch under a new durable generation", async () => {
    const holder = storeFor(session());
    const ordinals: number[] = [];
    let callCount = 0;
    const runAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) => {
        ordinals.push(quotaAttemptOrdinal);
        callCount += 1;
        return settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
          settled(requested, callCount < 5 ? "retryable" : "success"),
        );
      },
    );
    const wait = vi.fn(() => Promise.resolve());

    const result = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks,
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt,
      wait,
    });

    expect(result.status).toBe("completed");
    expect(result.providerAttemptCount).toBe(5);
    expect(ordinals).toEqual([0, 1, 2, 4, 5]);
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect(wait).toHaveBeenCalledTimes(4);
  });

  it("starts a fresh checkpoint when the exact input signature changes", async () => {
    const previousSignature = "refinement-transcript-v3";
    const currentSignature = "refinement-transcript-v4";
    let previousCheckpoint =
      createBroadcastRefinementTranscriptCheckpoint({
        refinementInputSignature: previousSignature,
        plannedChunks: chunks,
      });
    for (const chunk of chunks) {
      previousCheckpoint = recordBroadcastRefinementTranscriptSuccess(
        previousCheckpoint,
        chunk.chunkId,
        {
          ...transcript(chunk),
          textKo: "이전 입력에서 저장된 대사이므로 현재 실행에서 재사용하면 안 됩니다.",
        },
      );
    }
    const holder = storeFor(
      session({
        refinementTranscriptInputSignature: previousSignature,
        refinementTranscriptCheckpointJson:
          serializeBroadcastRefinementTranscriptCheckpoint(
            previousCheckpoint,
          ),
      }),
    );
    const runAttempt = vi.fn(
      async (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) => {
        const currentCheckpoint = JSON.parse(
          holder.current.refinementTranscriptCheckpointJson!,
        ) as {
          readonly refinementInputSignature: string;
          readonly successfulFragments: readonly unknown[];
          readonly gaps: readonly {
            readonly chunkId: string;
            readonly reason: string;
          }[];
        };
        expect(holder.current.refinementTranscriptInputSignature).toBe(
          currentSignature,
        );
        expect(currentCheckpoint.refinementInputSignature).toBe(
          currentSignature,
        );
        expect(currentCheckpoint.successfulFragments).toEqual([]);
        expect(currentCheckpoint.gaps).toEqual([]);
        return settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        );
      },
    );

    const result = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: currentSignature,
      chunks,
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt,
    });

    expect(result.status).toBe("completed");
    expect(result.checkpoint.refinementInputSignature).toBe(currentSignature);
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(
      runAttempt.mock.calls[0]?.[0].map(({ chunkId }) => chunkId),
    ).toEqual(["refine-a", "refine-b"]);
    expect(
      result.fragments.map(({ result: fragmentResult }) =>
        fragmentResult.textKo,
      ),
    ).not.toContain(
      "이전 입력에서 저장된 대사이므로 현재 실행에서 재사용하면 안 됩니다.",
    );
  });

  it("preserves completed cells across route drift and recovers only the changed route on the next run", async () => {
    const completedChunk =
      chunks[0] as BroadcastContextTranscriptionChunk;
    const routeChangedChunk =
      chunks[1] as BroadcastContextTranscriptionChunk;
    const holder = storeFor(session());
    const firstResult = transcript(completedChunk);
    const firstAttempt = vi.fn(
      async (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ): Promise<BroadcastTranscriptWorkerRunResult> => {
        const result: BroadcastTranscriptWorkerRunResult = {
          fragments: [
            {
              chunkId: completedChunk.chunkId,
              result: firstResult,
            },
          ],
          results: [firstResult],
          abstentions: [],
          abstainedChunkIds: [],
          gaps: [
            {
              chunkId: routeChangedChunk.chunkId,
              reason: "route-changed",
            },
          ],
          gapChunkIds: [routeChangedChunk.chunkId],
          requestedCount: requested.length,
          concurrencyOutcome: "test",
        };
        return settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
          result,
        );
      },
    );

    const interrupted =
      await runDurableBroadcastRefinementTranscriptPipeline({
        store: holder.store,
        initialSession: holder.current,
        runId: "run-1",
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        chunks,
        editorRetryGeneration: 0,
        allowOutcomeUnknownRetry: false,
        runAttempt: firstAttempt,
      });

    expect(interrupted.status).toBe("blocked-retryable-gap");
    expect(
      interrupted.fragments.map(({ chunkId }) => chunkId),
    ).toEqual(["refine-a"]);
    expect(interrupted.blockingGaps).toEqual([
      {
        chunkId: "refine-b",
        reason: "route-changed",
        attemptCount: 1,
      },
    ]);

    const nextAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        ),
    );
    const recovered =
      await runDurableBroadcastRefinementTranscriptPipeline({
        store: holder.store,
        initialSession: holder.current,
        runId: "run-1",
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        chunks,
        editorRetryGeneration: 0,
        allowOutcomeUnknownRetry: false,
        runAttempt: nextAttempt,
      });

    expect(firstAttempt).toHaveBeenCalledTimes(1);
    expect(nextAttempt).toHaveBeenCalledTimes(1);
    expect(
      nextAttempt.mock.calls[0]?.[0].map(({ chunkId }) => chunkId),
    ).toEqual(["refine-b"]);
    expect(recovered.status).toBe("completed");
    expect(
      recovered.fragments.map(({ chunkId }) => chunkId),
    ).toEqual(["refine-a", "refine-b"]);
    expect(recovered.checkpoint.gaps).toEqual([]);
  });

  it("does not silently resend an ambiguous paid chunk, then allows an editor retry", async () => {
    let checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-transcript-v1",
      plannedChunks: [chunks[0] as BroadcastContextTranscriptionChunk],
    });
    checkpoint = recordBroadcastRefinementTranscriptGap(checkpoint, {
      chunkId: "refine-a",
      reason: "outcome-unknown",
      attemptCount: 9,
    });
    const holder = storeFor(
      session({
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        refinementTranscriptCheckpointJson:
          serializeBroadcastRefinementTranscriptCheckpoint(checkpoint),
      }),
    );
    const runAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        ),
    );

    const blocked = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks: [chunks[0] as BroadcastContextTranscriptionChunk],
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt,
    });
    expect(blocked.status).toBe("blocked-outcome-unknown");
    expect(runAttempt).not.toHaveBeenCalled();

    const recovered = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks: [chunks[0] as BroadcastContextTranscriptionChunk],
      editorRetryGeneration: 1,
      allowOutcomeUnknownRetry: true,
      runAttempt,
    });
    expect(recovered.status).toBe("completed");
    expect(runAttempt).toHaveBeenCalledTimes(1);
  });

  it("treats confirmed no-speech as complete video evidence without ASR text", async () => {
    const holder = storeFor(session());
    const result = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-v1",
      chunks: [chunks[0] as BroadcastContextTranscriptionChunk],
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt: (
        requested,
        quotaAttemptOrdinal,
        _attemptIndex,
        persistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
          settled(requested, "no-speech"),
        ),
    });

    expect(result.complete).toBe(true);
    expect(result.fragments).toEqual([]);
    expect(result.abstentions).toEqual([
      expect.objectContaining({
        chunkId: "refine-a",
        reason: "no-speech",
      }),
    ]);
  });

  it("marks exactly the 190 ACKed cells ambiguous after a 200-cell worker crash", async () => {
    const manyChunks = Array.from({ length: 200 }, (_, index) => ({
      chunkId: `refine-${String(index + 1).padStart(3, "0")}`,
      sourceStartMs: index * 500,
      sourceEndMs: (index + 1) * 500,
      kind: "event" as const,
    }));
    const holder = storeFor(session());

    await expect(
      runDurableBroadcastRefinementTranscriptPipeline({
        store: holder.store,
        initialSession: holder.current,
        runId: "run-1",
        refinementTranscriptInputSignature: "refinement-transcript-200",
        chunks: manyChunks,
        editorRetryGeneration: 0,
        allowOutcomeUnknownRetry: false,
        runAttempt: async (
          requested,
          quotaAttemptOrdinal,
          _attemptIndex,
          persistence,
        ) => {
          for (const chunk of requested.slice(0, 190)) {
            await persistence.onDispatchIntent({
              operationId:
                `transcript-refinement-g${quotaAttemptOrdinal}-${chunk.chunkId}`,
              chunkId: chunk.chunkId,
              sourceStartMs: chunk.sourceStartMs,
              sourceEndMs: chunk.sourceEndMs,
              attemptOrdinal: quotaAttemptOrdinal,
              operationNamespace: "refinement",
              operationScope: null,
              routeManifestFingerprint: `sha256:${"1".repeat(64)}`,
            });
          }
          throw new Error("worker crashed at cell 190");
        },
      }),
    ).rejects.toThrow("worker crashed at cell 190");

    const crashedCheckpoint = JSON.parse(
      holder.current.refinementTranscriptCheckpointJson!,
    ) as {
      readonly gaps: readonly {
        readonly chunkId: string;
        readonly reason: string;
      }[];
    };
    expect(crashedCheckpoint.gaps).toHaveLength(190);
    expect(
      crashedCheckpoint.gaps.every(({ reason }) => reason === "in-flight"),
    ).toBe(true);
    expect(
      crashedCheckpoint.gaps.some(({ chunkId }) => chunkId === "refine-191"),
    ).toBe(false);

    const resumedAttempt = vi.fn(
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
        quotaAttemptOrdinal: number,
        _attemptIndex: number,
        persistence: DurableBroadcastRefinementTranscriptAttemptPersistence,
      ) =>
        settleWithPersistence(
          requested,
          quotaAttemptOrdinal,
          persistence,
        ),
    );
    const resumed = await runDurableBroadcastRefinementTranscriptPipeline({
      store: holder.store,
      initialSession: holder.current,
      runId: "run-1",
      refinementTranscriptInputSignature: "refinement-transcript-200",
      chunks: manyChunks,
      editorRetryGeneration: 0,
      allowOutcomeUnknownRetry: false,
      runAttempt: resumedAttempt,
    });

    expect(resumedAttempt).toHaveBeenCalledTimes(1);
    expect(
      resumedAttempt.mock.calls[0]?.[0].map(({ chunkId }) => chunkId),
    ).toEqual(manyChunks.slice(190).map(({ chunkId }) => chunkId));
    expect(resumed.status).toBe("blocked-outcome-unknown");
    expect(resumed.blockingGaps).toHaveLength(190);
    expect(
      resumed.blockingGaps.every(
        ({ reason }) => reason === "outcome-unknown",
      ),
    ).toBe(true);
    expect(resumed.fragments).toHaveLength(10);
  }, 60_000);

  it("rejects a stored checkpoint whose frozen source ranges changed", async () => {
    const checkpoint = createBroadcastRefinementTranscriptCheckpoint({
      refinementInputSignature: "refinement-transcript-v1",
      plannedChunks: [chunks[0] as BroadcastContextTranscriptionChunk],
    });
    const holder = storeFor(
      session({
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        refinementTranscriptCheckpointJson:
          serializeBroadcastRefinementTranscriptCheckpoint(checkpoint),
      }),
    );

    await expect(
      runDurableBroadcastRefinementTranscriptPipeline({
        store: holder.store,
        initialSession: holder.current,
        runId: "run-1",
        refinementTranscriptInputSignature: "refinement-transcript-v1",
        chunks: [
          {
            ...(chunks[0] as BroadcastContextTranscriptionChunk),
            sourceEndMs: 39_000,
          },
        ],
        editorRetryGeneration: 0,
        allowOutcomeUnknownRetry: false,
        runAttempt: (requested) => Promise.resolve(settled(requested)),
      }),
    ).rejects.toThrow("현재 구간 계획과 일치하지 않아요");
  });
});
