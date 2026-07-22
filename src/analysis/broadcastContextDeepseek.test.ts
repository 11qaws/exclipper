import { describe, expect, it } from "vitest";
import {
  buildBroadcastContextDeepseekRequestBody,
  buildBroadcastContextQwenRequestBody,
  extractBroadcastContextDeepseekResponse,
  extractBroadcastContextQwenDiscoveryResponse,
  extractBroadcastContextQwenRefinementResponse,
  extractBroadcastContextQwenSelectionResponse,
  extractBroadcastContextQwenOverviewResponse,
} from "./broadcastContextDeepseek";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  type BroadcastContextRequest,
} from "./broadcastContextProtocol";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "./participantRoster";

const dummyRequest: BroadcastContextRequest = {
  schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
  sourceDurationMs: 3600000,
  castRosterId: null,
  chapters: [
    {
      chapterId: "c1",
      startMs: 0,
      endMs: 300000,
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: "첫 번째 챕터 요약",
    },
    {
      chapterId: "c2",
      startMs: 300000,
      endMs: 600000,
      evidenceMode: "sampled-audio-video",
      evidenceCoverageRatio: 0.5,
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

const EXCHANGE_CAST_NAMES = [
  "세라 교수님",
  "아모레또",
  "유레카",
  "세나 아르벨",
  "토로리 코코",
  "망징이",
] as const;

describe("broadcastContextDeepseek", () => {
  it("adds the source-scoped closed cast to both context model prompts", () => {
    const request: BroadcastContextRequest = {
      ...dummyRequest,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    };
    const prompts = [
      buildBroadcastContextDeepseekRequestBody(request).messages[1].content,
      buildBroadcastContextQwenRequestBody(request).messages[1].content,
    ];
    for (const prompt of prompts) {
      for (const name of EXCHANGE_CAST_NAMES) expect(prompt).toContain(name);
      expect(prompt).toContain("목소리 느낌만으로 발화자를 정하거나");
      expect(prompt).toContain("canonical 전체 이름");
      expect(prompt).not.toContain("은분홍색");
    }
    expect(
      buildBroadcastContextQwenRequestBody(dummyRequest).messages[1].content,
    ).not.toContain("세라 교수님");
  });

  describe("buildBroadcastContextDeepseekRequestBody", () => {
    it("builds a correct prompt and request body", () => {
      const body = buildBroadcastContextDeepseekRequestBody(dummyRequest);
      expect(body.model).toBe("deepseek-v4-pro");
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("JSON 스키마");
      expect(body.messages[0].content).toContain("semanticChapters");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toContain("총 방송 길이: 01:00:00");
      expect(body.messages[1].content).toContain("첫 번째 챕터 요약");
      expect(body.messages[1].content).toContain("==== 후보 ID: can1 ====");
      expect(body.response_format.type).toBe("json_object");
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body.reasoning_effort).toBe("high");
    });

    it("uses Qwen 3.7 Plus hybrid thinking without DeepSeek-only fields", () => {
      const body = buildBroadcastContextQwenRequestBody(dummyRequest);
      expect(body.model).toBe("qwen3.7-plus");
      expect(body.enable_thinking).toBe(true);
      expect(body.thinking_budget).toBe(768);
      expect(body.max_tokens).toBe(4_096);
      expect(body.messages[0].content).toContain("600~1000자");
      expect(body.messages[0].content).toContain("host");
      expect(body.messages[0].content).toContain("클립 편집 라우터");
      expect(body.messages[0].content).toContain('"chapters"');
      expect(body.messages[0].content).toContain("주제가 바뀌는 경계");
      expect(body.messages[0].content).toContain("최대 12개");
      expect(body.messages[0].content).toContain("후속 30초 정밀 단계");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("reasoning_effort");
    });

    it.each([
      ["refinement", "qwen3.7-plus"],
      ["refinement-fast", "qwen3.6-flash"],
    ] as const)("bounds %s to the same three-lead localization contract", (mode, model) => {
      const body = buildBroadcastContextQwenRequestBody(
        { ...dummyRequest, candidates: [] },
        model,
        mode,
      );
      expect(body.max_tokens).toBe(1_024);
      expect(body.messages[0].content).toContain("최대 3개");
      expect(body.messages[0].content).toContain("1분 단위");
    });

    it("uses a high-recall topic discovery contract on the cheap text model", () => {
      const body = buildBroadcastContextQwenRequestBody(
        { ...dummyRequest, candidates: [] },
        "qwen3.6-flash",
        "discovery",
      );
      expect(body.model).toBe("qwen3.6-flash");
      expect(body.max_tokens).toBe(2_048);
      expect(body.messages[0].content).toContain("최대 8개");
      expect(body.messages[0].content).toContain("서로 다른 대상의 오답");
    });

    it("keeps grounded topic discoveries at the routing threshold", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "음식 퀴즈의 서로 다른 반응",
              leads: [{
                s: "c1",
                e: "c1",
                c: "reaction",
                p: 0.65,
                event: "초콜릿 모양을 두고 강하게 항변한다.",
                cue: "초콜릿한테 대한 모욕이야",
              }],
            }),
          },
        }],
      };
      const parsed = extractBroadcastContextQwenDiscoveryResponse(
        payload,
        { ...dummyRequest, candidates: [] },
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.discoveredLeads).toEqual([
          expect.objectContaining({
            startMs: 0,
            endMs: 300_000,
            confidence: 0.65,
          }),
        ]);
      }
    });

    it("parses the compact refinement schema into grounded leads", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "음식 오답에 반응하는 구간",
              leads: [{
                s: "c1",
                e: "c1",
                c: "reaction",
                p: 0.91,
                event: "음식 이름을 틀리고 강하게 항변한다.",
                cue: "내가 틀린 게 아니야",
              }],
            }),
          },
        }],
      };
      const parsed = extractBroadcastContextQwenRefinementResponse(
        payload,
        { ...dummyRequest, candidates: [] },
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.discoveredLeads).toEqual([
          expect.objectContaining({
            startMs: 0,
            endMs: 300_000,
            category: "reaction",
          }),
        ]);
      }
    });

    it("turns a compact editorial selection into complete candidate decisions", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "대표 반응 한 장면을 남김",
              selected: [{ id: "can1", p: 0.93, reason: "사건과 반응이 완결된다." }],
            }),
          },
        }],
      };
      const parsed = extractBroadcastContextQwenSelectionResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations).toEqual([
          expect.objectContaining({
            candidateId: "can1",
            clipDecision: "select",
            confidence: 0.93,
          }),
        ]);
      }
    });

    it("applies a stricter absolute threshold to routine gameplay context", () => {
      const gameplayRequest: BroadcastContextRequest = {
        ...dummyRequest,
        chapters: dummyRequest.chapters.map((chapter) => ({
          ...chapter,
          summaryKo: "마인크래프트 건축 중 흔한 자원 손실과 짧은 파쿠르 실패",
        })),
      };
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "일상적 게임 단편",
              selected: [{ id: "can1", p: 0.92, reason: "잠깐 당황한다." }],
            }),
          },
        }],
      };
      const parsed = extractBroadcastContextQwenSelectionResponse(
        payload,
        gameplayRequest,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          candidateId: "can1",
          clipDecision: "reject",
        });
      }
    });

    it("does not let a later game chapter suppress an earlier non-game event", () => {
      const mixedRequest: BroadcastContextRequest = {
        ...dummyRequest,
        chapters: [
          {
            ...dummyRequest.chapters[0]!,
            summaryKo: "음식 이름 맞추기와 밸런스 게임에서 칼국수 답을 두고 논쟁한다.",
          },
          {
            ...dummyRequest.chapters[1]!,
            summaryKo: "다음 날 마인크래프트 건축 릴레이를 예고한다.",
          },
        ],
        candidates: [{
          ...dummyRequest.candidates[0]!,
          transcriptKo: "누가 봐도 칼국수잖아요. 왜 바지락 칼국수만 정답이에요?",
          eventSummaryKo: "음식 퀴즈 정답 범위를 두고 제작자와 논쟁한다.",
          reactionSummaryKo: "억울함을 강하게 표현하며 자신의 답을 방어한다.",
        }],
      };
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "음식 퀴즈의 대표 논쟁",
              selected: [{
                id: "can1",
                p: 0.9,
                reason: "오답 판정에 반박하는 사건과 반응이 완결된다.",
              }],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenSelectionResponse(payload, mixedRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          clipDecision: "select",
          confidence: 0.9,
        });
      }
    });

    it("rejects ordinary gameplay even when the editorial jury is overconfident", () => {
      const gameplayRequest: BroadcastContextRequest = {
        ...dummyRequest,
        chapters: dummyRequest.chapters.map((chapter) => ({
          ...chapter,
          summaryKo: "마인크래프트 건축 릴레이에서 자원을 모아 기지를 확장한다.",
        })),
        candidates: [{
          ...dummyRequest.candidates[0]!,
          transcriptKo: "좌표를 잃었다가 기지를 다시 찾고 석탄을 캐러 간다.",
          eventSummaryKo: "길을 잃은 뒤 기지와 석탄을 찾는다.",
          reactionSummaryKo: "잠깐 당황한 뒤 평범한 채굴을 계속한다.",
        }],
      };
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "건축 릴레이 중 자원 수집",
              selected: [{
                id: "can1",
                p: 0.99,
                reason: "기지를 극적으로 다시 찾고 석탄 채굴을 시작한다.",
              }],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenSelectionResponse(
        payload,
        gameplayRequest,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          clipDecision: "reject",
          category: "not-clip-worthy",
          rejectionReasons: ["no-distinct-event"],
        });
      }
    });

    it("rejects generic chat banter when the whole broadcast is gameplay", () => {
      const relayRequest: BroadcastContextRequest = {
        ...dummyRequest,
        chapters: [
          {
            ...dummyRequest.chapters[0]!,
            summaryKo: "마인크래프트 건축 방송에서 자원을 채굴한다.",
          },
          {
            ...dummyRequest.chapters[1]!,
            summaryKo: "베이스 구축과 시간 부족 속에서 마무리한다.",
          },
        ],
        candidates: [{
          ...dummyRequest.candidates[0]!,
          startMs: 360_000,
          endMs: 390_000,
          transcriptKo: "채팅이 노래를 불러 달라고 하자 왜 갑자기 질문 폭탄이냐고 답한다.",
          eventSummaryKo: "건축 중 들어온 노래 요청에 짧게 반발한다.",
          reactionSummaryKo: "노래를 모른다며 당황하고 채팅과 장난스럽게 충돌한다.",
        }],
      };
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "건축 중 채팅 반응",
              selected: [{
                id: "can1",
                p: 0.99,
                reason: "채팅 노래 요청에 당황하며 반발하는 충돌 반응이다.",
              }],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenSelectionResponse(payload, relayRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          clipDecision: "reject",
          rejectionReasons: ["no-distinct-event"],
        });
      }
    });

    it("keeps a consequential exception inside a gameplay broadcast", () => {
      const gameplayRequest: BroadcastContextRequest = {
        ...dummyRequest,
        chapters: dummyRequest.chapters.map((chapter) => ({
          ...chapter,
          summaryKo: "마인크래프트 플레이 뒤 방송 운영 실수를 해명한다.",
        })),
        candidates: [{
          ...dummyRequest.candidates[0]!,
          transcriptKo: "기지로 돌아왔고, 제가 실수로 구독을 열었습니다. 정확히 사과드릴게요.",
          eventSummaryKo: "게임 도중 발생한 구독 설정 실수를 인정한다.",
          reactionSummaryKo: "경위를 설명하고 시청자에게 정확히 사과한다.",
        }],
      };
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "게임 중 운영 실수 사과",
              selected: [{
                id: "can1",
                p: 0.96,
                reason: "구독 설정 실수를 명시적으로 인정하고 정확히 사과한다.",
              }],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenSelectionResponse(
        payload,
        gameplayRequest,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          clipDecision: "select",
          confidence: 0.96,
        });
      }
    });

    it("grounds compact whole-broadcast leads and fills every candidate decision", () => {
      const payload = {
        choices: [{ message: { content: JSON.stringify({
          summary: "실수의 경위를 설명하고 사과했다.",
          host: {
            name: "아모레또",
            profile: "미국 출신 여성 스트리머로 추정된다. 음식 취향을 솔직하게 설명하고 채팅의 반박에는 구체적인 비유로 응수하며, 틀렸다고 판단하면 결국 인정하는 진행자다.",
            evidence: ["21살이라고 언급", "음식 퀴즈에서 채팅과 논쟁", "오답을 확인한 뒤 인정"],
            uncertainty: ["본명은 확인되지 않음", "이 방송 밖의 진행 성향은 확인하지 않음"],
          },
          themes: ["사과"],
          chapters: [{
            s: "c1",
            e: "c2",
            title: "실수 경위와 사과",
            desc: "실수의 경위를 설명한 뒤 책임을 인정하고 사과로 마무리한다.",
            kind: "main-event",
            sal: "primary",
          }],
          candidates: [{
            id: "can1",
            d: "select",
            c: "apology-accountability",
            p: 0.95,
            reason: "정확히 잘못을 인정한다.",
          }],
          leads: [{
            s: "c1",
            e: "c1",
            c: "apology-accountability",
            p: 0.96,
            event: "실수를 인정하고 사과한다.",
            cue: "제가 잘못했습니다",
          }],
        }) } }],
      };
      const parsed = extractBroadcastContextQwenOverviewResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          candidateId: "can1",
          clipDecision: "select",
        });
        expect(parsed.result.hostStreamerProfile).toMatchObject({
          displayNameKo: null,
          evidenceKo: ["음식 퀴즈에서 채팅과 논쟁", "오답을 확인한 뒤 인정"],
        });
        expect(parsed.result.hostStreamerProfile?.profileSummaryKo).not.toContain("미국 출신");
        expect(parsed.result.hostStreamerProfile?.uncertaintiesKo).toEqual([
          "이 방송 밖의 진행 성향은 확인하지 않음",
        ]);
        expect(parsed.result.discoveredLeads[0]).toMatchObject({
          category: "apology-accountability",
          startMs: 0,
          endMs: 300_000,
        });
        expect(parsed.result.semanticChaptersSupported).toBe(true);
        expect(parsed.result.semanticChapters[0]).toMatchObject({
          titleKo: "실수 경위와 사과",
          startMs: 0,
          endMs: 600_000,
          kind: "main-event",
          summaryKo: "실수의 경위를 설명한 뒤 책임을 인정하고 사과로 마무리한다.",
          salience: "primary",
        });
      }
    });

    it("keeps routine gameplay on the score map without adding editor-review clips", () => {
      const gameRequest: BroadcastContextRequest = {
        ...dummyRequest,
        candidates: [{
          ...dummyRequest.candidates[0]!,
          transcriptKo: "동굴에 추락해서 물에 떠내려가다가 겨우 살아남았어.",
          eventSummaryKo: "마인크래프트 동굴 추락과 생존",
          reactionSummaryKo: "애니 한 편 찍었다며 크게 당황한다.",
        }],
      };
      const payload = {
        choices: [{ message: { content: JSON.stringify({
          summary: "마인크래프트 건축 방송에서 자원 수집과 이동을 이어간다.",
          themes: ["건축"],
          candidates: [{
            id: "can1",
            d: "select",
            c: "reaction",
            p: 0.95,
            reason: "동굴 추락 후 극적으로 생존했다.",
          }],
          leads: [{
            s: "c1",
            e: "c2",
            c: "reaction",
            p: 0.94,
            event: "동굴 물에 빠졌다가 생존한다.",
            cue: "애니 한 편 찍었어",
          }],
        }) } }],
      };
      const parsed = extractBroadcastContextQwenOverviewResponse(payload, gameRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations[0]).toMatchObject({
          clipDecision: "reject",
          category: "not-clip-worthy",
          rejectionReasons: ["no-distinct-event"],
        });
        expect(parsed.result.discoveredLeads).toEqual([]);
      }
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
                hostStreamerProfile: {
                  displayNameKo: "아모레또",
                  profileSummaryKo: "방송을 주도하며 채팅의 반응을 받아 자신의 판단을 설명하고, 실수가 확인되면 이를 인정하는 진행자다.",
                  evidenceKo: ["채팅과 판단을 대조함", "실수를 명시적으로 인정함"],
                  uncertaintiesKo: ["방송 밖의 성향은 알 수 없음"],
                },
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
                    clipDecision: "select",
                    confidence: 0.92,
                    rejectionReasons: [],
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
        expect(parsed.result.hostStreamerProfile?.displayNameKo).toBeNull();
        expect(parsed.result.annotations[0]?.category).toBe("reaction");
        expect(parsed.result.annotations[0]?.clipDecision).toBe("select");
        expect(parsed.result.semanticChaptersSupported).toBe(true);
        expect(parsed.result.semanticChapters.length).toBe(1);
        expect(parsed.result.semanticChapters[0]!.startMs).toBe(0);
        expect(parsed.result.semanticChapters[0]!.endMs).toBe(600000);
      }
    });

    it("rejects malformed semantic chapters instead of reporting paid context as valid", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                recurringThemesKo: [],
                semanticChapters: [
                  {
                    startChapterId: "missing",
                    endChapterId: "missing",
                    titleKo: "근거 없는 단락",
                    summaryKo: "관측하지 않은 범위를 참조한다.",
                    kind: "main-event",
                    salience: "primary",
                    relatedCandidateIds: ["can1"],
                    uncertaintiesKo: [],
                  },
                ],
                annotations: [
                  {
                    candidateId: "can1",
                    category: "reaction",
                    clipDecision: "select",
                    confidence: 0.92,
                    rejectionReasons: [],
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

      expect(extractBroadcastContextDeepseekResponse(payload, dummyRequest).ok).toBe(false);
    });

    it("recovers valid semantic chapters while discarding malformed paid items", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                recurringThemesKo: [],
                semanticChapters: [
                  {
                    startChapterId: "c1",
                    endChapterId: "c1",
                    titleKo: "정상 단락",
                    summaryKo: "관측된 첫 구간이다.",
                    kind: "reaction",
                    salience: "secondary",
                    relatedCandidateIds: ["can1"],
                    uncertaintiesKo: [],
                  },
                  {
                    startChapterId: "missing",
                    endChapterId: "missing",
                    titleKo: "잘못된 단락",
                    summaryKo: "관측하지 않은 범위다.",
                    kind: "main-event",
                    salience: "primary",
                    relatedCandidateIds: [],
                    uncertaintiesKo: [],
                  },
                ],
                annotations: [
                  {
                    candidateId: "can1",
                    category: "reaction",
                    clipDecision: "select",
                    confidence: 0.92,
                    rejectionReasons: [],
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

      const parsed = extractBroadcastContextDeepseekResponse(payload, dummyRequest, {
        recoverMalformedItems: true,
      });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.semanticChapters).toHaveLength(1);
        expect(parsed.result.semanticChapters[0]?.titleKo).toBe("정상 단락");
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
                    clipDecision: "reject",
                    confidence: 0.8,
                    rejectionReasons: ["no-distinct-event"],
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

    it("accepts a fully negative broadcast without forcing a selected clip", () => {
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "단편적인 진행만 이어져 독립적인 클립 사건이 없다.",
                recurringThemesKo: [],
                semanticChapters: [],
                annotations: [
                  {
                    candidateId: "can1",
                    category: "not-clip-worthy",
                    clipDecision: "reject",
                    confidence: 0.96,
                    rejectionReasons: ["no-distinct-event", "reaction-without-context"],
                    contextSummaryKo: "전체 흐름에서도 별도 사건으로 이어지지 않는다.",
                    whyThisMomentKo: "클립으로 선택할 근거가 없다.",
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
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations.every((item) => item.clipDecision === "reject")).toBe(true);
      }
    });

    it("discovers a quiet semantic lead even when the sound pass found no candidates", () => {
      const request: BroadcastContextRequest = {
        ...dummyRequest,
        candidates: [],
      };
      const payload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "조용히 목표를 달성한 뒤 결과를 확인한 방송이다.",
                recurringThemesKo: ["긴 도전의 마무리"],
                semanticChapters: [],
                discoveredLeads: [
                  {
                    leadId: "quiet-success-1",
                    startChapterId: "c1",
                    endChapterId: "c1",
                    category: "quiet-achievement",
                    confidence: 0.88,
                    eventSummaryKo: "오랜 시도 끝에 목표를 달성했다고 확인한다.",
                    whyThisMomentKo: "큰 소리 없이도 방송의 핵심 성취가 완결된다.",
                    evidenceCueKo: "됐다. 드디어 끝냈다.",
                    uncertaintiesKo: ["정확한 화면 확인 필요"],
                  },
                ],
                annotations: [],
              }),
            },
          },
        ],
      };

      const parsed = extractBroadcastContextDeepseekResponse(payload, request);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations).toEqual([]);
        expect(parsed.result.discoveredLeadsSupported).toBe(true);
        expect(parsed.result.discoveredLeads[0]).toMatchObject({
          leadId: "quiet-success-1",
          startMs: 0,
          endMs: 300_000,
          category: "quiet-achievement",
        });
      }
    });

    it("rejects inconsistent decision reasons", () => {
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
                    category: "not-clip-worthy",
                    clipDecision: "reject",
                    confidence: 0.9,
                    rejectionReasons: [],
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

      expect(extractBroadcastContextDeepseekResponse(payload, dummyRequest).ok).toBe(false);
    });

    it("rejects unknown or duplicate candidate annotations", () => {
      const buildPayload = (candidateIds: readonly string[]) => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                broadcastSummaryKo: "방송 전체 요약",
                recurringThemesKo: [],
                annotations: candidateIds.map((candidateId) => ({
                  candidateId,
                  category: "not-clip-worthy",
                  clipDecision: "reject",
                  confidence: 0.9,
                  rejectionReasons: ["no-distinct-event"],
                  contextSummaryKo: "맥락",
                  whyThisMomentKo: "이유",
                  relatedCandidateIds: [],
                  uncertaintiesKo: [],
                })),
              }),
            },
          },
        ],
      });

      expect(
        extractBroadcastContextDeepseekResponse(buildPayload(["unknown"]), dummyRequest).ok,
      ).toBe(false);
      expect(
        extractBroadcastContextDeepseekResponse(buildPayload(["can1", "can1"]), dummyRequest).ok,
      ).toBe(false);
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

    it("recovers paid routing results while failing malformed items closed", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              broadcastSummaryKo: "음악 대기 뒤 본 방송이 이어졌다.",
              recurringThemesKo: ["음식 토크"],
              annotations: [],
              discoveredLeads: [
                {
                  leadId: "bad-range",
                  startChapterId: "missing",
                  endChapterId: "missing",
                  category: "reaction",
                  confidence: 0.9,
                  eventSummaryKo: "잘못된 범위",
                  whyThisMomentKo: "범위가 없다.",
                  evidenceCueKo: "없음",
                  uncertaintiesKo: [],
                },
              ],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextDeepseekResponse(payload, dummyRequest, {
        recoverMalformedItems: true,
      });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations).toEqual([
          expect.objectContaining({
            candidateId: "can1",
            clipDecision: "reject",
            rejectionReasons: ["uncertain-evidence"],
          }),
        ]);
        expect(parsed.result.discoveredLeads).toEqual([]);
      }
    });
  });
});
