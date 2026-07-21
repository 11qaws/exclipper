export const AUDIO_REACTION_CANDIDATE_WINDOW_MS = 45_000 as const;
export const MAX_AUDIO_REACTION_CANDIDATE_COUNT = 12 as const;

const MIN_CANDIDATE_WINDOW_MS = 30_000;
const MAX_CANDIDATE_WINDOW_MS = 60_000;
const LOCAL_BASELINE_RADIUS_MS = 120_000;
const BASELINE_GUARD_MS = 8_000;
const MIN_BASELINE_WINDOW_COUNT = 6;
const MAX_CLUSTER_GAP_MS = 2_000;
const MIN_LOUDNESS_LIFT_DB = 5;
const MIN_PEAK_LIFT_DB = 3;
const MIN_ROBUST_LOUDNESS_SCORE = 2;
const MIN_RMS_SCALE = 0.005;
const MIN_PEAK_SCALE = 0.01;
const MIN_RATE_SCALE = 0.015;
const SILENCE_RMS = 0.0025;
const SILENCE_PEAK = 0.015;
const IMPULSE_CREST_DB = 14;
// A one-second mixed-audio window often has a high crest during ordinary
// speech. Only discard it as an impulse when the signal is also isolated.
const IMPULSE_TEMPORAL_SUPPORT_LIFT_DB = 2.5;
const STRONG_VOCAL_SUPPORT_RATIO = 0.55;
const SUSTAINED_BACKGROUND_MS = 12_000;
// Retain quiet but changing speech as a review lead. The stricter music and
// edge gates below prevent harmonic beds from turning into false candidates.
const DIALOGUE_SIGNAL_SPEECH_RATIO = 0.42;
const DIALOGUE_SIGNAL_NOVELTY = 2.25;
const DIALOGUE_SIGNAL_ZERO_CROSSING_NOVELTY = 1.05;
const DIALOGUE_SIGNAL_MIN_CREST_DB = 6;
const PROGRAM_EDGE_GUARD_MS = 90_000;
// A long, steady vocal-band plateau is usually a song/MV or program bed,
// not a streamer reaction. Keep this gate conservative so a changing laugh,
// shout, or panic sequence can still pass through the normal reaction path.
const MUSIC_PLATEAU_MIN_DURATION_MS = 12_000;
const MUSIC_PLATEAU_MAX_RMS_RANGE_DB = 4;
const MUSIC_PLATEAU_MAX_SPEECH_RANGE = 0.12;
const MUSIC_PLATEAU_MAX_ZERO_CROSSING_RANGE = 0.08;

export interface AudioReactionFeatureWindow {
  readonly startMs: number;
  readonly endMs: number;
  /** Linear 0-1 root-mean-square amplitude for this window. */
  readonly rms: number;
  /** Linear 0-1 absolute peak amplitude for this window. */
  readonly peak: number;
  /** Share of adjacent samples whose sign changed, normalized to 0-1. */
  readonly zeroCrossingRate: number;
  /** Optional 0-1 energy share in a speech-like frequency band. */
  readonly speechBandEnergyRatio?: number;
}

export type AudioReactionEventKind =
  | "short-loudness-burst"
  | "sustained-vocal-reaction"
  | "dialogue-issue-signal";

/**
 * Privacy-safe aggregates only. Raw PCM, filenames, transcripts, and speaker
 * identity are deliberately outside this contract.
 */
export interface LocalAudioReactionEvidence {
  readonly eventKind: AudioReactionEventKind;
  readonly baselineRms: number;
  readonly medianAbsoluteDeviation: number;
  readonly robustLoudnessScore: number;
  readonly rmsLiftRatio: number;
  readonly peakLiftRatio: number;
  readonly sustainedWindowCount: number;
  readonly activeWindowCount: number;
  readonly clickPenalty: number;
  readonly backgroundPenalty: number;
  readonly zeroCrossingRate: number;
  readonly speechBandEnergyRatio: number;
}

export type AudioReactionCandidateEvidence = LocalAudioReactionEvidence;

export interface LocalAudioReactionCandidate {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly reason: string;
  readonly evidence: LocalAudioReactionEvidence;
}

export type AudioReactionCandidate = LocalAudioReactionCandidate;

