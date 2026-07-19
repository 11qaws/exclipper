/**
 * Pure, candidate-only Pass B contracts.
 *
 * This module deliberately has no media, model, storage, or UI dependencies. It
 * selects immutable fast-pass snapshots and turns timestamped local transcript
 * chunks into a presentation overlay. It never returns a candidate proposal,
 * score/rank update, editable range, or review-state mutation.
 */

export const CANDIDATE_PASS_B_MAX_CANDIDATES = 12;
export const CANDIDATE_PASS_B_MIN_DURATION_MS = 30_000;
export const CANDIDATE_PASS_B_MAX_DURATION_MS = 60_000;
export const CANDIDATE_PASS_B_MAX_SOURCE_DURATION_MS = 12 * 60 * 60 * 1_000;
export const CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH = 120;
export const CANDIDATE_PASS_B_DEFAULT_NEAR_PEAK_RADIUS_MS = 4_000;

const DEFAULT_MIN_CONFIDENCE = 0.45;
const DEFAULT_MAX_NO_SPEECH_PROBABILITY = 0.65;
const MAX_CANDIDATE_ID_LENGTH = 256;

export interface CandidatePassBSourceCandidate {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
}

export interface CandidatePassBSelectionOptions {
  readonly sourceDurationMs: number;
  readonly maxCandidates?: number;
}

/** Immutable decode snapshot. This is input to Pass B, not an AI proposal update. */
export interface CandidatePassBTarget {
  readonly candidateId: string;
  readonly decodeStartMs: number;
  readonly decodeEndMs: number;
  readonly reactionPeakMs: number;
}

export type CandidatePassBInputErrorCode =
  | "INVALID_SOURCE_DURATION"
  | "INVALID_MAX_CANDIDATES"
  | "INVALID_CANDIDATE_ID"
  | "DUPLICATE_CANDIDATE_ID"
  | "INVALID_CANDIDATE_SCORE"
  | "INVALID_CANDIDATE_RANGE"
  | "INVALID_CANDIDATE_PEAK"
  | "INVALID_TRANSCRIPT_OPTIONS";

export class CandidatePassBInputError extends Error {
  public readonly code: CandidatePassBInputErrorCode;
  public readonly candidateId: string | null;

  public constructor(
    code: CandidatePassBInputErrorCode,
    message: string,
    candidateId: string | null = null,
  ) {
    super(message);
    this.name = "CandidatePassBInputError";
    this.code = code;
    this.candidateId = candidateId;
  }
}

export interface CandidatePassBTranscriptChunk {
  /** Milliseconds relative to the beginning of the candidate decode window. */
  readonly relativeStartMs: number;
  /** Milliseconds relative to the beginning of the candidate decode window. */
  readonly relativeEndMs: number;
  readonly text: string;
  /** Normalized model confidence in the inclusive 0-1 range, when available. */
  readonly confidence?: number;
  /** Normalized model no-speech probability in the inclusive 0-1 range. */
  readonly noSpeechProbability?: number;
  /** Explicit decoder/VAD indication that the span contains no speech. */
  readonly isSilence?: boolean;
}

export interface CandidatePassBTranscriptOptions {
  readonly nearPeakRadiusMs?: number;
  readonly minConfidence?: number;
  readonly maxNoSpeechProbability?: number;
  readonly maxCueTextLength?: number;
}

export type CandidatePassBCuePhase = "before-peak" | "near-peak" | "after-peak";

export interface CandidatePassBCue {
  readonly phase: CandidatePassBCuePhase;
  readonly absoluteStartMs: number;
  readonly absoluteEndMs: number;
  readonly text: string;
  readonly confidence: number | null;
}

export type CandidatePassBFallbackReason =
  | "silent"
  | "empty-transcript"
  | "low-quality-transcript";

export type CandidatePassBBasisLabel =
  | "자동 전사 단서 · 재생 확인 필요"
  | "자동 전사 추정 · 빠른 근거 유지"
  | "또렷한 대사 없음 · 빠른 근거 유지";

export interface CandidatePassBOverlay {
  readonly event: string;
  readonly why: string;
  readonly reviewHint: string;
  readonly basisLabel: CandidatePassBBasisLabel;
}

