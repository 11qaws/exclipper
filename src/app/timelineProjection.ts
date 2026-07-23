/**
 * Pure projections from analysis results onto the review timeline.
 *
 * Nothing here reads component state or decides candidate outcomes; these
 * functions only reshape already-computed evidence for display.
 */
import type { BroadcastContextChapterInput } from "../analysis/broadcastContextProtocol";
import type { BroadcastContextTranscriptionChunk } from "../analysis/broadcastContextSamplingPlan";
import type {
  BroadcastTranscriptExplorationCell,
  BroadcastTranscriptExplorationCellState,
  CandidateTimelineFramesById,
  CandidateTimelineScorePoint,
  CandidateTimelineScoreSource,
  CandidateTimelineSignalKind,
  CandidateTimelineThumbnailById,
} from "./appViewTypes";

export function createTranscriptExplorationCells(
  chunks: readonly BroadcastContextTranscriptionChunk[],
  state: BroadcastTranscriptExplorationCellState = "queued",
): readonly BroadcastTranscriptExplorationCell[] {
  return chunks.map((chunk) => ({
    ...chunk,
    state,
    stage: null,
  }));
}

export function createChapterExplorationCells(
  chapters: readonly BroadcastContextChapterInput[],
): readonly BroadcastTranscriptExplorationCell[] {
  return chapters.map((chapter) => ({
    chunkId: `chapter:${chapter.chapterId}`,
    sourceStartMs: chapter.startMs,
    sourceEndMs: chapter.endMs,
    kind: "uniform",
    state: "complete",
    stage: null,
  }));
}

export function timelineSignalLabel(kind: CandidateTimelineSignalKind): string {
  return {
    audio: "목소리·소리 변화",
    chat: "채팅 반응",
    visual: "화면 변화",
    fused: "복합 신호",
  }[kind];
}

export function firstTimelineFrameById(
  framesById: CandidateTimelineFramesById,
): CandidateTimelineThumbnailById {
  return Object.fromEntries(
    Object.entries(framesById).flatMap(([candidateId, frames]) => {
      const frame = frames[0];
      return frame === undefined ? [] : [[candidateId, frame]];
    }),
  );
}

/**
 * Normalises each signal kind against its own maximum so the timeline shows
 * relative strength inside one broadcast, never a clip probability.
 */
export function buildCandidateTimelineScorePoints(
  sources: readonly CandidateTimelineScoreSource[],
): readonly CandidateTimelineScorePoint[] {
  const rawPoints = sources.flatMap(({ signalKind, candidates }) =>
    candidates.map((candidate) => ({ ...candidate, signalKind })),
  );
  const maximumBySignal = new Map<CandidateTimelineSignalKind, number>();
  for (const point of rawPoints) {
    const currentMaximum = maximumBySignal.get(point.signalKind) ?? 0;
    maximumBySignal.set(point.signalKind, Math.max(currentMaximum, point.score));
  }
  return rawPoints
    .filter(
      (point) =>
        Number.isFinite(point.peakMs) &&
        Number.isFinite(point.startMs) &&
        Number.isFinite(point.endMs) &&
        point.endMs > point.startMs &&
        Number.isFinite(point.score),
    )
    .map((point) => {
      const maximum = maximumBySignal.get(point.signalKind) ?? 0;
      const normalized = maximum > 0 ? point.score / maximum : 0;
      return {
        ...point,
        strength: Math.min(1, Math.max(0.08, normalized)),
      };
    })
    .sort((left, right) => left.peakMs - right.peakMs || right.strength - left.strength);
}
