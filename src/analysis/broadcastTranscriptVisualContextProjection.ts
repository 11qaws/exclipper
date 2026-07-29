import {
  MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
  type BroadcastContextChapterInput,
} from "./broadcastContextProtocol";
import {
  createBroadcastTranscriptVisualInspectionPlan,
  inspectBroadcastTranscriptVisualInspectionPublication,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualInspectionPublicationStatus,
  type BroadcastTranscriptVisualProviderSettlement,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  assertBroadcastTranscriptVisualInspectionRunnerCheckpoint,
  type BroadcastTranscriptVisualInspectionRunnerCheckpoint,
} from "./broadcastTranscriptVisualInspectionRunner";
import {
  parseBroadcastTranscriptResolvedEvidenceCheckpointJson,
  type BroadcastTranscriptResolvedEvidenceCheckpoint,
} from "./broadcastTranscriptResolvedEvidence";

export const MAX_BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_CHECKPOINT_BYTES =
  8 * 1024 * 1024;

export interface BroadcastTranscriptVisualContextProjection {
  readonly evidenceCheckpoint: BroadcastTranscriptResolvedEvidenceCheckpoint;
  readonly plan: BroadcastTranscriptVisualInspectionPlan;
  readonly runnerCheckpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint;
  readonly publication: BroadcastTranscriptVisualInspectionPublicationStatus;
  /** Only terminal visual settlements are projected. */
  readonly chapters: readonly BroadcastContextChapterInput[];
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedSummary(value: string): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH) return value;
  return codePoints.slice(0, MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH).join("");
}

function terminalSettlementSummary(
  settlement: BroadcastTranscriptVisualProviderSettlement,
): string {
  if (settlement.summaryKo === null) {
    throw new TypeError(
      "A terminal visual inspection settlement must contain a summary.",
    );
  }
  if (settlement.editorialFinding === null) {
    throw new TypeError(
      "A terminal visual inspection settlement must contain an editorial finding.",
    );
  }
  const findingLabel: string = {
    "quiet-success": "조용한 성공",
    "visual-event": "화면 사건",
    "no-usable-event": "사용할 사건 없음",
    "music-or-mv-only": "음악·뮤직비디오 전용 구간",
  }[settlement.editorialFinding];
  return boundedSummary(`[4화면 검토 · ${findingLabel}] ${settlement.summaryKo}`);
}

export function serializeBroadcastTranscriptVisualInspectionRunnerCheckpoint(
  checkpoint: BroadcastTranscriptVisualInspectionRunnerCheckpoint,
  plan: BroadcastTranscriptVisualInspectionPlan,
): string {
  assertBroadcastTranscriptVisualInspectionRunnerCheckpoint(checkpoint, plan);
  const serialized = JSON.stringify(checkpoint);
  if (
    utf8ByteLength(serialized) >
    MAX_BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_CHECKPOINT_BYTES
  ) {
    throw new TypeError(
      "The visual inspection runner checkpoint exceeds its durable byte ceiling.",
    );
  }
  return serialized;
}

export function parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
  serialized: string,
  plan: BroadcastTranscriptVisualInspectionPlan,
): BroadcastTranscriptVisualInspectionRunnerCheckpoint | null {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    utf8ByteLength(serialized) >
      MAX_BROADCAST_TRANSCRIPT_VISUAL_INSPECTION_CHECKPOINT_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    assertBroadcastTranscriptVisualInspectionRunnerCheckpoint(parsed, plan);
    return parsed;
  } catch {
    return null;
  }
}

export function projectBroadcastTranscriptVisualContext(
  evidenceCheckpoint: BroadcastTranscriptResolvedEvidenceCheckpoint,
  visualInspectionCheckpointJson: string,
): BroadcastTranscriptVisualContextProjection | null {
  const plan =
    createBroadcastTranscriptVisualInspectionPlan(evidenceCheckpoint);
  const runnerCheckpoint =
    parseBroadcastTranscriptVisualInspectionRunnerCheckpointJson(
      visualInspectionCheckpointJson,
      plan,
    );
  if (runnerCheckpoint === null) return null;

  const publication =
    inspectBroadcastTranscriptVisualInspectionPublication({
      plan,
      preparedFrameReceipts: runnerCheckpoint.preparedFrameReceipts,
      providerLedger: runnerCheckpoint.providerLedger,
    });
  const terminalByCellId = new Map(
    runnerCheckpoint.providerLedger.settlements
      .filter(
        ({ outcome }) =>
          outcome === "completed" || outcome === "excluded-music-only",
      )
      .map((settlement) => [settlement.cellId, settlement]),
  );
  const chapters = plan.cells.flatMap((cell) => {
    if (cell.inspectionPurpose !== "transcript-abstention") return [];
    const settlement = terminalByCellId.get(cell.cellId);
    if (settlement === undefined) return [];
    return [
      {
        chapterId: cell.cellId,
        startMs: cell.sourceStartMs,
        endMs: cell.sourceEndMs,
        evidenceMode: "sampled-audio-video" as const,
        evidenceCoverageRatio: 1,
        summaryKo: terminalSettlementSummary(settlement),
      },
    ];
  });

  return {
    evidenceCheckpoint,
    plan,
    runnerCheckpoint,
    publication,
    chapters,
  };
}

export function parseAndProjectBroadcastTranscriptVisualContext(input: {
  readonly transcriptEvidenceCheckpointJson: string;
  readonly visualInspectionCheckpointJson: string;
}): BroadcastTranscriptVisualContextProjection | null {
  const evidenceCheckpoint =
    parseBroadcastTranscriptResolvedEvidenceCheckpointJson(
      input.transcriptEvidenceCheckpointJson,
    );
  return evidenceCheckpoint === null
    ? null
    : projectBroadcastTranscriptVisualContext(
        evidenceCheckpoint,
        input.visualInspectionCheckpointJson,
      );
}

export function mergeBroadcastTranscriptAndVisualContextChapters(
  transcriptChapters: readonly BroadcastContextChapterInput[],
  visualChapters: readonly BroadcastContextChapterInput[],
): readonly BroadcastContextChapterInput[] {
  const ordered = [...transcriptChapters, ...visualChapters].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.chapterId.localeCompare(right.chapterId),
  );
  const chapterIds = new Set<string>();
  let previousEndMs = -1;
  for (const chapter of ordered) {
    if (
      chapterIds.has(chapter.chapterId) ||
      chapter.startMs < previousEndMs
    ) {
      throw new TypeError(
        "Transcript and visual context chapters must be unique, source-ordered, and non-overlapping.",
      );
    }
    chapterIds.add(chapter.chapterId);
    previousEndMs = chapter.endMs;
  }
  return ordered;
}

export function visualInspectionPlanCellIds(
  plan: BroadcastTranscriptVisualInspectionPlan,
): ReadonlySet<string> {
  return new Set(plan.cells.map(({ cellId }) => cellId));
}
