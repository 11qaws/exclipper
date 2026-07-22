import { describe, expect, it } from "vitest";
import type { BroadcastContextCandidateAnnotation } from "./broadcastContextProtocol";
import {
  finalizeContextQualifiedCandidates,
  selectCandidateDetailCandidateIds,
} from "./contextQualifiedFinalSelection";

function candidate(id: string, peakMs: number) {
  return { id, peakMs, startMs: peakMs - 20_000, endMs: peakMs + 25_000, score: 0.8 };
}

function annotation(
  candidateId: string,
  clipDecision: "select" | "review" | "reject",
): BroadcastContextCandidateAnnotation {
  return {
    candidateId,
    category:
      clipDecision === "select" ? "apology-accountability" : "not-clip-worthy",
    clipDecision,
    confidence: 0.9,
    rejectionReasons:
      clipDecision === "select" ? [] : ["no-distinct-event"],
    contextSummaryKo: "전체 방송 맥락 요약",
    whyThisMomentKo: "선택 또는 제외 근거",
    relatedCandidateIds: [],
    uncertaintiesKo: [],
  };
}

describe("finalizeContextQualifiedCandidates", () => {
  it("returns zero selected clips for an all-negative relay stream", () => {
    const candidates = [candidate("relay-a", 10_000), candidate("relay-b", 20_000)];
    const result = finalizeContextQualifiedCandidates(candidates, [
      annotation("relay-a", "reject"),
      annotation("relay-b", "reject"),
    ]);

    expect(result.selectedCandidates).toEqual([]);
    expect(result.rejectedCandidateIds).toEqual(["relay-a", "relay-b"]);
    expect(result.projectionById).toEqual({
      "relay-a": "deprioritized",
      "relay-b": "deprioritized",
    });
    expect(candidates).toHaveLength(2);
  });

  it("keeps only the exact apology and does not promote adjacent reactions", () => {
    const candidates = [
      candidate("loud-adjacent", 10_000),
      candidate("exact-apology", 20_000),
      candidate("aftertalk", 30_000),
    ];
    const result = finalizeContextQualifiedCandidates(candidates, [
      annotation("loud-adjacent", "reject"),
      annotation("exact-apology", "select"),
      annotation("aftertalk", "reject"),
    ]);

    expect(result.selectedCandidates.map((item) => item.id)).toEqual([
      "exact-apology",
    ]);
  });

  it("keeps missing context in review instead of silently selecting it", () => {
    const result = finalizeContextQualifiedCandidates(
      [candidate("unseen", 10_000)],
      [],
    );

    expect(result.selectedCandidates).toEqual([]);
    expect(result.reviewCandidates.map((item) => item.id)).toEqual(["unseen"]);
    expect(result.missingContextCandidateIds).toEqual(["unseen"]);
    expect(result.projectionById).toEqual({ unseen: "insufficient-evidence" });
  });

  it("keeps editor state intact when AI only projects a lower priority", () => {
    const approved = {
      ...candidate("approved-by-editor", 10_000),
      reviewState: "approved" as const,
      approvedBoundaryRevision: 3,
    };
    const result = finalizeContextQualifiedCandidates(
      [approved],
      [annotation(approved.id, "reject")],
    );

    expect(result.projectionById[approved.id]).toBe("deprioritized");
    expect(approved).toMatchObject({
      reviewState: "approved",
      approvedBoundaryRevision: 3,
    });
  });

  it("spends detail budget by editor priority without deleting the ledger", () => {
    const ledger = [
      { id: "approved-music", reviewState: "approved" as const },
      { id: "ai-recommended", reviewState: "unreviewed" as const },
      { id: "ai-low", reviewState: "unreviewed" as const },
      { id: "editor-rejected", reviewState: "rejected" as const },
    ];

    expect(
      selectCandidateDetailCandidateIds(
        ledger,
        {
          "approved-music": "deprioritized",
          "ai-recommended": "recommended",
          "ai-low": "deprioritized",
          "editor-rejected": "recommended",
        },
        new Set(["approved-music"]),
      ),
    ).toEqual(["approved-music", "ai-recommended"]);
    expect(ledger).toHaveLength(4);
  });
});