export interface CandidatePassBQualitySummary {
  readonly receivedChunkCount: number;
  readonly mappedChunkCount: number;
  readonly usableChunkCount: number;
  readonly discardedChunkCount: number;
  readonly meanConfidence: number | null;
}

interface CandidatePassBEvidenceBase {
  readonly candidateId: string;
  readonly cues: readonly CandidatePassBCue[];
  readonly overlay: CandidatePassBOverlay;
  readonly quality: CandidatePassBQualitySummary;
}

export type CandidatePassBEvidence =
  | (CandidatePassBEvidenceBase & {
      readonly status: "grounded-transcript";
      readonly fallbackReason: null;
    })
  | (CandidatePassBEvidenceBase & {
      readonly status: "provisional-transcript";
      /** Keeps existing no-clear-speech consumers conservative until they understand provisional evidence. */
      readonly fallbackReason: "low-quality-transcript";
    })
  | (CandidatePassBEvidenceBase & {
      readonly status: "fast-pass-fallback";
      readonly fallbackReason: CandidatePassBFallbackReason;
    });

interface NormalizedTranscriptOptions {
  readonly nearPeakRadiusMs: number;
  readonly minConfidence: number;
  readonly maxNoSpeechProbability: number;
  readonly maxCueTextLength: number;
}

interface MappedTranscriptChunk extends CandidatePassBCue {
  readonly distanceFromPeakMs: number;
  readonly hasIndependentQualitySignal: boolean;
}

interface SelectedPhaseCues {
  readonly cues: readonly CandidatePassBCue[];
  readonly allCuesHaveIndependentQualitySignal: boolean;
}

function assertSourceDuration(sourceDurationMs: number): void {
  if (
    !Number.isFinite(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > CANDIDATE_PASS_B_MAX_SOURCE_DURATION_MS
  ) {
    throw new CandidatePassBInputError(
      "INVALID_SOURCE_DURATION",
      "Pass B source duration must be finite, positive, and at most 12 hours.",
    );
  }
}

function assertMaxCandidates(maxCandidates: number): void {
  if (
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > CANDIDATE_PASS_B_MAX_CANDIDATES
  ) {
    throw new CandidatePassBInputError(
      "INVALID_MAX_CANDIDATES",
      "Pass B can select between 1 and 12 candidates.",
    );
  }
}

function assertCandidate(
  candidate: CandidatePassBSourceCandidate,
  sourceDurationMs: number,
): void {
  const candidateId = candidate.id;
  if (
    candidateId.length === 0 ||
    candidateId.length > MAX_CANDIDATE_ID_LENGTH ||
    candidateId.trim() !== candidateId
  ) {
    throw new CandidatePassBInputError(
      "INVALID_CANDIDATE_ID",
      "Pass B candidate IDs must be non-empty, trimmed, and bounded in length.",
      candidateId,
    );
  }
  if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
    throw new CandidatePassBInputError(
      "INVALID_CANDIDATE_SCORE",
      "Pass B candidate scores must be finite values between 0 and 1.",
      candidateId,
    );
  }
  if (
    !Number.isSafeInteger(candidate.startMs) ||
    !Number.isSafeInteger(candidate.endMs) ||
    candidate.startMs < 0 ||
    candidate.endMs > sourceDurationMs ||
    candidate.startMs >= candidate.endMs ||
    candidate.endMs - candidate.startMs < CANDIDATE_PASS_B_MIN_DURATION_MS ||
    candidate.endMs - candidate.startMs > CANDIDATE_PASS_B_MAX_DURATION_MS
  ) {
    throw new CandidatePassBInputError(
      "INVALID_CANDIDATE_RANGE",
      "Pass B candidates must stay inside the source and be between 30 and 60 seconds.",
      candidateId,
    );
  }
  if (
    !Number.isSafeInteger(candidate.peakMs) ||
    candidate.peakMs < candidate.startMs ||
    candidate.peakMs > candidate.endMs
  ) {
    throw new CandidatePassBInputError(
      "INVALID_CANDIDATE_PEAK",
      "Pass B candidate peaks must be integer timestamps inside their decode window.",
      candidateId,
    );
  }
}

