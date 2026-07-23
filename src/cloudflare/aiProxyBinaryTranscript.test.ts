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

    let captured: RequestInit | undefined;
    const upstreamFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init;
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
    expect(capturedBodyText(captured)).toBe(expected);
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
    };
    const inlinePart = geminiBody.contents[0]?.parts.find(
      (part) => "inlineData" in part,
    ) as { inlineData: { data: string } } | undefined;
    expect(inlinePart?.inlineData.data).toBe(expectedB64);
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
