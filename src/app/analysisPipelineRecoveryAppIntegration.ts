import type {
  AnalysisPipelineRecoveryPlan,
} from "./analysisPipelineRecoveryPlanner";

export interface AnalysisPipelineRecoveryAppHandlers {
  readonly rebuildDownstream: () => void;
  readonly retryWholeContext: (boundary: "transcript" | "context") => void;
  readonly restartRefinement: () => void;
  readonly resetCandidatePlanArtifacts: () => void;
  readonly persistCurrentCandidatePlan: () => Promise<unknown>;
  readonly repairCandidateDetails: (
    candidateIds: readonly string[],
  ) => Promise<void>;
}

/**
 * Executes the App-owned boundary selected by the durable recovery planner.
 *
 * Candidate-plan recovery intentionally has its own boundary. It discards only
 * Candidate Pass B plan/detail state, then lets the existing plan persistence
 * path CAS a current plan-only snapshot over the stale candidate snapshot.
 * Transcript, participant grounding, whole-context and refinement checkpoints
 * are not inputs to this handler and therefore cannot be reset by it.
 */
export function executeAnalysisPipelineRecoveryInApp(
  plan: AnalysisPipelineRecoveryPlan,
  handlers: AnalysisPipelineRecoveryAppHandlers,
): Promise<void> | null {
  switch (plan.kind) {
    case "terminal":
      return null;
    case "rebuild-downstream":
      handlers.rebuildDownstream();
      return null;
    case "transcript":
    case "context":
      handlers.retryWholeContext(plan.kind);
      return null;
    case "refinement":
      handlers.restartRefinement();
      return null;
    case "candidate-plan":
      handlers.resetCandidatePlanArtifacts();
      return handlers.persistCurrentCandidatePlan().then(() => undefined);
    case "candidate":
      return handlers.repairCandidateDetails(plan.candidateIds);
  }
}