export interface LocalAudioReactionAnalysisDiagnostics {
  readonly medianWindowDurationMs: number;
  readonly sourceMedianRms: number;
  readonly sourceMedianPeak: number;
  readonly silenceWindowCount: number;
  readonly impulseLikeWindowCount: number;
  readonly suppressedSustainedBackgroundCount: number;
  readonly eligibleEventCount: number;
}

export interface LocalAudioReactionAnalysisResult {
  readonly mode: "local-audio-reaction-fast-pass";
  readonly sourceDurationMs: number;
  readonly plannedWindowCount: number;
  readonly analyzedWindowCount: number;
  readonly coverageComplete: boolean;
  readonly candidateWindowMs: number;
  readonly candidates: readonly LocalAudioReactionCandidate[];
  readonly diagnostics: LocalAudioReactionAnalysisDiagnostics;
}

export interface SelectAudioReactionHighlightsOptions {
  readonly maxCandidates?: number;
  readonly candidateWindowMs?: number;
  readonly plannedWindowCount?: number;
}

interface NormalizedWindow extends AudioReactionFeatureWindow {
  readonly index: number;
  readonly centerMs: number;
  readonly rmsDb: number;
  readonly peakDb: number;
}

interface FeatureBaseline {
  readonly rms: number;
  readonly rmsMad: number;
  readonly peak: number;
  readonly peakMad: number;
  readonly zeroCrossingRate: number;
  readonly zeroCrossingRateMad: number;
  readonly speechBandEnergyRatio: number;
  readonly speechBandEnergyRatioMad: number;
}

interface ScoredWindow extends NormalizedWindow {
  readonly baseline: FeatureBaseline;
  readonly robustLoudnessScore: number;
  readonly robustPeakScore: number;
  readonly rmsLiftRatio: number;
  readonly peakLiftRatio: number;
  readonly loudnessLiftDb: number;
  readonly peakLiftDb: number;
  readonly vocalProxyStrength: number;
  readonly clickPenalty: number;
  readonly silence: boolean;
  readonly impulseLike: boolean;
  readonly dialogueLike: boolean;
  readonly active: boolean;
  readonly support: boolean;
  readonly score: number;
}

interface ReactionEvent {
  readonly windows: readonly ScoredWindow[];
  readonly activeWindows: readonly ScoredWindow[];
  readonly apex: ScoredWindow;
  readonly eventKind: AudioReactionEventKind;
  readonly score: number;
  readonly backgroundPenalty: number;
}

/**
 * Selects likely streamer reactions from already-extracted audio aggregates.
 * This pure function never receives or returns raw PCM.
 */
