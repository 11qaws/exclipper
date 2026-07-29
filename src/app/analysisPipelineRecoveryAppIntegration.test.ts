import { describe, expect, it, vi } from "vitest";

import {
  executeAnalysisPipelineRecoveryInApp,
  type AnalysisPipelineRecoveryAppHandlers,
} from "./analysisPipelineRecoveryAppIntegration";
import { planAnalysisPipelineRecovery } from "./analysisPipelineRecoveryPlanner";

describe("analysis pipeline recovery App integration", () => {
  it("rebuilds only the current candidate plan for candidate-plan-invalid", async () => {
    const calls: string[] = [];
    const handlers: AnalysisPipelineRecoveryAppHandlers = {
      rebuildDownstream: vi.fn(() => calls.push("rebuild-downstream")),
      retryWholeContext: vi.fn(() => calls.push("retry-whole-context")),
      restartRefinement: vi.fn(() => calls.push("restart-refinement")),
      resetCandidatePlanArtifacts: vi.fn(() =>
        calls.push("reset-candidate-plan-artifacts"),
      ),
      persistCurrentCandidatePlan: vi.fn(() => {
        calls.push("cas-current-candidate-plan");
        return Promise.resolve();
      }),
      repairCandidateDetails: vi.fn(() => {
        calls.push("repair-candidate-details");
        return Promise.resolve();
      }),
    };
    const plan = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        {
          code: "candidate-plan-invalid",
          detail: "The stored candidate plan does not match the current context cohort.",
        },
      ],
      priorAttemptCount: 0,
    });

    await executeAnalysisPipelineRecoveryInApp(plan, handlers);

    expect(calls).toEqual([
      "reset-candidate-plan-artifacts",
      "cas-current-candidate-plan",
    ]);
    expect(handlers.rebuildDownstream).not.toHaveBeenCalled();
    expect(handlers.retryWholeContext).not.toHaveBeenCalled();
    expect(handlers.restartRefinement).not.toHaveBeenCalled();
    expect(handlers.repairCandidateDetails).not.toHaveBeenCalled();
  });

  it("keeps a genuine source fence mismatch at the upstream rebuild boundary", () => {
    const handlers: AnalysisPipelineRecoveryAppHandlers = {
      rebuildDownstream: vi.fn(),
      retryWholeContext: vi.fn(),
      restartRefinement: vi.fn(),
      resetCandidatePlanArtifacts: vi.fn(),
      persistCurrentCandidatePlan: vi.fn(() => Promise.resolve()),
      repairCandidateDetails: vi.fn(() => Promise.resolve()),
    };
    const plan = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        {
          code: "candidate-plan-invalid",
          detail: "Candidate plan mismatch.",
        },
        {
          code: "source-fence-mismatch",
          detail: "Source mismatch.",
        },
      ],
      priorAttemptCount: 0,
    });

    expect(executeAnalysisPipelineRecoveryInApp(plan, handlers)).toBeNull();
    expect(handlers.rebuildDownstream).toHaveBeenCalledOnce();
    expect(handlers.resetCandidatePlanArtifacts).not.toHaveBeenCalled();
    expect(handlers.persistCurrentCandidatePlan).not.toHaveBeenCalled();
  });
});
