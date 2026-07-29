import { describe, expect, it } from "vitest";
import {
  BroadcastTranscriptVisualInspectionContractError,
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderBatchQueue,
  createBroadcastTranscriptVisualProviderSettlement,
  createBroadcastTranscriptVisualProviderSettlementLedger,
  inspectBroadcastTranscriptVisualInspectionPublication,
  parseBroadcastTranscriptVisualInspectionPlanJson,
  parseBroadcastTranscriptVisualProviderSettlementLedgerJson,
  recordBroadcastTranscriptVisualProviderSettlement,
  serializeBroadcastTranscriptVisualInspectionPlan,
  serializeBroadcastTranscriptVisualProviderSettlementLedger,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualProviderSettlement,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence as recordExactBroadcastTranscriptResolvedEvidence,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
  type BroadcastTranscriptResolvedEvidenceReason,
} from "./broadcastTranscriptResolvedEvidence";
import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const FRAME_FINGERPRINTS = [
  `sha256:${"1".repeat(64)}`,
  `sha256:${"2".repeat(64)}`,
  `sha256:${"3".repeat(64)}`,
  `sha256:${"4".repeat(64)}`,
] as const;

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

function plan(): BroadcastTranscriptVisualInspectionPlan {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
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
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "asr-a",
    "no-speech",
  );
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "asr-b",
    "no-audio",
  );
  evidence = recordBroadcastTranscriptResolvedEvidence(
    evidence,
    "asr-c",
    "no-speech",
  );
  return createBroadcastTranscriptVisualInspectionPlan(evidence);
}

function prepared(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
  cellId: string,
): BroadcastTranscriptVisualPreparedFrameReceipt {
  return createBroadcastTranscriptVisualPreparedFrameReceipt({
    plan: currentPlan,
    cellId,
    frameContentFingerprints: FRAME_FINGERPRINTS,
  });
}

function settlement(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
  cellId: string,
  outcome:
    | "completed"
    | "excluded-music-only"
    | "retryable"
    | "outcome-unknown",
  attemptOrdinal = 0,
): BroadcastTranscriptVisualProviderSettlement {
  const base = {
    plan: currentPlan,
    cellId,
    preparedFrameReceipt: prepared(currentPlan, cellId),
    providerModelRevision: "qwen-omni-visual-v1",
    operationId: `visual-${cellId}-${attemptOrdinal}`,
    attemptOrdinal,
  };
  switch (outcome) {
    case "completed":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome,
        editorialFinding: "quiet-success",
        summaryKo: "큰 소리는 없지만 화면에서 조용한 성공이 확인됐다.",
        providerResponseFingerprint: `sha256:${"b".repeat(64)}`,
      });
    case "excluded-music-only":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome,
        editorialFinding: "music-or-mv-only",
        summaryKo: "네 화면과 음성 부정 근거를 함께 검토한 결과 MV 구간이다.",
        providerResponseFingerprint: `sha256:${"c".repeat(64)}`,
      });
    case "retryable":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome,
        failureReason: "rate-limited",
      });
    case "outcome-unknown":
      return createBroadcastTranscriptVisualProviderSettlement({
        ...base,
        outcome,
        failureReason: "timeout-after-dispatch",
      });
  }
}

