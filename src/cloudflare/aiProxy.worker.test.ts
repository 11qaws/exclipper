import { describe, expect, it, vi } from "vitest";
import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "../analysis/participantRoster";
import {
  handleBroadcastTranscriptRequest,
  handleBroadcastContextRequest,
  handleCandidateInsightRequest,
  handleYouTubeCaptionsRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";

const ENDPOINT = "https://rettohighlight-gemini.example/v1/candidate-insights";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";
const API_KEY = "test-secret-key-that-must-never-be-returned";

function createEnvironment(): AiProxyEnvironment {
  return {
    GEMINI_API_KEY: API_KEY,
    RATE_LIMITER: {
      limit: vi.fn(() => Promise.resolve({ success: true })),
    },
    IP_RATE_LIMITER: {
      limit: vi.fn(() => Promise.resolve({ success: true })),
    },
  };
}

function createCandidateBody(candidateDurationMs = 1_000): {
  readonly audioBase64: string;
  readonly candidateDurationMs: number;
  readonly videoFrames: readonly [
    { readonly timestampMs: number; readonly mimeType: "image/jpeg"; readonly dataBase64: string },
    { readonly timestampMs: number; readonly mimeType: "image/jpeg"; readonly dataBase64: string },
  ];
} {
  const sampleCount = Math.ceil(
    (candidateDurationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  const wav = encodeCandidatePassBPcm16Wav(
    new Float32Array(sampleCount),
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return {
    audioBase64: encodeCandidatePassBBase64(wav),
    candidateDurationMs,
    videoFrames: [
      { timestampMs: 100, mimeType: "image/jpeg", dataBase64: "aGVsbG8=" },
      {
        timestampMs: Math.max(101, candidateDurationMs - 100),
        mimeType: "image/jpeg",
        dataBase64: "d29ybGQ=",
      },
    ],
  };
}

function createRequest(
  body: unknown,
  options: {
    readonly method?: string;
    readonly origin?: string | null;
    readonly contentType?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly url?: string;
  } = {},
): Request {
  const headers = new Headers(options.headers);
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? PRODUCTION_ORIGIN);
  }
  if (options.contentType !== "") {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const init: RequestInit = {
    method: options.method ?? "POST",
    headers,
  };
  if (options.method !== "OPTIONS" && options.method !== "GET") {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(options.url ?? ENDPOINT, init);
}

function createGeminiPayload(candidateDurationMs = 1_000): unknown {
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                segments: [
                  {
                    relativeStartMs: 0,
                    relativeEndMs: Math.min(500, candidateDurationMs),
                    text: "정말 놀랐어",
                  },
                ],
                eventSummaryKo: "큰 소리 뒤에 짧은 말이 들려요.",
                reactionSummaryKo: "목소리가 갑자기 커지는 반응이 들려요.",
                whyGoodClipKo: "반응 변화가 뚜렷해 먼저 확인할 만해요.",
                uncertaintiesKo: ["화면을 보지 않아 정확한 사건은 알 수 없어요."],
                identifiedParticipants: [],
              }),
            },
          ],
        },
      },
    ],
  };
}

function createQwenSsePayload(candidateDurationMs = 1_000): string {
  const payload = createGeminiPayload(candidateDurationMs) as {
    candidates: readonly [{ content: { parts: readonly [{ text: string }] } }];
  };
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload.candidates[0].content.parts[0].text }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

