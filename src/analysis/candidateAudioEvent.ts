/**
 * Pure candidate-window and AudioSet evidence projection for local audio-event AI.
 *
 * This module has no model, media, Worker, storage, or UI dependencies. It accepts
 * only complete 527-value evidence vectors, reads a fixed reaction allowlist,
 * and returns the bounded Worker-protocol result. Audible windows use the
 * pinned AST model's post-sigmoid scores; a conservative pre-model silence/click
 * gate may supply an all-zero absence vector. Raw vectors and arbitrary model
 * labels never appear in the protocol result.
 */

import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET,
} from "./candidateAudioEventWorkerProtocol";
import type {
  CandidateAudioEventCandidateResult,
  CandidateAudioEventDetection,
  CandidateAudioEventKind,
  CandidateAudioEventQuality,
  CandidateAudioEventStrength,
  CandidateAudioEventTarget,
} from "./candidateAudioEventWorkerProtocol";

export {
  CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET,
};
export type {
  CandidateAudioEventCandidateResult,
  CandidateAudioEventDetection,
  CandidateAudioEventKind,
  CandidateAudioEventQuality,
  CandidateAudioEventStrength,
  CandidateAudioEventTarget,
};

export const CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT = 527 as const;
export const CANDIDATE_AUDIO_EVENT_MIN_TARGET_DURATION_MS = 30_000 as const;
export const CANDIDATE_AUDIO_EVENT_POSSIBLE_THRESHOLD = 0.2 as const;
export const CANDIDATE_AUDIO_EVENT_STRONG_THRESHOLD = 0.5 as const;
export const CANDIDATE_AUDIO_EVENT_REPEATED_WINDOW_COUNT = 2 as const;
export const CANDIDATE_AUDIO_EVENT_MAX_DETECTIONS = 2 as const;

/**
 * Exact label indices from the pinned model's config.json. Deliberately omitted:
 * Baby laughter, Battle cry, Children shouting, generic Crowd, Chatter, and
 * every label outside the four product reaction groups. Generic Crowd is a
 * broad ambience/context label, not evidence of approval or cheering.
 */
export const CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST = [
  { labelId: 16, label: "Laughter", kind: "laughter" },
  { labelId: 18, label: "Giggle", kind: "laughter" },
  { labelId: 19, label: "Snicker", kind: "laughter" },
  { labelId: 20, label: "Belly laugh", kind: "laughter" },
  { labelId: 21, label: "Chuckle, chortle", kind: "laughter" },
  { labelId: 8, label: "Shout", kind: "shout" },
  { labelId: 9, label: "Bellow", kind: "shout" },
  { labelId: 10, label: "Whoop", kind: "shout" },
  { labelId: 11, label: "Yell", kind: "shout" },
  { labelId: 14, label: "Screaming", kind: "scream" },
  { labelId: 63, label: "Clapping", kind: "applause-or-cheering" },
  { labelId: 66, label: "Cheering", kind: "applause-or-cheering" },
  { labelId: 67, label: "Applause", kind: "applause-or-cheering" },
] as const satisfies readonly {
  readonly labelId: number;
  readonly label: string;
  readonly kind: CandidateAudioEventKind;
}[];

for (const definition of CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST) {
  Object.freeze(definition);
}
Object.freeze(CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST);

export type CandidateAudioEventAllowlistedAudioSetLabel =
  (typeof CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST)[number]["label"];

export type CandidateAudioEventWindowPhase =
  | "before-peak"
  | "near-peak"
  | "after-peak";

