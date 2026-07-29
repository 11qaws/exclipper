import { describe, expect, it } from "vitest";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
} from "./broadcastTranscriptResolvedEvidence";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderSettlement,
  createBroadcastTranscriptVisualProviderSettlementLedger,
  recordBroadcastTranscriptVisualProviderSettlement,
} from "./broadcastTranscriptVisualInspectionQueue";
import { createBroadcastTranscriptVisualInspectionRunnerCheckpoint } from "./broadcastTranscriptVisualInspectionRunner";
import {
  mergeBroadcastTranscriptAndVisualContextChapters,
  parseAndProjectBroadcastTranscriptVisualContext,
  parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson,
  serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "./broadcastTranscriptVisualContextProjection";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const FRAME_FINGERPRINTS = [
  `sha256:${"1".repeat(64)}`,
  `sha256:${"2".repeat(64)}`,
  `sha256:${"3".repeat(64)}`,
  `sha256:${"4".repeat(64)}`,
] as const;
const NO_PARTICIPANTS = {
  presence: "none-present",
  summaryKo: "등장인물이 확인되지 않았습니다.",
  participants: [],
} as const;

function evidenceCheckpoint() {
  let checkpoint = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: 90_000,
    transcriptInputSignature: "transcript-plan-v1",
    modelRevision: "qwen-asr-v1",
    plannedCells: [
      { chunkId: "asr-a", sourceStartMs: 0, sourceEndMs: 30_000 },
      { chunkId: "asr-b", sourceStartMs: 30_000, sourceEndMs: 60_000 },
      { chunkId: "asr-c", sourceStartMs: 60_000, sourceEndMs: 90_000 },
    ],
  });
  checkpoint = recordBroadcastTranscriptResolvedEvidence(
    checkpoint,
    "asr-a",
    "no-speech",
    createVerifiedNoSpeechRunReceiptForTest(90_000, 0, 30_000),
  );
  checkpoint = recordBroadcastTranscriptResolvedEvidence(
    checkpoint,
    "asr-c",
    "no-audio",
    null,
  );
  return checkpoint;
}

function checkpointJson(terminalCellIds: readonly string[]): string {
  const plan = createBroadcastTranscriptVisualInspectionPlan(
    evidenceCheckpoint(),
  );
  const receipts = terminalCellIds.map((cellId) =>
    createBroadcastTranscriptVisualPreparedFrameReceipt({
      plan,
      cellId,
      frameContentFingerprints: FRAME_FINGERPRINTS,
      audioEvidence:
        plan.cells.find((cell) => cell.cellId === cellId)
          ?.transcriptAbstentionReason === "no-audio"
          ? null
          : {
              sourceStartMs:
                plan.cells.find((cell) => cell.cellId === cellId)!
                  .sourceStartMs,
              sourceEndMs:
                plan.cells.find((cell) => cell.cellId === cellId)!
                  .sourceEndMs,
              codec: "audio/wav;codecs=pcm_s16le",
              extractionRevision:
                BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
              contentFingerprint: `sha256:${"9".repeat(64)}`,
            },
    }),
  );
  let providerLedger =
    createBroadcastTranscriptVisualProviderSettlementLedger(plan);
  for (const [index, cellId] of terminalCellIds.entries()) {
    const preparedFrameReceipt = receipts[index]!;
    const settlement =
      index === 0
        ? createBroadcastTranscriptVisualProviderSettlement({
            plan,
            cellId,
            preparedFrameReceipt,
            providerModelRevision: "qwen-omni-visual-v1",
            operationId: `visual-operation-${index}`,
            attemptOrdinal: 0,
            outcome: "completed",
            editorialFinding: "quiet-success",
            summaryKo: "소리 없이 화면에서 목표 달성이 확인됐다.",
            providerResponseFingerprint: `sha256:${"b".repeat(64)}`,
            participantOutcome: NO_PARTICIPANTS,
          })
        : createBroadcastTranscriptVisualProviderSettlement({
            plan,
            cellId,
            preparedFrameReceipt,
            providerModelRevision: "qwen-omni-visual-v1",
            operationId: `visual-operation-${index}`,
            attemptOrdinal: 0,
            outcome: "excluded-music-only",
            editorialFinding: "music-or-mv-only",
            summaryKo: "스트리머 발화가 없는 뮤직비디오 구간이다.",
            providerResponseFingerprint: `sha256:${"c".repeat(64)}`,
            participantOutcome: NO_PARTICIPANTS,
          });
    providerLedger = recordBroadcastTranscriptVisualProviderSettlement(
      providerLedger,
      plan,
      settlement,
    );
  }
  return serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
    createBroadcastTranscriptVisualInspectionRunnerCheckpoint({
      plan,
      preparedFrameReceipts: receipts,
      providerLedger,
    }),
    plan,
  );
}

