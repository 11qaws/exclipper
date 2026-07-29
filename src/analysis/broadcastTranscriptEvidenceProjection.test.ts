import { describe, expect, it } from "vitest";

import type { BroadcastContextChapterInput } from "./broadcastContextProtocol";
import {
  prepareBroadcastTranscriptEvidenceProjection,
} from "./broadcastTranscriptEvidenceProjection";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

const chunks = [
  {
    chunkId: "asr-0-90",
    sourceStartMs: 0,
    sourceEndMs: 90_000,
    kind: "uniform" as const,
  },
  {
    chunkId: "asr-90-180",
    sourceStartMs: 90_000,
    sourceEndMs: 180_000,
    kind: "uniform" as const,
  },
];

function dialogueChapter(): BroadcastContextChapterInput {
  return {
    chapterId: "transcript-001",
    startMs: 90_000,
    endMs: 180_000,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: "스트리머가 조용한 성공을 알아차리고 기뻐한다.",
  };
}

describe("prepareBroadcastTranscriptEvidenceProjection", () => {
  it("rebinds exact stored abstentions to a fresh operation signature", () => {
    let stored = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "old-operation",
      modelRevision: "asr-model-v1",
      plannedCells: chunks.map(
        ({ chunkId, sourceStartMs, sourceEndMs }) => ({
          chunkId,
          sourceStartMs,
          sourceEndMs,
        }),
      ),
    });
    stored = recordBroadcastTranscriptResolvedEvidence(
      stored,
      "asr-0-90",
      "no-audio",
    );
    const prepared = prepareBroadcastTranscriptEvidenceProjection({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "new-operation",
      modelRevision: "asr-model-v1",
      plannedChunks: chunks,
      storedCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(stored),
      storedChapters: [dialogueChapter()],
    });

    expect(prepared.checkpoint.transcriptInputSignature).toBe(
      "new-operation",
    );
    expect(prepared.checkpoint.resolvedEvidence[0]?.reason).toBe("no-audio");
  });

  it("does not reuse negative evidence across a model fence change", () => {
    let stored = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "old-operation",
      modelRevision: "asr-model-v1",
      plannedCells: chunks.map(
        ({ chunkId, sourceStartMs, sourceEndMs }) => ({
          chunkId,
          sourceStartMs,
          sourceEndMs,
        }),
      ),
    });
    stored = recordBroadcastTranscriptResolvedEvidence(
      stored,
      "asr-0-90",
      "no-speech",
      createVerifiedNoSpeechRunReceiptForTest(180_000, 0, 90_000),
    );
    const prepared = prepareBroadcastTranscriptEvidenceProjection({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "new-operation",
      modelRevision: "asr-model-v2",
      plannedChunks: chunks,
      storedCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(stored),
      storedChapters: [],
    });

    expect(prepared.checkpoint.resolvedEvidence).toEqual([]);
  });

  it("keeps current dialogue chapters separate from resolved abstentions", () => {
    const prepared = prepareBroadcastTranscriptEvidenceProjection({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "current-operation",
      modelRevision: "asr-model-v1",
      plannedChunks: chunks,
      storedCheckpointJson: null,
      storedChapters: [dialogueChapter()],
    });

    expect(prepared.dialogueChapters).toEqual([dialogueChapter()]);
    expect(prepared.checkpoint.resolvedEvidence).toEqual([]);
    expect(prepared.coveredRanges).toEqual([
      { startMs: 90_000, endMs: 180_000 },
    ]);
  });
});