export interface CandidateAudioEventWindow {
  readonly candidateId: string;
  readonly phase: CandidateAudioEventWindowPhase;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

/**
 * A complete evidence vector for one validated 10-second window: pinned AST
 * post-sigmoid scores, or an all-zero vector from the conservative audio gate.
 */
export interface CandidateAudioEventWindowScores {
  readonly window: CandidateAudioEventWindow;
  readonly sigmoidScores: ArrayLike<number>;
}

/**
 * Fixed interpretation metadata for presentation code. It prevents a sound tag
 * from silently becoming a speaker, emotion, or causal claim.
 */
export interface CandidateAudioEventProvisionalInterpretation {
  readonly quality: CandidateAudioEventQuality;
  readonly audioScope: "mixed-program-audio";
  readonly sourceAttribution: "unresolved";
  readonly causalInterpretation: "not-inferred";
}

export const CANDIDATE_AUDIO_EVENT_PROVISIONAL_INTERPRETATION = Object.freeze({
  quality: "provisional-audio-event",
  audioScope: "mixed-program-audio",
  sourceAttribution: "unresolved",
  causalInterpretation: "not-inferred",
} as const satisfies CandidateAudioEventProvisionalInterpretation);

export type CandidateAudioEventAggregationLevel =
  | "no-clear"
  | CandidateAudioEventStrength;

/**
 * Core-only numeric quality. A Worker may compare this object while aggregating
 * or retrying, but only `result` is allowed to cross the App boundary.
 */
export interface CandidateAudioEventAggregationQuality {
  readonly level: CandidateAudioEventAggregationLevel;
  readonly strongDetectionCount: number;
  readonly detectionCount: number;
  readonly topGroupScore: number;
  readonly secondaryGroupScore: number;
  readonly supportingWindowCount: number;
  readonly analyzedWindowCount: number;
}

export interface CandidateAudioEventAggregation {
  readonly result: CandidateAudioEventCandidateResult;
  readonly quality: CandidateAudioEventAggregationQuality;
}

export type CandidateAudioEventInputErrorCode =
  | "TOO_MANY_TARGETS"
  | "INVALID_CANDIDATE_ID"
  | "DUPLICATE_CANDIDATE_ID"
  | "INVALID_TARGET_RANGE"
  | "INVALID_REACTION_PEAK"
  | "INVALID_WINDOW_SET"
  | "INVALID_SCORE_VECTOR";

export class CandidateAudioEventInputError extends Error {
  public readonly code: CandidateAudioEventInputErrorCode;
  public readonly candidateId: string | null;

