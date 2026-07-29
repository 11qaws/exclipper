import { describe, expect, it } from "vitest";

import {
  deriveCandidatePublicationGate,
  deriveCandidateStageCommitGate,
  selectCandidateDetailActionIds,
} from "./candidatePublicationGate";

const settledContext = {
  candidateDetailOutstandingCount: 0,
  candidatePlanDurable: true,
  candidatePassBBusy: false,
  semanticLeadRefinementStatus: "completed",
  refinementEvidenceRequired: false,
  refinementEvidenceProjectionFingerprint: null,
  refinementEvidencePublicationEligible: false,
  wholeContextComplete: true,
  wholeContextFailed: false,
} as const;

const refinementEvidenceProjectionFingerprint =
  `sha256:${"a".repeat(64)}` as const;

describe("deriveCandidatePublicationGate", () => {
  it("opens publication after a fully completed detail run", () => {
    expect(
      deriveCandidatePublicationGate({
        ...settledContext,
        candidatePassBStatus: "completed",
      }).finalSelectionReady,
    ).toBe(true);
  });

  it("blocks publication while a completed envelope still has missing artifacts", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 8,
      candidatePassBStatus: "completed",
    });

    expect(gate.candidateDetailSettled).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("blocks publication with explicit per-candidate gaps", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 8,
      candidatePassBStatus: "completedWithGaps",
    });

    expect(gate.candidateDetailSettled).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("waits for the active refinement evidence route when the sealed plan selected leads", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "completed",
      refinementEvidenceRequired: true,
    });

    expect(gate.refinementEvidenceReady).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("does not accept a settled but publication-ineligible refinement route", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "completed",
      refinementEvidenceRequired: true,
      refinementEvidenceProjectionFingerprint,
      refinementEvidencePublicationEligible: false,
    });

    expect(gate.refinementEvidenceReady).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("opens only after the required active refinement projection is publication eligible", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "completed",
      refinementEvidenceRequired: true,
      refinementEvidenceProjectionFingerprint,
      refinementEvidencePublicationEligible: true,
    });

    expect(gate.refinementEvidenceReady).toBe(true);
    expect(gate.finalSelectionReady).toBe(true);
  });

  it("fails closed when a stale caller omits the refinement evidence contract", () => {
    const staleInput = {
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "completed",
      candidatePassBBusy: false,
      semanticLeadRefinementStatus: "completed",
      wholeContextComplete: true,
      wholeContextFailed: false,
    } as unknown as Parameters<typeof deriveCandidatePublicationGate>[0];

    const gate = deriveCandidatePublicationGate(staleInput);

    expect(gate.refinementEvidenceReady).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("never exposes a final selection after whole-context failure", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "completed",
      wholeContextComplete: false,
      wholeContextFailed: true,
    });

    expect(gate.finalSelectionReady).toBe(false);
  });

  it.each(["failed", "cancelled"] as const)(
    "does not publish a %s detail run as a completed analysis",
    (candidatePassBStatus) => {
      const gate = deriveCandidatePublicationGate({
        ...settledContext,
        candidateDetailOutstandingCount: 8,
        candidatePassBStatus,
      });

      expect(gate.candidateDetailSettled).toBe(false);
      expect(gate.finalSelectionReady).toBe(false);
    },
  );

  it("waits while candidate work remains active", () => {
    expect(
      deriveCandidatePublicationGate({
        ...settledContext,
        candidatePassBStatus: "transcribing",
        candidatePassBBusy: true,
      }).finalSelectionReady,
    ).toBe(false);
  });

  it("allows a genuinely empty paid-detail queue to finish", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: null,
    });

    expect(gate.candidateDetailSettled).toBe(true);
    expect(gate.finalSelectionReady).toBe(true);
  });

  it("keeps an empty detail queue blocked until its exact empty plan is durable", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidatePlanDurable: false,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: null,
    });

    expect(gate.candidatePlanDurable).toBe(false);
    expect(gate.candidateDetailSettled).toBe(false);
    expect(gate.finalSelectionReady).toBe(false);
  });

  it("publishes durable artifacts despite a late cancelled envelope", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidateDetailOutstandingCount: 0,
      candidatePassBStatus: "cancelled",
    });

    expect(gate.candidateDetailSettled).toBe(true);
    expect(gate.detailedReviewFailed).toBe(true);
    expect(gate.finalSelectionReady).toBe(true);
  });

  it("rejects invalid counts instead of guessing a pipeline state", () => {
    expect(() =>
      deriveCandidatePublicationGate({
        ...settledContext,
        candidateDetailOutstandingCount: -1,
        candidatePassBStatus: null,
      }),
    ).toThrow(RangeError);
  });
});

describe("selectCandidateDetailActionIds", () => {
  it("retries only missing paid artifacts", () => {
    expect(
      selectCandidateDetailActionIds({
        candidateIds: ["a", "b", "c"],
        outstandingIds: ["b"],
        retryableIds: [],
        runStatus: "failed",
      }),
    ).toEqual(["b"]);
  });

  it.each(["failed", "cancelled"] as const)(
    "does not repay an entire cohort after a late %s envelope",
    (runStatus) => {
      expect(
        selectCandidateDetailActionIds({
          candidateIds: ["a", "b", "c"],
          outstandingIds: [],
          retryableIds: [],
          runStatus,
        }),
      ).toEqual([]);
    },
  );

  it("still allows an intentional re-analysis after a successful run", () => {
    expect(
      selectCandidateDetailActionIds({
        candidateIds: ["a", "b"],
        outstandingIds: [],
        retryableIds: [],
        runStatus: "completed",
      }),
    ).toEqual(["a", "b"]);
  });

  it("keeps an incomplete current insight rerunnable after a completed run", () => {
    expect(
      selectCandidateDetailActionIds({
        candidateIds: ["candidate"],
        outstandingIds: ["candidate"],
        retryableIds: [],
        runStatus: "completed",
      }),
    ).toEqual(["candidate"]);
  });

  it("retries only explicitly blocked candidates after a failed run", () => {
    expect(
      selectCandidateDetailActionIds({
        candidateIds: ["a", "b", "c"],
        outstandingIds: [],
        retryableIds: ["c", "unknown", "c"],
        runStatus: "failed",
      }),
    ).toEqual(["c"]);
  });
});

describe("deriveCandidateStageCommitGate", () => {
  it("does not turn a context failure recovery screen into a committed stage", () => {
    expect(
      deriveCandidateStageCommitGate({
        wholeContextComplete: false,
        finalSelectionReady: true,
        hasPipelineGap: true,
      }),
    ).toEqual({
      broadcastContext: false,
      deepPass: false,
      publication: false,
      completion: false,
    });
  });

  it("keeps a partially rendered candidate run behind the durable cursor", () => {
    expect(
      deriveCandidateStageCommitGate({
        wholeContextComplete: true,
        finalSelectionReady: true,
        hasPipelineGap: true,
      }),
    ).toEqual({
      broadcastContext: true,
      deepPass: false,
      publication: false,
      completion: false,
    });
  });

  it("commits a fully judged empty result because it has no pipeline gap", () => {
    expect(
      deriveCandidateStageCommitGate({
        wholeContextComplete: true,
        finalSelectionReady: true,
        hasPipelineGap: false,
      }),
    ).toEqual({
      broadcastContext: true,
      deepPass: true,
      publication: true,
      completion: true,
    });
  });
});