describe("broadcastTranscriptVisualContextProjection", () => {
  it("projects only terminal visual plan cells as distinct sampled-audio-video chapters", () => {
    const evidence = evidenceCheckpoint();
    const projected = parseAndProjectBroadcastTranscriptVisualContext({
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      visualInspectionCheckpointJson: checkpointJson([
        "visual:asr-a",
        "visual:asr-b",
        "visual:asr-c",
      ]),
    });

    expect(projected?.publication.publicationReady).toBe(true);
    expect(projected?.chapters).toEqual([
      expect.objectContaining({
        chapterId: "visual:asr-a",
        startMs: 0,
        endMs: 30_000,
        evidenceMode: "sampled-audio-video",
        evidenceCoverageRatio: 1,
      }),
      expect.objectContaining({
        chapterId: "visual:asr-c",
        startMs: 60_000,
        endMs: 90_000,
        evidenceMode: "sampled-audio-video",
        evidenceCoverageRatio: 1,
      }),
    ]);
    expect(projected?.chapters[0]?.summaryKo).toContain("조용한 성공");
    expect(projected?.chapters[1]?.summaryKo).toContain(
      "음악·뮤직비디오 전용 구간",
    );
  });

  it("preserves a valid partial checkpoint without claiming publication readiness", () => {
    const evidence = evidenceCheckpoint();
    const projected = parseAndProjectBroadcastTranscriptVisualContext({
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(evidence),
      visualInspectionCheckpointJson: checkpointJson(["visual:asr-a"]),
    });

    expect(projected?.publication.publicationReady).toBe(false);
    expect(projected?.publication.missingPreparedCellIds).toEqual([
      "visual:asr-b",
      "visual:asr-c",
    ]);
    expect(projected?.chapters.map(({ chapterId }) => chapterId)).toEqual([
      "visual:asr-a",
    ]);
  });

  it("rejects a checkpoint rebound to another deterministic plan", () => {
    const evidence = evidenceCheckpoint();
    const plan = createBroadcastTranscriptVisualInspectionPlan(evidence);
    const tampered = JSON.parse(checkpointJson(["visual:asr-a"])) as {
      planFingerprint: string;
    };
    tampered.planFingerprint = "local-exact-fingerprint-v1:0000000000000000";

    expect(
      parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
        JSON.stringify(tampered),
        plan,
      ),
    ).toBeNull();
  });

  it("merges transcript and visual cells in source order and rejects overlap or duplicate ids", () => {
    const transcript = [
      {
        chapterId: "transcript-001",
        startMs: 30_000,
        endMs: 60_000,
        evidenceMode: "complete-transcript" as const,
        evidenceCoverageRatio: 1,
        summaryKo: "중간 발화",
      },
    ];
    const projected = parseAndProjectBroadcastTranscriptVisualContext({
      transcriptEvidenceCheckpointJson:
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(
          evidenceCheckpoint(),
        ),
      visualInspectionCheckpointJson: checkpointJson([
        "visual:asr-a",
        "visual:asr-b",
        "visual:asr-c",
      ]),
    })!;

    expect(
      mergeBroadcastTranscriptAndVisualContextChapters(
        transcript,
        projected.chapters,
      ).map(({ chapterId }) => chapterId),
    ).toEqual(["visual:asr-a", "transcript-001", "visual:asr-c"]);
    expect(() =>
      mergeBroadcastTranscriptAndVisualContextChapters(transcript, [
        {
          ...projected.chapters[0]!,
          chapterId: "visual:overlap",
          startMs: 50_000,
          endMs: 70_000,
        },
      ]),
    ).toThrow(/non-overlapping/u);
    expect(() =>
      mergeBroadcastTranscriptAndVisualContextChapters(transcript, [
        { ...transcript[0]! },
      ]),
    ).toThrow(/unique/u);
  });
});
