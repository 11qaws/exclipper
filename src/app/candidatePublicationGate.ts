import type { CandidatePassBRunState } from "../domain/candidatePassBRun";

export type SemanticLeadRefinementStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface CandidatePublicationGateInput {
  readonly candidateDetailOutstandingCount: number;
  /** Exact current plan receipt and its plan-only snapshot survived readback. */
  readonly candidatePlanDurable: boolean;
  readonly candidatePassBStatus: CandidatePassBRunState["status"] | null;
  readonly candidatePassBBusy: boolean;
  readonly semanticLeadRefinementStatus: SemanticLeadRefinementStatus;
  readonly refinementEvidenceRequired: boolean;
  readonly refinementEvidenceProjectionFingerprint: string | null;
  readonly refinementEvidencePublicationEligible: boolean;
  readonly wholeContextComplete: boolean;
  readonly wholeContextFailed: boolean;
}

export interface CandidatePublicationGate {
  readonly detailedReviewActive: boolean;
  readonly detailedReviewFailed: boolean;
  readonly candidateDetailSettled: boolean;
  readonly candidatePlanDurable: boolean;
  readonly refinementEvidenceReady: boolean;
  readonly finalSelectionReady: boolean;
}

export interface CandidateStageCommitGate {
  readonly broadcastContext: boolean;
  readonly deepPass: boolean;
  readonly publication: boolean;
  readonly completion: boolean;
}

export function selectCandidateDetailActionIds(input: {
  readonly candidateIds: readonly string[];
  readonly outstandingIds: readonly string[];
  readonly retryableIds: readonly string[];
  readonly runStatus: CandidatePassBRunState["status"] | null;
}): readonly string[] {
  const requestedIds = new Set([
    ...input.outstandingIds,
    ...input.retryableIds,
  ]);
  if (requestedIds.size > 0) {
    return input.candidateIds.filter((candidateId) =>
      requestedIds.has(candidateId),
    );
  }
  if (input.runStatus === "failed" || input.runStatus === "cancelled") {
    /*
     * All paid artifacts survived but the final envelope did not. Retrying the
     * entire cohort would pay for identical work; publication reconciles from
     * the durable receipts instead.
     */
    return [];
  }
  return input.candidateIds;
}

/**
 * Durable candidate artifacts are the source of truth. A failed or cancelled
 * run still blocks publication while artifacts are missing, but a late
 * envelope or cleanup failure must not discard already verified paid work.
 */
export function deriveCandidatePublicationGate(
  input: CandidatePublicationGateInput,
): CandidatePublicationGate {
  if (
    !Number.isSafeInteger(input.candidateDetailOutstandingCount) ||
    input.candidateDetailOutstandingCount < 0
  ) {
    throw new RangeError(
      "Outstanding candidate detail count must be a non-negative safe integer.",
    );
  }

  const detailedReviewActive =
    input.semanticLeadRefinementStatus === "running" || input.candidatePassBBusy;
  const detailedReviewFailed =
    input.semanticLeadRefinementStatus === "failed" ||
    input.candidatePassBStatus === "failed" ||
    input.candidatePassBStatus === "cancelled";
  /*
   * A run envelope is not candidate evidence. `completedWithGaps` explicitly
   * means at least one planned detail cell is unresolved, and even a nominal
   * `completed` envelope cannot override an exact durable outstanding count.
   */
  const candidateDetailSettled =
    input.candidateDetailOutstandingCount === 0 &&
    input.candidatePlanDurable === true;
  const detailFailureStillHasMissingArtifacts =
    detailedReviewFailed && input.candidateDetailOutstandingCount > 0;
  const refinementEvidenceContractValid =
    typeof input.refinementEvidenceRequired === "boolean" &&
    typeof input.refinementEvidencePublicationEligible === "boolean" &&
    (input.refinementEvidenceProjectionFingerprint === null ||
      (typeof input.refinementEvidenceProjectionFingerprint === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(
          input.refinementEvidenceProjectionFingerprint,
        )));
  const refinementEvidenceReady =
    refinementEvidenceContractValid &&
    (!input.refinementEvidenceRequired ||
      (input.refinementEvidenceProjectionFingerprint !== null &&
        input.refinementEvidencePublicationEligible));
  const finalSelectionReady =
    !detailedReviewActive &&
    !detailFailureStillHasMissingArtifacts &&
    candidateDetailSettled &&
    refinementEvidenceReady &&
    input.wholeContextComplete &&
    !input.wholeContextFailed &&
    input.semanticLeadRefinementStatus === "completed";

  return {
    detailedReviewActive,
    detailedReviewFailed,
    candidateDetailSettled,
    candidatePlanDurable: input.candidatePlanDurable === true,
    refinementEvidenceReady,
    finalSelectionReady,
  };
}

/**
 * UI may reveal a recovery panel after a failed stage, but a recovery panel is
 * not a durable stage result. Only complete, gap-free artifacts may advance
 * the job's resume cursor.
 */
export function deriveCandidateStageCommitGate(input: {
  readonly wholeContextComplete: boolean;
  readonly finalSelectionReady: boolean;
  readonly hasPipelineGap: boolean;
}): CandidateStageCommitGate {
  const broadcastContext = input.wholeContextComplete;
  const deepPass =
    broadcastContext &&
    input.finalSelectionReady &&
    !input.hasPipelineGap;
  /*
   * Publication is an analysis-artifact transition. Timeline reveal progress
   * is presentation state and may be throttled while the tab is in the
   * background, so it must never participate in the durable job cursor.
   */
  const publication = deepPass;
  return {
    broadcastContext,
    deepPass,
    publication,
    completion: publication,
  };
}