  public constructor(
    code: CandidateAudioEventInputErrorCode,
    message: string,
    candidateId: string | null = null,
  ) {
    super(message);
    this.name = "CandidateAudioEventInputError";
    this.code = code;
    this.candidateId = candidateId;
  }
}

const MAX_CANDIDATE_ID_LENGTH = 256;
const EVENT_KIND_ORDER = [
  "laughter",
  "shout",
  "scream",
  "applause-or-cheering",
] as const satisfies readonly CandidateAudioEventKind[];

const PHASE_OUTPUT_ORDER: Readonly<Record<CandidateAudioEventWindowPhase, number>> = {
  "before-peak": 0,
  "near-peak": 1,
  "after-peak": 2,
};

const PHASE_EVIDENCE_ORDER: Readonly<
  Record<CandidateAudioEventWindowPhase, number>
> = {
  "near-peak": 0,
  "before-peak": 1,
  "after-peak": 2,
};

/** Runtime array check without widening an already typed readonly array to any[]. */
function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

function assertTarget(target: CandidateAudioEventTarget): void {
  const candidateId = target.candidateId;
  if (
    typeof candidateId !== "string" ||
    candidateId.length === 0 ||
    candidateId.length > MAX_CANDIDATE_ID_LENGTH ||
    candidateId.trim() !== candidateId
  ) {
    throw new CandidateAudioEventInputError(
      "INVALID_CANDIDATE_ID",
      "Audio-event candidate IDs must be non-empty, trimmed, and bounded.",
      typeof candidateId === "string" ? candidateId : null,
    );
  }

  if (
    !Number.isSafeInteger(target.startMs) ||
    !Number.isSafeInteger(target.endMs) ||
    target.startMs < 0 ||
    target.endMs > MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS ||
    target.startMs >= target.endMs ||
    target.endMs - target.startMs < CANDIDATE_AUDIO_EVENT_MIN_TARGET_DURATION_MS ||
    target.endMs - target.startMs > MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS
  ) {
    throw new CandidateAudioEventInputError(
      "INVALID_TARGET_RANGE",
      "Audio-event targets must be safe integer ranges of 30 to 60 seconds within 12 hours.",
      candidateId,
    );
  }

  if (
    !Number.isSafeInteger(target.peakMs) ||
    target.peakMs < target.startMs ||
    target.peakMs > target.endMs
  ) {
    throw new CandidateAudioEventInputError(
      "INVALID_REACTION_PEAK",
      "Audio-event reaction peaks must be safe integer timestamps inside the target.",
      candidateId,
    );
  }
}

function assertTargetSet(targets: readonly CandidateAudioEventTarget[]): void {
  if (!isArrayValue(targets) || targets.length > MAX_CANDIDATE_AUDIO_EVENT_TARGETS) {
    throw new CandidateAudioEventInputError(
      "TOO_MANY_TARGETS",
      "Audio-event analysis accepts at most 12 candidate targets.",
    );
  }
  const candidateIds = new Set<string>();
  for (const target of targets) {
    assertTarget(target);
    if (candidateIds.has(target.candidateId)) {
      throw new CandidateAudioEventInputError(
        "DUPLICATE_CANDIDATE_ID",
        "Audio-event target IDs must be unique within one snapshot.",
        target.candidateId,
      );
    }
    candidateIds.add(target.candidateId);
  }
}

function clampedWindowStart(
  desiredStartMs: number,
  target: CandidateAudioEventTarget,
): number {
  return Math.min(
    target.endMs - CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
    Math.max(target.startMs, desiredStartMs),
  );
}

function createWindow(
  target: CandidateAudioEventTarget,
  phase: CandidateAudioEventWindowPhase,
  desiredStartMs: number,
): CandidateAudioEventWindow {
  const sourceStartMs = clampedWindowStart(desiredStartMs, target);
  return {
    candidateId: target.candidateId,
    phase,
    sourceStartMs,
    sourceEndMs: sourceStartMs + CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
  };
}

function windowKey(window: CandidateAudioEventWindow): string {
  return `${window.phase}:${window.sourceStartMs}:${window.sourceEndMs}`;
}

function rangeKey(window: CandidateAudioEventWindow): string {
  return `${window.sourceStartMs}:${window.sourceEndMs}`;
}

/**
 * Builds up to three bounded 10-second windows for each immutable target.
 * Near-peak wins when clamping would otherwise decode an identical boundary
 * window more than once.
 */
export function buildCandidateAudioEventWindows(
  targets: readonly CandidateAudioEventTarget[],
): readonly CandidateAudioEventWindow[] {
  assertTargetSet(targets);
  const result: CandidateAudioEventWindow[] = [];

  for (const target of targets) {
    const proposed = [
      createWindow(
        target,
        "near-peak",
        target.peakMs - CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS / 2,
      ),
      createWindow(
        target,
        "before-peak",
        target.peakMs - CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS,
      ),
      createWindow(target, "after-peak", target.peakMs),
    ];
    const seenRanges = new Set<string>();
    const targetWindows = proposed.filter((window) => {
      const key = rangeKey(window);
      if (seenRanges.has(key)) {
        return false;
      }
      seenRanges.add(key);
      return true;
    });
    targetWindows.sort(
      (left, right) =>
        PHASE_OUTPUT_ORDER[left.phase] - PHASE_OUTPUT_ORDER[right.phase],
    );
    result.push(...targetWindows.slice(0, MAX_CANDIDATE_AUDIO_EVENT_WINDOWS_PER_TARGET));
  }

  return result;
}

function assertScoreVector(
  scores: ArrayLike<number>,
  candidateId: string,
): void {
  if (
    scores === null ||
    typeof scores !== "object" ||
    !Number.isSafeInteger(scores.length) ||
    scores.length !== CANDIDATE_AUDIO_EVENT_AUDIOSET_LABEL_COUNT
  ) {
    throw new CandidateAudioEventInputError(
      "INVALID_SCORE_VECTOR",
      "Audio-event score vectors must contain exactly 527 sigmoid-or-gated values.",
      candidateId,
    );
  }
  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index];
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    ) {
      throw new CandidateAudioEventInputError(
        "INVALID_SCORE_VECTOR",
        "Audio-event sigmoid-or-gated values must be finite numbers from zero to one.",
        candidateId,
      );
    }
  }
}

