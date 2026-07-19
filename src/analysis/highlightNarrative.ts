import type { UnifiedHighlightCandidate } from "./highlightFusion";

export type HighlightInterpretationBasis = "signal-inference" | "visual-exploration";

export interface HighlightNarrative {
  readonly title: string;
  readonly event: string;
  readonly streamerReaction: string;
  readonly audienceReaction: string;
  readonly whyRecommended: string;
  readonly basis: HighlightInterpretationBasis;
  readonly basisLabel: "신호 기반 추정" | "반응 근거 부족 · 탐색 후보";
  readonly reviewHint: string;
}

type TemporalRelation = "before" | "after" | "overlap" | "unknown";

interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

function validRange(startMs: number | undefined, endMs: number | undefined): TimeRange | undefined {
  return startMs !== undefined &&
    endMs !== undefined &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs <= endMs
    ? { startMs, endMs }
    : undefined;
}

function audioRange(candidate: UnifiedHighlightCandidate): TimeRange | undefined {
  return candidate.evidence.audio !== undefined
    ? validRange(candidate.peakMs, candidate.peakMs)
    : undefined;
}

function chatRange(candidate: UnifiedHighlightCandidate): TimeRange | undefined {
  const chat = candidate.evidence.chat;
  return chat === undefined ? undefined : validRange(chat.bucketStartMs, chat.bucketEndMs);
}

function visualRange(candidate: UnifiedHighlightCandidate): TimeRange | undefined {
  const visual = candidate.evidence.visual;
  return visual === undefined
    ? undefined
    : validRange(visual.previousFrameMs, visual.currentFrameMs);
}

function relationBetween(
  left: TimeRange | undefined,
  right: TimeRange | undefined,
): TemporalRelation {
  if (left === undefined || right === undefined) {
    return "unknown";
  }
  if (left.endMs < right.startMs) {
    return "before";
  }
  if (left.startMs > right.endMs) {
    return "after";
  }
  return "overlap";
}

function topPercent(rankPercentile: number): number {
  return Math.max(1, Math.round((1 - rankPercentile) * 100));
}

function eventExplanation(candidate: UnifiedHighlightCandidate): string {
  const visual = candidate.evidence.visual;
  if (visual === undefined) {
    return "반응 신호는 잡혔지만 화면 사건의 종류는 아직 확인 전이에요.";
  }
  const reactionRange = audioRange(candidate) ?? chatRange(candidate);
  const relation = relationBetween(visualRange(candidate), reactionRange);
  const timing =
    relation === "before"
      ? "반응 신호보다 앞선 시간대에"
      : relation === "after"
        ? "반응 신호 뒤 시간대에"
        : relation === "overlap"
          ? "반응 신호와 겹치는 시간대에"
          : "이 후보 구간에";
  const strength = visual.sceneChangeStrength;
  const rank = topPercent(visual.rankPercentile);
  return strength === undefined
    ? `${timing} 영상 내 상위 ${rank}%의 화면 변화가 있어요. 반응의 원인이라고 단정할 수는 없지만 사건 맥락을 찾을 단서예요.`
    : `${timing} 장면 변화 ${strength.toFixed(2)}(영상 내 상위 ${rank}%)가 있어요. 반응의 원인이라고 단정할 수는 없지만 화면상 사건을 찾을 단서예요.`;
}

function streamerReactionExplanation(candidate: UnifiedHighlightCandidate): string {
  const audio = candidate.evidence.audio;
  if (audio === undefined) {
    return "오디오 반응 근거는 없어요. 채팅 또는 화면 신호만으로 고른 후보예요.";
  }
  const lift = audio.rmsLiftRatio;
  const liftText = lift === undefined ? "평소보다 두드러진" : `평소의 ${lift.toFixed(1)}배 수준인`;
  if (audio.eventKind === "sustained-vocal-reaction") {
    const sustained = audio.sustainedWindowCount;
    return `${liftText} 음성형 반응이${sustained === undefined ? " 잠시 이어졌어요" : ` 약 ${sustained}개 분석 구간 동안 이어졌어요`}. 웃음·외침·놀람처럼 지속되는 소리일 수 있지만, 게임·영상 소리인지 스트리머 목소리인지는 재생 확인이 필요해요.`;
  }
  return `${liftText} 짧은 오디오 반응이 잡혔어요. 효과음과 구분하려고 한순간의 클릭성 피크는 감점했지만, 실제 목소리인지는 재생 확인이 필요해요.`;
}

function audienceReactionExplanation(candidate: UnifiedHighlightCandidate): string {
  const chat = candidate.evidence.chat;
  if (chat === undefined) {
    return "함께 넣은 채팅 근거는 없어요.";
  }
  const relation = relationBetween(chatRange(candidate), audioRange(candidate));
  const timing =
    relation === "before"
      ? "방송 오디오 반응 신호보다 앞선 시간대에"
      : relation === "after"
        ? "방송 오디오 반응 신호 뒤 시간대에"
        : relation === "overlap"
          ? "방송 오디오 반응 신호와 겹치는 시간대에"
          : "이 후보 구간에서";
  const reactionSuffix =
    chat.reactionMessageCount > 0
      ? ` 이 중 반응 표현은 ${chat.reactionMessageCount}개였어요.`
      : "";
  return `${timing} ${chat.uniqueAuthorCount}명이 채팅 ${chat.messageCount}개를 남겨 평소의 ${chat.burstRatio.toFixed(1)}배로 늘었어요.${reactionSuffix}`;
}

