import { describe, expect, it } from "vitest";

import {
  deriveCandidatePublicationGate,
  deriveCandidateStageCommitGate,
  selectCandidateDetailActionIds,
} from "./candidatePublicationGate";

const settledContext = {
  candidateDetailOutstandingCount: 8,
  candidatePassBBusy: false,
  semanticLeadRefinementStatus: "completed",
  wholeContextComplete: true,
  wholeContextFailed: false,
} as const;

describe("deriveCandidatePublicationGate", () => {
  it("opens publication after a fully completed detail run", () => {
    expect(
      deriveCandidatePublicationGate({
        ...settledContext,
        candidatePassBStatus: "completed",
      }).finalSelectionReady,
    ).toBe(true);
  });

  it("opens publication with explicit per-candidate gaps", () => {
    const gate = deriveCandidatePublicationGate({
      ...settledContext,
      candidatePassBStatus: "completedWithGaps",
    });

    expect(gate.candidateDetailSettled).toBe(true);
    expect(gate.finalSelectionReady).toBe(true);
  });

  it.each(["failed", "cancelled"] as const)(
    "does not publish a %s detail run as a completed analysis",
    (candidatePassBStatus) => {
      const gate = deriveCandidatePublicationGate({
        ...settledContext,
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
        runStatus: "completed",
      }),
    ).toEqual(["a", "b"]);
  });

  it("keeps an incomplete legacy insight rerunnable after a completed run", () => {
    expect(
      selectCandidateDetailActionIds({
        candidateIds: ["candidate"],
        outstandingIds: ["candidate"],
        runStatus: "completed",
      }),
    ).toEqual(["candidate"]);
  });
});

describe("deriveCandidateStageCommitGate", () => {
  it("does not turn a context failure recovery screen into a committed stage", () => {
    expect(
      deriveCandidateStageCommitGate({
        wholeContextComplete: false,
        finalSelectionReady: true,
        publicationReady: true,
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
        publicationReady: true,
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
        publicationReady: true,
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
