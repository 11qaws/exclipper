import { describe, expect, it } from "vitest";

import {
  createSemanticLeadCandidate,
  parseSemanticLeadCandidates,
  serializeSemanticLeadCandidates,
} from "./semanticLeadCandidate";

describe("createSemanticLeadCandidate", () => {
  it("creates a source-fenced semantic candidate without pretending it was loud", () => {
    const candidate = createSemanticLeadCandidate(
      {
        leadId: "exact-apology",
        startChapterId: "chapter-1",
        endChapterId: "chapter-1",
        startMs: 0,
        endMs: 210_000,
        category: "apology-accountability",
        confidence: 0.91,
        eventSummaryKo: "실수를 인정하고 사과한다.",
        whyThisMomentKo: "방송의 핵심 책임 인정 장면이다.",
        evidenceCueKo: "제가 실수했습니다. 죄송합니다.",
        uncertaintiesKo: [],
      },
      {
        leadId: "exact-apology",
        startMs: 45_000,
        peakMs: 67_500,
        endMs: 90_000,
        transcriptMatchScore: 1,
        matchedSegmentId: "refine-001",
      },
      "제가 실수했습니다. 죄송합니다.",
    );

    expect(candidate.signalKinds).toEqual(["semantic"]);
    expect(candidate.evidence.audio).toBeUndefined();
    expect(candidate.evidence.semantic?.category).toBe("apology-accountability");
    expect(candidate.endMs - candidate.startMs).toBe(45_000);
    const serialized = serializeSemanticLeadCandidates([candidate]);
    expect(parseSemanticLeadCandidates(JSON.parse(serialized))).toEqual([candidate]);
  });

  it("namespaces repeated child lead IDs by their parent refinement lead", () => {
    const child = {
      leadId: "lead-01",
      startChapterId: "chapter-1",
      endChapterId: "chapter-1",
      startMs: 0,
      endMs: 120_000,
      category: "reaction" as const,
      confidence: 0.8,
      eventSummaryKo: "반응이 발생했다.",
      whyThisMomentKo: "상황과 반응이 이어진다.",
      evidenceCueKo: "대사 근거가 있다.",
      uncertaintiesKo: [],
    };
    const range = {
      leadId: "lead-01",
      startMs: 10_000,
      peakMs: 30_000,
      endMs: 55_000,
      transcriptMatchScore: 1,
      matchedSegmentId: "refine-001",
    };
    const first = createSemanticLeadCandidate(
      child,
      range,
      "첫 번째 부모 구간의 대사입니다.",
      "parent-a",
    );
    const second = createSemanticLeadCandidate(
      child,
      { ...range, startMs: 60_000, peakMs: 80_000, endMs: 105_000 },
      "두 번째 부모 구간의 대사입니다.",
      "parent-b",
    );

    expect(first.id).toMatch(/^semantic-pair-[0-9a-f]{16}$/u);
    expect(second.id).toMatch(/^semantic-pair-[0-9a-f]{16}$/u);
    expect(first.id).not.toBe(second.id);
    const candidates = [first, second];
    expect(
      parseSemanticLeadCandidates(
        JSON.parse(serializeSemanticLeadCandidates(candidates)),
      ),
    ).toEqual(candidates);
  });

  it("keeps legal maximum-length parent and child IDs bounded", () => {
    const childId = "c".repeat(256);
    const child = {
      leadId: childId,
      startChapterId: "chapter-1",
      endChapterId: "chapter-1",
      startMs: 0,
      endMs: 90_000,
      category: "reaction" as const,
      confidence: 0.8,
      eventSummaryKo: "반응이 발생했다.",
      whyThisMomentKo: "상황과 반응이 이어진다.",
      evidenceCueKo: "대사 근거가 있다.",
      uncertaintiesKo: [],
    };
    const candidate = createSemanticLeadCandidate(
      child,
      {
        leadId: childId,
        startMs: 10_000,
        peakMs: 30_000,
        endMs: 55_000,
        transcriptMatchScore: 1,
        matchedSegmentId: "refine-001",
      },
      "검증 가능한 대사입니다.",
      "p".repeat(256),
    );

    expect(candidate.id).toMatch(/^semantic-pair-[0-9a-f]{16}$/u);
    expect(candidate.id.length).toBeLessThanOrEqual(320);
  });
});
