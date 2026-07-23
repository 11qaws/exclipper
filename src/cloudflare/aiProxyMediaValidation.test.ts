import { describe, expect, it, vi } from "vitest";

import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import aiProxyWorker, {
  handleBroadcastTranscriptRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";

const TRANSCRIPT_ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-transcript";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";

function createEnvironment(): AiProxyEnvironment {
  return {
    GEMINI_API_KEY: "gemini-secret",
    QWEN_API_KEY: "qwen-secret",
    BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    IP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  };
}

function transcriptRequest(body: unknown): Request {
  return new Request(TRANSCRIPT_ENDPOINT, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
    },
    body: JSON.stringify(body),
  });
}

function silentWavBase64(durationMs: number): string {
  const sampleCount = Math.ceil(
    (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return encodeCandidatePassBBase64(
    encodeCandidatePassBPcm16Wav(
      new Float32Array(sampleCount),
      CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    ),
  );
}

describe("broadcast transcript media validation", () => {
  /**
   * The production outage: a 90-second chunk is 3.84 MB of base64, and the
   * proxy used to decode all of it just to read a 44-byte header. The Worker
   * was killed for exceeding its resource limits, and Cloudflare's own error
   * response carried no CORS headers, so browsers reported a CORS violation
   * instead of the real fault.
   */
  it("accepts a full-length 90 second chunk", async () => {
    const durationMs = 90_000;
    const audioBase64 = silentWavBase64(durationMs);
    expect(audioBase64.length).toBeGreaterThan(3_800_000);

    const upstreamFetch = vi.fn(
      () =>
        Promise.resolve(new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ textKo: "조용한 구간이다." }) } }],
          }),
          { status: 200 },
        )),
    );

    const response = await handleBroadcastTranscriptRequest(
      transcriptRequest({ audioBase64, sourceStartMs: 0, durationMs }),
      createEnvironment(),
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).not.toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(upstreamFetch).toHaveBeenCalled();
  });

  it("still rejects audio whose declared duration does not match the header", async () => {
    const audioBase64 = silentWavBase64(2_000);
    const response = await handleBroadcastTranscriptRequest(
      transcriptRequest({ audioBase64, sourceStartMs: 0, durationMs: 5_000 }),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
  });

  it("still rejects a payload that is not a canonical WAV", async () => {
    // Valid base64 and a plausible length, but no RIFF header.
    const audioBase64 = "A".repeat(64_000);
    const response = await handleBroadcastTranscriptRequest(
      transcriptRequest({ audioBase64, sourceStartMs: 0, durationMs: 1_000 }),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
  });

  it.each([
    ["padding in the middle", "AAAA=AAA"],
    ["a character outside the alphabet", "AAAA$AAA"],
    ["a length that is not a multiple of four", "AAAAA"],
  ])("still rejects base64 with %s", async (_label, audioBase64) => {
    const response = await handleBroadcastTranscriptRequest(
      transcriptRequest({ audioBase64, sourceStartMs: 0, durationMs: 1_000 }),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );

    expect(response.status).toBe(400);
  });
});

describe("worker error boundary", () => {
  /**
   * Without this boundary a thrown handler produced a Cloudflare error page
   * with no CORS headers, so the browser hid the real fault behind a CORS
   * message. Every response must leave with an allowed origin attached.
   */
  it("answers a thrown handler with a CORS-bearing 500", async () => {
    const hostileEnvironment = new Proxy(
      {},
      {
        get() {
          throw new Error("environment access failed");
        },
      },
    ) as AiProxyEnvironment;

    const response = await aiProxyWorker.fetch(
      transcriptRequest({ audioBase64: "AAAA", sourceStartMs: 0, durationMs: 1_000 }),
      hostileEnvironment,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(await response.json()).toMatchObject({
      error: { code: "PROXY_UNAVAILABLE" },
    });
  });

  it("does not attach CORS headers for a disallowed origin", async () => {
    const hostileEnvironment = new Proxy(
      {},
      {
        get() {
          throw new Error("environment access failed");
        },
      },
    ) as AiProxyEnvironment;

    const response = await aiProxyWorker.fetch(
      new Request(TRANSCRIPT_ENDPOINT, {
        method: "POST",
        headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
        body: "{}",
      }),
      hostileEnvironment,
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
