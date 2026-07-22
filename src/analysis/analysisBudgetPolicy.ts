import { createBroadcastContextSamplingPlan } from "./broadcastContextSamplingPlan";
import { estimateCandidatePassBCost } from "./candidatePassBCost";

export const ANALYSIS_BUDGET_POLICY_VERSION = "1.2.0" as const;
export const ANALYSIS_BUDGET_LIMIT_USD = 1;

const VISUAL_CHAPTERING_RESERVE_USD = 0.08;
const CONTEXT_REASONING_RESERVE_USD = 0.08;
const SEMANTIC_LEAD_REFINEMENT_ASR_RESERVE_USD = 0.03;
const PRO_ADJUDICATION_PER_CANDIDATE_USD = 0.04;
const PRO_ADJUDICATION_LIMIT_USD = 0.12;
const RETRY_AND_PRICE_VARIANCE_RESERVE_USD = 0.08;

export interface AnalysisBudgetEnvelope {
  readonly policyVersion: typeof ANALYSIS_BUDGET_POLICY_VERSION;
  readonly limitUsd: typeof ANALYSIS_BUDGET_LIMIT_USD;
  readonly qwenAsrUsd: number;
  readonly candidatePerceptionUsd: number;
  readonly qwenVisualChapteringReserveUsd: number;
  readonly contextReasoningReserveUsd: number;
  readonly semanticLeadRefinementAsrReserveUsd: number;
  readonly proAdjudicationReserveUsd: number;
  readonly retryAndPriceVarianceReserveUsd: number;
  readonly projectedMaximumUsd: number;
  readonly withinLimit: boolean;
}

/**
 * Hard planning envelope for a single analysis. The reserve-based stages are
 * stopped before their allocation is exceeded; they are not promises about a
 * provider invoice. ASR and candidate perception use duration/token estimates.
 */
export function createAnalysisBudgetEnvelope(
  sourceDurationMs: number,
  candidateCount: number,
  ambiguousCandidateCount: number,
  hasCompleteExternalTranscript = false,
): AnalysisBudgetEnvelope {
  const asr = createBroadcastContextSamplingPlan(
    sourceDurationMs,
    [],
    hasCompleteExternalTranscript,
  );
  const candidatePerception = estimateCandidatePassBCost(
    candidateCount,
    60_000,
  );
  const boundedAmbiguousCount = Number.isFinite(ambiguousCandidateCount)
    ? Math.min(3, Math.max(0, Math.round(ambiguousCandidateCount)))
    : 0;
  const proAdjudicationReserveUsd = Math.min(
    PRO_ADJUDICATION_LIMIT_USD,
    boundedAmbiguousCount * PRO_ADJUDICATION_PER_CANDIDATE_USD,
  );
  const projectedMaximumUsd =
    asr.estimatedAsrCostUsd +
    candidatePerception.totalCostUsd +
    VISUAL_CHAPTERING_RESERVE_USD +
    CONTEXT_REASONING_RESERVE_USD +
    SEMANTIC_LEAD_REFINEMENT_ASR_RESERVE_USD +
    proAdjudicationReserveUsd +
    RETRY_AND_PRICE_VARIANCE_RESERVE_USD;

  return {
    policyVersion: ANALYSIS_BUDGET_POLICY_VERSION,
    limitUsd: ANALYSIS_BUDGET_LIMIT_USD,
    qwenAsrUsd: asr.estimatedAsrCostUsd,
    candidatePerceptionUsd: candidatePerception.totalCostUsd,
    qwenVisualChapteringReserveUsd: VISUAL_CHAPTERING_RESERVE_USD,
    contextReasoningReserveUsd: CONTEXT_REASONING_RESERVE_USD,
    semanticLeadRefinementAsrReserveUsd:
      SEMANTIC_LEAD_REFINEMENT_ASR_RESERVE_USD,
    proAdjudicationReserveUsd,
    retryAndPriceVarianceReserveUsd: RETRY_AND_PRICE_VARIANCE_RESERVE_USD,
    projectedMaximumUsd,
    withinLimit: projectedMaximumUsd <= ANALYSIS_BUDGET_LIMIT_USD,
  };
}
