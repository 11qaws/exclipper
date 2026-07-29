import type { AnalysisStage } from "../domain/analysisRun";
import type {
  AnalysisPipelineSuccessGap,
  AnalysisPipelineSuccessGapCode,
} from "./analysisPipelineSuccess";

export type AnalysisPipelineRecoveryKind =
  | "transcript"
  | "context"
  | "refinement"
  | "candidate-plan"
  | "candidate"
  | "rebuild-downstream";

export type AnalysisPipelineRecoveryTerminalReason =
  | "invalid-prior-attempt-count"
  | "candidate-ids-required";

interface AnalysisPipelineRecoveryPlanBase {
  readonly failedStage: AnalysisStage;
  readonly priorAttemptCount: number;
  readonly gapCodes: readonly AnalysisPipelineSuccessGapCode[];
  /**
   * All valid candidate IDs reported by the selected certification snapshot.
   * Callers use these as direct targets only when `kind === "candidate"`.
   */
  readonly candidateIds: readonly string[];
}

export type AnalysisPipelineRecoveryPlan =
  | (AnalysisPipelineRecoveryPlanBase & {
      readonly kind: AnalysisPipelineRecoveryKind;
      readonly repairGeneration: number;
    })
  | (AnalysisPipelineRecoveryPlanBase & {
      readonly kind: "terminal";
      readonly repairGeneration: null;
      readonly reason: AnalysisPipelineRecoveryTerminalReason;
    });

export interface PlanAnalysisPipelineRecoveryInput {
  readonly failedStage: AnalysisStage;
  readonly gaps: readonly AnalysisPipelineSuccessGap[];
  /**
   * Number of repair generations already attempted for the same durable token.
   * The caller resets this count only when the durable token changes.
   */
  readonly priorAttemptCount: number;
}

/**
 * Current-schema deterministic repair ownership for every certification gap.
 *
 * `satisfies Record<...>` deliberately makes a newly-added gap code a compile
 * error until its recovery owner is chosen.
 */
export const ANALYSIS_PIPELINE_GAP_RECOVERY_KIND = {
  "current-schema-required": "rebuild-downstream",
  "fast-result-invalid": "rebuild-downstream",
  "run-fence-mismatch": "rebuild-downstream",
  "source-fence-mismatch": "rebuild-downstream",
  "transcript-unsettled": "transcript",
  "participant-grounding-stale": "context",
  "context-input-stale": "context",
  "context-ledger-incomplete": "context",
  "context-result-invalid": "context",
  "refinement-evidence-incomplete": "refinement",
  "refinement-receipt-stale": "refinement",
  "candidate-plan-invalid": "candidate-plan",
  "candidate-detail-not-durable": "candidate",
  "candidate-verification-incomplete": "candidate",
} as const satisfies Readonly<
  Record<AnalysisPipelineSuccessGapCode, AnalysisPipelineRecoveryKind>
>;

const RECOVERY_KIND_ORDER: Readonly<
  Record<AnalysisPipelineRecoveryKind, number>
> = {
  "rebuild-downstream": 0,
  transcript: 1,
  context: 2,
  refinement: 3,
  "candidate-plan": 4,
  candidate: 5,
};

const EMPTY_GAP_FALLBACK_KIND: Readonly<
  Record<AnalysisStage, AnalysisPipelineRecoveryKind>
> = {
  preflight: "rebuild-downstream",
  fastPass: "rebuild-downstream",
  seedClustering: "rebuild-downstream",
  commitFastResult: "rebuild-downstream",
  broadcastContext: "context",
  deepPass: "refinement",
  publication: "candidate",
};

function uniqueGapCodes(
  gaps: readonly AnalysisPipelineSuccessGap[],
): readonly AnalysisPipelineSuccessGapCode[] {
  return Object.freeze([...new Set(gaps.map(({ code }) => code))]);
}

function uniqueCandidateIds(
  gaps: readonly AnalysisPipelineSuccessGap[],
): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const gap of gaps) {
    for (const candidateId of gap.candidateIds ?? []) {
      if (seen.has(candidateId)) continue;
      seen.add(candidateId);
      ids.push(candidateId);
    }
  }
  return Object.freeze(ids);
}

function selectedRecoveryKind(
  failedStage: AnalysisStage,
  gaps: readonly AnalysisPipelineSuccessGap[],
): AnalysisPipelineRecoveryKind {
  if (gaps.length === 0) {
    return EMPTY_GAP_FALLBACK_KIND[failedStage];
  }
  return gaps
    .map(({ code }) => ANALYSIS_PIPELINE_GAP_RECOVERY_KIND[code])
    .sort((left, right) => RECOVERY_KIND_ORDER[left] - RECOVERY_KIND_ORDER[right])[0]!;
}

function candidateGapHasReportedId(
  gap: AnalysisPipelineSuccessGap,
): boolean {
  if (ANALYSIS_PIPELINE_GAP_RECOVERY_KIND[gap.code] !== "candidate") {
    return true;
  }
  return (
    gap.candidateIds !== undefined &&
    gap.candidateIds.length > 0
  );
}

/**
 * Chooses the next repair generation for a stable certification snapshot.
 *
 * Mixed gaps always start at the earliest recovery boundary. Later gaps are
 * reconsidered by certification after that boundary produces a new durable
 * token, so the planner never launches overlapping repair stages. Individual
 * stage runners bound work per invocation and persist every settlement; this
 * planner deliberately has no lifetime retry cap because a transient provider
 * failure must not turn an otherwise recoverable analysis into a terminal job.
 */
export function planAnalysisPipelineRecovery(
  input: PlanAnalysisPipelineRecoveryInput,
): AnalysisPipelineRecoveryPlan {
  const gapCodes = uniqueGapCodes(input.gaps);
  const candidateIds = uniqueCandidateIds(input.gaps);
  const base: AnalysisPipelineRecoveryPlanBase = Object.freeze({
    failedStage: input.failedStage,
    priorAttemptCount: input.priorAttemptCount,
    gapCodes,
    candidateIds,
  });

  if (
    !Number.isSafeInteger(input.priorAttemptCount) ||
    input.priorAttemptCount < 0 ||
    input.priorAttemptCount >= Number.MAX_SAFE_INTEGER
  ) {
    return Object.freeze({
      ...base,
      kind: "terminal",
      repairGeneration: null,
      reason: "invalid-prior-attempt-count",
    });
  }
  const kind = selectedRecoveryKind(input.failedStage, input.gaps);
  if (
    kind === "candidate" &&
    input.gaps.some((gap) => !candidateGapHasReportedId(gap))
  ) {
    return Object.freeze({
      ...base,
      kind: "terminal",
      repairGeneration: null,
      reason: "candidate-ids-required",
    });
  }

  return Object.freeze({
    ...base,
    kind,
    repairGeneration: input.priorAttemptCount + 1,
  });
}