function compareCandidateSelection(
  left: CandidatePassBSourceCandidate,
  right: CandidatePassBSourceCandidate,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.startMs !== right.startMs) {
    return left.startMs - right.startMs;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Validates the complete fast-pass set, then returns at most 12 immutable decode
 * snapshots in score-descending, time-ascending, ID-ascending order.
 */
export function selectCandidatePassBTargets(
  candidates: readonly CandidatePassBSourceCandidate[],
  options: CandidatePassBSelectionOptions,
): readonly CandidatePassBTarget[] {
  assertSourceDuration(options.sourceDurationMs);
  const maxCandidates = options.maxCandidates ?? CANDIDATE_PASS_B_MAX_CANDIDATES;
  assertMaxCandidates(maxCandidates);

  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    assertCandidate(candidate, options.sourceDurationMs);
    if (candidateIds.has(candidate.id)) {
      throw new CandidatePassBInputError(
        "DUPLICATE_CANDIDATE_ID",
        "Pass B candidate IDs must be unique within one selection snapshot.",
        candidate.id,
      );
    }
    candidateIds.add(candidate.id);
  }

  return [...candidates]
    .sort(compareCandidateSelection)
    .slice(0, maxCandidates)
    .map((candidate) => ({
      candidateId: candidate.id,
      decodeStartMs: candidate.startMs,
      decodeEndMs: candidate.endMs,
      reactionPeakMs: candidate.peakMs,
    }));
}

function clampedInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function validProbability(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1);
}

function normalizeTranscriptOptions(
  options: CandidatePassBTranscriptOptions,
): NormalizedTranscriptOptions {
  const nearPeakRadiusMs =
    options.nearPeakRadiusMs ?? CANDIDATE_PASS_B_DEFAULT_NEAR_PEAK_RADIUS_MS;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxNoSpeechProbability =
    options.maxNoSpeechProbability ?? DEFAULT_MAX_NO_SPEECH_PROBABILITY;
  const maxCueTextLength =
    options.maxCueTextLength ?? CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH;

  if (
    !Number.isSafeInteger(nearPeakRadiusMs) ||
    nearPeakRadiusMs < 0 ||
    nearPeakRadiusMs > CANDIDATE_PASS_B_MIN_DURATION_MS / 2 ||
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 ||
    minConfidence > 1 ||
    !Number.isFinite(maxNoSpeechProbability) ||
    maxNoSpeechProbability < 0 ||
    maxNoSpeechProbability > 1 ||
    !Number.isSafeInteger(maxCueTextLength) ||
    maxCueTextLength < 1 ||
    maxCueTextLength > CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH
  ) {
    throw new CandidatePassBInputError(
      "INVALID_TRANSCRIPT_OPTIONS",
      "Pass B transcript thresholds and text limits are outside their supported ranges.",
    );
  }

  return {
    nearPeakRadiusMs,
    minConfidence,
    maxNoSpeechProbability,
    maxCueTextLength,
  };
}

function assertTarget(target: CandidatePassBTarget): void {
  assertSourceDuration(target.decodeEndMs);
  assertCandidate(
    {
      id: target.candidateId,
      startMs: target.decodeStartMs,
      endMs: target.decodeEndMs,
      peakMs: target.reactionPeakMs,
      score: 0,
    },
    target.decodeEndMs,
  );
}

function truncateCodePoints(value: string, maxLength: number): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= maxLength) {
    return value;
  }
  if (maxLength === 1) {
    return "…";
  }
  return `${codePoints.slice(0, maxLength - 1).join("")}…`;
}

/** Removes model control tokens and unsafe spacing while preserving spoken text. */
export function normalizeCandidatePassBText(
  value: string,
  maxLength = CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH,
): string {
  const boundedMaxLength = Number.isSafeInteger(maxLength)
    ? Math.min(CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH, Math.max(1, maxLength))
    : CANDIDATE_PASS_B_MAX_CUE_TEXT_LENGTH;
  const normalized = value
    .normalize("NFKC")
    .replace(/<\|[^|<>]{0,64}\|>/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateCodePoints(normalized, boundedMaxLength);
}

function isNonSpeechOnly(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) {
    return true;
  }
  return /^(?:[[(（]\s*)?(?:무음|음악|웃음|박수|비명|잡음|silence|music|laughter|applause|noise|blank[ _]?audio)(?:\s*[\])）])?[.!…~-]*$/iu.test(
    text,
  );
}

