import type {
  BroadcastContextResult,
  BroadcastContextSemanticChapterKind,
} from "./broadcastContextProtocol";

export type BroadcastContextSemanticFamily =
  | "event-reaction"
  | "achievement-payoff"
  | "flow-transition"
  | "general-context";

export function semanticChapterFamily(
  kind: BroadcastContextSemanticChapterKind,
): BroadcastContextSemanticFamily {
  if (kind === "main-event" || kind === "reaction") {
    return "event-reaction";
  }
  if (kind === "quiet-achievement" || kind === "setup-and-payoff") {
    return "achievement-payoff";
  }
  if (
    kind === "story-progress" ||
    kind === "context-shift" ||
    kind === "running-gag"
  ) {
    return "flow-transition";
  }
  return "general-context";
}

export function semanticChapterFamilyLabel(
  family: BroadcastContextSemanticFamily,
): string {
  return {
    "event-reaction": "주요 사건·반응",
    "achievement-payoff": "성취·회수",
    "flow-transition": "흐름·전환",
    "general-context": "일반 맥락",
  }[family];
}

export type BroadcastContextUiStatus =
  | "idle"
  | "restoring"
  | "running"
  | "completed"
  | "failed";

export type BroadcastContextTimelineState =
  | "not-analyzed"
  | "restoring"
  | "running"
  | "failed"
  | "legacy-unsupported"
  | "partial"
  | "complete";

export interface BroadcastContextTimelineMetric {
  readonly value: string;
  readonly label: string;
}

export interface BroadcastContextTimelinePresentation {
  readonly state: BroadcastContextTimelineState;
  readonly topicMetric: BroadcastContextTimelineMetric;
  readonly leadMetric: BroadcastContextTimelineMetric;
  readonly topicEmptyText: string;
  readonly leadEmptyText: string;
  readonly noticeText: string | null;
  readonly noticeTone: "neutral" | "warning" | null;
}

interface BroadcastContextTimelinePresentationInput {
  readonly status: BroadcastContextUiStatus;
  readonly result: BroadcastContextResult | null;
  readonly recoveredAnalysis: boolean;
}

function unavailablePresentation(
  state: Extract<
    BroadcastContextTimelineState,
    "not-analyzed" | "restoring" | "running" | "failed"
  >,
  topicEmptyText: string,
  leadEmptyText: string,
  noticeText: string,
  noticeTone: "neutral" | "warning",
): BroadcastContextTimelinePresentation {
  return {
    state,
    topicMetric: { value: "—", label: "주제 미분석" },
    leadMetric: { value: "—", label: "단서 미분석" },
    topicEmptyText,
    leadEmptyText,
    noticeText,
    noticeTone,
  };
}

export function buildBroadcastContextTimelinePresentation(
  input: BroadcastContextTimelinePresentationInput,
): BroadcastContextTimelinePresentation {
  if (input.status === "restoring") {
    return unavailablePresentation(
      "restoring",
      "저장된 주제 결과 확인 중",
      "저장된 의미 단서 확인 중",
      "이미 저장된 전체 맥락 결과를 확인하고 있어요.",
      "neutral",
    );
  }
  if (input.status === "running") {
    return unavailablePresentation(
      "running",
      "주제 구분 중",
      "의미 사건 탐색 중",
      "전체 방송 맥락을 판단하는 중이에요. 기존 후보는 이 단계에서도 유지됩니다.",
      "neutral",
    );
  }
  if (input.status === "failed") {
    return unavailablePresentation(
      "failed",
      "주제 판단 실패 · 없음으로 보지 않음",
      "의미 단서 판단 실패 · 없음으로 보지 않음",
      "전체 맥락 판단에 실패했어요. 기존 후보는 유지되며, 빈 레일은 사건이 없다는 뜻이 아닙니다.",
      "warning",
    );
  }
  if (input.result === null) {
    return unavailablePresentation(
      "not-analyzed",
      input.recoveredAnalysis
        ? "이 저장 기록은 전체 맥락 미분석"
        : "전체 맥락 분석 전",
      input.recoveredAnalysis
        ? "이 저장 기록은 의미 단서 미분석"
        : "전체 맥락 분석 전",
      input.recoveredAnalysis
        ? "이 저장 기록에는 전체 맥락 결과가 없어요. 현재 숫자는 빠른 탐색 후보이며, 주제와 의미 단서는 아직 판정하지 않았습니다."
        : "전체 맥락 분석이 끝나면 주제 구간과 조용한 의미 단서를 이 축에 함께 표시합니다.",
      "neutral",
    );
  }

  const topicSupported = input.result.semanticChaptersSupported;
  const leadSupported = input.result.discoveredLeadsSupported;
  const partial = input.result.coverage.status === "partial";
  const state: BroadcastContextTimelineState =
    !topicSupported || !leadSupported
      ? "legacy-unsupported"
      : partial
        ? "partial"
        : "complete";
  const topicEmptyText = !topicSupported
    ? "이 저장 결과는 주제 구간 기능 미지원"
    : input.result.semanticChapters.length > 0
      ? ""
      : partial
        ? "확인한 근거 범위에서 뚜렷한 주제 없음"
        : "분석 결과 뚜렷한 주제 없음";
  const leadEmptyText = !leadSupported
    ? "이 저장 결과는 의미 단서 기능 미지원"
    : input.result.discoveredLeads.length > 0
      ? ""
      : partial
        ? "확인한 근거 범위에서 추가 의미 단서 없음"
        : "분석 결과 추가 의미 단서 없음";

  let noticeText: string | null = null;
  let noticeTone: "neutral" | "warning" | null = null;
  if (!topicSupported || !leadSupported) {
    noticeText = "이전 버전에서 저장하지 않은 항목은 0개가 아니라 —로 표시합니다.";
    noticeTone = "neutral";
  } else if (partial) {
    const coveragePercent = Math.max(
      0,
      Math.min(100, Math.round(input.result.coverage.coverageRatio * 100)),
    );
    const exactGapText =
      input.result.coverage.gaps.length > 0
        ? ` · 근거 없는 시간 범위 ${input.result.coverage.gaps.length}곳은 빗금으로 표시`
        : " · 일부 챕터는 표본 근거만 확인";
    noticeText = `AI 근거 범위 ${coveragePercent}%${exactGapText}합니다. 비어 있는 범위를 사건 없음으로 해석하지 않습니다.`;
    noticeTone = "warning";
  }

  return {
    state,
    topicMetric: {
      value: topicSupported ? String(input.result.semanticChapters.length) : "—",
      label: topicSupported ? "주제 구간" : "주제 미지원",
    },
    leadMetric: {
      value: leadSupported ? String(input.result.discoveredLeads.length) : "—",
      label: leadSupported ? "의미 단서" : "단서 미지원",
    },
    topicEmptyText,
    leadEmptyText,
    noticeText,
    noticeTone,
  };
}
