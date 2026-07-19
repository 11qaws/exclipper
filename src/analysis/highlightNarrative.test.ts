import { describe, expect, it } from "vitest";

import type { UnifiedHighlightCandidate } from "./highlightFusion";
import { buildHighlightNarrative } from "./highlightNarrative";

function candidate(
  evidence: UnifiedHighlightCandidate["evidence"],
  signalKinds: UnifiedHighlightCandidate["signalKinds"],
): UnifiedHighlightCandidate {
  return {
    id: `highlight-${signalKinds.join("-")}-1234abcd`,
    peakMs: 50_000,
    startMs: 22_000,
    endMs: 67_000,
    score: 0.9,
    reason: "presentation-only",
    signalKinds,
    evidence,
  };
}

describe("buildHighlightNarrative", () => {
  it("explains event, streamer reaction, audience response, and review value without inventing an event", () => {
    const narrative = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          audio: {
            rankPercentile: 0.95,
            robustPercentile: 0.9,
            normalizedScore: 0.93,
            eventKind: "sustained-vocal-reaction",
            rmsLiftRatio: 3.2,
            sustainedWindowCount: 4,
          },
          chat: {
            rankPercentile: 0.9,
            robustPercentile: 0.85,
            normalizedScore: 0.88,
            bucketStartMs: 50_000,
            bucketEndMs: 55_000,
            messageCount: 40,
            uniqueAuthorCount: 25,
            reactionMessageCount: 18,
            baselineMessageCount: 8,
            baselineUniqueAuthorCount: 5,
            burstRatio: 4.8,
            robustBurstScore: 3,
            repetitionRatio: 0.1,
            singleAuthorRatio: 0.08,
            spamPenalty: 0,
          },
        },
        ["audio", "chat"],
      ),
    );

    expect(narrative.title).toContain("오디오 반응 신호");
    expect(narrative.event).toContain("종류는 아직 확인 전");
    expect(narrative.streamerReaction).toContain("3.2배");
    expect(narrative.audienceReaction).toContain("25명");
    expect(narrative.title).toContain("겹치는 시간대");
    expect(narrative.title).not.toContain("뒤 채팅");
    expect(narrative.whyRecommended).toContain("검토할 가치");
    expect(JSON.stringify(narrative)).not.toMatch(/킬|승리|골|우승/u);
  });

  it("describes chat-before-audio ordering without reversing the sequence", () => {
    const narrative = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          audio: {
            rankPercentile: 0.95,
            robustPercentile: 0.9,
            normalizedScore: 0.93,
            eventKind: "short-loudness-burst",
          },
          chat: {
            rankPercentile: 0.9,
            robustPercentile: 0.85,
            normalizedScore: 0.88,
            bucketStartMs: 40_000,
            bucketEndMs: 45_000,
            messageCount: 30,
            uniqueAuthorCount: 18,
            reactionMessageCount: 12,
            baselineMessageCount: 6,
            baselineUniqueAuthorCount: 4,
            burstRatio: 5,
            robustBurstScore: 3,
            repetitionRatio: 0.1,
            singleAuthorRatio: 0.08,
            spamPenalty: 0,
          },
        },
        ["audio", "chat"],
      ),
    );

    expect(narrative.title).toContain("채팅이 먼저");
    expect(narrative.audienceReaction).toContain("앞선 시간대");
    expect(narrative.whyRecommended).toContain("시청자 반응이 먼저");
    expect(narrative.title).not.toContain("스트리머 반응 뒤");
  });

  it("describes audio-before-chat ordering without implying that either signal caused the other", () => {
    const narrative = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          audio: {
            rankPercentile: 0.95,
            robustPercentile: 0.9,
            normalizedScore: 0.93,
            eventKind: "short-loudness-burst",
          },
          chat: {
            rankPercentile: 0.9,
            robustPercentile: 0.85,
            normalizedScore: 0.88,
            bucketStartMs: 55_000,
            bucketEndMs: 60_000,
            messageCount: 30,
            uniqueAuthorCount: 18,
            reactionMessageCount: 12,
            baselineMessageCount: 6,
            baselineUniqueAuthorCount: 4,
            burstRatio: 5,
            robustBurstScore: 3,
            repetitionRatio: 0.1,
            singleAuthorRatio: 0.08,
            spamPenalty: 0,
          },
        },
        ["audio", "chat"],
      ),
    );

    expect(narrative.title).toContain("오디오 반응 신호 뒤 시간대");
    expect(narrative.audienceReaction).toContain("오디오 반응 신호 뒤 시간대");
    expect(narrative.whyRecommended).toContain("오디오 반응 신호 뒤 시간대");
    expect(
      [narrative.title, narrative.audienceReaction, narrative.whyRecommended].join(" "),
    ).not.toMatch(/(?:오디오|채팅).*(?:때문에|원인으로).*(?:오디오|채팅)/u);
  });

  it.each([
    ["before", 40_000, 45_000, "반응 신호보다 앞선 시간대"],
    ["after", 55_000, 60_000, "반응 신호 뒤 시간대"],
  ] as const)(
    "describes a visual change %s the reaction as timing evidence, not its cause",
    (_relation, previousFrameMs, currentFrameMs, expectedTiming) => {
      const narrative = buildHighlightNarrative(
        candidate(
          {
            normalization: "within-signal-rank-and-mad",
            audio: {
              rankPercentile: 0.95,
              robustPercentile: 0.9,
              normalizedScore: 0.93,
              eventKind: "short-loudness-burst",
            },
            visual: {
              rankPercentile: 1,
              robustPercentile: 0.8,
              normalizedScore: 0.9,
              previousFrameMs,
              currentFrameMs,
            },
          },
          ["audio", "visual"],
        ),
      );

      expect(narrative.event).toContain(expectedTiming);
      expect(narrative.event).toContain("원인이라고 단정할 수는 없");
      expect(narrative.event).not.toMatch(
        /화면 변화(?:가|로 인해) 반응(?:을|이) (?:일으켰|만들었|유발했)/u,
      );
    },
  );

  it("uses neutral wording when visual and chat timing overlaps or is unavailable", () => {
    const chatEvidence = {
      rankPercentile: 0.9,
      robustPercentile: 0.85,
      normalizedScore: 0.88,
      bucketStartMs: 50_000,
      bucketEndMs: 55_000,
      messageCount: 30,
      uniqueAuthorCount: 18,
      reactionMessageCount: 12,
      baselineMessageCount: 6,
      baselineUniqueAuthorCount: 4,
      burstRatio: 5,
      robustBurstScore: 3,
      repetitionRatio: 0.1,
      singleAuthorRatio: 0.08,
      spamPenalty: 0,
    } as const;
    const overlapping = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          chat: chatEvidence,
          visual: {
            rankPercentile: 1,
            robustPercentile: 0.8,
            normalizedScore: 0.9,
            previousFrameMs: 49_000,
            currentFrameMs: 51_000,
          },
        },
        ["chat", "visual"],
      ),
    );
    const unavailable = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          chat: chatEvidence,
          visual: {
            rankPercentile: 1,
            robustPercentile: 0.8,
            normalizedScore: 0.9,
          },
        },
        ["chat", "visual"],
      ),
    );

    expect(overlapping.whyRecommended).toContain("겹치는 시간대");
    expect(overlapping.whyRecommended).not.toContain("화면 변화 뒤");
    expect(unavailable.whyRecommended).toContain("정확한 순서는 알 수 없어");
    expect(unavailable.whyRecommended).not.toContain("화면 변화 뒤");
  });

  it("labels a visual-only result as a low-confidence exploration candidate", () => {
    const narrative = buildHighlightNarrative(
      candidate(
        {
          normalization: "within-signal-rank-and-mad",
          visual: {
            rankPercentile: 1,
            robustPercentile: 0.8,
            normalizedScore: 0.9,
            sceneChangeStrength: 5,
          },
        },
        ["visual"],
      ),
    );

    expect(narrative.basis).toBe("visual-exploration");
    expect(narrative.basisLabel).toContain("반응 근거 부족");
    expect(narrative.whyRecommended).toContain("낮은 우선순위");
  });
});
