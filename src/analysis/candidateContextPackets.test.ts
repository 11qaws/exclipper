import { describe, expect, it } from "vitest";
import { buildCandidatePassBContextPackets } from "./candidateContextPackets";
import type { BroadcastContextResult } from "./broadcastContextProtocol";
import type { UnifiedHighlightCandidate } from "./highlightFusion";
import {
  CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET,
  CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
} from "./candidatePassBContextBudget";
import {
  CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
  buildCandidatePassBQwenOmniSharedPrompt,
} from "./candidatePassBQwenOmni";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "./participantRoster";

const semanticCandidate: UnifiedHighlightCandidate = {
  id: "semantic-apology",
  startMs: 120_000,
  peakMs: 145_000,
  endMs: 170_000,
  score: 0.92,
  reason: "전체 맥락 후보",
  signalKinds: ["semantic"],
  evidence: {
    normalization: "within-signal-rank-and-mad",
    semantic: {
      rankPercentile: 0.92,
      robustPercentile: 0.92,
      normalizedScore: 0.92,
      category: "apology-accountability",
      confidence: 0.92,
      eventSummaryKo: "실수로 구독을 연 사실을 바로잡는 장면",
      whyThisMomentKo: "사과의 원인과 책임 인정이 한 구간에서 완결된다.",
      evidenceCueKo: "제가 잘못 열었습니다. 죄송합니다.",
      transcriptKo: "제가 잘못 열었습니다. 혼란을 드려 죄송합니다.",
    },
  },
};

const broadcastContext: BroadcastContextResult = {
  schemaVersion: "1.7.0",
  broadcastSummaryKo:
    "방송 초반 잡담 뒤 설정 실수를 발견하고 정확히 사과한 다음 본편으로 돌아갔다.",
  hostStreamerProfile: null,
  recurringThemesKo: ["설정 확인과 사과"],
  annotations: [],
  semanticChaptersSupported: true,
  semanticChapters: [{
    semanticChapterId: "chapter-apology",
    startChapterId: "middle",
    endChapterId: "middle",
    startMs: 100_000,
    endMs: 190_000,
    titleKo: "구독 설정 실수 해명",
    summaryKo: "설정 실수를 확인하고 시청자에게 경위를 설명해 사과한다.",
    kind: "main-event",
    salience: "primary",
    relatedCandidateIds: ["semantic-apology"],
    uncertaintiesKo: [],
  }],
  discoveredLeadsSupported: true,
  discoveredLeads: [],
  coverage: {
    status: "complete",
    coveredMs: 300_000,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [],
  },
};

