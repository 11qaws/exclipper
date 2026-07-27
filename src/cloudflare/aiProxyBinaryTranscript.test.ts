import { describe, expect, it, vi } from "vitest";

import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import { buildBroadcastTranscriptQwenOmniRequestBody } from "../analysis/broadcastTranscriptQwen";
import {
  handleBroadcastTranscriptRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";

const ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-transcript";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";

function createEnvironment(): AiProxyEnvironment {
  return {
    GEMINI_API_KEY: "gemini-secret",
    QWEN_API_KEY: "qwen-secret",
    AI_QUOTA_MODE: "disabled",
    BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "paid-direct",
    BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
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

function binaryRequest(
  wav: Uint8Array,
  query: string,
): Request {
  return new Request(`${ENDPOINT}${query}`, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "audio/wav",
      "CF-Connecting-IP": "203.0.113.42",
    },
    body: wav as Uint8Array<ArrayBuffer>,
  });
}

function base64Request(
  body: string,
  query: string,
): Request {
  return new Request(`${ENDPOINT}${query}`, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "application/vnd.exclipper.transcript-base64",
      "CF-Connecting-IP": "203.0.113.42",
    },
    body,
  });
}

function fragmentedBinaryRequest(
  wav: Uint8Array,
  query: string,
): Request {
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
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "audio/wav",
      "CF-Connecting-IP": "203.0.113.42",
    },
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
  it("passes browser-prepared Base64 through without changing provider bytes", async () => {
    const wav = silentWav(30_000);
    const audioBase64 = encodeCandidatePassBBase64(wav);
    const expected = JSON.stringify(
      buildBroadcastTranscriptQwenOmniRequestBody(audioBase64),
    );
    let capturedBody = "";
    let capturedUint8Array = false;
    const response = await handleBroadcastTranscriptRequest(
      base64Request(audioBase64, "?startMs=600000&durationMs=30000"),
      createEnvironment(),
      {
        fetchImplementation: (_input, init) => {
          capturedBody = capturedBodyText(init);
          capturedUint8Array = init?.body instanceof Uint8Array;
          return Promise.resolve(qwenSseSuccess("브라우저 직접 경로입니다."));
        },
      },
    );

    expect(response.status).toBe(200);
    expect(capturedUint8Array).toBe(true);
    expect(capturedBody).toBe(expected);
  });

  it.each([
    ["quote", "\""],
    ["backslash", "\\"],
    ["newline", "\n"],
    ["NUL", "\0"],
    ["non-ASCII", "가"],
    ["internal padding", "="],
  ])("rejects %s in a direct Base64 body", async (_label, replacement) => {
    const wav = silentWav(2_000);
    const valid = encodeCandidatePassBBase64(wav);
    const offset = Math.floor(valid.length / 2);
    const invalid = `${valid.slice(0, offset)}${replacement}${valid.slice(offset + 1)}`;
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      base64Request(invalid, "?startMs=0&durationMs=2000"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect([400, 413]).toContain(response.status);
    const payload = await response.json() as { error: { code: string } };
    expect(["INVALID_AUDIO", "PAYLOAD_TOO_LARGE"]).toContain(
      payload.error.code,
    );
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects non-canonical unused Base64 pad bits", async () => {
    const valid = encodeCandidatePassBBase64(silentWav(3));
    expect(valid.endsWith("=")).toBe(true);
    const invalid = `${valid.slice(0, -2)}B=`;
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      base64Request(invalid, "?startMs=0&durationMs=3"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("limits the direct Base64 transport to the production 30-second chunk", async () => {
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      base64Request(
        encodeCandidatePassBBase64(silentWav(90_000)),
        "?startMs=0&durationMs=90000",
      ),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate start", "?startMs=0&startMs=1&durationMs=2000"],
    ["duplicate duration", "?startMs=0&durationMs=2000&durationMs=2000"],
    ["past 12 hours", "?startMs=43199001&durationMs=2000"],
  ])("rejects direct Base64 query with %s", async (_label, query) => {
    const response = await handleBroadcastTranscriptRequest(
      base64Request(encodeCandidatePassBBase64(silentWav(2_000)), query),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  /**
   * The whole point of the transport change: the upstream provider must not
   * be able to tell the difference. The raw-WAV path has to assemble a body
   * that is byte-for-byte identical to what the base64-in-JSON path sent.
   */
  it("sends the exact same upstream body as the JSON path, for a full 90s chunk", async () => {
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
      binaryRequest(wav, "?startMs=600000&durationMs=90000"),
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
      fragmentedBinaryRequest(wav, "?startMs=0&durationMs=2000"),
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
      binaryRequest(wav, "?startMs=0&durationMs=2000"),
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
      binaryRequest(silentWav(2_000), "?startMs=0&durationMs=5000"),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
  });

  it("rejects a truncated raw WAV even when its header declares the full duration", async () => {
    const wav = silentWav(2_000);
    const upstreamFetch = vi.fn();
    const response = await handleBroadcastTranscriptRequest(
      binaryRequest(wav.slice(0, -2), "?startMs=0&durationMs=2000"),
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
      binaryRequest(silentWav(2_000), query),
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
      binaryRequest(oversized, "?startMs=0&durationMs=90000"),
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
      binaryRequest(wav, "?startMs=1000&durationMs=2000"),
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
      binaryRequest(silentWav(2_000), "?startMs=0&durationMs=2000"),
      createEnvironment(),
      { fetchImplementation: upstreamFetch, upstreamTimeoutMs: 1 },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "UPSTREAM_TIMEOUT" },
    });
  });

  it("keeps accepting the legacy JSON transport", async () => {
    const wav = silentWav(2_000);
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(qwenSseSuccess("기존 경로다.")),
    );
    const response = await handleBroadcastTranscriptRequest(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.42",
        },
        body: JSON.stringify({
          audioBase64: encodeCandidatePassBBase64(wav),
          sourceStartMs: 0,
          durationMs: 2_000,
        }),
      }),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ textKo: "기존 경로다." });
  });
});