function cuePhase(
  absoluteStartMs: number,
  absoluteEndMs: number,
  peakMs: number,
  nearPeakRadiusMs: number,
): CandidatePassBCuePhase {
  if (absoluteEndMs <= peakMs - nearPeakRadiusMs) {
    return "before-peak";
  }
  if (absoluteStartMs >= peakMs + nearPeakRadiusMs) {
    return "after-peak";
  }
  return "near-peak";
}

function distanceFromPeak(
  phase: CandidatePassBCuePhase,
  absoluteStartMs: number,
  absoluteEndMs: number,
  peakMs: number,
): number {
  if (phase === "before-peak") {
    return Math.max(0, peakMs - absoluteEndMs);
  }
  if (phase === "after-peak") {
    return Math.max(0, absoluteStartMs - peakMs);
  }
  return Math.abs((absoluteStartMs + absoluteEndMs) / 2 - peakMs);
}

function compareMappedChunks(
  left: MappedTranscriptChunk,
  right: MappedTranscriptChunk,
): number {
  if (left.distanceFromPeakMs !== right.distanceFromPeakMs) {
    return left.distanceFromPeakMs - right.distanceFromPeakMs;
  }
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }
  if (left.absoluteStartMs !== right.absoluteStartMs) {
    return left.absoluteStartMs - right.absoluteStartMs;
  }
  if (left.absoluteEndMs !== right.absoluteEndMs) {
    return left.absoluteEndMs - right.absoluteEndMs;
  }
  return left.text < right.text ? -1 : left.text > right.text ? 1 : 0;
}

function selectPhaseCues(chunks: readonly MappedTranscriptChunk[]): SelectedPhaseCues {
  const phases: readonly CandidatePassBCuePhase[] = [
    "before-peak",
    "near-peak",
    "after-peak",
  ];
  const selected: CandidatePassBCue[] = [];
  let allCuesHaveIndependentQualitySignal = true;
  for (const phase of phases) {
    const best = chunks.filter((chunk) => chunk.phase === phase).sort(compareMappedChunks)[0];
    if (best !== undefined) {
      selected.push({
        phase: best.phase,
        absoluteStartMs: best.absoluteStartMs,
        absoluteEndMs: best.absoluteEndMs,
        text: best.text,
        confidence: best.confidence,
      });
      allCuesHaveIndependentQualitySignal &&= best.hasIndependentQualitySignal;
    }
  }
  return {
    cues: selected,
    allCuesHaveIndependentQualitySignal,
  };
}

function phaseLabel(phase: CandidatePassBCuePhase): string {
  switch (phase) {
    case "before-peak":
      return "반응 전에는";
    case "near-peak":
      return "반응 시점 부근에는";
    case "after-peak":
      return "반응 뒤에는";
  }
}

function quoteCue(text: string): string {
  return `“${text.replace(/[“”]/gu, '"')}”`;
}

function groundedOverlay(
  cues: readonly CandidatePassBCue[],
  meanConfidence: number | null,
): CandidatePassBOverlay {
  const event = `${cues
    .map((cue) => `${phaseLabel(cue.phase)} 자동 전사에서 ${quoteCue(cue.text)}로 인식됐어요.`)
    .join(" ")} 품질 신호를 통과했어도 자동 전사는 틀릴 수 있고, 이 시간 관계만으로 화면 사건의 종류나 발화와 반응 사이의 원인을 확정하지 않아요.`;
  const hasBefore = cues.some((cue) => cue.phase === "before-peak");
  const hasNear = cues.some((cue) => cue.phase === "near-peak");
  const hasAfter = cues.some((cue) => cue.phase === "after-peak");
  const positionSummary =
    hasBefore && (hasNear || hasAfter)
      ? "반응 전후"
      : hasNear
        ? "반응 시점 부근"
        : hasBefore
          ? "반응 전"
          : "반응 뒤";
  const confidenceNotice =
    meanConfidence === null
      ? "대사 여부를 보조하는 신호는 있었지만 모델 신뢰 점수는 제공되지 않았어요."
      : meanConfidence < 0.65
        ? "통과한 전사도 신뢰도가 높지 않을 수 있어요."
        : "자동 전사는 고유명사나 방송 은어를 틀릴 수 있어요.";
  return {
    event,
    why: `${positionSummary}에 품질 신호와 시간 위치를 통과한 자동 전사 단서가 있어, 빠른 분석이 잡은 반응의 맥락을 재생으로 확인하기 쉬운 후보예요. 이 전사가 정확하거나 사건의 원인이라는 뜻은 아니에요.`,
    reviewHint: `${confidenceNotice} 따옴표 속 대사와 실제 화면 사건·스트리머 반응의 관계를 재생해 확인해 주세요.`,
    basisLabel: "자동 전사 단서 · 재생 확인 필요",
  };
}

