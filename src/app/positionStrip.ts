/**
 * Placement math for the compact broadcast-position strip.
 *
 * The strip replaces an always-visible five-lane timeline with a single 6px
 * rail: it answers "roughly where in the broadcast is this candidate", not
 * "what happened here" — that detail moved to the map sheet (`M`). Keeping
 * the arithmetic here, rather than inline in JSX, makes the clamping and
 * rounding behaviour independently testable.
 */

/**
 * A candidate's horizontal position on the strip as a percentage in [0, 100].
 * Returns 0 for a non-positive or unknown source duration rather than NaN or
 * a percentage outside the rail, since the strip has no meaningful position
 * to show before the source length is known.
 */
export function candidateStripPositionPercent(
  peakMs: number,
  sourceDurationMs: number,
): number {
  if (!Number.isFinite(peakMs) || !Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (peakMs / sourceDurationMs) * 100));
}

/** 30-minute tick timestamps (ms) projected onto the strip as percentages. */
export function stripTickPercentages(
  tickTimestampsMs: readonly number[],
  sourceDurationMs: number,
): readonly number[] {
  if (sourceDurationMs <= 0) {
    return [];
  }
  return tickTimestampsMs.map((tickMs) =>
    candidateStripPositionPercent(tickMs, sourceDurationMs),
  );
}
