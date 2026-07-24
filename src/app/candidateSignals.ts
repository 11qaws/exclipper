import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";

/**
 * The "why is this on my screen" tiles.
 *
 * The evidence behind a candidate was only reachable three levels down, in a
 * fold inside a tab, even though it answers the first question a reviewer
 * asks. This projects it into at most three glanceable figures.
 *
 * Every value is a comparison *within the same broadcast* — a rank or a
 * ratio against that stream's own baseline — never an absolute quality
 * score, because nothing here measures whether a moment is good.
 */

export type CandidateSignalKind = "chat" | "audio" | "visual";

export interface CandidateSignalTile {
  readonly kind: CandidateSignalKind;
  /** What was measured, e.g. "채팅 반응". */
  readonly label: string;
  /** The figure itself, without its unit. */
  readonly value: string;
  /** Unit suffix rendered smaller, e.g. "배" or "%". */
  readonly unit: string;
  /** What the figure is relative to. Dropped first when space is tight. */
  readonly note: string;
}

/**
 * A rank percentile in [0, 1] as a "top N%" integer. Percentiles arrive with
 * 1 meaning strongest, so the top share is the complement, floored at 1 —
 * "top 0%" would read as an error rather than as a very strong signal.
 */
export function topPercent(rankPercentile: number): number {
  if (!Number.isFinite(rankPercentile)) {
    return 100;
  }
  const clamped = Math.min(1, Math.max(0, rankPercentile));
  return Math.max(1, Math.round((1 - clamped) * 100));
}

export function buildCandidateSignalTiles(
  candidate: UnifiedHighlightCandidate,
): readonly CandidateSignalTile[] {
  const tiles: CandidateSignalTile[] = [];
  const { chat, audio, visual } = candidate.evidence;

  if (chat !== undefined) {
    tiles.push({
      kind: "chat",
      label: "채팅 반응",
      value: chat.burstRatio.toFixed(1),
      unit: "배",
      note: "평소 대비",
    });
  }
  if (audio !== undefined) {
    tiles.push({
      kind: "audio",
      label: "오디오 반응",
      value: String(topPercent(audio.rankPercentile)),
      unit: "%",
      note: "상위",
    });
  }
  if (visual !== undefined) {
    tiles.push({
      kind: "visual",
      label: "화면 변화",
      value: String(topPercent(visual.rankPercentile)),
      unit: "%",
      note: "상위",
    });
  }
  return tiles;
}