export function selectAudioReactionHighlights(
  windows: readonly AudioReactionFeatureWindow[],
  sourceDurationMs: number,
  options: SelectAudioReactionHighlightsOptions = {},
): LocalAudioReactionAnalysisResult {
  const durationMs = normalizePositiveDuration(sourceDurationMs);
  const normalized = normalizeWindows(windows, durationMs);
  const scored = normalized.map((window) => scoreWindow(window, normalized));
  const clusters = buildClusters(scored);
  const events: ReactionEvent[] = [];
  let suppressedSustainedBackgroundCount = 0;

  for (const cluster of clusters) {
    const evaluated = evaluateCluster(cluster, scored, durationMs);
    if (evaluated === "sustained-background") {
      suppressedSustainedBackgroundCount += 1;
    } else if (evaluated !== null) {
      events.push(evaluated);
    }
  }

  const requestedWindowMs = clampInteger(
    options.candidateWindowMs ?? AUDIO_REACTION_CANDIDATE_WINDOW_MS,
    MIN_CANDIDATE_WINDOW_MS,
    MAX_CANDIDATE_WINDOW_MS,
    AUDIO_REACTION_CANDIDATE_WINDOW_MS,
  );

  const durationTarget = Math.ceil((durationMs / 3_600_000) * 6);
  const detailAnalysisBudget = 12; // Will be passed into selector
  const minimumReservoir = detailAnalysisBudget * 2;
  const reservoirBudget = Math.max(minimumReservoir, Math.min(durationTarget, 96));
  
  const maxCandidates = clampInteger(
    options.maxCandidates ?? reservoirBudget,
    1,
    96,
    reservoirBudget,
  );

  // 1. Signal Cluster
  // We keep the existing events which are already clustered locally by peak search.
  
  // Sort events by score descending to form the reservoir
  events.sort((left, right) => 
    right.score - left.score ||
    left.apex.centerMs - right.apex.centerMs ||
    left.eventKind.localeCompare(right.eventKind)
  );

  const candidates: LocalAudioReactionCandidate[] = [];

  for (const event of events) {
    if (candidates.length >= maxCandidates) break;

    const candidate = createCandidate(event, durationMs, requestedWindowMs);
    
    // Hard overlap check (deduplication of exactly identical signal ranges)
    if (candidates.some((accepted) => rangesOverlap(accepted, candidate))) {
      continue;
    }
    candidates.push(candidate);
  }

  // Final chronological sort for the reservoir
  candidates.sort((left, right) => left.peakMs - right.peakMs);

  const medianWindowDurationMs = Math.round(
    median(normalized.map((window) => window.endMs - window.startMs)),
  );
  const inferredPlannedWindowCount =
    medianWindowDurationMs > 0 ? Math.ceil(durationMs / medianWindowDurationMs) : 0;
  const plannedWindowCount = clampInteger(
    options.plannedWindowCount ?? inferredPlannedWindowCount,
    0,
    Number.MAX_SAFE_INTEGER,
    inferredPlannedWindowCount,
  );

  return {
    mode: "local-audio-reaction-fast-pass",
    sourceDurationMs: durationMs,
    plannedWindowCount,
    analyzedWindowCount: normalized.length,
    coverageComplete:
      plannedWindowCount > 0 &&
      normalized.length === plannedWindowCount &&
      hasContinuousCoverage(normalized, durationMs),
    candidateWindowMs: Math.min(requestedWindowMs, durationMs),
    candidates,
    diagnostics: {
      medianWindowDurationMs,
      sourceMedianRms: round(median(normalized.map((window) => window.rms)), 6),
      sourceMedianPeak: round(median(normalized.map((window) => window.peak)), 6),
      silenceWindowCount: scored.filter((window) => window.silence).length,
      impulseLikeWindowCount: scored.filter((window) => window.impulseLike).length,
      suppressedSustainedBackgroundCount,
      eligibleEventCount: events.length,
    },
  };
}

function hasContinuousCoverage(
  windows: readonly NormalizedWindow[],
  durationMs: number,
): boolean {
  if (windows[0]?.startMs !== 0 || windows.at(-1)?.endMs !== durationMs) {
    return false;
  }
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index]?.startMs !== windows[index - 1]?.endMs) {
      return false;
    }
  }
  return windows.length > 0;
}

function normalizeWindows(
  windows: readonly AudioReactionFeatureWindow[],
  durationMs: number,
): readonly NormalizedWindow[] {
  const normalized = windows.map((window, index) => {
    const startMs = finiteInteger(window.startMs, `windows[${index}].startMs`);
    const endMs = finiteInteger(window.endMs, `windows[${index}].endMs`);
    if (startMs < 0 || endMs <= startMs || endMs > durationMs) {
      throw new RangeError(
        `windows[${index}] must be a positive range within the source duration.`,
      );
    }
    const rms = normalizedRate(window.rms, `windows[${index}].rms`);
    const peak = normalizedRate(window.peak, `windows[${index}].peak`);
    if (peak < rms) {
      throw new RangeError(`windows[${index}].peak must be greater than or equal to rms.`);
    }
    const zeroCrossingRate = normalizedRate(
      window.zeroCrossingRate,
      `windows[${index}].zeroCrossingRate`,
    );
    const speechBandEnergyRatio =
      window.speechBandEnergyRatio === undefined
        ? undefined
        : normalizedRate(
            window.speechBandEnergyRatio,
            `windows[${index}].speechBandEnergyRatio`,
          );

    return {
      index,
      startMs,
      endMs,
      rms,
      peak,
      zeroCrossingRate,
      ...(speechBandEnergyRatio === undefined ? {} : { speechBandEnergyRatio }),
      centerMs: Math.round((startMs + endMs) / 2),
      rmsDb: amplitudeToDb(rms),
      peakDb: amplitudeToDb(peak),
    } satisfies NormalizedWindow;
  });

  normalized.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous !== undefined && current !== undefined && current.startMs < previous.endMs) {
      throw new RangeError("Audio feature windows must not overlap.");
    }
  }
  return normalized.map((window, index) => ({ ...window, index }));
}