function provisionalOverlay(cues: readonly CandidatePassBCue[]): CandidatePassBOverlay {
  const cueSummary = cues
    .map((cue) => `${phaseLabel(cue.phase)} 자동 전사에서 ${quoteCue(cue.text)}로 추정됐어요.`)
    .join(" ");
  return {
    event: `${cueSummary} 이 결과에는 독립적인 대사 품질 신호가 없어 사건 설명에는 반영하지 않았어요.`,
    why: "자동 전사 추정은 후보를 재생할 위치만 돕고, 기존 빠른 분석의 사건·원인 설명을 바꾸지 않아요.",
    reviewHint:
      "품질 신호가 없는 자동 전사 추정은 배경음이나 효과음을 말로 잘못 들었을 수 있어요. 따옴표 속 문장을 사실로 쓰기 전에 해당 위치를 재생해 확인해 주세요.",
    basisLabel: "자동 전사 추정 · 빠른 근거 유지",
  };
}

function fallbackOverlay(reason: CandidatePassBFallbackReason): CandidatePassBOverlay {
  const event =
    reason === "silent"
      ? "말소리가 확인되지 않아 사건 내용을 전사로 보강하지 않았어요."
      : reason === "low-quality-transcript"
        ? "전사 품질이 낮아 확인되지 않은 사건을 설명에 넣지 않았어요."
        : "전사에서 읽을 수 있는 발화 단서를 얻지 못해 사건 내용을 보강하지 않았어요.";
  const reviewHint =
    reason === "silent"
      ? "비언어 반응일 수 있으니 기존 오디오·채팅 근거와 실제 장면을 재생해 확인해 주세요."
      : reason === "low-quality-transcript"
        ? "부정확한 대사를 사실처럼 쓰지 않았어요. 기존 후보 구간을 재생해 직접 확인해 주세요."
        : "기존 빠른 분석 근거와 후보 구간을 재생해 실제 사건과 반응을 확인해 주세요.";
  return {
    event,
    why: "확인되지 않은 내용을 만들지 않고 기존 빠른 분석 후보와 신호 설명을 그대로 유지해요.",
    reviewHint,
    basisLabel: "또렷한 대사 없음 · 빠른 근거 유지",
  };
}

function meanKnownConfidence(chunks: readonly MappedTranscriptChunk[]): number | null {
  const known = chunks
    .map((chunk) => chunk.confidence)
    .filter((confidence): confidence is number => confidence !== null);
  if (known.length === 0) {
    return null;
  }
  return Math.round((known.reduce((sum, confidence) => sum + confidence, 0) / known.length) * 1_000) / 1_000;
}

/**
 * Maps local transcript timestamps into source time and creates a candidate-ID
 * overlay. Timestamped text without an independent quality signal remains a
 * provisional seek cue, while unusable input falls back. Neither path touches
 * the fast-pass candidate.
 */
