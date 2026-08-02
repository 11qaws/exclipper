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
  createBroadcastContextRequest,
  type BroadcastContextRequest,
} from "./broadcastContextProtocol";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
} from "./participantRoster";

const dummyChapters = [
  {
    chapterId: "c1",
    startMs: 0,
    endMs: 300000,
    evidenceMode: "complete-transcript" as const,
    evidenceCoverageRatio: 1,
    summaryKo: "첫 번째 챕터 요약",
  },
  {
    chapterId: "c2",
    startMs: 300000,
    endMs: 600000,
    evidenceMode: "sampled-audio-video" as const,
    evidenceCoverageRatio: 0.5,
    summaryKo: "두 번째 챕터 요약",
  },
] as const;

const dummyRequest: BroadcastContextRequest = createBroadcastContextRequest({
  sourceDurationMs: 3600000,
  castRosterId: null,
  outputLanguage: "ko",
  chapters: dummyChapters,
  candidates: [
    {
      candidateId: "can1",
      startMs: 60000,
      endMs: 90000,
      transcriptKo: "대화 내용",
      eventSummaryKo: "사건 내용",
      reactionSummaryKo: "리액션 내용",
      participantContextKo:
        "등장인물 어댑터는 이 후보 구간에서 인물을 식별하지 못했다.",
      chatReactionSummaryKo: null,
    },
  ],
  participantGrounding: createBroadcastParticipantGrounding({
    sourceDurationMs: 3600000,
    castRosterId: null,
    chapters: dummyChapters,
  }),
});

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
    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: dummyRequest.sourceDurationMs,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: dummyRequest.chapters,
    });
    const request: BroadcastContextRequest = createBroadcastContextRequest({
      sourceDurationMs: dummyRequest.sourceDurationMs,
      chapters: dummyRequest.chapters,
      candidates: dummyRequest.candidates,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      participantGrounding,
      outputLanguage: "ko",
    });
    const prompts = [
      buildBroadcastContextDeepseekRequestBody(request).messages[1].content,
      buildBroadcastContextQwenRequestBody(request).messages[1].content,
    ];
    for (const prompt of prompts) {
      for (const name of EXCHANGE_CAST_NAMES) expect(prompt).toContain(name);
      expect(prompt).toContain("목소리 느낌만으로 발화자를 정하거나");
      expect(prompt).toContain("canonical 전체 이름");
      expect(prompt).toContain("visual-identity");
      expect(prompt).toContain("검증된 참조 자료 없음");
      expect(prompt).not.toContain("은분홍색");
    }
    expect(
      buildBroadcastContextQwenRequestBody(dummyRequest).messages[1].content,
    ).toContain("관찰 확인된 화면·목소리 인물 근거 없음");
    expect(
      buildBroadcastContextDeepseekRequestBody(dummyRequest).messages[0].content,
    ).toContain("명단은 이름 표기 교정용일 뿐 실제 등장 증거가 아닙니다");
  });

  it("keeps a host name only when a completed media adapter supplied observed identity evidence", () => {
    const participantInput = {
      sourceDurationMs: dummyRequest.sourceDurationMs,
      castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
      chapters: dummyRequest.chapters,
    } as const;
    const participantGrounding = createBroadcastParticipantGrounding(
      participantInput,
      {
        visualIdentity: {
          receipt: {
            adapter: "visual-identity",
            revision: "visual-reference-v1",
            status: "completed",
            inputCount: 4,
            processedCount: 4,
            unavailableReason: null,
          },
          evidence: [
            {
              evidenceId: "visual:c1:amoretto",
              participantId: "amoretto",
              kind: "visual-reference-match",
              supports: "visible-identity",
              adapter: "visual-identity",
              startMs: 60_000,
              endMs: 90_000,
              chapterId: "c1",
              confidence: 0.95,
              evidenceKo: "네 장의 대표 화면에서 아모레또 아바타를 확인했습니다.",
            },
          ],
        },
      },
    );
    const request = createBroadcastContextRequest({
      sourceDurationMs: dummyRequest.sourceDurationMs,
      chapters: dummyRequest.chapters,
      candidates: dummyRequest.candidates,
      castRosterId: AMORETTO_CHANNEL_CAST_ROSTER_ID,
      participantGrounding,
      outputLanguage: "ko",
    });
    const payload = {
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "음식 토크를 진행하며 채팅과 의견을 주고받았다.",
            host: {
              name: "아모레또",
              profile: "채팅의 반응을 받아 음식 취향을 설명하고 자신의 실수를 바로 인정하는 진행을 보였다.",
              evidence: ["화면 참조와 채널 진행 역할이 일치함"],
              uncertainty: [],
            },
            themes: ["음식 토크"],
            chapters: [{
              s: "c1",
              e: "c2",
              title: "음식 토크",
              desc: "음식 취향을 두고 채팅과 대화한다.",
              kind: "main-event",
              sal: "primary",
            }],
            candidates: [{
              id: "can1",
              d: "select",
              c: "reaction",
              p: 0.9,
              reason: "채팅과의 반응이 완결된다.",
            }],
            leads: [],
          }),
        },
      }],
    };

    const parsed = extractBroadcastContextQwenOverviewResponse(payload, request);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.hostStreamerProfile?.displayNameKo).toBe("아모레또");
    }
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
      expect(body).not.toHaveProperty("max_tokens");
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

    it("requests English-only editorial narration when the session language is English", () => {
      const body = buildBroadcastContextQwenRequestBody({
        ...dummyRequest,
        outputLanguage: "en",
      });
      expect(body.messages[1].content).toContain("in English only");
      expect(body.messages[1].content).toContain("host profile");
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
      expect(body).not.toHaveProperty("max_tokens");
      expect(body.enable_thinking).toBe(model !== "qwen3.6-flash");
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
      expect(body).not.toHaveProperty("max_tokens");
      expect(body.enable_thinking).toBe(false);
      expect(body).not.toHaveProperty("thinking_budget");
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

    it("preserves a scheduled overview while isolating ungrounded candidates and malformed leads", () => {
      const scheduledRequest: BroadcastContextRequest = {
        ...dummyRequest,
        candidates: [],
      };
      const payload = {
        choices: [{ message: { content: JSON.stringify({
          summary: "음식 이름을 맞히며 채팅과 의견을 주고받고, 오답을 확인한 뒤 반응을 정리했다.",
          host: {
            name: null,
            profile: "음식 취향을 설명하고 채팅의 반박에 응수하며 결과를 확인한 뒤 판단을 정리한다.",
            evidence: ["음식 퀴즈 진행", "채팅 반응에 응수"],
            uncertainty: ["화면·목소리 인물 식별 근거 없음"],
          },
          themes: ["음식 퀴즈"],
          chapters: [{
            s: "c1",
            e: "c2",
            title: "음식 이름 맞히기",
            desc: "여러 음식을 구별하며 채팅과 답을 비교한다.",
            kind: "main-event",
            sal: "primary",
          }],
          // There were no input candidate IDs, so this volunteered verdict is
          // deliberately ignored instead of discarding the paid overview.
          candidates: [{
            id: "invented",
            d: "select",
            c: "reaction",
            p: 0.9,
            reason: "입력에 없는 후보",
          }],
          leads: [{
            s: "c1",
            e: "c1",
            c: "reaction",
            p: 0.4,
            event: "신뢰도 미달 항목",
            cue: "개별 격리 대상",
          }, {
            s: "c2",
            e: "c2",
            c: "reaction",
            p: 0.92,
            event: "오답을 확인하고 크게 반응한다.",
            cue: "정답 확인 뒤 반응",
          }],
        }) } }],
      };

      const parsed = extractBroadcastContextQwenOverviewResponse(
        payload,
        scheduledRequest,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.annotations).toEqual([]);
        expect(parsed.result.discoveredLeads).toHaveLength(1);
        expect(parsed.result.discoveredLeads[0]?.eventSummaryKo).toContain(
          "오답을 확인",
        );
      }
    });

    it("keeps a paid overview when a narrative field contains stray Han text", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "음식 퀴즈를 진행하다 突然 당황하고 실수를 인정했다.",
              host: {
                name: null,
                profile: "음식 퀴즈를 진행하며 채팅 반응에 응수하고 결과를 확인한 뒤 자신의 판단을 바로잡는다.",
                evidence: ["음식 퀴즈 진행", "채팅 반응에 응수"],
                uncertainty: ["화면·목소리 인물 식별 근거 없음"],
              },
              themes: ["음식과 反應"],
              chapters: [{
                s: "c1",
                e: "c2",
                title: "음식 퀴즈",
                desc: "음식 이름을 맞히며 채팅과 의견을 주고받는다.",
                kind: "main-event",
                sal: "primary",
              }],
              candidates: [{
                id: "can1",
                d: "select",
                c: "reaction",
                p: 0.91,
                reason: "예상 밖 結果에 반응했다.",
              }],
              leads: [],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenOverviewResponse(payload, dummyRequest);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result.broadcastSummaryKo).toContain("한글 표기 미확인");
        expect(parsed.result.annotations[0]?.contextSummaryKo).toContain(
          "한글 표기 미확인",
        );
        expect(JSON.stringify(parsed.result)).not.toMatch(/\p{Script=Han}/u);
      }
    });

    it("keeps an English session English-only when replacing stray Han text", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "The food quiz suddenly changed after 突然 confusion.",
              host: {
                name: null,
                profile: "The host runs a food quiz, responds to chat, and corrects a mistaken judgment after seeing the result.",
                evidence: ["Runs the food quiz", "Responds to chat"],
                uncertainty: ["No verified visual or voice identity"],
              },
              themes: ["food and 反應"],
              chapters: [{
                s: "c1",
                e: "c2",
                title: "Food quiz",
                desc: "The host compares food names and reactions with chat.",
                kind: "main-event",
                sal: "primary",
              }],
              candidates: [{
                id: "can1",
                d: "select",
                c: "reaction",
                p: 0.91,
                reason: "The host reacted to an unexpected 結果.",
              }],
              leads: [],
            }),
          },
        }],
      };

      const parsed = extractBroadcastContextQwenOverviewResponse(payload, {
        ...dummyRequest,
        outputLanguage: "en",
      });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const serialized = JSON.stringify(parsed.result);
        expect(serialized).toContain("wording not verified");
        expect(serialized).not.toContain("한글 표기 미확인");
        expect(serialized).not.toMatch(/\p{Script=Han}/u);
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
          host: {
            name: null,
            profile: "건축 목표를 설명하며 이동과 자원 수집 상황을 채팅에 전달하고 예상 밖 상황에는 크게 반응한다.",
            evidence: ["건축 목표 설명", "추락 뒤 상황 설명"],
            uncertainty: ["화면·목소리 인물 식별 근거 없음"],
          },
          themes: ["건축"],
          chapters: [{
            s: "c1",
            e: "c2",
            title: "건축과 동굴 이동",
            desc: "건축 자원을 모으고 동굴을 이동하는 일반적인 게임 진행이 이어진다.",
            kind: "story-progress",
            sal: "secondary",
          }],
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

    it("retries the whole overview unit instead of inventing a missing candidate verdict", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "음식 토크 전체 흐름",
              host: {
                name: null,
                profile: "음식 취향을 설명하고 채팅의 반박에 응수하며 결과를 확인한 뒤 판단을 정리한다.",
                evidence: ["음식 취향 설명", "채팅 반박에 응수"],
                uncertainty: ["인물 식별 근거 없음"],
              },
              themes: ["음식"],
              chapters: [{
                s: "c1",
                e: "c2",
                title: "음식 토크",
                desc: "음식 이름과 취향을 두고 채팅과 대화한다.",
                kind: "main-event",
                sal: "primary",
              }],
              candidates: [],
              leads: [],
            }),
          },
        }],
      };

      expect(
        extractBroadcastContextQwenOverviewResponse(payload, dummyRequest).ok,
      ).toBe(false);
    });

    it("retries discovery when any returned lead is malformed", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "주제 내부 사건 탐색",
              leads: [{
                s: "missing",
                e: "missing",
                c: "reaction",
                p: 0.9,
                event: "존재하지 않는 범위",
                cue: "잘못된 챕터",
              }],
            }),
          },
        }],
      };

      expect(
        extractBroadcastContextQwenDiscoveryResponse(payload, {
          ...dummyRequest,
          candidates: [],
        }).ok,
      ).toBe(false);
    });

    it("retries selection when one selected item violates the current schema", () => {
      const payload = {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "최종 심사",
              selected: [{
                id: "can1",
                p: 0.95,
              }],
            }),
          },
        }],
      };

      expect(
        extractBroadcastContextQwenSelectionResponse(payload, dummyRequest).ok,
      ).toBe(false);
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
                discoveredLeads: [],
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

    it("rejects the whole response when any required semantic chapter is malformed", () => {
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

      const parsed = extractBroadcastContextDeepseekResponse(
        payload,
        dummyRequest,
      );
      expect(parsed.ok).toBe(false);
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
                hostStreamerProfile: {
                  displayNameKo: null,
                  profileSummaryKo:
                    "방송을 주도하며 평범한 진행을 이어간 스트리머다.",
                  evidenceKo: ["방송 구간을 직접 진행했다."],
                  uncertaintiesKo: ["화면 근거로 이름은 확인하지 못했다."],
                },
                recurringThemesKo: [],
                semanticChapters: [],
                discoveredLeads: [],
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
                hostStreamerProfile: {
                  displayNameKo: null,
                  profileSummaryKo:
                    "차분하게 목표를 수행하고 결과를 확인하는 진행자다.",
                  evidenceKo: ["목표 달성과 결과 확인을 직접 설명했다."],
                  uncertaintiesKo: ["화면 근거로 이름은 확인하지 못했다."],
                },
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

    it("rejects missing candidate judgments and malformed discovered leads", () => {
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

      const parsed = extractBroadcastContextDeepseekResponse(
        payload,
        dummyRequest,
      );
      expect(parsed.ok).toBe(false);
    });
  });
});