function scoreWindow(
  window: NormalizedWindow,
  windows: readonly NormalizedWindow[],
): ScoredWindow {
  const baselineWindows = selectBaselineWindows(window, windows);
  const baseline = createBaseline(baselineWindows);
  const robustLoudnessScore = robustScore(
    window.rms,
    baseline.rms,
    baseline.rmsMad,
    MIN_RMS_SCALE,
  );
  const robustPeakScore = robustScore(
    window.peak,
    baseline.peak,
    baseline.peakMad,
    MIN_PEAK_SCALE,
  );
  const rmsLiftRatio = safeLiftRatio(window.rms, baseline.rms, MIN_RMS_SCALE);
  const peakLiftRatio = safeLiftRatio(window.peak, baseline.peak, MIN_PEAK_SCALE);
  const loudnessLiftDb = window.rmsDb - amplitudeToDb(baseline.rms);
  const peakLiftDb = window.peakDb - amplitudeToDb(baseline.peak);
  const zeroCrossingNovelty = Math.abs(
    robustScore(
      window.zeroCrossingRate,
      baseline.zeroCrossingRate,
      baseline.zeroCrossingRateMad,
      MIN_RATE_SCALE,
    ),
  );
  const speechBandEnergyRatio = window.speechBandEnergyRatio ?? 0;
  const speechBandNovelty =
    window.speechBandEnergyRatio === undefined
      ? 0
      : Math.max(
          0,
          robustScore(
            speechBandEnergyRatio,
            baseline.speechBandEnergyRatio,
            baseline.speechBandEnergyRatioMad,
            MIN_RATE_SCALE,
          ),
        );
  const vocalProxyStrength = clamp(
    speechBandNovelty * 0.7 + zeroCrossingNovelty * 0.3,
    0,
    8,
  );
  const crestDb = window.peakDb - window.rmsDb;
  const clickPenalty = clamp((crestDb - 10) / 8, 0, 1);
  const silence = window.rms <= SILENCE_RMS && window.peak <= SILENCE_PEAK;
  const candidateElevated =
    !silence &&
    loudnessLiftDb >= MIN_LOUDNESS_LIFT_DB &&
    peakLiftDb >= MIN_PEAK_LIFT_DB &&
    robustLoudnessScore >= MIN_ROBUST_LOUDNESS_SCORE;
  const baselineRmsDb = amplitudeToDb(baseline.rms);
  const hasTemporalSupport = adjacentWindows(window, windows).some(
    (adjacent) =>
      adjacent.rmsDb - baselineRmsDb >= IMPULSE_TEMPORAL_SUPPORT_LIFT_DB,
  );
  const hasStrongVocalSupport =
    speechBandEnergyRatio >= STRONG_VOCAL_SUPPORT_RATIO;
  const highCrestWithoutVocalAnchor =
    crestDb >= IMPULSE_CREST_DB && !hasStrongVocalSupport;
  const impulseLike =
    candidateElevated &&
    highCrestWithoutVocalAnchor &&
    window.endMs - window.startMs <= 2_000 &&
    !hasTemporalSupport;
  const dialogueLike =
    !silence &&
    !candidateElevated &&
    window.speechBandEnergyRatio !== undefined &&
    speechBandEnergyRatio >= DIALOGUE_SIGNAL_SPEECH_RATIO &&
    speechBandNovelty >= DIALOGUE_SIGNAL_NOVELTY &&
    zeroCrossingNovelty >= DIALOGUE_SIGNAL_ZERO_CROSSING_NOVELTY &&
    crestDb >= DIALOGUE_SIGNAL_MIN_CREST_DB &&
    crestDb < IMPULSE_CREST_DB;
  // Sustained high-crest effects may extend a real reaction, but they cannot
  // seed a candidate without a lower-crest or strong vocal-band anchor.
  const active =
    (candidateElevated && !highCrestWithoutVocalAnchor) || dialogueLike;
  const support =
    active ||
    (!silence &&
      !impulseLike &&
      loudnessLiftDb >= 2.5 &&
      robustLoudnessScore >= 1);
  const score =
    Math.max(0, robustLoudnessScore) * 1.1 +
    Math.min(4, Math.max(0, robustPeakScore)) * 0.35 +
    vocalProxyStrength * 0.25 +
    Math.min(1, loudnessLiftDb / 12) -
    clickPenalty +
    (dialogueLike ? Math.min(2, speechBandNovelty) * 0.18 : 0);

  return {
    ...window,
    baseline,
    robustLoudnessScore,
    robustPeakScore,
    rmsLiftRatio,
    peakLiftRatio,
    loudnessLiftDb,
    peakLiftDb,
    vocalProxyStrength,
    clickPenalty,
    silence,
    impulseLike,
    dialogueLike,
    active,
    support,
    score,
  };
}

