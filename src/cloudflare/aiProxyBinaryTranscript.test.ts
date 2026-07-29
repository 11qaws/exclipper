import { describe, expect, it, vi } from "vitest";

import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import {
  MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
  buildBroadcastTranscriptQwenOmniRequestBody,
} from "../analysis/broadcastTranscriptQwen";
import {
  BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
  BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
  BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
  BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
  BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
  broadcastTranscriptRouteRequestHeaders,
  createBroadcastTranscriptRouteSelection,
} from "../analysis/broadcastTranscriptRouteManifest";
import {
  AI_PROVIDER_ROUTING_POLICY_VERSION,
  resolveBroadcastTranscriptConnection,
  resolveBroadcastTranscriptFallbackConnection,
} from "./aiProviderConfiguration";
import {
  handleBroadcastTranscriptRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";

const ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-transcript";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";

function createEnvironment(
  transcriptProvider: "qwen" | "groq" = "qwen",
): AiProxyEnvironment {
  return {
    GEMINI_API_KEY: "gemini-secret",
    QWEN_API_KEY: "qwen-secret",
    GROQ_API_KEY: "groq-secret",
    AI_QUOTA_MODE: "disabled",
    BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "paid-direct",
    BROADCAST_TRANSCRIPT_PROVIDER: transcriptProvider,
    AI_PROVIDER_FALLBACK_MODE: "bounded",
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    IP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  };
}

function silentWav(durationMs: number): Uint8Array {
  const sampleCount = Math.ceil(
    (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return encodeCandidatePassBPcm16Wav(
    new Float32Array(sampleCount),
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
}

async function currentTranscriptRouteHeaders(
  environment: AiProxyEnvironment,
  headers: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, string>>> {
  const resolution = resolveBroadcastTranscriptConnection(environment);
  if (
    environment.BROADCAST_TRANSCRIPT_TRANSPORT_MODE !== "paid-direct" ||
    !resolution.ok ||
    resolution.connection.provider === "disabled"
  ) {
    throw new TypeError(
      "Binary transcript test environment does not match its route.",
    );
  }
  const primary = resolution.connection;
  const fallback = resolveBroadcastTranscriptFallbackConnection(
    environment,
    primary.provider,
  );
  const route = await createBroadcastTranscriptRouteSelection({
    schemaVersion: BROADCAST_TRANSCRIPT_ROUTE_MANIFEST_SCHEMA_VERSION,
    serviceVersion: BROADCAST_TRANSCRIPT_HEALTH_SERVICE_VERSION,
    routingPolicyVersion: AI_PROVIDER_ROUTING_POLICY_VERSION,
    providerConfigurationVersion:
      BROADCAST_TRANSCRIPT_PROVIDER_CONFIGURATION_VERSION,
    transportVersion: BROADCAST_TRANSCRIPT_TRANSPORT_VERSION,
    transportMode: "paid-direct",
    maximumChunkDurationMs:
      MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS,
    primaryMediaType: BROADCAST_TRANSCRIPT_PRIMARY_MEDIA_TYPE,
    provider: primary.provider,
    modelId: primary.descriptor.modelId,
    modelRevision: primary.descriptor.modelRevision,
    effectiveFallback: fallback === null
      ? { mode: "disabled" }
      : {
          mode: "bounded",
          provider: fallback.provider,
          modelId: fallback.descriptor.modelId,
          modelRevision: fallback.descriptor.modelRevision,
        },
  });
  return {
    ...headers,
    ...broadcastTranscriptRouteRequestHeaders(route),
  };
}

async function binaryRequest(
  wav: Uint8Array,
  query: string,
  environment: AiProxyEnvironment = createEnvironment(),
): Promise<Request> {
  return new Request(`${ENDPOINT}${query}`, {
    method: "POST",
    headers: await currentTranscriptRouteHeaders(environment, {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "audio/wav",
      "CF-Connecting-IP": "203.0.113.42",
    }),
    body: wav as Uint8Array<ArrayBuffer>,
  });
}

async function fragmentedBinaryRequest(
  wav: Uint8Array,
  query: string,
): Promise<Request> {
  const boundaries = [0, 17, 44, Math.floor(wav.byteLength / 2), wav.byteLength];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < boundaries.length - 1; index += 1) {
        controller.enqueue(
          wav.slice(boundaries[index], boundaries[index + 1]),
        );
      }
      controller.close();
    },
  });
  return new Request(`${ENDPOINT}${query}`, {
    method: "POST",
    headers: await currentTranscriptRouteHeaders(createEnvironment(), {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "audio/wav",
      "CF-Connecting-IP": "203.0.113.42",
    }),
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function qwenSseSuccess(text: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200 },
  );
}

function capturedBodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  throw new Error("unexpected upstream body type");
}

describe("binary transcript ingress", () => {
  it("builds the exact provider body from a full 90-second raw WAV", async () => {
    const wav = silentWav(90_000);
    const expected = JSON.stringify(
      buildBroadcastTranscriptQwenOmniRequestBody(
        encodeCandidatePassBBase64(wav),
      ),
    );

    let capturedBody = "";
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = capturedBodyText(init);
        return Promise.resolve(qwenSseSuccess("조용한 구간이다."));
      },
    );

    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(wav, "?startMs=600000&durationMs=90000"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceStartMs: 600_000,
      sourceEndMs: 690_000,
      textKo: "조용한 구간이다.",
    });
    expect(capturedBody).toBe(expected);
  });

  it("assembles fragmented ingress into the same bounded upstream body", async () => {
    const wav = silentWav(2_000);
    const expected = JSON.stringify(
      buildBroadcastTranscriptQwenOmniRequestBody(
        encodeCandidatePassBBase64(wav),
      ),
    );
    expect(JSON.parse(expected)).toMatchObject({ max_tokens: 1_024 });
    let capturedBody = "";
    let capturedUint8Array = false;
    const response = await handleBroadcastTranscriptRequest(
      await fragmentedBinaryRequest(wav, "?startMs=0&durationMs=2000"),
      createEnvironment(),
      {
        fetchImplementation: (_input, init) => {
          capturedBody = capturedBodyText(init);
          capturedUint8Array = init?.body instanceof Uint8Array;
          return Promise.resolve(qwenSseSuccess("조각난 요청이다."));
        },
      },
    );

    expect(response.status).toBe(200);
    expect(capturedUint8Array).toBe(true);
    expect(capturedBody).toBe(expected);
  });

  it("rejects a payload that is not a canonical WAV without calling upstream", async () => {
    const wav = silentWav(2_000);
    wav[0] = 0x00; // break "RIFF"
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(wav, "?startMs=0&durationMs=2000"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects audio whose declared duration does not match the bytes", async () => {
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(
        silentWav(2_000),
        "?startMs=0&durationMs=5000",
      ),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
  });

  it("sends paid-direct WAV to explicitly selected Groq without exposing its key", async () => {
    const wav = silentWav(2_000);
    let providerInit: RequestInit | undefined;
    const environment = createEnvironment("groq");
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(
        wav,
        "?startMs=5000&durationMs=2000",
        environment,
      ),
      environment,
      {
        fetchImplementation: (_input, init) => {
          providerInit = init;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                language: "ko",
                duration: 2,
                text: "직접 전송 경로입니다.",
                segments: [
                  {
                    start: 0,
                    end: 2,
                    text: "직접 전송 경로입니다.",
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-ExClipper-Model-Id")).toBe(
      "whisper-large-v3-turbo",
    );
    expect(response.headers.get("X-ExClipper-Model-Revision")).toBe(
      "groq-whisper-large-v3-turbo-ko-segment-v1-2026-07-29",
    );
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      modelId: "whisper-large-v3-turbo",
      sourceStartMs: 5_000,
      sourceEndMs: 7_000,
      textKo: "직접 전송 경로입니다.",
    });
    expect(providerInit?.body).toBeInstanceOf(FormData);
    const form = providerInit?.body as FormData;
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(wav.byteLength);
    expect(form.get("url")).toBeNull();
    expect(new Headers(providerInit?.headers).get("Authorization")).toBe(
      "Bearer groq-secret",
    );
    expect(JSON.stringify(payload)).not.toContain("groq-secret");
  });

  it("redacts Groq authentication errors from the browser response", async () => {
    const upstreamSecret = "gsk_fixture_never_return";
    const environment = {
      ...createEnvironment("groq"),
      AI_PROVIDER_FALLBACK_MODE: "disabled",
    } satisfies AiProxyEnvironment;
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(
        silentWav(2_000),
        "?startMs=0&durationMs=2000",
        environment,
      ),
      environment,
      {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "invalid_api_key",
                  message: `Invalid API Key: ${upstreamSecret}`,
                },
              }),
              { status: 401 },
            ),
          ),
      },
    );
    const payloadText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(payloadText)).toMatchObject({
      error: { code: "PROXY_NOT_CONFIGURED" },
    });
    expect(payloadText).not.toContain(upstreamSecret);
    expect(payloadText).not.toContain("invalid_api_key");
  });

  it("rejects a truncated raw WAV even when its header declares the full duration", async () => {
    const wav = silentWav(2_000);
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(
        wav.slice(0, -2),
        "?startMs=0&durationMs=2000",
      ),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing durationMs", "?startMs=0"],
    ["missing startMs", "?durationMs=2000"],
    ["a negative-looking start", "?startMs=-1&durationMs=2000"],
    ["a duration above the 90s contract", "?startMs=0&durationMs=90001"],
    ["an unknown query key", "?startMs=0&durationMs=2000&x=1"],
  ])("rejects %s", async (_label, query) => {
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(silentWav(2_000), query),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("rejects a body above the WAV ceiling with 413", async () => {
    const oversized = new Uint8Array(44 + 16_000 * 2 * 90 + 3);
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(oversized, "?startMs=0&durationMs=90000"),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );
    expect(response.status).toBe(413);
  });

  it("falls back to Gemini with the same audio when Qwen returns a server error", async () => {
    const wav = silentWav(2_000);
    const expectedB64 = encodeCandidatePassBBase64(wav);
    const bodies: string[] = [];
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(capturedBodyText(init));
        if (bodies.length === 1) {
          return Promise.resolve(new Response("temporary", { status: 503 }));
        }
        return Promise.resolve(new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [{ text: JSON.stringify({ textKo: "괜찮았다." }) }],
                },
              },
            ],
          }),
          { status: 200 },
        ));
      },
    );

    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(wav, "?startMs=1000&durationMs=2000"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(2);
    const geminiBody = JSON.parse(bodies[1]!) as {
      contents: readonly { parts: readonly Record<string, unknown>[] }[];
      generationConfig: { maxOutputTokens: number };
    };
    const inlinePart = geminiBody.contents[0]?.parts.find(
      (part) => "inlineData" in part,
    ) as { inlineData: { data: string } } | undefined;
    expect(inlinePart?.inlineData.data).toBe(expectedB64);
    expect(geminiBody.generationConfig.maxOutputTokens).toBe(1_024);
  });

  it("times out when response headers arrive but the SSE body stalls", async () => {
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () =>
                    controller.error(
                      new DOMException("aborted", "AbortError"),
                    ),
                  { once: true },
                );
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        ),
    );
    const response = await handleBroadcastTranscriptRequest(
      await binaryRequest(
        silentWav(2_000),
        "?startMs=0&durationMs=2000",
      ),
      createEnvironment(),
      { fetchImplementation: upstreamFetch, upstreamTimeoutMs: 1 },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "UPSTREAM_TIMEOUT" },
    });
  });

  it.each([
    ["application/json", JSON.stringify({ audioBase64: "UklGRg==" })],
    [
      "application/vnd.exclipper.transcript-base64",
      encodeCandidatePassBBase64(silentWav(2_000)),
    ],
  ])("rejects retired %s transcript ingress", async (contentType, body) => {
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(qwenSseSuccess("호출되면 안 된다.")),
    );
    const response = await handleBroadcastTranscriptRequest(
      new Request(ENDPOINT, {
        method: "POST",
        headers: await currentTranscriptRouteHeaders(createEnvironment(), {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": contentType,
          "CF-Connecting-IP": "203.0.113.42",
        }),
        body,
      }),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
