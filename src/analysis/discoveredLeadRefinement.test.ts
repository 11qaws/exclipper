import { describe, expect, it } from "vitest";
import type { BroadcastContextDiscoveredLead } from "./broadcastContextProtocol";
import {
  DISCOVERED_LEAD_REFINEMENT_BUDGET_USD,
  createDiscoveredLeadRefinementChapters,
  createCaptionDiscoveredLeadRefinementPlan,
  createDiscoveredLeadRefinementPlan,
  materializeRefinedDiscoveredLeadEvidence,
  refineDiscoveredLeadRange,
} from "./discoveredLeadRefinement";

function lead(id: string, startMs: number, confidence = 0.9): BroadcastContextDiscoveredLead {
  return {
    leadId: id,
    startChapterId: `chapter-${id}`,
    endChapterId: `chapter-${id}`,
    startMs,
    endMs: startMs + 210_000,
    category: "apology-accountability",
    confidence,
    eventSummaryKo: "실수를 인정하고 사과한다.",
    whyThisMomentKo: "정확한 사과 장면이다.",
    evidenceCueKo: "실수로 구독을 열어서 죄송합니다",
    uncertaintiesKo: [],
  };
}

describe("discoveredLeadRefinement", () => {
  it("bounds four semantic leads under the three-cent ASR reserve", () => {
    const plan = createDiscoveredLeadRefinementPlan(
      Array.from({ length: 8 }, (_, index) => lead(String(index + 1), index * 300_000)),
    );
    expect(plan.selectedLeadIds).toHaveLength(4);
    expect(plan.estimatedAsrCostUsd).toBeLessThanOrEqual(
      DISCOVERED_LEAD_REFINEMENT_BUDGET_USD,
    );
    expect(
      plan.segments.every(
        (segment) => segment.sourceEndMs - segment.sourceStartMs <= 60_000,
      ),
    ).toBe(true);
  });

  it("subtracts higher-priority coverage and emits globally non-overlapping ASR cells", () => {
    const priorityLeads = [
      { ...lead("primary", 100_000, 0.99), endMs: 310_000 },
      { ...lead("fully-covered", 120_000, 0.98), endMs: 300_000 },
      { ...lead("partial-overlap", 250_000, 0.97), endMs: 460_000 },
      { ...lead("independent-one", 600_000, 0.96), endMs: 810_000 },
      { ...lead("independent-two", 900_000, 0.95), endMs: 1_110_000 },
    ];
    const plan = createDiscoveredLeadRefinementPlan(priorityLeads);

    expect(plan.selectedLeadIds).toEqual([
      "primary",
      "partial-overlap",
      "independent-one",
      "independent-two",
    ]);
    expect(
      plan.segments.some((segment) => segment.leadId === "fully-covered"),
    ).toBe(false);
    expect(
      plan.segments
        .filter((segment) => segment.leadId === "partial-overlap")
        .every((segment) => segment.sourceStartMs >= 310_000),
    ).toBe(true);

    const sourceOrderedSegments = [...plan.segments].sort(
      (left, right) =>
        left.sourceStartMs - right.sourceStartMs ||
        left.sourceEndMs - right.sourceEndMs,
    );
    expect(
      sourceOrderedSegments.every(
        (segment, index) =>
          index === 0 ||
          (sourceOrderedSegments[index - 1]?.sourceEndMs ?? 0) <=
            segment.sourceStartMs,
      ),
    ).toBe(true);
    expect(plan.estimatedAsrCostUsd).toBeLessThanOrEqual(
      DISCOVERED_LEAD_REFINEMENT_BUDGET_USD,
    );
  });

  it("lets editorial jury order own shared ASR coverage", () => {
    const juryFirst = {
      ...lead("jury-first", 100_000, 0.71),
      endMs: 310_000,
    };
    const higherInitialConfidence = {
      ...lead("later-duplicate", 100_000, 0.99),
      endMs: 310_000,
    };
    const plan = createDiscoveredLeadRefinementPlan(
      [juryFirst, higherInitialConfidence],
      { preserveInputOrder: true },
    );

    expect(plan.selectedLeadIds).toEqual(["jury-first"]);
    expect(
      new Set(plan.segments.map((segment) => segment.leadId)),
    ).toEqual(new Set(["jury-first"]));
  });

  it("covers the full lead with free thirty-second caption refinement", () => {
    const broadLead = { ...lead("caption", 600_000), endMs: 1_020_000 };
    const plan = createCaptionDiscoveredLeadRefinementPlan([broadLead]);
    expect(plan.estimatedAsrCostUsd).toBe(0);
    expect(plan.segments[0]?.sourceStartMs).toBe(broadLead.startMs);
    expect(plan.segments.at(-1)?.sourceEndMs).toBe(broadLead.endMs);
    expect(
      plan.segments.every(
        (segment) => segment.sourceEndMs - segment.sourceStartMs <= 30_000,
      ),
    ).toBe(true);
  });

  it("keeps twenty pre-ranked caption leads in jury order at no ASR cost", () => {
    const juryOrder = [
      lead("selected-low-signal", 1_200_000, 0.7),
      lead("selected-high-signal", 300_000, 0.95),
      ...Array.from({ length: 19 }, (_, index) =>
        lead(`reserve-${index + 1}`, 1_800_000 + index * 300_000, 0.8),
      ),
    ];
    const plan = createCaptionDiscoveredLeadRefinementPlan(juryOrder, {
      preserveInputOrder: true,
    });
    expect(plan.selectedLeadIds).toEqual(
      juryOrder.slice(0, 20).map((item) => item.leadId),
    );
    expect(plan.estimatedAsrCostUsd).toBe(0);
  });

  it("locates the exact apology cell instead of choosing the loudest neighbor", () => {
    const target = lead("apology", 600_000);
    const plan = createDiscoveredLeadRefinementPlan([target]);
    const transcripts = plan.segments.map((segment, index) => ({
      schemaVersion: "1.0.0" as const,
      modelId: "qwen3-asr-flash" as const,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      textKo:
        index === 1
          ? "제가 실수로 구독을 열어서 정말 죄송합니다."
          : "게임 화면을 보며 평범한 이야기를 이어간다.",
      detectedLanguage: "ko",
      emotion: index === 1 ? "sad" : "neutral",
      billedSeconds: 60,
    }));
    const refined = refineDiscoveredLeadRange(target, plan, transcripts, 2_000_000);
    expect(refined?.matchedSegmentId).toBe(plan.segments[1]?.segmentId);
    expect(refined?.transcriptMatchScore).toBeGreaterThan(0.5);
    expect((refined?.endMs ?? 0) - (refined?.startMs ?? 0)).toBe(60_000);
  });

  it("builds source-fenced chapters and materializes more than one refined event", () => {
    const parent = lead("food-quiz", 600_000);
    const plan = createDiscoveredLeadRefinementPlan([parent]);
    const transcripts = plan.segments.slice(0, 3).map((segment, index) => ({
      schemaVersion: "1.0.0" as const,
      modelId: "qwen3.5-omni-flash" as const,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      textKo: index === 0 ? "칼국수를 보고 억울해한다." : `음식 퀴즈 ${index}`,
      detectedLanguage: "ko",
      emotion: "neutral",
      billedSeconds: 60,
    }));
    const chapters = createDiscoveredLeadRefinementChapters(
      parent.leadId,
      plan,
      transcripts,
      "음식 이름 맞히기 사건",
    );
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toMatchObject({
      chapterId: plan.segments[0]?.segmentId,
      summaryKo: "[상위 사건] 음식 이름 맞히기 사건 칼국수를 보고 억울해한다.",
    });

    const refinedLead = {
      ...parent,
      leadId: "refined-kalguksu",
      startChapterId: chapters[0]?.chapterId ?? "missing",
      endChapterId: chapters[0]?.chapterId ?? "missing",
      startMs: chapters[0]?.startMs ?? 0,
      endMs: chapters[0]?.endMs ?? 0,
    };
    const evidence = materializeRefinedDiscoveredLeadEvidence(
      refinedLead,
      transcripts,
      2_000_000,
    );
    expect(evidence?.transcriptKo).toContain("칼국수");
    expect((evidence?.range.endMs ?? 0) - (evidence?.range.startMs ?? 0)).toBe(
      60_000,
    );
  });

  it("uses the evidence cue cell instead of the midpoint of a broad refined range", () => {
    const parent = { ...lead("broad", 600_000), endMs: 840_000 };
    const plan = createDiscoveredLeadRefinementPlan([parent]);
    const transcripts = plan.segments.slice(0, 4).map((segment, index) => ({
      schemaVersion: "1.0.0" as const,
      modelId: "qwen3.5-omni-flash" as const,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      textKo:
        index === 3
          ? "참치 초밥은 초밥이라면서 왜 칼국수는 안 됩니까"
          : "다른 음식 이름을 맞히는 평범한 진행",
      detectedLanguage: "ko",
      emotion: "neutral",
      billedSeconds: 60,
    }));
    const refined = {
      ...parent,
      leadId: "kalguksu",
      startMs: transcripts[0]?.sourceStartMs ?? 0,
      endMs: transcripts[3]?.sourceEndMs ?? 0,
      evidenceCueKo: "참치 초밥은 초밥 칼국수",
    };
    const evidence = materializeRefinedDiscoveredLeadEvidence(
      refined,
      transcripts,
      2_000_000,
    );
    expect(evidence?.range.startMs).toBe(transcripts[3]?.sourceStartMs);
    expect(evidence?.range.transcriptMatchScore).toBeGreaterThanOrEqual(0.5);
    expect(evidence?.transcriptKo).toContain("칼국수");
  });
});
