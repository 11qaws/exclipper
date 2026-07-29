import { describe, expect, it, vi } from "vitest";

import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import {
  createBroadcastContextPhaseLedger,
  serializeBroadcastContextPhaseLedger,
} from "../analysis/broadcastContextPhaseLedger";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
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
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  type BroadcastContextSessionRecord,
} from "../storage/broadcastContextSessionStore";
import { runDurableBroadcastRefinementTranscriptPipeline } from "./durableBroadcastRefinementTranscriptPipeline";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

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
  const chapters = [
    {
      chapterId: "transcript-001",
      startMs: 0,
      endMs: 120_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: "스트리머가 방송에서 여러 음식에 관해 이야기한다.",
    },
  ];
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: 120_000,
    castRosterId: null,
    chapters,
  });
  const base: BroadcastContextSessionRecord = {
    kind: "broadcastContextSession",
    runId: "run-1",
    schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
    inputSignature: "input-1",
    sourceDurationMs: 120_000,
    completeAudioCoverage: true,
    chapters,
    gapChunkIds: [],
    fragmentGaps: [],
    transcriptEvidenceInputSignature: null,
    transcriptEvidenceCheckpointJson: null,
    transcriptProviderReceiptInputSignature: null,
    transcriptProviderReceiptCheckpointJson: null,
    modelRevision: "test-model",
    sourceCastRosterId: null,
    transcriptSealOperationKey: "transcript-seal",
    participantGroundingInputSignature: "grounding-signature",
    participantGroundingPlanFingerprint: "grounding-plan-fingerprint-v1",
    participantGroundingCheckpointJson: JSON.stringify(participantGrounding),
    contextInputSignature: "context-signature",
    contextInputCheckpointJson: JSON.stringify({
      sourceDurationMs: 120_000,
      chapters,
      candidates: [],
      participantGrounding,
      outputLanguage: "ko",
    }),
    contextPhaseLedgerJson: serializeBroadcastContextPhaseLedger(
      createBroadcastContextPhaseLedger({
        fence: {
          parentContextSignature: "context-signature",
          transcriptSignature: "transcript-seal",
          groundingSignature: "grounding-signature",
        },
        units: [
          {
            phase: "discovery",
            unitId: "overview",
            inputDigest: "discovery-digest",
            operationId: "discovery-operation",
            attemptOrdinal: 0,
            required: true,
          },
        ],
      }),
    ),
    contextResultJson: "{}",
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
          if (expected !== holder.current) return Promise.resolve(false);
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

describe("runDurableBroadcastRefinementTranscriptPipeline", () => {
  it("seals in-flight before dispatch and read-backs every successful settlement", async () => {
    const holder = storeFor(session());
    const runAttempt = vi.fn(
      (requested: readonly BroadcastContextTranscriptionChunk[]) => {
        const checkpoint = JSON.parse(
          holder.current.refinementTranscriptCheckpointJson!,
        ) as { gaps: readonly { reason: string }[] };
        expect(checkpoint.gaps.map(({ reason }) => reason)).toEqual([
          "in-flight",
          "in-flight",
        ]);
        return Promise.resolve(settled(requested));
      },
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
    ).toHaveBeenCalledTimes(3);
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
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(settled(requested)),
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
      (requested: readonly BroadcastContextTranscriptionChunk[]) => {
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
        expect(currentCheckpoint.gaps).toEqual(
          chunks.map(({ chunkId }) => ({
            chunkId,
            reason: "in-flight",
            attemptCount: 1,
          })),
        );
        return Promise.resolve(settled(requested));
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
      (
        requested: readonly BroadcastContextTranscriptionChunk[],
      ): Promise<BroadcastTranscriptWorkerRunResult> =>
        Promise.resolve({
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
        }),
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
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(settled(requested)),
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
      (requested: readonly BroadcastContextTranscriptionChunk[]) =>
        Promise.resolve(settled(requested)),
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
      runAttempt: (requested) =>
        Promise.resolve(settled(requested, "no-speech")),
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