describe("candidate context packets", () => {
  it("binds a semantic candidate to whole-flow, before, after and reference dialogue", () => {
    const packets = buildCandidatePassBContextPackets({
      candidates: [semanticCandidate],
      sourceDurationMs: 300_000,
      broadcastContext,
      transcriptChapters: [
        {
          chapterId: "before",
          startMs: 60_000,
          endMs: 120_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "시청자와 방송 설정에 관해 잡담했다.",
        },
        {
          chapterId: "after",
          startMs: 170_000,
          endMs: 230_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "사과를 마치고 원래 진행으로 돌아갔다.",
        },
      ],
      youtubeCaptionTrack: null,
    });

    expect(packets["semantic-apology"]).toMatchObject({
      transcriptSource: "semantic-refinement",
      transcriptKo: "제가 잘못 열었습니다. 혼란을 드려 죄송합니다.",
      contextCategory: "apology-accountability",
      contextDecision: "select",
    });
    expect(packets["semantic-apology"]?.beforeContextKo).toContain("잡담");
    expect(packets["semantic-apology"]?.afterContextKo).toContain("원래 진행");
    expect(packets["semantic-apology"]?.broadcastSummaryKo).toContain("정확히 사과");
  });

  it("keeps an editor-approved context rejection in the evidence queue", () => {
    const rejectedContext: BroadcastContextResult = {
      ...broadcastContext,
      annotations: [{
        candidateId: semanticCandidate.id,
        category: "not-clip-worthy",
        clipDecision: "reject",
        confidence: 0.91,
        rejectionReasons: ["no-distinct-event"],
        contextSummaryKo: "전체 맥락 AI는 독립 사건이 아니라고 판단했다.",
        whyThisMomentKo: "편집자 승인이 없으면 상세 검토를 생략한다.",
        relatedCandidateIds: [],
        uncertaintiesKo: [],
      }],
    };
    const baseInput = {
      sourceDurationMs: 300_000,
      broadcastContext: rejectedContext,
      transcriptChapters: [
        {
          chapterId: "approved-before",
          startMs: 60_000,
          endMs: 120_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "설정 이야기를 나누고 있었다.",
        },
        {
          chapterId: "approved-after",
          startMs: 170_000,
          endMs: 230_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "해명 뒤 원래 진행으로 돌아갔다.",
        },
      ],
      youtubeCaptionTrack: null,
    } as const;

    expect(
      buildCandidatePassBContextPackets({
        ...baseInput,
        candidates: [semanticCandidate],
      })[semanticCandidate.id],
    ).toBeUndefined();

    const approvedPackets = buildCandidatePassBContextPackets({
      ...baseInput,
      candidates: [{
        ...semanticCandidate,
        reviewState: "approved",
      }],
    });
    expect(approvedPackets[semanticCandidate.id]).toMatchObject({
      contextDecision: "review",
      contextCategory: "apology-accountability",
    });
  });

  it("returns canonical bounded packets without changing full broadcast data", () => {
    const maximumField = (label: string, fill: string): string => {
      const suffix = `${label}끝`;
      return `${label}시작${fill.repeat(
        4_000 - `${label}시작`.length - suffix.length,
      )}${suffix}`;
    };
    const transcriptKo = maximumField("대사", "가");
    const maximumCandidate: UnifiedHighlightCandidate = {
      ...semanticCandidate,
      evidence: {
        ...semanticCandidate.evidence,
        semantic: {
          ...semanticCandidate.evidence.semantic!,
          eventSummaryKo: maximumField("사건", "나"),
          whyThisMomentKo: maximumField("이유", "다"),
          transcriptKo,
        },
      },
    };
    const maximumBroadcastContext: BroadcastContextResult = {
      ...broadcastContext,
      broadcastSummaryKo: maximumField("전체", "라"),
      semanticChapters: [{
        ...broadcastContext.semanticChapters[0]!,
        titleKo: maximumField("제목", "마"),
        summaryKo: maximumField("주제", "바"),
      }],
    };
    const originalBroadcastSummary = maximumBroadcastContext.broadcastSummaryKo;
    const input = {
      candidates: [maximumCandidate],
      sourceDurationMs: 300_000,
      broadcastContext: maximumBroadcastContext,
      transcriptChapters: [
        {
          chapterId: "maximum-before",
          startMs: 60_000,
          endMs: 120_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: maximumField("직전", "사"),
        },
        {
          chapterId: "maximum-after",
          startMs: 170_000,
          endMs: 230_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: maximumField("직후", "아"),
        },
      ],
      youtubeCaptionTrack: null,
    } as const;

    const first = buildCandidatePassBContextPackets(input)[maximumCandidate.id];
    const second = buildCandidatePassBContextPackets(input)[maximumCandidate.id];
    const encoder = new TextEncoder();
    const aggregateBytes = [
      first?.transcriptKo,
      first?.beforeContextKo,
      first?.afterContextKo,
      first?.broadcastSummaryKo,
      first?.topicContextKo,
      first?.fastEvidenceKo,
      first?.contextVerdictKo,
    ].reduce(
      (sum, value) => sum + encoder.encode(value ?? "").byteLength,
      0,
    );

    expect(first).toEqual(second);
    expect(first?.transcriptKo).toBe(transcriptKo);
    expect(aggregateBytes).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_CANONICAL_CONTEXT_UTF8_BUDGET,
    );
    expect(first?.broadcastSummaryKo).toContain(
      CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
    );
    expect(first?.topicContextKo).toContain(
      CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
    );
    expect(maximumBroadcastContext.broadcastSummaryKo).toBe(
      originalBroadcastSummary,
    );
    if (first === undefined) {
      throw new Error("Expected a canonical candidate context packet.");
    }
    for (const outputLanguage of ["ko", "en"] as const) {
      const prompt = buildCandidatePassBQwenOmniSharedPrompt(
        60_000,
        4,
        DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        outputLanguage,
        first,
      );
      expect(encoder.encode(prompt).byteLength).toBeLessThanOrEqual(
        CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
      );
    }
  });
});
