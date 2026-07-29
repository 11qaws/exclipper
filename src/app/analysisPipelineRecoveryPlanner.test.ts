import { describe, expect, it } from "vitest";

import type {
  AnalysisPipelineSuccessGap,
  AnalysisPipelineSuccessGapCode,
} from "./analysisPipelineSuccess";
import {
  ANALYSIS_PIPELINE_GAP_RECOVERY_KIND,
  planAnalysisPipelineRecovery,
  type AnalysisPipelineRecoveryKind,
} from "./analysisPipelineRecoveryPlanner";

const GAP_CASES = [
  ["current-schema-required", "rebuild-downstream"],
  ["fast-result-invalid", "rebuild-downstream"],
  ["run-fence-mismatch", "rebuild-downstream"],
  ["source-fence-mismatch", "rebuild-downstream"],
  ["transcript-unsettled", "transcript"],
  ["participant-grounding-stale", "context"],
  ["context-input-stale", "context"],
  ["context-ledger-incomplete", "context"],
  ["context-result-invalid", "context"],
  ["refinement-evidence-incomplete", "refinement"],
  ["refinement-receipt-stale", "refinement"],
  ["candidate-plan-invalid", "candidate-plan"],
  ["candidate-detail-not-durable", "candidate"],
  ["candidate-verification-incomplete", "candidate"],
] as const satisfies readonly (readonly [
  AnalysisPipelineSuccessGapCode,
  AnalysisPipelineRecoveryKind,
])[];

function gap(
  code: AnalysisPipelineSuccessGapCode,
  candidateIds?: readonly string[],
): AnalysisPipelineSuccessGap {
  return {
    code,
    detail: `${code} detail`,
    ...(candidateIds === undefined ? {} : { candidateIds }),
  };
}

describe("analysis pipeline recovery planner", () => {
  it("maps every current certification gap code to exactly one recovery owner", () => {
    expect(Object.entries(ANALYSIS_PIPELINE_GAP_RECOVERY_KIND).sort()).toEqual(
      GAP_CASES.map(([code, kind]) => [code, kind]).sort(),
    );
  });

  it.each(GAP_CASES)(
    "maps %s to %s",
    (code, expectedKind) => {
      const result = planAnalysisPipelineRecovery({
        failedStage: "publication",
        gaps: [
          gap(
            code,
            expectedKind === "candidate" ? ["candidate-a"] : undefined,
          ),
        ],
        priorAttemptCount: 0,
      });

      expect(result).toMatchObject({
        kind: expectedKind,
        repairGeneration: 1,
        gapCodes: [code],
      });
    },
  );

  it("deduplicates reported candidate IDs without losing their first-seen order", () => {
    const result = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        gap("candidate-detail-not-durable", [
          "candidate-b",
          "candidate-a",
          "candidate-b",
        ]),
        gap("candidate-verification-incomplete", [
          "candidate-a",
          "candidate-c",
        ]),
      ],
      priorAttemptCount: 1,
    });

    expect(result).toMatchObject({
      kind: "candidate",
      repairGeneration: 2,
      candidateIds: ["candidate-b", "candidate-a", "candidate-c"],
    });
  });

  it.each([
    "candidate-detail-not-durable",
    "candidate-verification-incomplete",
  ] as const)(
    "stops when %s omits its required candidate IDs",
    (code) => {
      expect(
        planAnalysisPipelineRecovery({
          failedStage: "publication",
          gaps: [gap(code)],
          priorAttemptCount: 0,
        }),
      ).toMatchObject({
        kind: "terminal",
        repairGeneration: null,
        reason: "candidate-ids-required",
      });
    },
  );

  it("chooses the earliest repair boundary for mixed gaps", () => {
    const result = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        gap("candidate-verification-incomplete", ["candidate-a"]),
        gap("refinement-receipt-stale"),
        gap("context-ledger-incomplete"),
        gap("transcript-unsettled"),
      ],
      priorAttemptCount: 0,
    });

    expect(result).toMatchObject({
      kind: "transcript",
      repairGeneration: 1,
      candidateIds: ["candidate-a"],
    });
  });

  it("gives sealed-parent rebuilds priority over every downstream repair", () => {
    const result = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        gap("candidate-detail-not-durable", ["candidate-a"]),
        gap("source-fence-mismatch"),
        gap("transcript-unsettled"),
      ],
      priorAttemptCount: 0,
    });

    expect(result.kind).toBe("rebuild-downstream");
  });

  it("repairs an invalid candidate plan after the durable upstream fences", () => {
    const result = planAnalysisPipelineRecovery({
      failedStage: "publication",
      gaps: [
        gap("candidate-plan-invalid"),
        gap("candidate-detail-not-durable", ["candidate-a"]),
      ],
      priorAttemptCount: 0,
    });

    expect(result).toMatchObject({
      kind: "candidate-plan",
      repairGeneration: 1,
      candidateIds: ["candidate-a"],
    });
  });

  it.each([
    ["preflight", "rebuild-downstream"],
    ["fastPass", "rebuild-downstream"],
    ["seedClustering", "rebuild-downstream"],
    ["commitFastResult", "rebuild-downstream"],
    ["broadcastContext", "context"],
    ["deepPass", "refinement"],
    ["publication", "candidate"],
  ] as const)(
    "uses the failed %s stage when the gap list is empty",
    (failedStage, expectedKind) => {
      expect(
        planAnalysisPipelineRecovery({
          failedStage,
          gaps: [],
          priorAttemptCount: 0,
        }),
      ).toMatchObject({
        kind: expectedKind,
        repairGeneration: 1,
        candidateIds: [],
        gapCodes: [],
      });
    },
  );

  it("continues creating durable repair generations without a lifetime retry cap", () => {
    for (const priorAttemptCount of [0, 1, 2, 3, 100, 10_000]) {
      expect(
        planAnalysisPipelineRecovery({
          failedStage: "broadcastContext",
          gaps: [gap("context-ledger-incomplete")],
          priorAttemptCount,
        }),
      ).toMatchObject({
        kind: "context",
        repairGeneration: priorAttemptCount + 1,
      });
    }
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid prior attempt count %s",
    (priorAttemptCount) => {
      expect(
        planAnalysisPipelineRecovery({
          failedStage: "broadcastContext",
          gaps: [gap("context-ledger-incomplete")],
          priorAttemptCount,
        }),
      ).toMatchObject({
        kind: "terminal",
        repairGeneration: null,
        reason: "invalid-prior-attempt-count",
      });
    },
  );
});
