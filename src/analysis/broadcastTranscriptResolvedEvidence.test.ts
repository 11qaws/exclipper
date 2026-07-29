import { describe, expect, it } from "vitest";
import {
  BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION,
  MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS,
  assertBroadcastTranscriptResolvedEvidenceCheckpoint,
  broadcastTranscriptEvidencePlanCoversWholeSource,
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  inspectBroadcastTranscriptEvidenceSettlement,
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  rebaseBroadcastTranscriptResolvedEvidenceModelRevision,
  recordBroadcastTranscriptResolvedEvidence as recordExactBroadcastTranscriptResolvedEvidence,
  serializeBroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceReason,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

const plan = [
  { chunkId: "asr-a", sourceStartMs: 0, sourceEndMs: 30_000 },
  { chunkId: "asr-b", sourceStartMs: 30_000, sourceEndMs: 60_000 },
  { chunkId: "asr-c", sourceStartMs: 60_000, sourceEndMs: 90_000 },
] as const;

function checkpoint() {
  return createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: `local-file-sampled-sha256-v1:${"a".repeat(64)}`,
    sourceDurationMs: 90_000,
    transcriptInputSignature: "run:source:uniform",
    modelRevision: "qwen3.5-omni-flash:asr-v1",
    plannedCells: plan,
  });
}

