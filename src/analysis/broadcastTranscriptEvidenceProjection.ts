import type { BroadcastContextChapterInput } from "./broadcastContextProtocol";
import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import {
  broadcastResolvedAbstentionReasonForChapter,
} from "./broadcastTranscriptChapters";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  recordBroadcastTranscriptResolvedEvidence,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
} from "./broadcastTranscriptResolvedEvidence";

export interface PrepareBroadcastTranscriptEvidenceProjectionInput {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly transcriptInputSignature: string;
  readonly modelRevision: string;
  readonly plannedChunks: readonly BroadcastContextTranscriptionChunk[];
  readonly storedCheckpointJson: string | null;
  readonly storedChapters: readonly BroadcastContextChapterInput[];
}

export interface PreparedBroadcastTranscriptEvidenceProjection {
  readonly dialogueChapters: readonly BroadcastContextChapterInput[];
  readonly checkpoint: BroadcastTranscriptResolvedEvidenceCheckpoint;
  readonly coveredRanges: readonly {
    readonly startMs: number;
    readonly endMs: number;
  }[];
}

function exactPlanJson(
  checkpoint: Pick<
    BroadcastTranscriptResolvedEvidenceCheckpoint,
    "plannedCells"
  >,
): string {
  return JSON.stringify(checkpoint.plannedCells);
}

/**
 * Rebinds durable negative transcript evidence to the current operation while
 * keeping it outside the dialogue map. It also performs the one-way migration
 * from ExClipper's own legacy placeholder chapters.
 */
export function prepareBroadcastTranscriptEvidenceProjection(
  input: PrepareBroadcastTranscriptEvidenceProjectionInput,
): PreparedBroadcastTranscriptEvidenceProjection {
  const plannedCells = input.plannedChunks.map(
    ({ chunkId, sourceStartMs, sourceEndMs }) => ({
      chunkId,
      sourceStartMs,
      sourceEndMs,
    }),
  );
  let checkpoint = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: input.sourceFingerprint,
    sourceDurationMs: input.sourceDurationMs,
    transcriptInputSignature: input.transcriptInputSignature,
    modelRevision: input.modelRevision,
    plannedCells,
  });
  const stored =
    input.storedCheckpointJson === null
      ? null
      : parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
          input.storedCheckpointJson,
        );
  if (
    stored !== null &&
    stored.sourceFingerprint === input.sourceFingerprint &&
    stored.sourceDurationMs === input.sourceDurationMs &&
    stored.modelRevision === input.modelRevision &&
    exactPlanJson(stored) === exactPlanJson(checkpoint)
  ) {
    for (const evidence of stored.resolvedEvidence) {
      checkpoint =
        evidence.reason === "no-audio"
          ? recordBroadcastTranscriptResolvedEvidence(
              checkpoint,
              evidence.chunkId,
              "no-audio",
              null,
            )
          : recordBroadcastTranscriptResolvedEvidence(
              checkpoint,
              evidence.chunkId,
              "no-speech",
              evidence.speechActivityReceipt,
            );
    }
  }

  const dialogueChapters: BroadcastContextChapterInput[] = [];
  for (const chapter of input.storedChapters) {
    const reason = broadcastResolvedAbstentionReasonForChapter(chapter);
    if (reason === null) {
      dialogueChapters.push(chapter);
      continue;
    }
    const planned = plannedCells.find(
      (cell) =>
        cell.sourceStartMs === chapter.startMs &&
        cell.sourceEndMs === chapter.endMs,
    );
    if (planned === undefined) {
      throw new RangeError(
        "A legacy transcript abstention does not match the current source plan.",
      );
    }
    if (reason === "no-audio") {
      checkpoint = recordBroadcastTranscriptResolvedEvidence(
        checkpoint,
        planned.chunkId,
        "no-audio",
        null,
      );
    }
    // Legacy no-speech placeholders have no exact VAD receipt. They remain
    // uncovered so the current pipeline must re-establish evidence instead of
    // silently reactivating an unproven dialogue exclusion.
  }

  return {
    dialogueChapters,
    checkpoint,
    coveredRanges: [
      ...dialogueChapters.map(({ startMs, endMs }) => ({ startMs, endMs })),
      ...checkpoint.resolvedEvidence.map(
        ({ sourceStartMs: startMs, sourceEndMs: endMs }) => ({
          startMs,
          endMs,
        }),
      ),
    ].sort(
      (left, right) =>
        left.startMs - right.startMs || left.endMs - right.endMs,
    ),
  };
}