describe("broadcastTranscriptVisualInspectionQueue", () => {
  it("creates exactly four deterministic source-time frames for every transcript abstention", () => {
    const current = plan();
    expect(current.cells).toHaveLength(3);
    expect(current.cells.map(({ transcriptChunkId }) => transcriptChunkId)).toEqual([
      "asr-a",
      "asr-b",
      "asr-c",
    ]);
    for (const cell of current.cells) {
      expect(cell.frameTimestampsMs).toHaveLength(4);
      expect(new Set(cell.frameTimestampsMs).size).toBe(4);
      expect(
        cell.frameTimestampsMs.every(
          (timestampMs) =>
            timestampMs >= cell.sourceStartMs &&
            timestampMs < cell.sourceEndMs,
        ),
      ).toBe(true);
    }
    expect(
      parseBroadcastTranscriptVisualInspectionPlanJson(
        serializeBroadcastTranscriptVisualInspectionPlan(current),
      ),
    ).toEqual(current);
  });

  it("rejects a resolved cell too short to carry four distinct source timestamps", () => {
    let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
      sourceFingerprint: SOURCE_FINGERPRINT,
      sourceDurationMs: 3,
      transcriptInputSignature: "short-plan",
      modelRevision: "model",
      plannedCells: [
        { chunkId: "too-short", sourceStartMs: 0, sourceEndMs: 3 },
      ],
    });
    evidence = recordBroadcastTranscriptResolvedEvidence(
      evidence,
      "too-short",
      "no-speech",
    );
    expect(() =>
      createBroadcastTranscriptVisualInspectionPlan(evidence),
    ).toThrow(BroadcastTranscriptVisualInspectionContractError);
  });

  it("uses salience and candidate overlap only to reorder and never delete cells", () => {
    const current = plan();
    const baseline =
      createBroadcastTranscriptVisualFramePreparationQueue(current);
    const prioritized = createBroadcastTranscriptVisualFramePreparationQueue(
      current,
      {
        localVisualSalience: [
          { cellId: "visual:asr-a", normalizedSalience: 1 },
          { cellId: "visual:asr-c", normalizedSalience: 0.2 },
        ],
        existingCandidates: [
          {
            candidateId: "candidate-b",
            sourceStartMs: 35_000,
            sourceEndMs: 55_000,
          },
        ],
      },
    );

    expect(baseline.tasks.map(({ cellId }) => cellId)).toEqual([
      "visual:asr-a",
      "visual:asr-b",
      "visual:asr-c",
    ]);
    expect(prioritized.tasks.map(({ cellId }) => cellId)).toEqual([
      "visual:asr-b",
      "visual:asr-a",
      "visual:asr-c",
    ]);
    expect(new Set(prioritized.tasks.map(({ cellId }) => cellId))).toEqual(
      new Set(current.cells.map(({ cellId }) => cellId)),
    );
    for (const task of prioritized.tasks) {
      expect(task.frameTimestampsMs).toEqual(
        current.cells.find(({ cellId }) => cellId === task.cellId)
          ?.frameTimestampsMs,
      );
    }
  });

  it("separates local frame preparation from provider batching and exposes every missing bundle", () => {
    const current = plan();
    const frameQueue =
      createBroadcastTranscriptVisualFramePreparationQueue(current);
    const first = prepared(current, "visual:asr-a");
    const third = prepared(current, "visual:asr-c");
    const providerQueue = createBroadcastTranscriptVisualProviderBatchQueue({
      plan: current,
      framePreparationQueue: frameQueue,
      preparedFrameReceipts: [first, third],
      maximumBatchSize: 1,
    });

    expect(providerQueue.batches).toHaveLength(2);
    expect(
      providerQueue.batches.flatMap(({ tasks }) =>
        tasks.map(({ cellId }) => cellId),
      ),
    ).toEqual(["visual:asr-a", "visual:asr-c"]);
    expect(providerQueue.missingPreparedCellIds).toEqual(["visual:asr-b"]);
  });

  it("blocks publication for missing, retryable, or outcome-unknown cells", () => {
    const current = plan();
    const receipts = current.cells.map(({ cellId }) =>
      prepared(current, cellId),
    );
    let ledger =
      createBroadcastTranscriptVisualProviderSettlementLedger(current);
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-a", "completed"),
    );
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-b", "retryable"),
    );
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-c", "outcome-unknown"),
    );

    expect(
      inspectBroadcastTranscriptVisualInspectionPublication({
        plan: current,
        preparedFrameReceipts: receipts,
        providerLedger: ledger,
      }),
    ).toMatchObject({
      quietSuccessCellIds: ["visual:asr-a"],
      downstreamEligibleCellIds: ["visual:asr-a"],
      retryableCellIds: ["visual:asr-b"],
      outcomeUnknownCellIds: ["visual:asr-c"],
      publicationReady: false,
    });
    expect(
      inspectBroadcastTranscriptVisualInspectionPublication({
        plan: current,
        preparedFrameReceipts: receipts.slice(1),
        providerLedger: ledger,
      }),
    ).toMatchObject({
      missingPreparedCellIds: ["visual:asr-a"],
      publicationReady: false,
    });
  });

  it("admits quiet success downstream only with a completed four-frame provider receipt", () => {
    const current = plan();
    const receipts = current.cells.map(({ cellId }) =>
      prepared(current, cellId),
    );
    let ledger =
      createBroadcastTranscriptVisualProviderSettlementLedger(current);
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-a", "retryable"),
    );
    expect(
      inspectBroadcastTranscriptVisualInspectionPublication({
        plan: current,
        preparedFrameReceipts: receipts,
        providerLedger: ledger,
      }).quietSuccessCellIds,
    ).toEqual([]);

    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-a", "completed", 1),
    );
    expect(
      inspectBroadcastTranscriptVisualInspectionPublication({
        plan: current,
        preparedFrameReceipts: receipts,
        providerLedger: ledger,
      }),
    ).toMatchObject({
      quietSuccessCellIds: ["visual:asr-a"],
      downstreamEligibleCellIds: ["visual:asr-a"],
    });
  });

  it("allows music or MV exclusion only as a completed multimodal provider receipt", () => {
    const current = plan();
    const excluded = settlement(
      current,
      "visual:asr-b",
      "excluded-music-only",
    );
    expect(excluded).toMatchObject({
      requestedInspectionMode:
        "multimodal-audio-evidence-and-four-video-frames",
      outcome: "excluded-music-only",
      reviewedFrameTimestampsMs:
        current.cells[1]?.frameTimestampsMs,
      requestedFrameContentFingerprints: FRAME_FINGERPRINTS,
      transcriptAbstentionReviewed: true,
      editorialFinding: "music-or-mv-only",
    });

    const forged = {
      ...excluded,
      requestedInspectionMode: "local-visual-salience",
    } as unknown as BroadcastTranscriptVisualProviderSettlement;
    expect(() =>
      recordBroadcastTranscriptVisualProviderSettlement(
        createBroadcastTranscriptVisualProviderSettlementLedger(current),
        current,
        forged,
      ),
    ).toThrow(BroadcastTranscriptVisualInspectionContractError);
  });

  it("opens publication only after every cell has a terminal completed or music-only settlement", () => {
    const current = plan();
    const receipts = current.cells.map(({ cellId }) =>
      prepared(current, cellId),
    );
    let ledger =
      createBroadcastTranscriptVisualProviderSettlementLedger(current);
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-a", "completed"),
    );
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-b", "excluded-music-only"),
    );
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      createBroadcastTranscriptVisualProviderSettlement({
        plan: current,
        cellId: "visual:asr-c",
        preparedFrameReceipt: prepared(current, "visual:asr-c"),
        providerModelRevision: "qwen-omni-visual-v1",
        operationId: "visual-asr-c-terminal",
        attemptOrdinal: 0,
        outcome: "completed",
        editorialFinding: "no-usable-event",
        summaryKo: "화면에 별도의 편집 사건은 확인되지 않았다.",
        providerResponseFingerprint: `sha256:${"d".repeat(64)}`,
      }),
    );
    const status = inspectBroadcastTranscriptVisualInspectionPublication({
      plan: current,
      preparedFrameReceipts: receipts,
      providerLedger: ledger,
    });
    expect(status).toMatchObject({
      completedCellIds: ["visual:asr-a", "visual:asr-c"],
      downstreamEligibleCellIds: ["visual:asr-a"],
      excludedMusicOnlyCellIds: ["visual:asr-b"],
      publicationReady: true,
    });
    const serialized =
      serializeBroadcastTranscriptVisualProviderSettlementLedger(
        ledger,
        current,
      );
    expect(
      parseBroadcastTranscriptVisualProviderSettlementLedgerJson(
        serialized,
        current,
      ),
    ).toEqual(ledger);
  });

  it("rejects stale source, range, frame, and plan fences", () => {
    const current = plan();
    const receipt = prepared(current, "visual:asr-a");
    const forgedReceipt = {
      ...receipt,
      sourceStartMs: 1,
    };
    expect(() =>
      createBroadcastTranscriptVisualProviderBatchQueue({
        plan: current,
        framePreparationQueue:
          createBroadcastTranscriptVisualFramePreparationQueue(current),
        preparedFrameReceipts: [forgedReceipt],
      }),
    ).toThrow(BroadcastTranscriptVisualInspectionContractError);

    const serialized = serializeBroadcastTranscriptVisualInspectionPlan(current);
    expect(
      parseBroadcastTranscriptVisualInspectionPlanJson(
        serialized.replace(current.planFingerprint, "stale-plan"),
      ),
    ).toBeNull();

    const reviewed = settlement(current, "visual:asr-a", "completed");
    const changedFrameReceipt =
      createBroadcastTranscriptVisualPreparedFrameReceipt({
        plan: current,
        cellId: "visual:asr-a",
        frameContentFingerprints: [
          `sha256:${"5".repeat(64)}`,
          `sha256:${"6".repeat(64)}`,
          `sha256:${"7".repeat(64)}`,
          `sha256:${"8".repeat(64)}`,
        ],
      });
    const reviewedLedger =
      recordBroadcastTranscriptVisualProviderSettlement(
        createBroadcastTranscriptVisualProviderSettlementLedger(current),
        current,
        reviewed,
      );
    expect(() =>
      inspectBroadcastTranscriptVisualInspectionPublication({
        plan: current,
        preparedFrameReceipts: [
          changedFrameReceipt,
          prepared(current, "visual:asr-b"),
          prepared(current, "visual:asr-c"),
        ],
        providerLedger: reviewedLedger,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "STALE_SETTLEMENT",
      }),
    );
  });

  it("requires a newer attempt and explicit confirmation before replacing outcome-unknown", () => {
    const current = plan();
    let ledger =
      createBroadcastTranscriptVisualProviderSettlementLedger(current);
    ledger = recordBroadcastTranscriptVisualProviderSettlement(
      ledger,
      current,
      settlement(current, "visual:asr-a", "outcome-unknown"),
    );
    const recovered = settlement(
      current,
      "visual:asr-a",
      "completed",
      1,
    );
    expect(() =>
      recordBroadcastTranscriptVisualProviderSettlement(
        ledger,
        current,
        recovered,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "OUTCOME_UNKNOWN_REQUIRES_CONFIRMATION",
      }),
    );
    expect(
      recordBroadcastTranscriptVisualProviderSettlement(
        ledger,
        current,
        recovered,
        { allowOutcomeUnknownReplacement: true },
      ).settlements,
    ).toEqual([recovered]);
  });

  it("preserves every planned cell across generated priority permutations", () => {
    const current = plan();
    let seed = 0x41c64e6d;
    const random = (): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let iteration = 0; iteration < 128; iteration += 1) {
      const hints = current.cells
        .filter(() => random() > 0.3)
        .map(({ cellId }) => ({
          cellId,
          normalizedSalience: random(),
        }));
      const candidates = current.cells
        .filter(() => random() > 0.5)
        .map((cell, index) => ({
          candidateId: `candidate-${iteration}-${index}`,
          sourceStartMs: cell.sourceStartMs,
          sourceEndMs:
            cell.sourceStartMs +
            Math.max(1, Math.floor((cell.sourceEndMs - cell.sourceStartMs) / 2)),
        }));
      const queue = createBroadcastTranscriptVisualFramePreparationQueue(
        current,
        {
          localVisualSalience: hints,
          existingCandidates: candidates,
        },
      );
      expect(new Set(queue.tasks.map(({ cellId }) => cellId))).toEqual(
        new Set(current.cells.map(({ cellId }) => cellId)),
      );
      expect(queue.tasks).toHaveLength(current.cells.length);
    }
  });
});