async function responseErrorCode(response: Response): Promise<string> {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("aiProxy.worker", () => {
  it("fetches a fixed-host Korean YouTube caption track", async () => {
    const player = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            languageCode: "ko",
            kind: "asr",
            baseUrl: "https://www.youtube.com/api/timedtext?v=KzAW3yow80Q&lang=ko",
          }],
        },
      },
    };
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify(player),
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        events: [{
          tStartMs: 1_000,
          dDurationMs: 2_000,
          segs: [{ utf8: "제가 틀렸어요" }],
        }],
      }), { status: 200 }));
    const environment = createEnvironment();
    const response = await handleYouTubeCaptionsRequest(
      createRequest(undefined, {
        method: "GET",
        url: "https://rettohighlight-gemini.example/v1/youtube-captions?v=KzAW3yow80Q",
      }),
      environment,
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      videoId: "KzAW3yow80Q",
      languageCode: "ko",
      isAutoGenerated: true,
      events: [{ startMs: 1_000, durationMs: 2_000, text: "제가 틀렸어요" }],
    });
    expect(String(upstreamFetch.mock.calls[0]?.[0])).toContain("youtubei/v1/player");
    expect(upstreamFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(String(upstreamFetch.mock.calls[1]?.[0])).toContain("fmt=json3");
  });

  it("reasons over whole-broadcast context through Qwen 3.7 Plus", async () => {
    const contextInput = {
      sourceDurationMs: 60_000,
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      chapters: [
        {
          chapterId: "chapter-1",
          startMs: 0,
          endMs: 60_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "스트리머가 실수를 인정하고 정확히 사과했다.",
        },
      ],
      candidates: [
        {
          candidateId: "candidate-1",
          startMs: 10_000,
          endMs: 55_000,
          transcriptKo: "제가 실수했습니다. 죄송합니다.",
          eventSummaryKo: "실수를 인정했다.",
          reactionSummaryKo: "차분하게 사과했다.",
          chatReactionSummaryKo: null,
        },
      ],
    };
    const providerResult = {
      summary: "실수의 경위를 설명하고 사과한 방송이다.",
      themes: ["사과"],
      leads: [],
      candidates: [
        {
          id: "candidate-1",
          c: "apology-accountability",
          d: "select",
          p: 0.95,
          reason: "잘못을 직접 인정했다.",
        },
      ],
    };
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a serialized Qwen context request.");
        }
        const body = JSON.parse(init.body) as Record<string, unknown>;
        expect(body.model).toBe("qwen3.7-plus");
        expect(body.enable_thinking).toBe(true);
        expect(body.thinking_budget).toBe(768);
        expect(body.max_tokens).toBe(3_072);
        expect(body.response_format).toEqual({ type: "json_object" });
        expect(body).not.toHaveProperty("thinking");
        const messages = body.messages as Array<{ content?: string }>;
        expect(messages[1]?.content).toContain("세라 교수님");
        expect(messages[1]?.content).toContain("토로리 코코");
        expect(messages[1]?.content).toContain("목소리 느낌만으로 발화자를 정하거나");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(providerResult) } }],
              usage: {
                prompt_tokens: 1_234,
                completion_tokens: 321,
                total_tokens: 1_555,
              },
            }),
            { status: 200 },
          ),
        );
      },
    );
    const environment: AiProxyEnvironment = {
      ...createEnvironment(),
      BROADCAST_CONTEXT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
      QWEN_REGION: "singapore",
    };
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
        headers: { "CF-Connecting-IP": "203.0.113.42" },
      }),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      broadcastSummaryKo: providerResult.summary,
      annotations: [expect.objectContaining({ clipDecision: "select" })],
    });
    expect(environment.IP_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "broadcast-context:203.0.113.42",
    });
    expect(environment.RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "broadcast-context",
    });
    expect(response.headers.get("X-ExClipper-Usage-Prompt-Tokens")).toBe("1234");
    expect(response.headers.get("X-ExClipper-Usage-Completion-Tokens")).toBe("321");
    expect(response.headers.get("X-ExClipper-Usage-Total-Tokens")).toBe("1555");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-ExClipper-Usage-Total-Tokens",
    );
  });

  it("rejects an arbitrary whole-context roster before any paid call", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastContextRequest(
      createRequest(
        {
          sourceDurationMs: 60_000,
          castRosterId: "user-authored-roster",
          chapters: [{
            chapterId: "chapter-1",
            startMs: 0,
            endMs: 60_000,
            evidenceMode: "complete-transcript",
            evidenceCoverageRatio: 1,
            summaryKo: "방송 내용을 설명했다.",
          }],
          candidates: [],
        },
        { url: "https://rettohighlight-gemini.example/v1/broadcast-context" },
      ),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(400);
    expect(await responseErrorCode(response)).toBe("INVALID_REQUEST");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("falls back once from Qwen 3.7 Plus to Qwen 3.6 Flash for text context", async () => {
    const contextInput = {
      sourceDurationMs: 60_000,
      chapters: [
        {
          chapterId: "chapter-1",
          startMs: 0,
          endMs: 60_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "스트리머가 조용히 목표를 달성하고 기뻐했다.",
        },
      ],
      candidates: [
        {
          candidateId: "candidate-1",
          startMs: 5_000,
          endMs: 50_000,
          transcriptKo: "드디어 성공했어.",
          eventSummaryKo: "목표를 달성했다.",
          reactionSummaryKo: "작게 웃으며 안도했다.",
          chatReactionSummaryKo: null,
        },
      ],
    };
    const providerResult = {
      summary: "오랜 시도 끝에 조용히 목표를 달성했다.",
      themes: ["조용한 성취"],
      leads: [],
      candidates: [
        {
          id: "candidate-1",
          c: "quiet-achievement",
          d: "select",
          p: 0.91,
          reason: "성공의 맥락과 반응이 함께 확인된다.",
        },
      ],
    };
    const attemptedModels: string[] = [];
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { model: string };
        attemptedModels.push(body.model);
        if (body.model === "qwen3.7-plus") {
          return Promise.resolve(new Response("temporary", { status: 503 }));
        }
        expect(body.model).toBe("qwen3.6-flash");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(providerResult) } }],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
      }),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      broadcastSummaryKo: providerResult.summary,
    });
    expect(attemptedModels).toEqual(["qwen3.7-plus", "qwen3.6-flash"]);
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(
      "qwen3.6-flash",
    );
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBe("true");
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe(
      "unavailable",
    );
  });

  it("does not pay for a second context model when the shared input is invalid", async () => {
    const contextInput = {
      sourceDurationMs: 60_000,
      chapters: [{
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 60_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "스트리머가 방송 내용을 차분하게 설명했다.",
      }],
      candidates: [{
        candidateId: "candidate-1",
        startMs: 5_000,
        endMs: 50_000,
        transcriptKo: "오늘 있었던 일을 설명할게요.",
        eventSummaryKo: "방송 중 있었던 일을 설명했다.",
        reactionSummaryKo: "차분한 목소리로 정리했다.",
        chatReactionSummaryKo: null,
      }],
    };
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              status: "INVALID_ARGUMENT",
              message: "The shared request argument is invalid.",
            },
          }),
          { status: 400 },
        ),
      ),
    );
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
      }),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(502);
    expect(await responseErrorCode(response)).toBe("UPSTREAM_REJECTED");
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBeNull();
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("uses Qwen 3.6 Flash for bounded topic discovery", async () => {
    const contextInput = {
      sourceDurationMs: 120_000,
      chapters: [{
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 120_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "두바이 초콜릿 모양을 두고 강하게 항변한다.",
      }],
      candidates: [],
      analysisMode: "discovery",
    };
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { model: string; max_tokens: number };
        expect(body.model).toBe("qwen3.6-flash");
        expect(body.max_tokens).toBe(2_048);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    summary: "초콜릿 항변",
                    leads: [{
                      s: "chapter-1",
                      e: "chapter-1",
                      c: "reaction",
                      p: 0.82,
                      event: "초콜릿 모양을 두고 항변한다.",
                      cue: "초콜릿한테 대한 모욕이야",
                    }],
                  }),
                },
              }],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
      }),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      discoveredLeads: [expect.objectContaining({ confidence: 0.82 })],
    });
  });

  it.each([
    {
      label: "jury-approved fast localization",
      analysisMode: "refinement-fast",
      modelId: "qwen3.6-flash",
      modelRevision: "qwen3.6-flash-caption-refinement-speed-v1-2026-07-22",
    },
    {
      label: "quality-gated reserve adjudication",
      analysisMode: "refinement",
      modelId: "qwen3.7-plus",
      modelRevision: "qwen3.7-plus-caption-refinement-quality-v1-2026-07-22",
    },
  ] as const)("uses the bounded Qwen tier for $label", async ({
    analysisMode,
    modelId,
    modelRevision,
  }) => {
    const contextInput = {
      sourceDurationMs: 120_000,
      chapters: [{
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 120_000,
        evidenceMode: "complete-transcript",
        evidenceCoverageRatio: 1,
        summaryKo: "칼국수 이름을 틀린 뒤 강하게 항변한다.",
      }],
      candidates: [],
      analysisMode,
    };
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { model: string; max_tokens: number };
        expect(body.model).toBe(modelId);
        expect(body.max_tokens).toBe(1_024);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    summary: "칼국수 오답 항변",
                    leads: [{
                      s: "chapter-1",
                      e: "chapter-1",
                      c: "reaction",
                      p: 0.91,
                      event: "칼국수 이름을 틀리고 항변한다.",
                      cue: "내가 틀린 게 아니야",
                    }],
                  }),
                },
              }],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
      }),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      discoveredLeads: [expect.objectContaining({ confidence: 0.91 })],
    });
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(modelId);
    expect(response.headers.get("X-ExClipper-Model-Revision")).toBe(
      modelRevision,
    );
  });

  it("uses Qwen 3.7 Plus for the final abstention-sensitive editorial jury", async () => {
    const contextInput = {
      sourceDurationMs: 120_000,
      chapters: [{
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 120_000,
        evidenceMode: "candidate-context-only",
        evidenceCoverageRatio: 1,
        summaryKo: "평범한 게임 건축 진행 구간",
      }],
      candidates: [{
        candidateId: "candidate-1",
        startMs: 30_000,
        endMs: 90_000,
        transcriptKo: "재료가 부족해서 다시 모으러 간다.",
        eventSummaryKo: "흔한 자원 부족",
        reactionSummaryKo: "잠깐 당황한 뒤 진행을 계속한다.",
        chatReactionSummaryKo: null,
      }],
      analysisMode: "selection",
    };
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { model: string };
        expect(body.model).toBe("qwen3.7-plus");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    summary: "독립적인 클립 가치가 없어 기권",
                    selected: [],
                  }),
                },
              }],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const response = await handleBroadcastContextRequest(
      createRequest(contextInput, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-context",
      }),
      {
        ...createEnvironment(),
        BROADCAST_CONTEXT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      annotations: [expect.objectContaining({ clipDecision: "reject" })],
    });
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe("qwen3.7-plus");
  });

  it("transcribes a bounded broadcast chunk through the fixed Qwen Omni adapter", async () => {
    const durationMs = 1_000;
    const candidate = createCandidateBody(durationMs);
    const body = {
      audioBase64: candidate.audioBase64,
      sourceStartMs: 600_000,
      durationMs,
    };
    const upstreamFetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        );
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer qwen-secret",
        );
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a serialized Qwen request body.");
        }
        const requestBody = JSON.parse(init.body) as {
          model: string;
          messages: readonly [{ content: readonly [{ input_audio: { data: string } }] }];
          modalities: readonly string[];
          stream: boolean;
        };
        expect(requestBody.model).toBe("qwen3.5-omni-flash");
        expect(requestBody.messages[0].content[0].input_audio.data).toBe(
          `data:;base64,${candidate.audioBase64}`,
        );
        expect(requestBody.modalities).toEqual(["text"]);
        expect(requestBody.stream).toBe(true);
        return Promise.resolve(
          new Response(
            [
              `data: ${JSON.stringify({ choices: [{ delta: { content: "칼국수 이야기를 하며 웃는다." }, finish_reason: null }] })}`,
              `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] })}`,
              "data: [DONE]",
              "",
            ].join("\n\n"),
            { status: 200 },
          ),
        );
      },
    );
    const environment: AiProxyEnvironment = {
      ...createEnvironment(),
      BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
      QWEN_API_KEY: "qwen-secret",
    };
    const response = await handleBroadcastTranscriptRequest(
      createRequest(body, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-transcript",
        headers: { "CF-Connecting-IP": "203.0.113.42" },
      }),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modelId: "qwen3.5-omni-flash",
      sourceStartMs: 600_000,
      sourceEndMs: 601_000,
      textKo: "칼국수 이야기를 하며 웃는다.",
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: null,
    });
    expect(environment.IP_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "broadcast-transcript:203.0.113.42",
    });
    expect(environment.RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "broadcast-transcript",
    });
  });

  it("uses Gemini once when Qwen transcript returns an explicit temporary failure", async () => {
    const durationMs = 1_000;
    const candidate = createCandidateBody(durationMs);
    const body = {
      audioBase64: candidate.audioBase64,
      sourceStartMs: 600_000,
      durationMs,
    };
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{
              finishReason: "STOP",
              content: {
                parts: [{ text: JSON.stringify({ textKo: "세라 교수님이 결과를 설명했다." }) }],
              },
            }],
          }),
          { status: 200 },
        ),
      );
    const response = await handleBroadcastTranscriptRequest(
      createRequest(body, {
        url: "https://rettohighlight-gemini.example/v1/broadcast-transcript",
      }),
      {
        ...createEnvironment(),
        BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modelId: "gemini-3.6-flash",
      textKo: "세라 교수님이 결과를 설명했다.",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    const fallbackInput = upstreamFetch.mock.calls[1]?.[0];
    const fallbackUrl = typeof fallbackInput === "string"
      ? fallbackInput
      : fallbackInput instanceof URL
        ? fallbackInput.toString()
        : fallbackInput?.url ?? "";
    expect(fallbackUrl).toContain("/models/gemini-3.6-flash:generateContent");
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBe("true");
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe(
      "server-error",
    );
  });

  it("does not replay duration-billed transcript work after an ambiguous timeout", async () => {
    const durationMs = 1_000;
    const candidate = createCandidateBody(durationMs);
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const response = await handleBroadcastTranscriptRequest(
      createRequest(
        {
          audioBase64: candidate.audioBase64,
          sourceStartMs: 0,
          durationMs,
        },
        { url: "https://rettohighlight-gemini.example/v1/broadcast-transcript" },
      ),
      {
        ...createEnvironment(),
        BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamTimeoutMs: 1 },
    );
    expect(response.status).toBe(504);
    expect(await responseErrorCode(response)).toBe("UPSTREAM_TIMEOUT");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("logs only a bounded provider code when Qwen rejects transcript work", async () => {
    const durationMs = 1_000;
    const candidate = createCandidateBody(durationMs);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleBroadcastTranscriptRequest(
      createRequest(
        {
          audioBase64: candidate.audioBase64,
          sourceStartMs: 0,
          durationMs,
        },
        { url: "https://rettohighlight-gemini.example/v1/broadcast-transcript" },
      ),
      {
        ...createEnvironment(),
        BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                code: "Model.AccessDenied",
                message: "private upstream detail",
              }),
              { status: 400 },
            ),
          ),
      },
    );

    expect(response.status).toBe(502);
    expect(consoleError).toHaveBeenCalledWith(
      "broadcast_transcript_upstream_rejected",
      { status: 400, providerCode: "Model.AccessDenied" },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private upstream detail");
    consoleError.mockRestore();
  });

  it("rejects an overlong transcript chunk with structured JSON before upstream work", async () => {
    const candidate = createCandidateBody(1_000);
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      createRequest(
        {
          audioBase64: candidate.audioBase64,
          sourceStartMs: 0,
          durationMs: 90_001,
        },
        { url: "https://rettohighlight-gemini.example/v1/broadcast-transcript" },
      ),
      {
        ...createEnvironment(),
        BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(400);
    expect(await responseErrorCode(response)).toBe("INVALID_REQUEST");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("reports health without disclosing configuration or calling Gemini", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleCandidateInsightRequest(
      new Request("https://rettohighlight-gemini.example/healthz"),
      { ...createEnvironment(), GEMINI_API_KEY: "" },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      service: "rettohighlight-gemini",
      version: 2,
      routingPolicyVersion: "1.11.0",
      contextModelRevision:
        "qwen3.7-plus-context-editorial-jury-topic-balanced-2026-07-22",
      providers: {
        schemaVersion: "1.2.0",
        geminiRoutes: {
          candidateInsightConfigured: false,
          broadcastTranscriptConfigured: false,
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain(API_KEY);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("answers an allowed production preflight without invoking Gemini", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleCandidateInsightRequest(
      createRequest(null, { method: "OPTIONS", contentType: "" }),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "content-type",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("allows localhost development origins but rejects lookalike and missing origins", async () => {
    const localhost = await handleCandidateInsightRequest(
      createRequest(null, {
        method: "OPTIONS",
        origin: "http://localhost:5173",
        contentType: "",
      }),
      createEnvironment(),
    );
    expect(localhost.status).toBe(204);
    expect(localhost.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );

    for (const origin of ["https://11qaws.github.io.evil.test", null]) {
      const response = await handleCandidateInsightRequest(
        createRequest(createCandidateBody(), { origin }),
        createEnvironment(),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("rejects unsupported paths, methods, and content types before upstream work", async () => {
    const upstreamFetch = vi.fn();
    const dependencies = { fetchImplementation: upstreamFetch };

    const wrongPath = await handleCandidateInsightRequest(
      createRequest(createCandidateBody(), {
        url: "https://rettohighlight-gemini.example/v1/other",
      }),
      createEnvironment(),
      dependencies,
    );
    expect(wrongPath.status).toBe(404);

    const wrongMethod = await handleCandidateInsightRequest(
      createRequest(null, { method: "GET", contentType: "" }),
      createEnvironment(),
      dependencies,
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("POST, OPTIONS");

    const wrongType = await handleCandidateInsightRequest(
      createRequest("payload", { contentType: "text/plain" }),
      createEnvironment(),
      dependencies,
    );
    expect(wrongType.status).toBe(415);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("accepts only the exact request schema and a matching canonical 16kHz mono WAV", async () => {
    const valid = createCandidateBody();
    const environment = createEnvironment();
    const cases: readonly unknown[] = [
      { ...valid, extra: true },
      { audioBase64: valid.audioBase64 },
      { ...valid, candidateDurationMs: 60_001 },
      { ...valid, candidateDurationMs: 999 },
      { ...valid, audioBase64: "AAAA" },
      { ...valid, audioBase64: "not-base64" },
      {
        ...valid,
        castRosterId: "arbitrary-public-roster",
      },
    ];
    for (const body of cases) {
      const response = await handleCandidateInsightRequest(
        createRequest(body),
        environment,
      );
      expect(response.status).toBe(400);
    }
    expect(environment.RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(environment.IP_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body before reading it", async () => {
    const response = await handleCandidateInsightRequest(
      createRequest(createCandidateBody(), {
        headers: { "Content-Length": "99999999" },
      }),
      createEnvironment(),
    );
    expect(response.status).toBe(413);
    expect(await responseErrorCode(response)).toBe("PAYLOAD_TOO_LARGE");
  });

  it("constructs the fixed Gemini request server-side and returns a validated envelope", async () => {
    const candidate = createCandidateBody();
    const geminiPayload = createGeminiPayload(candidate.candidateDurationMs);
    const upstreamFetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        );
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(API_KEY);
        expect(init?.credentials).toBe("omit");
        expect(init?.cache).toBe("no-store");
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a serialized Gemini request body.");
        }
        const body = JSON.parse(init.body) as {
          store: boolean;
          contents: readonly [
            {
              parts: readonly [
                { text: string },
                { inlineData: { mimeType: string; data: string } },
              ];
            },
          ];
          generationConfig: {
            thinkingConfig: { thinkingLevel: string };
            maxOutputTokens: number;
          };
        };
        expect(body.store).toBe(false);
        expect(body.contents[0].parts[0].text.length).toBeGreaterThan(100);
        expect(body.contents[0].parts[1].inlineData).toEqual({
          mimeType: "audio/wav",
          data: candidate.audioBase64,
        });
        expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("MEDIUM");
        expect(body.generationConfig.maxOutputTokens).toBe(4_096);
        return Promise.resolve(
          new Response(JSON.stringify(geminiPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );

    const environment = createEnvironment();
    const response = await handleCandidateInsightRequest(
      createRequest(candidate, {
        headers: { "CF-Connecting-IP": "203.0.113.42" },
      }),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(geminiPayload);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(environment.RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "candidate-insights",
    });
    expect(environment.IP_RATE_LIMITER.limit).toHaveBeenCalledWith({
      key: "candidate-insights:203.0.113.42",
    });
  });

  it("fails closed when the secret is unavailable", async () => {
    const missingSecret = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      { ...createEnvironment(), GEMINI_API_KEY: "" },
    );
    expect(missingSecret.status).toBe(503);
    expect(await responseErrorCode(missingSecret)).toBe("PROXY_NOT_CONFIGURED");
  });

  it("analyzes candidate audio through the active Qwen Omni adapter", async () => {
    const candidate = createCandidateBody();
    const geminiPayload = createGeminiPayload(candidate.candidateDurationMs) as {
      candidates: readonly [{ content: { parts: readonly [{ text: string }] } }];
    };
    const analysisText = geminiPayload.candidates[0].content.parts[0].text;
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: analysisText }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const upstreamFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe(
        "https://workspace-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer qwen-secret");
      if (typeof init?.body !== "string") {
        throw new TypeError("Expected a serialized Qwen request body.");
      }
      const body = JSON.parse(init.body) as {
        model: string;
        stream: boolean;
        modalities: readonly string[];
      };
      expect(body).toMatchObject({
        model: "qwen3.5-omni-flash",
        stream: true,
        modalities: ["text"],
      });
      return Promise.resolve(new Response(sse, { status: 200 }));
    });
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
        QWEN_WORKSPACE_ID: "workspace-123",
      },
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    const responsePayload = await response.json() as typeof geminiPayload;
    expect(
      JSON.parse(responsePayload.candidates[0].content.parts[0].text),
    ).toEqual({
      ...JSON.parse(analysisText),
      identifiedParticipants: [],
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("accepts only the built-in closed roster identifier", async () => {
    const valid = createCandidateBody();
    const qwenPayload = createQwenSsePayload(valid.candidateDurationMs);
    let upstreamRequestBody = "";
    const upstreamFetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        upstreamRequestBody = typeof init?.body === "string" ? init.body : "";
        return Promise.resolve(new Response(qwenPayload, { status: 200 }));
      },
    );
    const response = await handleCandidateInsightRequest(
      createRequest({
        ...valid,
        castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      }),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(upstreamRequestBody).toContain("아모레또");
    expect(upstreamRequestBody).toContain("두 가지 이상");
  });

  it("removes visual and causal claims from a successful provider response when no frame arrived", async () => {
    const candidateWithFrames = createCandidateBody();
    const candidate = { ...candidateWithFrames, videoFrames: [] };
    const inventedAnalysis = JSON.stringify({
      segments: [
        {
          relativeStartMs: 100,
          relativeEndMs: 700,
          text: "내가 두바이 초콜릿을 안 먹어",
        },
      ],
      eventSummaryKo: "게임에서 아이템을 잘못 골라 공격에 실패했다.",
      reactionSummaryKo: "화면의 캐릭터를 보며 당황했다.",
      whyGoodClipKo: "게임 화면과 반응의 인과가 뚜렷하다.",
      uncertaintiesKo: [],
      identifiedParticipants: [
        {
          nameKo: "유레카",
          roleKo: "스트리머",
          evidenceBasis: "on-screen-label",
          evidenceKo: "화면에 이름이 보였다.",
          confidence: 0.9,
          relativeTimestampMs: 300,
        },
      ],
    });
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: inventedAnalysis }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: () => Promise.resolve(new Response(sse, { status: 200 })) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      candidates: readonly [{ content: { parts: readonly [{ text: string }] } }];
    };
    const safeAnalysis = JSON.parse(payload.candidates[0].content.parts[0].text) as {
      eventSummaryKo: string;
      reactionSummaryKo: string;
      whyGoodClipKo: string;
      segments: readonly { text: string }[];
      identifiedParticipants: readonly unknown[];
    };
    expect(safeAnalysis.segments[0]?.text).toBe("내가 두바이 초콜릿을 안 먹어");
    expect(safeAnalysis.eventSummaryKo).toContain("대표 화면을 확보하지 못해");
    expect(safeAnalysis.reactionSummaryKo).not.toContain("캐릭터");
    expect(safeAnalysis.whyGoodClipKo).not.toContain("게임 화면");
    expect(safeAnalysis.identifiedParticipants).toEqual([]);
  });

  it("uses one bounded Gemini fallback when Qwen candidate perception fails", async () => {
    const candidate = createCandidateBody();
    const geminiPayload = createGeminiPayload(candidate.candidateDurationMs);
    const upstreamFetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("dashscope-intl.aliyuncs.com")) {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            "Bearer qwen-secret",
          );
          return Promise.resolve(
            new Response("temporary qwen failure", { status: 503 }),
          );
        }
        expect(url).toContain("models/gemini-3.6-flash:generateContent");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(API_KEY);
        return Promise.resolve(
          new Response(JSON.stringify(geminiPayload), { status: 200 }),
        );
      },
    );
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(geminiPayload);
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(
      "gemini-3.6-flash",
    );
    expect(response.headers.get("X-ExClipper-Model-Revision")).toBe(
      "gemini-3.6-flash-grounded-frames-cast-v5-2026-07-22",
    );
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBe("true");
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe(
      "unavailable",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-ExClipper-Model-Id",
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("starts with the configured alternate when the selected provider credential is missing", async () => {
    const candidate = createCandidateBody();
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(
        new Response(createQwenSsePayload(candidate.candidateDurationMs), {
          status: 200,
        }),
      ),
    );
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        GEMINI_API_KEY: "",
        CANDIDATE_INSIGHT_PROVIDER: "gemini",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(
      "qwen3.5-omni-flash",
    );
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBe("true");
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe("auth");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a deterministic invalid-argument failure on another provider", async () => {
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              status: "INVALID_ARGUMENT",
              message: "candidate duration is invalid",
            },
          }),
          { status: 400 },
        ),
      ),
    );
    const response = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(502);
    expect(await responseErrorCode(response)).toBe("UPSTREAM_INVALID_ARGUMENT");
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBeNull();
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("uses a different provider for a temporary rate-limit failure", async () => {
    const candidate = createCandidateBody();
    const geminiPayload = createGeminiPayload(candidate.candidateDurationMs);
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(geminiPayload), { status: 200 }),
      );
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-ExClipper-Fallback-Used")).toBe("true");
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe(
      "rate-limited",
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back when the selected provider does not expose the configured model", async () => {
    const candidate = createCandidateBody();
    const qwenPayload = createQwenSsePayload(candidate.candidateDurationMs);
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("missing model", { status: 404 }))
      .mockResolvedValueOnce(new Response(qwenPayload, { status: 200 }));
    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "gemini",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(
      "qwen3.5-omni-flash",
    );
    expect(response.headers.get("X-ExClipper-Fallback-Reason")).toBe(
      "model-unavailable",
    );
  });

  it("reports both bounded failure classes without exposing provider bodies", async () => {
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("primary private", { status: 503 }))
      .mockResolvedValueOnce(new Response("fallback private", { status: 429 }));
    const response = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        AI_PROVIDER_FALLBACK_MODE: "bounded",
        QWEN_API_KEY: "qwen-secret",
      },
      { fetchImplementation: upstreamFetch, upstreamRetryDelaysMs: [] },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("X-ExClipper-Primary-Failure")).toBe(
      "unavailable",
    );
    expect(response.headers.get("X-ExClipper-Fallback-Failure")).toBe(
      "rate-limited",
    );
    expect(await response.text()).not.toContain("private");
  });

  it.each([
    { label: "client", clientSuccess: false, globalSuccess: true },
    { label: "global", clientSuccess: true, globalSuccess: false },
  ])(
    "stops before Gemini when the $label rate limit is exhausted",
    async ({ clientSuccess, globalSuccess }) => {
      const environment = createEnvironment();
      vi.mocked(environment.IP_RATE_LIMITER.limit).mockResolvedValueOnce({
        success: clientSuccess,
      });
      vi.mocked(environment.RATE_LIMITER.limit).mockResolvedValueOnce({
        success: globalSuccess,
      });
      const upstreamFetch = vi.fn();

      const response = await handleCandidateInsightRequest(
        createRequest(createCandidateBody()),
        environment,
        { fetchImplementation: upstreamFetch },
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(environment.IP_RATE_LIMITER.limit).toHaveBeenCalledTimes(1);
      expect(environment.RATE_LIMITER.limit).toHaveBeenCalledTimes(
        clientSuccess ? 1 : 0,
      );
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it("times out the upstream request and exposes neither the key nor upstream errors", async () => {
    const timeoutFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const timeoutResponse = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      createEnvironment(),
      { fetchImplementation: timeoutFetch, upstreamTimeoutMs: 5 },
    );
    expect(timeoutResponse.status).toBe(504);

    const rawUpstreamError = "private upstream detail";
    const rejectedResponse = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      createEnvironment(),
      {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(`${rawUpstreamError} ${API_KEY}`, { status: 400 }),
          ),
      },
    );
    const safeText = await rejectedResponse.text();
    expect(rejectedResponse.status).toBe(502);
    expect(safeText).not.toContain(rawUpstreamError);
    expect(safeText).not.toContain(API_KEY);
  });

  it("maps a transient upstream service failure without exposing its body", async () => {
    const providerBody = `private transient detail ${API_KEY}`;
    const response = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      createEnvironment(),
      {
        fetchImplementation: () =>
          Promise.resolve(new Response(providerBody, { status: 503 })),
        upstreamRetryDelaysMs: [],
      },
    );

    const text = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "UPSTREAM_UNAVAILABLE" },
    });
    expect(text).not.toContain(providerBody);
    expect(text).not.toContain(API_KEY);
  });

  it("retries a transient upstream failure and returns the next valid response", async () => {
    const candidate = createCandidateBody();
    const geminiPayload = createGeminiPayload(candidate.candidateDurationMs);
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(geminiPayload), { status: 200 }),
      );

    const response = await handleCandidateInsightRequest(
      createRequest(candidate),
      createEnvironment(),
      {
        fetchImplementation: upstreamFetch,
        upstreamRetryDelaysMs: [0],
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(geminiPayload);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "an API-key rejection",
      upstreamError: {
        error: {
          status: "INVALID_ARGUMENT",
          message: "API key not valid. Please pass a valid API key.",
        },
      },
      expectedStatus: 503,
      expectedCode: "PROXY_NOT_CONFIGURED",
    },
    {
      label: "a response-format rejection",
      upstreamError: {
        error: {
          status: "INVALID_ARGUMENT",
          message: "responseFormat text mimeType or schema is invalid",
        },
      },
      expectedStatus: 502,
      expectedCode: "UPSTREAM_RESPONSE_FORMAT_REJECTED",
    },
    {
      label: "another invalid argument",
      upstreamError: {
        error: {
          status: "INVALID_ARGUMENT",
          message: "The submitted request argument is not supported.",
        },
      },
      expectedStatus: 502,
      expectedCode: "UPSTREAM_INVALID_ARGUMENT",
    },
  ])(
    "classifies $label without returning the provider message",
    async ({ upstreamError, expectedStatus, expectedCode }) => {
      const response = await handleCandidateInsightRequest(
        createRequest(createCandidateBody()),
        createEnvironment(),
        {
          fetchImplementation: () =>
            Promise.resolve(
              new Response(JSON.stringify(upstreamError), { status: 400 }),
            ),
        },
      );
      const text = await response.text();
      expect(response.status).toBe(expectedStatus);
      expect(JSON.parse(text)).toMatchObject({
        error: { code: expectedCode },
      });
      expect(text).not.toContain(upstreamError.error.message);
      expect(text).not.toContain(API_KEY);
    },
  );

  it.each(["client", "global"] as const)(
    "fails closed when the %s rate-limit binding cannot answer",
    async (binding) => {
      const environment = createEnvironment();
      const target =
        binding === "client"
          ? environment.IP_RATE_LIMITER
          : environment.RATE_LIMITER;
      vi.mocked(target.limit).mockRejectedValueOnce(
        new Error("private limiter failure"),
      );
      const upstreamFetch = vi.fn();

      const response = await handleCandidateInsightRequest(
        createRequest(createCandidateBody()),
        environment,
        { fetchImplementation: upstreamFetch },
      );

      expect(response.status).toBe(503);
      expect(await responseErrorCode(response)).toBe("RATE_LIMIT_UNAVAILABLE");
      expect(environment.IP_RATE_LIMITER.limit).toHaveBeenCalledTimes(1);
      expect(environment.RATE_LIMITER.limit).toHaveBeenCalledTimes(
        binding === "global" ? 1 : 0,
      );
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized or malformed successful Gemini responses", async () => {
    const oversized = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      createEnvironment(),
      {
        fetchImplementation: () =>
          Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "Content-Length": "99999999" },
            }),
          ),
      },
    );
    expect(oversized.status).toBe(502);

    const malformed = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      createEnvironment(),
      {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
          ),
      },
    );
    expect(malformed.status).toBe(502);
    expect(await responseErrorCode(malformed)).toBe(
      "UPSTREAM_INVALID_RESPONSE",
    );
  });
});
