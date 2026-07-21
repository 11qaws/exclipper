import { describe, expect, it } from "vitest";
import {
  buildBroadcastContextDeepseekRequestBody,
  extractBroadcastContextDeepseekResponse,
} from "./broadcastContextDeepseek";
import type { BroadcastContextRequest } from "./broadcastContextProtocol";

const dummyRequest: BroadcastContextRequest = {
  schemaVersion: "1.1.0",
  sourceDurationMs: 3600000,
  chapters: [
    {
      chapterId: "c1",
      startMs: 0,
      endMs: 300000,
      summaryKo: "첫 번째 챕터 요약",
    },
    {
      chapterId: "c2",
      startMs: 300000,
      endMs: 600000,
      summaryKo: "두 번째 챕터 요약",
    },
  ],
  candidates: [
    {
      candidateId: "can1",
      startMs: 60000,
      endMs: 90000,
      transcriptKo: "대화 내용",
      eventSummaryKo: "사건 내용",
      reactionSummaryKo: "리액션 내용",
      chatReactionSummaryKo: null,
    },
  ],
};

describe("broadcastContextDeepseek", () => {
  describe("buildBroadcastContextDeepseekRequestBody", () => {
    it("builds a correct prompt and request body", () => {
      const body = buildBroadcastContextDeepseekRequestBody(dummyRequest);
      expect(body.model).toBe("deepseek-chat");
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("JSON 스키마");
      expect(body.messages[0].content).toContain("semanticChapters");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toContain("총 방송 길이: 01:00:00");
      expect(body.messages[1].content).toContain("첫 번째 챕터 요약");
      expect(body.messages[1].content).toContain("==== 후보 ID: can1 ====");
      expect(body.response_format.type).toBe("json_object");
    });
  });

  describe("extractBroadcastContextDeepseekResponse", () => {
    it("parses valid response successfully with semantic chapters", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                recurringThemesKo: ["떡밥 1", "밈 2"],
                semanticChapters: [
                  {
                    startChapterId: "c1",
                    endChapterId: "c2",
                    titleKo: "의미 단락 제목",
                    summaryKo: "의미 단락 요약",
                    kind: "main-event",
                    salience: "primary",
                    relatedCandidateIds: ["can1"],
                    uncertaintiesKo: []
                  }
                ],
                annotations: [
                  {
                    candidateId: "can1",
                    category: "reaction",
                    contextSummaryKo: "맥락",
                    whyThisMomentKo: "이유",
                    relatedCandidateIds: [],
                    uncertaintiesKo: ["불확실"],
                  },
                ],
              }),
            },
          },
        ],
      };

      const parsed = extractBroadcastContextDeepseekResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.broadcastSummaryKo).toBe("방송 전체 요약");
        expect(parsed.result.annotations[0]?.category).toBe("reaction");
        expect(parsed.result.semanticChaptersSupported).toBe(true);
        expect(parsed.result.semanticChapters.length).toBe(1);
        expect(parsed.result.semanticChapters[0]!.startMs).toBe(0);
        expect(parsed.result.semanticChapters[0]!.endMs).toBe(600000);
      }
    });

    it("rejects invalid category", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                recurringThemesKo: [],
                annotations: [
                  {
                    candidateId: "can1",
                    category: "invalid-category",
                    contextSummaryKo: "맥락",
                    whyThisMomentKo: "이유",
                    relatedCandidateIds: [],
                    uncertaintiesKo: [],
                  },
                ],
              }),
            },
          },
        ],
      };

      const parsed = extractBroadcastContextDeepseekResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(false);
    });

    it("rejects missing fields", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                // recurringThemesKo missing
                annotations: [],
              }),
            },
          },
        ],
      };

      const parsed = extractBroadcastContextDeepseekResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(false);
    });
  });
});
