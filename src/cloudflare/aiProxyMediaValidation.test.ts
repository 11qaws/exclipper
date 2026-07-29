import { describe, expect, it, vi } from "vitest";

import { encodeCandidatePassBPcm16Wav } from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import { MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS } from "../analysis/broadcastTranscriptQwen";
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
    AI_QUOTA_MODE: "disabled",
    BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "paid-direct",
    BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    IP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  };
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
      "Media validation test environment does not match its route.",
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

async function transcriptRequest(
  wav: Uint8Array,
  durationMs: number,
  origin = PRODUCTION_ORIGIN,
): Promise<Request> {
  return new Request(`${TRANSCRIPT_ENDPOINT}?startMs=0&durationMs=${durationMs}`, {
    method: "POST",
    headers: await currentTranscriptRouteHeaders(createEnvironment(), {
      Origin: origin,
      "Content-Type": "audio/wav",
      "CF-Connecting-IP": "203.0.113.42",
    }),
    body: wav as Uint8Array<ArrayBuffer>,
  });
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

describe("broadcast transcript media validation", () => {
  /**
   * A 90-second raw WAV stays within the current paid-direct contract. The
   * browser no longer expands it to Base64 before the Worker validates it.
   */
  it("accepts a full-length 90-second raw WAV chunk", async () => {
    const durationMs = 90_000;
    const wav = silentWav(durationMs);
    expect(wav.byteLength).toBe(2_880_044);

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
      await transcriptRequest(wav, durationMs),
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
    const wav = silentWav(2_000);
    const response = await handleBroadcastTranscriptRequest(
      await transcriptRequest(wav, 5_000),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
  });

  it("still rejects a payload that is not a canonical WAV", async () => {
    const invalidWav = new Uint8Array(32_044);
    const response = await handleBroadcastTranscriptRequest(
      await transcriptRequest(invalidWav, 1_000),
      createEnvironment(),
      { fetchImplementation: vi.fn() },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_AUDIO" },
    });
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
      await transcriptRequest(silentWav(1_000), 1_000),
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
      await transcriptRequest(silentWav(1_000), 1_000, "https://example.invalid"),
      hostileEnvironment,
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
