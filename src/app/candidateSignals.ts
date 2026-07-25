import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";

/**
 * The "why is this on my screen" tiles.
 *
 * The evidence behind a candidate was only reachable three levels down, in a
 * fold inside a tab, even though it answers the first question a reviewer
 * asks. This projects it into at most three glanceable figures.
 *
 * Every value is a ratio against that stream's *own* baseline — how far this
 * moment sits above what the broadcast normally does — never an absolute
 * quality score, because nothing here measures whether a moment is good. A
 * tile is a bare figure with no room for a caveat, so a figure only earns one
 * when its denominator is stated in the tile itself ("평소 대비").
 *
 * Two fields are deliberately excluded, and neither should come back to fill
 * the row out:
 * - `rankPercentile`: still drives internal prioritisation, but as a tile it
 *   reads as a grade ("상위 3%") the ranking cannot back up — it carries a lot
 *   of false signal and clusters in a few situations.
 * - `sceneChangeStrength`: a unitless float with no reference point. "0.70"
 *   answers nothing an editor asked; it only makes the tile look measured.
 *   That leaves the visual signal with no showable figure, so it gets no tile.
 *   The evidence chips still name it, which is the honest amount to say.
 */

export type CandidateSignalKind = "chat" | "audio";

export interface CandidateSignalTile {
  readonly kind: CandidateSignalKind;
  /** What was measured, e.g. "채팅 반응". */
  readonly label: string;
  /** The figure itself, without its unit. */
  readonly value: string;
  /** Unit suffix rendered smaller, e.g. "배". */
  readonly unit: string;
  /** What the figure is relative to. Dropped first when space is tight. */
  readonly note: string;
}

export function buildCandidateSignalTiles(
  candidate: UnifiedHighlightCandidate,
): readonly CandidateSignalTile[] {
  const tiles: CandidateSignalTile[] = [];
  const { chat, audio } = candidate.evidence;

  if (chat !== undefined) {
    tiles.push({
      kind: "chat",
      label: "채팅 반응",
      value: chat.burstRatio.toFixed(1),
      unit: "배",
      note: "평소 대비",
    });
  }
  // A signal without a showable figure yields no tile: inventing a stand-in
  // number, or falling back to the rank, would be worse than an absent tile.
  // The evidence chips still name the signal.
  if (audio?.rmsLiftRatio !== undefined) {
    tiles.push({
      kind: "audio",
      label: "오디오 반응",
      value: audio.rmsLiftRatio.toFixed(1),
      unit: "배",
      note: "평소 음량 대비",
    });
  }
  return tiles;
}