function adjacentWindows(
  target: NormalizedWindow,
  windows: readonly NormalizedWindow[],
): readonly NormalizedWindow[] {
  const adjacent: NormalizedWindow[] = [];
  const previous = windows[target.index - 1];
  if (
    previous !== undefined &&
    previous.endMs === target.startMs
  ) {
    adjacent.push(previous);
  }
  const next = windows[target.index + 1];
  if (
    next !== undefined &&
    next.startMs === target.endMs
  ) {
    adjacent.push(next);
  }
  return adjacent;
}

function selectBaselineWindows(
  target: NormalizedWindow,
  windows: readonly NormalizedWindow[],
): readonly NormalizedWindow[] {
  const local: NormalizedWindow[] = [];
  for (let index = target.index - 1; index >= 0; index -= 1) {
    const window = windows[index];
    if (window === undefined) {
      continue;
    }
    const distanceMs = target.centerMs - window.centerMs;
    if (distanceMs > LOCAL_BASELINE_RADIUS_MS) {
      break;
    }
    if (distanceMs > BASELINE_GUARD_MS) {
      local.push(window);
    }
  }
  for (let index = target.index + 1; index < windows.length; index += 1) {
    const window = windows[index];
    if (window === undefined) {
      continue;
    }
    const distanceMs = window.centerMs - target.centerMs;
    if (distanceMs > LOCAL_BASELINE_RADIUS_MS) {
      break;
    }
    if (distanceMs > BASELINE_GUARD_MS) {
      local.push(window);
    }
  }
  if (local.length >= MIN_BASELINE_WINDOW_COUNT) {
    return local;
  }
  const fallback = windows.filter(
    (window) =>
      window.index !== target.index &&
      Math.abs(window.centerMs - target.centerMs) > MAX_CLUSTER_GAP_MS,
  );
  return fallback.length > 0 ? fallback : [target];
}

function createBaseline(windows: readonly NormalizedWindow[]): FeatureBaseline {
  const rmsValues = windows.map((window) => window.rms);
  const peakValues = windows.map((window) => window.peak);
  const zeroCrossingValues = windows.map((window) => window.zeroCrossingRate);
  const speechValues = windows
    .map((window) => window.speechBandEnergyRatio)
    .filter((value): value is number => value !== undefined);
  const rms = median(rmsValues);
  const peak = median(peakValues);
  const zeroCrossingRate = median(zeroCrossingValues);
  const speechBandEnergyRatio = median(speechValues);
  return {
    rms,
    rmsMad: median(rmsValues.map((value) => Math.abs(value - rms))),
    peak,
    peakMad: median(peakValues.map((value) => Math.abs(value - peak))),
    zeroCrossingRate,
    zeroCrossingRateMad: median(
      zeroCrossingValues.map((value) => Math.abs(value - zeroCrossingRate)),
    ),
    speechBandEnergyRatio,
    speechBandEnergyRatioMad: median(
      speechValues.map((value) => Math.abs(value - speechBandEnergyRatio)),
    ),
  };
}

function buildClusters(windows: readonly ScoredWindow[]): readonly (readonly ScoredWindow[])[] {
  const clusters: ScoredWindow[][] = [];
  let current: ScoredWindow[] = [];

  for (const window of windows) {
    const previous = current.at(-1);
    if (
      !window.support ||
      (previous !== undefined && window.startMs - previous.endMs > MAX_CLUSTER_GAP_MS)
    ) {
      if (current.some((item) => item.active)) {
        clusters.push(current);
      }
      current = window.support ? [window] : [];
    } else {
      current.push(window);
    }
  }
  if (current.some((window) => window.active)) {
    clusters.push(current);
  }
  return clusters;
}

