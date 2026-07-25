/**
 * Honest time estimates for the fast-scan waiting screen.
 *
 * The progress bar used to show fabricated constants (0.76, 0.84, ...) for
 * stages whose real completion fraction wasn't known, which made the bar
 * appear to stall. This module produces a duration estimate instead: a
 * static range before there is enough signal to project from, and a
 * measured projection once the run has been going long enough that
 * elapsed-time / ratio is a meaningful extrapolation.
 *
 * Every output is deliberately a range or an "약" (about) prefix — never a
 * precise-looking number for a process whose real duration depends on the
 * user's hardware and the broadcast's content. Shown numbers are also padded
 * and held monotonically decreasing; see REMAINING_ESTIMATE_PADDING_FACTOR and
 * clampToMonotonic for why.
 */

export interface AnalysisDurationRangeMs {
  readonly lowMs: number;
  readonly highMs: number;
}

/**
 * Static planning estimate from source duration alone, before any progress
 * signal exists. Calibrated to "6시간 기준 약 25~40분" from the product
 * plan: roughly 4.2–6.7 minutes of processing per hour of broadcast.
 */
export function estimateAnalysisDurationRangeMs(
  sourceDurationMs: number,
): AnalysisDurationRangeMs {
  const hours = Math.max(0, sourceDurationMs) / 3_600_000;
  const lowMs = Math.max(3 * 60_000, Math.round(hours * 25 * 60_000) / 6);
  const highMs = Math.max(lowMs + 2 * 60_000, Math.round(hours * 40 * 60_000) / 6);
  return { lowMs, highMs };
}

/**
 * Minimum elapsed time and ratio before a measured projection replaces the
 * static estimate. Below this, elapsed/ratio swings wildly on noisy early
 * progress and would read as more precise than it is.
 */
const MINIMUM_ELAPSED_MS_FOR_PROJECTION = 8_000;
const MINIMUM_RATIO_FOR_PROJECTION = 0.04;

export interface RemainingEstimateInput {
  readonly sourceDurationMs: number;
  readonly elapsedMs: number;
  /** Fast-scan completion fraction in [0, 1], or null before any progress arrives. */
  readonly ratio: number | null;
}

export type RemainingEstimateBasis = "static" | "measured";

export interface RemainingEstimate {
  readonly basis: RemainingEstimateBasis;
  readonly remainingMs: number;
}

/**
 * Padding applied to every remaining-time estimate before it is shown.
 *
 * Finishing earlier than promised costs nothing; overrunning a promise reads as
 * a hung run, because the editor cannot tell a slow machine from a stuck one.
 * So the shown number is deliberately generous rather than centred.
 *
 * The padding multiplies the *remaining* amount, not the projected total: that
 * keeps the estimate converging to zero as the run completes, instead of
 * leaving a permanent 18% tail that never counts down.
 */
const REMAINING_ESTIMATE_PADDING_FACTOR = 1.18;

/**
 * Projects remaining time from elapsed time and completion ratio once both
 * are large enough to trust, falling back to the static duration-based range
 * (using its midpoint) otherwise. Both paths carry the same padding, since the
 * editor reads one label and cannot tell which basis produced it.
 */
export function estimateRemainingMs(
  input: RemainingEstimateInput,
): RemainingEstimate {
  if (
    input.ratio !== null &&
    input.ratio >= MINIMUM_RATIO_FOR_PROJECTION &&
    input.elapsedMs >= MINIMUM_ELAPSED_MS_FOR_PROJECTION
  ) {
    const projectedTotalMs = input.elapsedMs / input.ratio;
    return {
      basis: "measured",
      remainingMs:
        Math.max(0, projectedTotalMs - input.elapsedMs) *
        REMAINING_ESTIMATE_PADDING_FACTOR,
    };
  }
  const range = estimateAnalysisDurationRangeMs(input.sourceDurationMs);
  const midpointMs = (range.lowMs + range.highMs) / 2;
  return {
    basis: "static",
    remainingMs:
      Math.max(0, midpointMs - input.elapsedMs) * REMAINING_ESTIMATE_PADDING_FACTOR,
  };
}

/**
 * Holds the shown remaining time to what the editor has already seen, so the
 * displayed number only ever falls.
 *
 * A remaining time that jumps back up ("4분 남음" → "6분 남음") is worse than a
 * number that sits still: it exposes the label as guesswork and cancels the
 * padding above, whose whole point is that the run beats its promise. When a
 * fresh projection rises — a slower stage, a stalled worker, a noisy ratio — we
 * keep showing the previous value; as soon as reality drops below it, the label
 * follows reality down again.
 *
 * Deliberately pure and stateless: the caller owns the previous value, so a new
 * analysis run resets the sequence simply by passing null. Applying it twice to
 * the same input is a no-op, which makes it safe to run during a render.
 */
export function clampToMonotonic(
  previousShownMs: number | null,
  nextEstimateMs: number,
): number {
  const nextMs = Number.isFinite(nextEstimateMs) ? Math.max(0, nextEstimateMs) : 0;
  if (previousShownMs === null || !Number.isFinite(previousShownMs)) {
    return nextMs;
  }
  return Math.min(Math.max(0, previousShownMs), nextMs);
}

/** Rounds to the nearest whole minute, never showing zero for real remaining work. */
function roundToMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * "약 N분 남음" for a measured projection, "약 N~M분" for the static range —
 * the two read differently on purpose, so the editor can tell whether the
 * number comes from real progress or a planning guess.
 */
export function formatRemainingLabel(estimate: RemainingEstimate): string {
  if (estimate.basis === "measured") {
    const minutes = roundToMinutes(estimate.remainingMs);
    return minutes <= 1 ? "약 1분 남음" : `약 ${minutes}분 남음`;
  }
  const minutes = roundToMinutes(estimate.remainingMs);
  return `약 ${minutes}분 남음 (추정)`;
}