function recordBroadcastTranscriptResolvedEvidence(
  current: BroadcastTranscriptResolvedEvidenceCheckpoint,
  chunkId: string,
  reason: BroadcastTranscriptResolvedEvidenceReason,
): BroadcastTranscriptResolvedEvidenceCheckpoint {
  const cell = current.plannedCells.find(
    (candidate) => candidate.chunkId === chunkId,
  );
  if (cell === undefined) {
    return recordExactBroadcastTranscriptResolvedEvidence(
      current,
      chunkId,
      "no-audio",
      null,
    );
  }
  return reason === "no-audio"
    ? recordExactBroadcastTranscriptResolvedEvidence(
        current,
        chunkId,
        "no-audio",
        null,
      )
    : recordExactBroadcastTranscriptResolvedEvidence(
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

describe("broadcastTranscriptResolvedEvidence", () => {
  it("stores no-speech as dialogue exclusion while keeping visual inspection required", () => {
    const current = recordBroadcastTranscriptResolvedEvidence(
      checkpoint(),
      "asr-b",
      "no-speech",
    );

    expect(current).toMatchObject({
      schemaVersion:
        BROADCAST_TRANSCRIPT_RESOLVED_EVIDENCE_SCHEMA_VERSION,
      dialogueDisposition: "exclude-resolved-ranges",
      visualDisposition: "inspection-required",
      resolvedEvidence: [
        {
          chunkId: "asr-b",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          reason: "no-speech",
        },
      ],
    });
    const resolved = current.resolvedEvidence[0];
    if (resolved?.reason !== "no-speech") {
      throw new Error("Expected an exact no-speech evidence entry.");
    }
    expect(resolved.speechActivityReceipt).toMatchObject({
      sourceDurationMs: 90_000,
      sourceStartMs: 30_000,
      sourceEndMs: 60_000,
    });
    expect(
      parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
        serializeBroadcastTranscriptResolvedEvidenceCheckpoint(current),
      ),
    ).toEqual(current);
  });

  it("rebases only the aggregate model fence after a bounded provider fallback", () => {
    const current = recordBroadcastTranscriptResolvedEvidence(
      checkpoint(),
      "asr-b",
      "no-speech",
    );
    const mixedRevision =
      "broadcast-transcript-mixed-v1:gemini-3.6-flash-audio-transcript-reviewed-2026-07-22|qwen3.5-omni-flash-audio-transcript-90s-reviewed-2026-07-22";
    const rebased =
      rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
        current,
        mixedRevision,
      );

    expect(rebased.modelRevision).toBe(mixedRevision);
    expect({
      ...rebased,
      modelRevision: current.modelRevision,
    }).toEqual(current);
    expect(() =>
      rebaseBroadcastTranscriptResolvedEvidenceModelRevision(
        current,
        " invalid ",
      ),
    ).toThrow();
  });

  it("allows an empty dialogue map to settle only when every plan cell has resolved evidence", () => {
    let current = checkpoint();
    for (const [index, cell] of plan.entries()) {
      current = recordBroadcastTranscriptResolvedEvidence(
        current,
        cell.chunkId,
        index % 2 === 0 ? "no-speech" : "no-audio",
      );
    }

    expect(
      inspectBroadcastTranscriptEvidenceSettlement({
        checkpoint: current,
        chapterRanges: [],
        gapRanges: [],
      }),
    ).toEqual({
      plannedCellCount: 3,
      chapterCellCount: 0,
      resolvedEvidenceCount: 3,
      gapCellCount: 0,
      isPlanSettled: true,
      isDialogueEmptyButResolved: true,
      requiresVisualInspection: true,
    });

    expect(() =>
      inspectBroadcastTranscriptEvidenceSettlement({
        checkpoint: recordBroadcastTranscriptResolvedEvidence(
          checkpoint(),
          "asr-a",
          "no-speech",
        ),
        chapterRanges: [],
        gapRanges: [],
      }),
    ).toThrow(RangeError);
  });

  it("partitions plan cells exactly among chapters, abstentions, and gaps", () => {
    const current = recordBroadcastTranscriptResolvedEvidence(
      checkpoint(),
      "asr-b",
      "no-speech",
    );
    expect(
      inspectBroadcastTranscriptEvidenceSettlement({
        checkpoint: current,
        chapterRanges: [{ startMs: 0, endMs: 30_000 }],
        gapRanges: [
          {
            chunkId: "asr-c",
            sourceStartMs: 60_000,
            sourceEndMs: 90_000,
          },
        ],
      }),
    ).toMatchObject({
      chapterCellCount: 1,
      resolvedEvidenceCount: 1,
      gapCellCount: 1,
      isPlanSettled: false,
    });
    expect(() =>
      inspectBroadcastTranscriptEvidenceSettlement({
        checkpoint: current,
        chapterRanges: [{ startMs: 0, endMs: 60_000 }],
        gapRanges: [],
      }),
    ).toThrow(RangeError);
  });

  it("accepts a paid legacy chapter spanning contiguous current plan cells", () => {
    expect(
      inspectBroadcastTranscriptEvidenceSettlement({
        checkpoint: checkpoint(),
        chapterRanges: [{ startMs: 0, endMs: 90_000 }],
        gapRanges: [],
      }),
    ).toMatchObject({
      chapterCellCount: 3,
      isPlanSettled: true,
      isDialogueEmptyButResolved: false,
    });
  });

  it("rejects moved ranges, unknown chunks, duplicate ids, overlap, and additional keys", () => {
    expect(() =>
      recordBroadcastTranscriptResolvedEvidence(
        checkpoint(),
        "unknown",
        "no-speech",
      ),
    ).toThrow(RangeError);
    expect(() =>
      assertBroadcastTranscriptResolvedEvidenceCheckpoint({
        ...checkpoint(),
        plannedCells: [
          plan[0],
          { ...plan[1], chunkId: "asr-a" },
        ],
      }),
    ).toThrow();
    expect(() =>
      assertBroadcastTranscriptResolvedEvidenceCheckpoint({
        ...checkpoint(),
        plannedCells: [
          plan[0],
          { ...plan[1], sourceStartMs: 29_999 },
        ],
      }),
    ).toThrow();
    expect(() =>
      assertBroadcastTranscriptResolvedEvidenceCheckpoint({
        ...checkpoint(),
        extra: true,
      }),
    ).toThrow();
    expect(
      parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
        JSON.stringify({
          ...recordBroadcastTranscriptResolvedEvidence(
            checkpoint(),
            "asr-a",
            "no-speech",
          ),
          resolvedEvidence: [
            {
              chunkId: "asr-a",
              sourceStartMs: 1,
              sourceEndMs: 30_000,
              reason: "no-speech",
            },
          ],
        }),
      ),
    ).toBeNull();

    expect(() =>
      recordExactBroadcastTranscriptResolvedEvidence(
        checkpoint(),
        "asr-b",
        "no-speech",
        createVerifiedNoSpeechRunReceiptForTest(
          60_000,
          30_000,
          60_000,
        ),
      ),
    ).toThrow("exact-range VAD receipt");

    const legacyWithoutVadReceipt = {
      ...checkpoint(),
      schemaVersion: "1.0.0",
      resolvedEvidence: [
        {
          chunkId: "asr-b",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          reason: "no-speech",
        },
      ],
    };
    expect(
      parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
        JSON.stringify(legacyWithoutVadReceipt),
      ),
    ).toBeNull();
  });

  it("enforces the 12-hour and bounded-cell ceilings", () => {
    expect(() =>
      createBroadcastTranscriptResolvedEvidenceCheckpoint({
        sourceFingerprint: "source",
        sourceDurationMs: 12 * 60 * 60_000 + 1,
        transcriptInputSignature: "plan",
        modelRevision: "model",
        plannedCells: plan,
      }),
    ).toThrow(RangeError);

    const tooMany = Array.from(
      { length: MAX_BROADCAST_TRANSCRIPT_EVIDENCE_CELLS + 1 },
      (_, index) => ({
        chunkId: `cell-${index}`,
        sourceStartMs: index,
        sourceEndMs: index + 1,
      }),
    );
    expect(() =>
      createBroadcastTranscriptResolvedEvidenceCheckpoint({
        sourceFingerprint: "source",
        sourceDurationMs: tooMany.length,
        transcriptInputSignature: "plan",
        modelRevision: "model",
        plannedCells: tooMany,
      }),
    ).toThrow(RangeError);
  });

  it("recognizes only a contiguous full-source plan as complete audio coverage", () => {
    expect(broadcastTranscriptEvidencePlanCoversWholeSource(checkpoint())).toBe(
      true,
    );
    expect(
      broadcastTranscriptEvidencePlanCoversWholeSource(
        createBroadcastTranscriptResolvedEvidenceCheckpoint({
          sourceFingerprint: "source",
          sourceDurationMs: 120_000,
          transcriptInputSignature: "plan",
          modelRevision: "model",
          plannedCells: [
            { chunkId: "a", sourceStartMs: 0, sourceEndMs: 30_000 },
            { chunkId: "b", sourceStartMs: 90_000, sourceEndMs: 120_000 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("keeps canonical ordering and exact range pairing across generated permutations", () => {
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let iteration = 0; iteration < 128; iteration += 1) {
      const cellCount = 1 + Math.floor(random() * 48);
      const cells = Array.from({ length: cellCount }, (_, index) => ({
        chunkId: `cell-${iteration}-${index}`,
        sourceStartMs: index * 1_000,
        sourceEndMs: (index + 1) * 1_000,
      }));
      const shuffled = [...cells].sort(() => random() - 0.5);
      let current =
        createBroadcastTranscriptResolvedEvidenceCheckpoint({
          sourceFingerprint: `source-${iteration}`,
          sourceDurationMs: cellCount * 1_000,
          transcriptInputSignature: `plan-${iteration}`,
          modelRevision: "model",
          plannedCells: shuffled,
        });
      for (const cell of shuffled) {
        current = recordBroadcastTranscriptResolvedEvidence(
          current,
          cell.chunkId,
          random() < 0.5 ? "no-audio" : "no-speech",
        );
      }
      const restored =
        parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
          serializeBroadcastTranscriptResolvedEvidenceCheckpoint(current),
        );
      expect(restored?.plannedCells.map(({ chunkId }) => chunkId)).toEqual(
        cells.map(({ chunkId }) => chunkId),
      );
      expect(
        inspectBroadcastTranscriptEvidenceSettlement({
          checkpoint: current,
          chapterRanges: [],
          gapRanges: [],
        }).isDialogueEmptyButResolved,
      ).toBe(true);
    }
  });
});
