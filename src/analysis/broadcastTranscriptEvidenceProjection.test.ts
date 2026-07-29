import { describe, expect, it } from "vitest";

import type { BroadcastContextChapterInput } from "./broadcastContextProtocol";
import {
  createBroadcastNoSpeechChapters,
} from "./broadcastTranscriptChapters";
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
  it("keeps a legacy no-speech placeholder uncovered until exact VAD evidence is rebuilt", () => {
    const [legacy] = createBroadcastNoSpeechChapters(
      [chunks[0]!],
      180_000,
    );
    const prepared = prepareBroadcastTranscriptEvidenceProjection({
      sourceFingerprint: "source-v1",
      sourceDurationMs: 180_000,
      transcriptInputSignature: "transcript-operation-v2",
      modelRevision: "asr-model-v1",
      plannedChunks: chunks,
      storedCheckpointJson: null,
      storedChapters: [legacy!, dialogueChapter()],
    });

    expect(prepared.dialogueChapters).toEqual([dialogueChapter()]);
    expect(prepared.checkpoint.resolvedEvidence).toEqual([]);
    expect(prepared.coveredRanges).toEqual([
      { startMs: 90_000, endMs: 180_000 },
    ]);
  });

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

  it("fails closed when a legacy placeholder cannot be mapped exactly", () => {
    const [legacy] = createBroadcastNoSpeechChapters(
      [
        {
          chunkId: "old-cell",
          sourceStartMs: 0,
          sourceEndMs: 60_000,
          kind: "uniform",
        },
      ],
      180_000,
    );
    expect(() =>
      prepareBroadcastTranscriptEvidenceProjection({
        sourceFingerprint: "source-v1",
        sourceDurationMs: 180_000,
        transcriptInputSignature: "new-operation",
        modelRevision: "asr-model-v1",
        plannedChunks: chunks,
        storedCheckpointJson: null,
        storedChapters: [legacy!],
      }),
    ).toThrow(RangeError);
  });
});
