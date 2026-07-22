import { describe, expect, it } from "vitest";
import type {
  BroadcastContextChapterInput,
  BroadcastContextDiscoveredLead,
  BroadcastContextSemanticChapter,
} from "./broadcastContextProtocol";
import {
  createBroadcastTopicalLeadJuryPlan,
  createBroadcastTopicalDiscoverySlices,
  createParallelBroadcastTopicalDiscoverySlices,
  mergeBroadcastTopicalDiscoveryLeads,
  selectBroadcastTopicalJuryApprovedLeadIds,
  selectBroadcastTopicalRefinementLeadIds,
} from "./broadcastTopicalDiscovery";

const chapters: BroadcastContextChapterInput[] = Array.from(
  { length: 8 },
  (_, index) => ({
    chapterId: `c${index + 1}`,
    startMs: index * 120_000,
    endMs: (index + 1) * 120_000,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: `대사 ${index + 1}`,
  }),
);

function semantic(
  id: string,
  startMs: number,
  endMs: number,
  salience: "primary" | "secondary" = "primary",
): BroadcastContextSemanticChapter {
  return {
    semanticChapterId: id,
    startChapterId: "c1",
    endChapterId: "c8",
    startMs,
    endMs,
    titleKo: id,
    summaryKo: id,
    kind: "main-event",
    salience,
    relatedCandidateIds: [],
    uncertaintiesKo: [],
  };
}

function lead(id: string, startMs: number, confidence = 0.8): BroadcastContextDiscoveredLead {
  return {
    leadId: id,
    startChapterId: "c1",
    endChapterId: "c1",
    startMs,
    endMs: startMs + 120_000,
    category: "reaction",
    confidence,
    eventSummaryKo: id,
    whyThisMomentKo: "검토 가치",
    evidenceCueKo: id,
    uncertaintiesKo: [],
  };
}