export function buildCandidatePassBEvidence(
  target: CandidatePassBTarget,
  transcriptChunks: readonly CandidatePassBTranscriptChunk[],
  options: CandidatePassBTranscriptOptions = {},
): CandidatePassBEvidence {
  assertTarget(target);
  const normalizedOptions = normalizeTranscriptOptions(options);
  const candidateDurationMs = target.decodeEndMs - target.decodeStartMs;
  const usableChunks: MappedTranscriptChunk[] = [];
  let mappedChunkCount = 0;
  let silentChunkCount = 0;
  let lowQualityChunkCount = 0;

  for (const chunk of transcriptChunks) {
    const normalizedText = normalizeCandidatePassBText(
      chunk.text,
      normalizedOptions.maxCueTextLength,
    );
    const validTimestamps =
      Number.isFinite(chunk.relativeStartMs) &&
      Number.isFinite(chunk.relativeEndMs) &&
      chunk.relativeStartMs < chunk.relativeEndMs;
    const hasValidQuality =
      validProbability(chunk.confidence) && validProbability(chunk.noSpeechProbability);
    if (!validTimestamps || !hasValidQuality) {
      if (normalizedText.length > 0) {
        lowQualityChunkCount += 1;
      }
      continue;
    }

    const relativeStartMs = clampedInteger(
      chunk.relativeStartMs,
      0,
      candidateDurationMs,
    );
    const relativeEndMs = clampedInteger(chunk.relativeEndMs, 0, candidateDurationMs);
    if (relativeStartMs >= relativeEndMs) {
      if (normalizedText.length > 0) {
        lowQualityChunkCount += 1;
      }
      continue;
    }
    mappedChunkCount += 1;

    const noSpeech =
      chunk.isSilence === true ||
      (chunk.noSpeechProbability !== undefined &&
        chunk.noSpeechProbability >= normalizedOptions.maxNoSpeechProbability) ||
      isNonSpeechOnly(normalizedText);
    if (noSpeech) {
      silentChunkCount += 1;
      continue;
    }
    const hasIndependentQualitySignal =
      chunk.confidence !== undefined &&
      (chunk.noSpeechProbability !== undefined || chunk.isSilence === false);
    if (
      normalizedText.length === 0 ||
      (chunk.confidence !== undefined && chunk.confidence < normalizedOptions.minConfidence)
    ) {
      if (normalizedText.length > 0) {
        lowQualityChunkCount += 1;
      }
      continue;
    }

    const absoluteStartMs = target.decodeStartMs + relativeStartMs;
    const absoluteEndMs = target.decodeStartMs + relativeEndMs;
    const phase = cuePhase(
      absoluteStartMs,
      absoluteEndMs,
      target.reactionPeakMs,
      normalizedOptions.nearPeakRadiusMs,
    );
    usableChunks.push({
      phase,
      absoluteStartMs,
      absoluteEndMs,
      text: normalizedText,
      confidence: chunk.confidence ?? null,
      hasIndependentQualitySignal,
      distanceFromPeakMs: distanceFromPeak(
        phase,
        absoluteStartMs,
        absoluteEndMs,
        target.reactionPeakMs,
      ),
    });
  }

  const cueSelection = selectPhaseCues(usableChunks);
  const { cues } = cueSelection;
  const meanConfidence = meanKnownConfidence(usableChunks);
  const quality: CandidatePassBQualitySummary = {
    receivedChunkCount: transcriptChunks.length,
    mappedChunkCount,
    usableChunkCount: usableChunks.length,
    discardedChunkCount: transcriptChunks.length - usableChunks.length,
    meanConfidence,
  };

  if (cues.length > 0) {
    if (!cueSelection.allCuesHaveIndependentQualitySignal) {
      return {
        candidateId: target.candidateId,
        status: "provisional-transcript",
        fallbackReason: "low-quality-transcript",
        cues,
        overlay: provisionalOverlay(cues),
        quality,
      };
    }
    return {
      candidateId: target.candidateId,
      status: "grounded-transcript",
      fallbackReason: null,
      cues,
      overlay: groundedOverlay(cues, meanConfidence),
      quality,
    };
  }

  const fallbackReason: CandidatePassBFallbackReason =
    lowQualityChunkCount > 0
      ? "low-quality-transcript"
      : silentChunkCount > 0
        ? "silent"
        : "empty-transcript";
  return {
    candidateId: target.candidateId,
    status: "fast-pass-fallback",
    fallbackReason,
    cues: [],
    overlay: fallbackOverlay(fallbackReason),
    quality,
  };
}
