/**
 * Conservative client-side estimate for the current Gemini Pass B payload.
 *
 * The app sends each candidate's audio and up to four representative frames,
 * not the entire source video. This is an estimate for planning only; retries,
 * provider-side thinking tokens, and changes to media resolution can increase
 * the final bill.
 */
export const GEMINI_PASS_B_AUDIO_TOKENS_PER_SECOND = 32;
export const GEMINI_PASS_B_IMAGE_TOKENS_PER_FRAME = 1_120;
export const GEMINI_PASS_B_PROMPT_TOKENS_PER_CANDIDATE = 900;
export const GEMINI_PASS_B_OUTPUT_TOKENS_PER_CANDIDATE = 700;
export const GEMINI_PASS_B_INPUT_PRICE_PER_MILLION_UNDER_200K_USD = 2;
export const GEMINI_PASS_B_OUTPUT_PRICE_PER_MILLION_UNDER_200K_USD = 12;
export const GEMINI_PASS_B_INPUT_PRICE_PER_MILLION_OVER_200K_USD = 4;
export const GEMINI_PASS_B_OUTPUT_PRICE_PER_MILLION_OVER_200K_USD = 18;

export interface CandidatePassBCostEstimate {
  readonly candidateCount: number;
  readonly audioDurationMs: number;
  readonly frameCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputPricePerMillionUsd: number;
  readonly outputPricePerMillionUsd: number;
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly totalCostUsd: number;
  readonly usesOver200kTier: boolean;
}

export function estimateCandidatePassBCost(
  candidateCount: number,
  candidateDurationMs: number,
  frameCount = 4,
): CandidatePassBCostEstimate {
  const normalizedCandidateCount = clampInteger(candidateCount, 0, 12);
  const normalizedDurationMs = Math.max(0, Math.round(candidateDurationMs));
  const normalizedFrameCount = clampInteger(frameCount, 0, 4);
  const audioTokens =
    (normalizedDurationMs / 1_000) * GEMINI_PASS_B_AUDIO_TOKENS_PER_SECOND;
  const inputTokens = Math.round(
    normalizedCandidateCount *
      (audioTokens +
        normalizedFrameCount * GEMINI_PASS_B_IMAGE_TOKENS_PER_FRAME +
        GEMINI_PASS_B_PROMPT_TOKENS_PER_CANDIDATE),
  );
  const outputTokens =
    normalizedCandidateCount * GEMINI_PASS_B_OUTPUT_TOKENS_PER_CANDIDATE;
  const usesOver200kTier = inputTokens > 200_000;
  const inputPricePerMillionUsd = usesOver200kTier
    ? GEMINI_PASS_B_INPUT_PRICE_PER_MILLION_OVER_200K_USD
    : GEMINI_PASS_B_INPUT_PRICE_PER_MILLION_UNDER_200K_USD;
  const outputPricePerMillionUsd = usesOver200kTier
    ? GEMINI_PASS_B_OUTPUT_PRICE_PER_MILLION_OVER_200K_USD
    : GEMINI_PASS_B_OUTPUT_PRICE_PER_MILLION_UNDER_200K_USD;
  const inputCostUsd = (inputTokens / 1_000_000) * inputPricePerMillionUsd;
  const outputCostUsd = (outputTokens / 1_000_000) * outputPricePerMillionUsd;
  return {
    candidateCount: normalizedCandidateCount,
    audioDurationMs: normalizedDurationMs,
    frameCount: normalizedFrameCount,
    inputTokens,
    outputTokens,
    inputPricePerMillionUsd,
    outputPricePerMillionUsd,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    usesOver200kTier,
  };
}

export function formatEstimatedUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return "<$0.01";
  }
  return `$${value.toFixed(2)}`;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
