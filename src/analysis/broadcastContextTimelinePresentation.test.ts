import { describe, expect, it } from "vitest";

import type { BroadcastContextResult } from "./broadcastContextProtocol";
import {
  buildBroadcastContextTimelinePresentation,
  semanticChapterFamily,
  semanticChapterFamilyLabel,
} from "./broadcastContextTimelinePresentation";

const completeResult: BroadcastContextResult = {
  schemaVersion: "1.4.0",
  broadcastSummaryKo: "음식에 관해 이야기한다.",
  hostStreamerProfile: null,
  recurringThemesKo: [],
  annotations: [],
  semanticChaptersSupported: true,
  semanticChapters: [],
  discoveredLeadsSupported: true,
  discoveredLeads: [],
  coverage: {
    status: "complete",
    coveredMs: 600_000,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [],
  },
};

describe("buildBroadcastContextTimelinePresentation", () => {
  it("does not disguise an unopened legacy context stage as two confirmed zeros", () => {
    const view = buildBroadcastContextTimelinePresentation({
      status: "idle",
      result: null,
      recoveredAnalysis: true,
    });

    expect(view.state).toBe("not-analyzed");
    expect(view.topicMetric.value).toBe("—");
    expect(view.leadMetric.value).toBe("—");
    expect(view.topicEmptyText).toContain("미분석");
    expect(view.noticeText).not.toContain("없다고");
  });

  it("keeps a failed judgment unknown instead of claiming no event", () => {
    const view = buildBroadcastContextTimelinePresentation({
      status: "failed",
      result: null,
      recoveredAnalysis: false,
    });

    expect(view.state).toBe("failed");
    expect(view.topicEmptyText).toContain("없음으로 보지 않음");
    expect(view.noticeTone).toBe("warning");
  });

  it("uses explicit completed-empty wording only with complete supported evidence", () => {
    const view = buildBroadcastContextTimelinePresentation({
      status: "completed",
      result: completeResult,
      recoveredAnalysis: false,
    });

    expect(view.state).toBe("complete");
    expect(view.topicMetric.value).toBe("0");
    expect(view.leadMetric.value).toBe("0");
    expect(view.topicEmptyText).toBe("분석 결과 뚜렷한 주제 없음");
    expect(view.noticeText).toBeNull();
  });

  it("labels unsupported legacy dimensions with an em dash", () => {
    const view = buildBroadcastContextTimelinePresentation({
      status: "completed",
      result: {
        ...completeResult,
        semanticChaptersSupported: false,
        discoveredLeadsSupported: false,
      },
      recoveredAnalysis: true,
    });

    expect(view.state).toBe("legacy-unsupported");
    expect(view.topicMetric).toEqual({ value: "—", label: "주제 미지원" });
    expect(view.leadMetric).toEqual({ value: "—", label: "단서 미지원" });
    expect(view.noticeText).toContain("0개가 아니라 —");
  });

  it("limits empty claims to the observed range when context coverage is partial", () => {
    const view = buildBroadcastContextTimelinePresentation({
      status: "completed",
      result: {
        ...completeResult,
        coverage: {
          status: "partial",
          coveredMs: 420_000,
          coverageRatio: 0.7,
          gaps: [{ startMs: 420_000, endMs: 600_000 }],
          partialChapterIds: [],
        },
      },
      recoveredAnalysis: false,
    });

    expect(view.state).toBe("partial");
    expect(view.topicEmptyText).toContain("확인한 근거 범위");
    expect(view.noticeText).toContain("70%");
    expect(view.noticeText).toContain("빗금");
  });
});

describe("semantic chapter families", () => {
  it("uses stable meaning-based families instead of sequence colors", () => {
    expect(semanticChapterFamily("main-event")).toBe("event-reaction");
    expect(semanticChapterFamily("reaction")).toBe("event-reaction");
    expect(semanticChapterFamily("quiet-achievement")).toBe("achievement-payoff");
    expect(semanticChapterFamily("setup-and-payoff")).toBe("achievement-payoff");
    expect(semanticChapterFamily("story-progress")).toBe("flow-transition");
    expect(semanticChapterFamily("context-shift")).toBe("flow-transition");
    expect(semanticChapterFamily("running-gag")).toBe("flow-transition");
    expect(semanticChapterFamily("other")).toBe("general-context");
    expect(semanticChapterFamilyLabel("achievement-payoff")).toBe("성취·회수");
  });
});