function evaluateCluster(
  windows: readonly ScoredWindow[],
  allWindows: readonly ScoredWindow[],
  sourceDurationMs: number,
): ReactionEvent | "sustained-background" | null {
  const activeWindows = windows.filter((window) => window.active);
  if (activeWindows.length === 0) {
    return null;
  }
  const apex = [...activeWindows].sort(compareScoredWindows)[0];
  if (apex === undefined) {
    return null;
  }
  const plateau = elevatedPlateau(apex, allWindows);
  const plateauDurationMs =
    (plateau.at(-1)?.endMs ?? apex.endMs) - (plateau[0]?.startMs ?? apex.startMs);
  const rmsRangeDb = numericRange(plateau.map((window) => window.rmsDb));
  const vocalSupportRatio = safeRatio(
    plateau.filter(
      (window) =>
        window.speechBandEnergyRatio === undefined
          ? window.vocalProxyStrength >= 1
          : window.speechBandEnergyRatio >= 0.4,
    ).length,
    plateau.length,
  );
  const backgroundPenalty = clamp(
    (plateauDurationMs / SUSTAINED_BACKGROUND_MS) *
      (1 - clamp(rmsRangeDb / 4, 0, 1)) *
      (1 - vocalSupportRatio),
    0,
    1,
  );
  if (
    plateauDurationMs >= SUSTAINED_BACKGROUND_MS &&
    rmsRangeDb < 2.5 &&
    vocalSupportRatio < 0.4
  ) {
    return "sustained-background";
  }

  const speechValues = plateau
    .map((window) => window.speechBandEnergyRatio)
    .filter((value): value is number => value !== undefined);
  const zeroCrossingRange = numericRange(
    plateau.map((window) => window.zeroCrossingRate),
  );
  const speechRange = numericRange(speechValues);
  const steadyMusicPlateau =
    plateauDurationMs >= MUSIC_PLATEAU_MIN_DURATION_MS &&
    activeWindows.length >= 3 &&
    rmsRangeDb <= MUSIC_PLATEAU_MAX_RMS_RANGE_DB &&
    speechValues.length >= 3 &&
    speechRange <= MUSIC_PLATEAU_MAX_SPEECH_RANGE &&
    zeroCrossingRange <= MUSIC_PLATEAU_MAX_ZERO_CROSSING_RANGE;
  if (steadyMusicPlateau) {
    return "sustained-background";
  }

  const hasVocalAnchor = activeWindows.some(
    (window) =>
      window.speechBandEnergyRatio === undefined
        ? window.vocalProxyStrength >= 1
        : window.speechBandEnergyRatio >= 0.4,
  );
  if (!hasVocalAnchor) {
    return null;
  }

  const nearProgramEdge =
    apex.centerMs < PROGRAM_EDGE_GUARD_MS ||
    sourceDurationMs - apex.centerMs < PROGRAM_EDGE_GUARD_MS;
  const hasDistinctiveEdgeVoice = activeWindows.some(
    (window) =>
      window.speechBandEnergyRatio === undefined
        ? window.vocalProxyStrength >= 2
        : window.speechBandEnergyRatio >= STRONG_VOCAL_SUPPORT_RATIO,
  );
  if (nearProgramEdge && !hasDistinctiveEdgeVoice) {
    return null;
  }

  const eventDurationMs =
    (windows.at(-1)?.endMs ?? apex.endMs) - (windows[0]?.startMs ?? apex.startMs);
  const singleWindowHasVocalSupport =
    activeWindows.length === 1 &&
    (apex.dialogueLike || apex.vocalProxyStrength >= 1.5) &&
    (apex.clickPenalty < 0.5 ||
      (apex.speechBandEnergyRatio ?? 0) >= STRONG_VOCAL_SUPPORT_RATIO);
  if (activeWindows.length < 2 && !singleWindowHasVocalSupport) {
    return null;
  }
  const eventKind: AudioReactionEventKind =
    activeWindows.filter((window) => window.dialogueLike).length >=
      Math.ceil(activeWindows.length / 2)
      ? "dialogue-issue-signal"
      : eventDurationMs >= 3_000 &&
          activeWindows.length >= 3 &&
          (vocalSupportRatio >= 0.4 || rmsRangeDb >= 2)
        ? "sustained-vocal-reaction"
        : "short-loudness-burst";
  const score =
    apex.score +
    Math.log1p(activeWindows.length) * 0.7 +
    vocalSupportRatio * 0.8 -
    backgroundPenalty * 1.5;
  return {
    windows,
    activeWindows,
    apex,
    eventKind,
    score,
    backgroundPenalty,
  };
}

