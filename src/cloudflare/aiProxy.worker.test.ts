import { describe, expect, it, vi } from "vitest";
import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import {
  handleCandidateInsightRequest,
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
              }),
            },
          ],
        },
      },
    ],
  };
}

async function responseErrorCode(response: Response): Promise<string> {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("aiProxy.worker", () => {
  it("reports health without disclosing configuration or calling Gemini", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleCandidateInsightRequest(
      new Request("https://rettohighlight-gemini.example/healthz"),
      { ...createEnvironment(), GEMINI_API_KEY: "" },
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "rettohighlight-gemini",
      version: 1,
    });
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
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
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

  it("keeps a prepared provider fail-closed until its transport is activated", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleCandidateInsightRequest(
      createRequest(createCandidateBody()),
      {
        ...createEnvironment(),
        CANDIDATE_INSIGHT_PROVIDER: "qwen",
        QWEN_API_KEY: "qwen-secret",
        QWEN_WORKSPACE_ID: "workspace-123",
      },
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(503);
    expect(await responseErrorCode(response)).toBe("PROVIDER_NOT_ACTIVE");
    expect(upstreamFetch).not.toHaveBeenCalled();
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