function recommendationExplanation(candidate: UnifiedHighlightCandidate): string {
  const hasAudio = candidate.evidence.audio !== undefined;
  const hasChat = candidate.evidence.chat !== undefined;
  const hasVisual = candidate.evidence.visual !== undefined;
  if (hasAudio && hasChat) {
    return hasVisual
      ? "화면 변화, 방송 오디오 반응 신호, 시청자 채팅이 가까운 후보 구간에 함께 잡혔어요. 오디오의 주체나 어느 신호가 원인인지는 단정하지 않고, 실제 사건과 반응 흐름을 먼저 확인할 가치가 높아요."
      : relationBetween(chatRange(candidate), audioRange(candidate)) === "after"
        ? "방송 오디오 반응 신호 뒤 시간대에 시청자 반응도 커져, 실제 흐름을 먼저 검토할 가치가 높아요."
        : relationBetween(chatRange(candidate), audioRange(candidate)) === "before"
          ? "시청자 반응이 먼저 커진 뒤 시간대에 방송 오디오 반응 신호도 잡혀, 실제 흐름을 먼저 검토할 가치가 높아요."
          : relationBetween(chatRange(candidate), audioRange(candidate)) === "overlap"
            ? "방송 오디오 반응 신호와 시청자 반응이 겹치는 시간대에 잡혀, 먼저 검토할 가치가 높아요."
            : "방송 오디오 반응 신호와 시청자 반응이 같은 후보 구간에 잡혀, 실제 순서와 반응 주체를 재생으로 확인할 가치가 높아요.";
  }
  if (hasAudio) {
    return hasVisual
      ? "화면 변화와 방송 오디오 반응 신호가 가까워, 실제 스트리머 반응과 그 원인이 함께 담겼는지 먼저 확인할 후보예요."
      : "방송 오디오 반응 신호가 두드러져, 실제 스트리머의 말투·웃음·외침인지 먼저 확인할 후보예요.";
  }
  if (hasChat) {
    if (!hasVisual) {
      return "시청자 반응이 평소보다 크게 몰려, 화면과 실제 스트리머 반응을 먼저 확인할 후보예요.";
    }
    const relation = relationBetween(visualRange(candidate), chatRange(candidate));
    return relation === "before"
      ? "화면 변화가 먼저 잡히고 그 뒤 시간대에 시청자 반응이 몰려, 실제 사건과 반응을 확인할 후보예요."
      : relation === "after"
        ? "시청자 반응이 먼저 몰리고 그 뒤 시간대에 화면 변화가 잡혀, 실제 흐름을 확인할 후보예요."
        : relation === "overlap"
          ? "화면 변화와 시청자 반응이 겹치는 시간대에 잡혀, 스트리머의 조용한 반응이나 중요한 사건을 확인할 후보예요."
          : "화면 변화와 시청자 반응이 같은 후보 구간에 잡혔지만 정확한 순서는 알 수 없어, 재생으로 실제 흐름을 확인할 후보예요.";
  }
  return "오디오·채팅 반응 근거가 없어 화면 변화만으로 남긴 낮은 우선순위 탐색 후보예요.";
}

export function buildHighlightNarrative(
  candidate: UnifiedHighlightCandidate,
): HighlightNarrative {
  const hasAudio = candidate.evidence.audio !== undefined;
  const hasChat = candidate.evidence.chat !== undefined;
  const isExploration = !hasAudio && !hasChat;
  const audioChatRelation = relationBetween(chatRange(candidate), audioRange(candidate));
  const title = isExploration
    ? "반응 근거가 부족한 화면 탐색 후보"
    : hasAudio && hasChat
      ? audioChatRelation === "after"
        ? "오디오 반응 신호 뒤 시간대에 채팅도 커진 장면"
        : audioChatRelation === "before"
          ? "채팅이 먼저 커지고 오디오 반응 신호도 잡힌 장면"
          : audioChatRelation === "overlap"
            ? "오디오 반응 신호와 채팅이 겹치는 시간대의 장면"
            : "오디오 반응 신호와 채팅이 같은 후보 구간에 잡힌 장면"
      : hasAudio
        ? "방송 오디오 반응 신호가 두드러진 장면"
        : "시청자 반응이 갑자기 모인 장면";

  return {
    title,
    event: eventExplanation(candidate),
    streamerReaction: streamerReactionExplanation(candidate),
    audienceReaction: audienceReactionExplanation(candidate),
    whyRecommended: recommendationExplanation(candidate),
    basis: isExploration ? "visual-exploration" : "signal-inference",
    basisLabel: isExploration ? "반응 근거 부족 · 탐색 후보" : "신호 기반 추정",
    reviewHint: isExploration
      ? "큰 화면 변화가 실제 클립감인지 짧게 재생해 확인해 주세요."
      : "아직 대사를 받아쓴 단계는 아니므로, 후보를 재생해 실제 사건과 반응을 최종 확인해 주세요.",
  };
}
