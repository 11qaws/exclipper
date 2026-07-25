import type { UnifiedHighlightCandidate } from "../analysis/highlightFusion";

/**
 * The "why is this on my screen" tiles.
 *
 * The evidence behind a candidate was only reachable three levels down, in a
 * fold inside a tab, even though it answers the first question a reviewer
 * asks. This projects it into at most three glanceable figures.
 *
 * Every value is a measurement taken *within the same broadcast* — a ratio
 * against that stream's own baseline, or the raw strength of what was
 * observed — never an absolute quality score, because nothing here measures
 * whether a moment is good.
 *
 * The rank percentile is deliberately not among them. It still drives internal
 * prioritisation, but as a tile it reads as a grade ("상위 3%") that the number
 * cannot back up: the ranking carries a lot of false signal and clusters in a
 * few situations. A tile has no room for that caveat, so the rank stays out.
 * Do not reintroduce it to make a candidate look better justified.
 */

export type CandidateSignalKind = "chat" | "audio" | "visual";

export interface CandidateSignalTile {
  readonly kind: CandidateSignalKind;
  /** What was measured, e.g. "채팅 반응". */
  readonly label: string;
  /** The figure itself, without its unit. */
  readonly value: string;
  /** Unit suffix rendered smaller, e.g. "배". Empty for a unitless figure. */
  readonly unit: string;
  /** What the figure is relative to. Dropped first when space is tight. */
  readonly note: string;
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
  // A signal without a showable figure yields no tile: the rank it used to
  // fall back on is not shown, and inventing a stand-in figure would be worse
  // than an absent tile. The evidence chips still name the signal.
  if (audio?.rmsLiftRatio !== undefined) {
    tiles.push({
      kind: "audio",
      label: "오디오 반응",
      value: audio.rmsLiftRatio.toFixed(1),
      unit: "배",
      note: "평소 음량 대비",
    });
  }
  if (visual?.sceneChangeStrength !== undefined) {
    tiles.push({
      kind: "visual",
      label: "화면 변화",
      value: visual.sceneChangeStrength.toFixed(2),
      unit: "",
      note: "장면 변화 강도",
    });
  }
  return tiles;
}