function elevatedPlateau(
  apex: ScoredWindow,
  windows: readonly ScoredWindow[],
): readonly ScoredWindow[] {
  const thresholdDb = amplitudeToDb(apex.baseline.rms) + 3;
  let first = apex.index;
  let last = apex.index;
  while (first > 0) {
    const previous = windows[first - 1];
    const current = windows[first];
    if (
      previous === undefined ||
      current === undefined ||
      current.startMs - previous.endMs > MAX_CLUSTER_GAP_MS ||
      previous.rmsDb < thresholdDb
    ) {
      break;
    }
    first -= 1;
  }
  while (last < windows.length - 1) {
    const current = windows[last];
    const next = windows[last + 1];
    if (
      current === undefined ||
      next === undefined ||
      next.startMs - current.endMs > MAX_CLUSTER_GAP_MS ||
      next.rmsDb < thresholdDb
    ) {
      break;
    }
    last += 1;
  }
  return windows.slice(first, last + 1);
}

function createCandidate(
  event: ReactionEvent,
  durationMs: number,
  requestedWindowMs: number,
): LocalAudioReactionCandidate {
  const peakMs = event.apex.centerMs;
  const effectiveWindowMs = Math.min(requestedWindowMs, durationMs);
  const contextBeforeMs = Math.round(effectiveWindowMs * 0.6);
  const latestStartMs = Math.max(0, durationMs - effectiveWindowMs);
  const startMs = clamp(peakMs - contextBeforeMs, 0, latestStartMs);
  const endMs = startMs + effectiveWindowMs;
  const evidence: LocalAudioReactionEvidence = {
    eventKind: event.eventKind,
    baselineRms: round(event.apex.baseline.rms, 6),
    medianAbsoluteDeviation: round(event.apex.baseline.rmsMad, 6),
    robustLoudnessScore: round(event.apex.robustLoudnessScore, 3),
    rmsLiftRatio: round(event.apex.rmsLiftRatio, 3),
    peakLiftRatio: round(event.apex.peakLiftRatio, 3),
    sustainedWindowCount: event.windows.length,
    activeWindowCount: event.activeWindows.length,
    clickPenalty: round(event.apex.clickPenalty, 3),
    backgroundPenalty: round(event.backgroundPenalty, 3),
    zeroCrossingRate: round(event.apex.zeroCrossingRate, 6),
    speechBandEnergyRatio: round(event.apex.speechBandEnergyRatio ?? 0, 6),
  };
  const signalDescription =
    event.eventKind === "dialogue-issue-signal"
      ? "대사 변화 신호"
      : event.eventKind === "sustained-vocal-reaction"
        ? `${event.activeWindows.length}개 구간에 걸쳐 웃음·외침처럼 이어지는 음성 변화`
        : "평소보다 크게 튄 짧은 음량 반응";
  return {
    id: `audio-${event.eventKind}-${event.apex.startMs}-${startMs}-${endMs}`,
    peakMs,
    startMs,
    endMs,
    score: round(event.score, 6),
    reason: `${signalDescription}가 감지됐어요. 오디오만으로는 실제 사건 내용을 알 수 없어 영상·대사·채팅과 함께 확인해야 해요.`,
    evidence,
  };
}



function compareScoredWindows(left: ScoredWindow, right: ScoredWindow): number {
  return right.score - left.score || left.centerMs - right.centerMs;
}

function rangesOverlap(
  left: Pick<LocalAudioReactionCandidate, "startMs" | "endMs">,
  right: Pick<LocalAudioReactionCandidate, "startMs" | "endMs">,
): boolean {
  return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
}

function robustScore(
  value: number,
  baseline: number,
  mad: number,
  scaleFloor: number,
): number {
  return clamp((value - baseline) / Math.max(scaleFloor, 1.4826 * mad), -3, 8);
}

function safeLiftRatio(value: number, baseline: number, floor: number): number {
  return (value + floor) / (baseline + floor);
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function amplitudeToDb(value: number): number {
  return Math.max(-100, 20 * Math.log10(Math.max(0.00001, value)));
}

function numericRange(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

function normalizePositiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("sourceDurationMs must be a finite positive number.");
  }
  return Math.max(1, Math.round(value));
}

function finiteInteger(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return Math.round(value);
}

function normalizedRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
  return value;
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(Math.round(value), minimum, maximum);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