describe("broadcastTopicalDiscovery", () => {
  it("prefers grounded editorial topics and source-fences their chapters", () => {
    const slices = createBroadcastTopicalDiscoverySlices(chapters, [
      semantic("food", 240_000, 600_000),
      semantic("talk", 600_000, 960_000),
    ]);
    expect(slices.map((slice) => slice.titleKo)).toEqual(["food", "talk"]);
    expect(slices[0]?.chapters.map((chapter) => chapter.chapterId)).toEqual([
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("falls back to four chronological coverage slices", () => {
    const slices = createBroadcastTopicalDiscoverySlices(chapters, []);
    expect(slices).toHaveLength(4);
    expect(slices.flatMap((slice) => slice.chapters)).toEqual(chapters);
  });

  it("builds deterministic parallel slices that cover every chapter exactly once", () => {
    const slices = createParallelBroadcastTopicalDiscoverySlices(chapters);
    expect(slices).toHaveLength(4);
    expect(slices.map((slice) => slice.sliceId)).toEqual([
      "coverage-01",
      "coverage-02",
      "coverage-03",
      "coverage-04",
    ]);
    expect(slices.flatMap((slice) => slice.chapters)).toEqual(chapters);
    expect(new Set(slices.flatMap((slice) => slice.chapters.map((chapter) => chapter.chapterId))).size)
      .toBe(chapters.length);
  });

  it("round-robins topics and removes only near-identical ranges", () => {
    const merged = mergeBroadcastTopicalDiscoveryLeads([
      [lead("global", 0, 0.95), lead("global-2", 600_000, 0.9)],
      [lead("kalguksu", 240_000, 0.9), lead("dubai", 480_000, 0.8)],
      [lead("duplicate", 250_000, 0.85)],
    ]);
    expect(merged.map((item) => item.leadId)).toEqual([
      "global",
      "kalguksu",
      "dubai",
      "global-2",
    ]);
  });

  it("keeps precise events inside a much broader overview range", () => {
    const broad = { ...lead("broad-overview", 0, 0.9), endMs: 900_000 };
    const preciseA = lead("precise-a", 120_000, 0.85);
    const preciseB = lead("precise-b", 480_000, 0.82);
    const merged = mergeBroadcastTopicalDiscoveryLeads([
      [broad],
      [preciseA, preciseB],
    ]);
    expect(merged.map((item) => item.leadId)).toEqual([
      "broad-overview",
      "precise-a",
      "precise-b",
    ]);
  });

  it("builds one compact comparative jury for up to 32 meaning leads", () => {
    const semanticChapter = semantic("food-quiz", 0, 960_000);
    const leads = Array.from({ length: 32 }, (_, index) =>
      lead(`lead-${index + 1}`, index * 30_000),
    );
    const plan = createBroadcastTopicalLeadJuryPlan(
      960_000,
      "음식 퀴즈 방송",
      [semanticChapter],
      leads,
    );
    expect(plan.candidates).toHaveLength(32);
    expect(plan.chapters).toHaveLength(1);
    expect(plan.leadIdByCandidateId["topical-jury-32"]).toBe("lead-32");
  });

  it("gives more reserve turns to the topic with fewer jury selections", () => {
    const semanticChapters = [
      semantic("food-quiz", 0, 1_800_000),
      semantic("talk", 1_800_000, 3_600_000),
    ];
    const leads = [
      lead("broad-quiz-context", 480_000, 0.85),
      lead("skin", 1_320_000, 0.88),
      lead("dubai", 1_560_000, 0.82),
      lead("talk-selected", 2_400_000, 0.9),
      lead("talk-neighbor", 2_640_000, 0.95),
    ];
    const plan = createBroadcastTopicalLeadJuryPlan(
      3_600_000,
      "음식과 토크 방송",
      semanticChapters,
      leads,
    );
    const selectedCandidateIds = [
      "topical-jury-02",
      "topical-jury-03",
      "topical-jury-04",
    ];
    const annotations = plan.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      category: "reaction" as const,
      clipDecision: selectedCandidateIds.includes(candidate.candidateId)
        ? "select" as const
        : "reject" as const,
      confidence:
        candidate.candidateId === "topical-jury-02"
          ? 0.94
          : candidate.candidateId === "topical-jury-03"
            ? 0.92
            : candidate.candidateId === "topical-jury-04"
              ? 0.91
              : 0.82,
      rejectionReasons: selectedCandidateIds.includes(candidate.candidateId)
        ? []
        : ["duplicate-episode" as const],
      contextSummaryKo: "비교 결과",
      whyThisMomentKo: "비교 결과",
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    }));
    expect(
      selectBroadcastTopicalJuryApprovedLeadIds(leads, plan, annotations),
    ).toEqual(["skin", "dubai", "talk-selected"]);
    expect(
      selectBroadcastTopicalRefinementLeadIds(
        leads,
        plan,
        annotations,
        semanticChapters,
      ),
    ).toEqual([
      "skin",
      "dubai",
      "talk-selected",
      "talk-neighbor",
      "broad-quiz-context",
    ]);
  });

  it("does not refine a negative broadcast when the jury abstains", () => {
    const leads = [lead("fragment", 300_000)];
    const plan = createBroadcastTopicalLeadJuryPlan(
      900_000,
      "뚜렷한 사건이 없는 방송",
      [semantic("relay", 0, 900_000)],
      leads,
    );
    expect(
      selectBroadcastTopicalRefinementLeadIds(
        leads,
        plan,
        [{
          candidateId: "topical-jury-01",
          category: "not-clip-worthy",
          clipDecision: "reject",
          confidence: 0.9,
          rejectionReasons: ["no-distinct-event"],
          contextSummaryKo: "단편적인 진행",
          whyThisMomentKo: "독립적인 클립 가치 없음",
          relatedCandidateIds: [],
          uncertaintiesKo: [],
        }],
        [semantic("relay", 0, 900_000)],
      ),
    ).toEqual([]);
  });

  it("limits reserve fan-out when the jury approves only one event", () => {
    const topic = semantic("single-seed", 0, 1_800_000);
    const leads = Array.from({ length: 10 }, (_, index) =>
      lead(`event-${index + 1}`, index * 150_000, 0.9 - index * 0.01),
    );
    const plan = createBroadcastTopicalLeadJuryPlan(
      1_800_000,
      "하나의 사건만 확실한 방송",
      [topic],
      leads,
    );
    const annotations = plan.candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      category: index === 0 ? "reaction" as const : "not-clip-worthy" as const,
      clipDecision: index === 0 ? "select" as const : "reject" as const,
      confidence: 0.95,
      rejectionReasons: index === 0 ? [] : ["no-distinct-event" as const],
      contextSummaryKo: "비교 결과",
      whyThisMomentKo: "비교 결과",
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    }));

    const selectedLeadIds = selectBroadcastTopicalRefinementLeadIds(
      leads,
      plan,
      annotations,
      [topic],
    );
    expect(selectedLeadIds[0]).toBe("event-1");
    expect(selectedLeadIds).toHaveLength(6);
  });

  it("keeps three later context events when the jury clusters on an early topic", () => {
    const topic = semantic("quiz", 0, 1_800_000);
    const leads = [
      lead("early-a", 480_000, 0.9),
      lead("early-b", 720_000, 0.9),
      lead("early-c", 960_000, 0.9),
      lead("kalguksu-context", 1_200_000, 0.75),
      lead("skin-payoff", 1_320_000, 0.88),
      lead("dubai-payoff", 1_560_000, 0.82),
    ];
    const plan = createBroadcastTopicalLeadJuryPlan(
      1_800_000,
      "음식 퀴즈",
      [topic],
      leads,
    );
    const annotations = plan.candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      category: "reaction" as const,
      clipDecision: index < 3 ? "select" as const : "reject" as const,
      confidence: index < 3 ? 0.95 - index * 0.01 : 0.82,
      rejectionReasons: index < 3 ? [] : ["duplicate-episode" as const],
      contextSummaryKo: "편집 심사",
      whyThisMomentKo: "편집 심사",
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    }));
    const selectedLeadIds = selectBroadcastTopicalRefinementLeadIds(
      leads,
      plan,
      annotations,
      [topic],
    );
    expect(selectedLeadIds.slice(0, 3)).toEqual([
      "early-a",
      "early-b",
      "early-c",
    ]);
    expect(selectedLeadIds).toHaveLength(6);
    expect(selectedLeadIds).toEqual(
      expect.arrayContaining([
        "kalguksu-context",
        "skin-payoff",
        "dubai-payoff",
      ]),
    );
  });
});