function assertAndIndexWindowScores(
  target: CandidateAudioEventTarget,
  input: readonly CandidateAudioEventWindowScores[],
): ReadonlyMap<string, ArrayLike<number>> {
  const expectedWindows = buildCandidateAudioEventWindows([target]);
  if (!isArrayValue(input) || input.length !== expectedWindows.length) {
    throw new CandidateAudioEventInputError(
      "INVALID_WINDOW_SET",
      "Audio-event aggregation requires one score vector for every planned window.",
      target.candidateId,
    );
  }
  const expectedKeys = new Set(expectedWindows.map(windowKey));
  const indexed = new Map<string, ArrayLike<number>>();
  for (const entry of input) {
    const window = entry?.window;
    if (
      window === undefined ||
      window.candidateId !== target.candidateId ||
      !Number.isSafeInteger(window.sourceStartMs) ||
      !Number.isSafeInteger(window.sourceEndMs) ||
      !Object.hasOwn(PHASE_OUTPUT_ORDER, window.phase)
    ) {
      throw new CandidateAudioEventInputError(
        "INVALID_WINDOW_SET",
        "Audio-event score windows must match the requested candidate identity and timestamps.",
        target.candidateId,
      );
    }
    const key = windowKey(window);
    if (!expectedKeys.has(key) || indexed.has(key)) {
      throw new CandidateAudioEventInputError(
        "INVALID_WINDOW_SET",
        "Audio-event score windows must exactly match the unique planned windows.",
        target.candidateId,
      );
    }
    assertScoreVector(entry.sigmoidScores, target.candidateId);
    indexed.set(key, entry.sigmoidScores);
  }
  return indexed;
}

function groupScore(
  scores: ArrayLike<number>,
  kind: CandidateAudioEventKind,
): number {
  let sum = 0;
  for (const definition of CANDIDATE_AUDIO_EVENT_AUDIOSET_ALLOWLIST) {
    if (definition.kind === kind) {
      sum += scores[definition.labelId] ?? 0;
    }
  }
  return Math.min(1, sum);
}

interface WindowGroupScore {
  readonly window: CandidateAudioEventWindow;
  readonly score: number;
}

interface DetectionDraft {
  readonly kind: CandidateAudioEventKind;
  readonly strength: CandidateAudioEventStrength;
  readonly peakScore: number;
  readonly supportingWindowCount: number;
  readonly strongestWindow: CandidateAudioEventWindow;
}

function compareWindowGroupScore(
  left: WindowGroupScore,
  right: WindowGroupScore,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  const phaseDifference =
    PHASE_EVIDENCE_ORDER[left.window.phase] -
    PHASE_EVIDENCE_ORDER[right.window.phase];
  if (phaseDifference !== 0) {
    return phaseDifference;
  }
  return left.window.sourceStartMs - right.window.sourceStartMs;
}

function compareDetectionDraft(left: DetectionDraft, right: DetectionDraft): number {
  if (left.strength !== right.strength) {
    return left.strength === "strong" ? -1 : 1;
  }
  if (left.peakScore !== right.peakScore) {
    return right.peakScore - left.peakScore;
  }
  if (left.supportingWindowCount !== right.supportingWindowCount) {
    return right.supportingWindowCount - left.supportingWindowCount;
  }
  return EVENT_KIND_ORDER.indexOf(left.kind) - EVENT_KIND_ORDER.indexOf(right.kind);
}

function modelDescriptor() {
  return {
    id: CANDIDATE_AUDIO_EVENT_MODEL_ID,
    revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
    dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
    device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  } as const;
}

function baseResult(
  target: CandidateAudioEventTarget,
  analyzedWindowCount: number,
) {
  return {
    mode: "candidate-audio-event",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reactionPeakMs: target.peakMs,
    analyzedWindowCount,
    quality: CANDIDATE_AUDIO_EVENT_PROVISIONAL_INTERPRETATION.quality,
    model: modelDescriptor(),
    sampleRateHz: CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  } as const;
}

function aggregationQuality(
  drafts: readonly DetectionDraft[],
  analyzedWindowCount: number,
  bestAllowlistScore: number,
): CandidateAudioEventAggregationQuality {
  const selected = drafts.slice(0, CANDIDATE_AUDIO_EVENT_MAX_DETECTIONS);
  const level: CandidateAudioEventAggregationLevel =
    selected[0]?.strength ?? "no-clear";
  return {
    level,
    strongDetectionCount: selected.filter(({ strength }) => strength === "strong")
      .length,
    detectionCount: selected.length,
    topGroupScore: selected[0]?.peakScore ?? bestAllowlistScore,
    secondaryGroupScore: selected[1]?.peakScore ?? 0,
    supportingWindowCount: selected.reduce(
      (sum, draft) => sum + draft.supportingWindowCount,
      0,
    ),
    analyzedWindowCount,
  };
}

/**
 * Deterministically aggregates complete sigmoid vectors into at most two fixed
 * reaction detections. Related AudioSet labels are summed within a product group
 * and capped at one; the numeric aggregate stays in core-only `quality`.
 */
export function aggregateCandidateAudioEventScores(
  target: CandidateAudioEventTarget,
  input: readonly CandidateAudioEventWindowScores[],
): CandidateAudioEventAggregation {
  assertTarget(target);
  const expectedWindows = buildCandidateAudioEventWindows([target]);
  const indexed = assertAndIndexWindowScores(target, input);
  const drafts: DetectionDraft[] = [];
  let bestAllowlistScore = 0;

  for (const kind of EVENT_KIND_ORDER) {
    const windowScores = expectedWindows
      .map((window) => ({
        window,
        score: groupScore(indexed.get(windowKey(window))!, kind),
      }))
      .sort(compareWindowGroupScore);
    const peakScore = windowScores[0]?.score ?? 0;
    bestAllowlistScore = Math.max(bestAllowlistScore, peakScore);
    const supportingWindowCount = windowScores.filter(
      ({ score }) => score >= CANDIDATE_AUDIO_EVENT_POSSIBLE_THRESHOLD,
    ).length;
    if (peakScore < CANDIDATE_AUDIO_EVENT_POSSIBLE_THRESHOLD) {
      continue;
    }
    const strength: CandidateAudioEventStrength =
      peakScore >= CANDIDATE_AUDIO_EVENT_STRONG_THRESHOLD ||
      supportingWindowCount >= CANDIDATE_AUDIO_EVENT_REPEATED_WINDOW_COUNT
        ? "strong"
        : "possible";
    drafts.push({
      kind,
      strength,
      peakScore,
      supportingWindowCount,
      strongestWindow: windowScores[0]!.window,
    });
  }

  drafts.sort(compareDetectionDraft);
  const selected = drafts.slice(0, CANDIDATE_AUDIO_EVENT_MAX_DETECTIONS);
  const quality = aggregationQuality(
    selected,
    expectedWindows.length,
    bestAllowlistScore,
  );
  const base = baseResult(target, expectedWindows.length);

  if (selected.length === 0) {
    return {
      result: {
        ...base,
        status: "no-clear-event",
        reasonCode:
          bestAllowlistScore < CANDIDATE_AUDIO_EVENT_POSSIBLE_THRESHOLD / 4
            ? "NO_ALLOWLIST_EVENT"
            : "LOW_EVENT_CONFIDENCE",
        detections: [],
      },
      quality,
    };
  }

  const detections = selected
    .map<CandidateAudioEventDetection>((draft) => ({
      kind: draft.kind,
      strength: draft.strength,
      sourceStartMs: draft.strongestWindow.sourceStartMs,
      sourceEndMs: draft.strongestWindow.sourceEndMs,
    }))
    .sort(
      (left, right) =>
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs ||
        EVENT_KIND_ORDER.indexOf(left.kind) -
          EVENT_KIND_ORDER.indexOf(right.kind),
    );
  const [firstDetection, ...remainingDetections] = detections;
  return {
    result: {
      ...base,
      status: "detected",
      detections: [firstDetection!, ...remainingDetections],
    },
    quality,
  };
}

function aggregationQualityTuple(
  quality: CandidateAudioEventAggregationQuality,
): readonly number[] {
  const levelRank =
    quality.level === "strong" ? 2 : quality.level === "possible" ? 1 : 0;
  return [
    levelRank,
    quality.strongDetectionCount,
    quality.detectionCount,
    quality.topGroupScore,
    quality.secondaryGroupScore,
    quality.supportingWindowCount,
    quality.analyzedWindowCount,
  ];
}

/** Returns -1, 0, or 1 using a monotonic, lexicographic quality order. */
export function compareCandidateAudioEventAggregationQuality(
  left: CandidateAudioEventAggregationQuality,
  right: CandidateAudioEventAggregationQuality,
): -1 | 0 | 1 {
  const leftTuple = aggregationQualityTuple(left);
  const rightTuple = aggregationQualityTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    const difference = leftTuple[index]! - rightTuple[index]!;
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}
