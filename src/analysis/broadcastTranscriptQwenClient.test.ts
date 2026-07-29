import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
  requestBroadcastTranscriptChunkBinary,
} from "./broadcastTranscriptQwenClient";
import type { BroadcastTranscriptQwenClientError } from "./broadcastTranscriptQwenClient";
import { encodeCandidatePassBPcm16Wav } from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
} from "./candidatePassBWorkerProtocol";
import {
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
} from "./broadcastTranscriptQwen";
import {
  BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
} from "./broadcastTranscriptRouteManifest";
import {
  AI_QUOTA_ENDPOINT_PATH,
  AI_QUOTA_SCHEMA_VERSION,
} from "./aiQuotaProtocol";
import { BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE } from "./broadcastTranscriptMediaProtocol";

function silentWav(durationMs: number): Uint8Array {
  return encodeCandidatePassBPcm16Wav(
    new Float32Array(
      Math.ceil((durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ),
    ),
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
}

async function qwenRoute(
  mode: "free-r2" | "paid-direct" = "paid-direct",
) {
  const manifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: "1.1.0",
    serviceVersion: 6,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 3,
    transportMode: mode,
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: "qwen3.5-omni-flash",
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback: { mode: "disabled" },
  };
  return createBroadcastTranscriptRouteSelection(manifest);
}

function transcriptResponseHeaders(
  routeFingerprint: string,
  modelId = "qwen3.5-omni-flash",
  modelRevision = BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  fallbackUsed = false,
): HeadersInit {
  return {
    [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]: modelId,
    [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]: modelRevision,
    [CANDIDATE_PASS_B_RESPONSE_FALLBACK_HEADER]:
      fallbackUsed ? "true" : "false",
    [BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER]: routeFingerprint,
  };
}

describe("broadcastTranscriptQwenClient", () => {
  it("sends only audio and source offsets and accepts a matching result", async () => {
    const route = await qwenRoute();
    const wav = silentWav(1_000);
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=10000&durationMs=1000`,
        );
        if (init === undefined) throw new TypeError("init");
        expect(init?.body).toBe(wav);
        expect(new Headers(init.headers).get("Content-Type")).toBe(
          "audio/wav",
        );
        expect(
          new Headers(init.headers).get(
            BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER,
          ),
        ).toBe(route.fingerprint);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.0.0",
              modelId: "qwen3.5-omni-flash",
              sourceStartMs: 10_000,
              sourceEndMs: 11_000,
              textKo: "조용히 성공했다고 말한다.",
              detectedLanguage: "ko",
              emotion: "happy",
              billedSeconds: 1,
            }),
            {
              status: 200,
              headers: transcriptResponseHeaders(route.fingerprint),
            },
          ),
        );
      },
    );
    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 1_000, {
        route,
        fetchImplementation,
      }),
    ).resolves.toMatchObject({
      textKo: "조용히 성공했다고 말한다.",
      modelRevision:
        BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      providerReceipt: {
        provider: "qwen",
        fallbackUsed: false,
      },
    });
  });

  it("rejects a proxy model revision that does not match its response model ID", async () => {
    const route = await qwenRoute();
    const wav = silentWav(1_000);
    const fetchImplementation = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: "1.0.0",
            modelId: "whisper-large-v3-turbo",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            textKo: "안녕하세요.",
            detectedLanguage: "ko",
            emotion: null,
            billedSeconds: 1,
          }),
          {
            status: 200,
            headers: transcriptResponseHeaders(
              route.fingerprint,
              "whisper-large-v3-turbo",
              BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
            ),
          },
        ),
      );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 0, 1_000, {
        route,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
  });

  it("rejects a success body when the server omits its model receipt headers", async () => {
    const route = await qwenRoute();
    const wav = silentWav(1_000);
    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 0, 1_000, {
        route,
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: "1.0.0",
                modelId: "qwen3.5-omni-flash",
                sourceStartMs: 0,
                sourceEndMs: 1_000,
                textKo: "헤더가 없는 응답",
                detectedLanguage: "ko",
                emotion: null,
                billedSeconds: 1,
              }),
              { status: 200 },
            ),
          ),
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
  });

  it("rejects a result whose source fence does not match the request", async () => {
    const route = await qwenRoute();
    const wav = silentWav(1_000);
    const fetchImplementation = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: "1.0.0",
            modelId: "qwen3.5-omni-flash",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            textKo: "다른 구간",
            detectedLanguage: "ko",
            emotion: null,
            billedSeconds: 1,
          }),
          {
            status: 200,
            headers: transcriptResponseHeaders(route.fingerprint),
          },
        ),
    );
    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 1_000, {
        route,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
  });

  it("rejects a raw chunk above the 90-second production ceiling locally", async () => {
    const route = await qwenRoute();
    const wav = silentWav(1_000);
    const fetchImplementation = vi.fn();
    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 0, 90_001, {
        route,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses one raw WAV request when the server selects paid-direct", async () => {
    const route = await qwenRoute("paid-direct");
    const wav = silentWav(90_000);
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=10000&durationMs=90000`,
        );
        expect(init?.body).toBe(wav);
        const headers = new Headers(init?.headers);
        expect(headers.get("Content-Type")).toBe("audio/wav");
        expect(
          headers.get(BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER),
        ).toBe(route.fingerprint);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.0.0",
              modelId: "qwen3.5-omni-flash",
              sourceStartMs: 10_000,
              sourceEndMs: 100_000,
              textKo: "유료 직접 경로입니다.",
              detectedLanguage: "ko",
              emotion: null,
              billedSeconds: 90,
            }),
            {
              status: 200,
              headers: transcriptResponseHeaders(route.fingerprint),
            },
          ),
        );
      },
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 90_000, {
        route,
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "유료 직접 경로입니다." });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("resolves a Free R2 staged ticket without uploading the WAV twice", async () => {
    const route = await qwenRoute("free-r2");
    const wav = silentWav(90_000);
    const ticket = `v2.${"a".repeat(80)}.${"b".repeat(43)}`;
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (fetchImplementation.mock.calls.length === 1) {
          expect(init?.body).toBe(wav);
          expect(
            new Headers(init?.headers).get(
              BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER,
            ),
          ).toBe(route.fingerprint);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: "1.0.0",
                status: "staged",
                mediaTicket: ticket,
                expiresAtMs: Date.now() + 600_000,
                sourceStartMs: 10_000,
                sourceEndMs: 100_000,
              }),
              { status: 202 },
            ),
          );
        }
        expect(_input).toBe(BROADCAST_TRANSCRIPT_PROXY_ENDPOINT);
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
        );
        expect(
          new Headers(init?.headers).get(
            BROADCAST_TRANSCRIPT_ROUTE_FINGERPRINT_HEADER,
          ),
        ).toBe(route.fingerprint);
        if (typeof init?.body !== "string") throw new TypeError("body");
        expect(JSON.parse(init.body)).toEqual({
          schemaVersion: "1.0.0",
          mediaTicket: ticket,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.0.0",
              modelId: "qwen3.5-omni-flash",
              sourceStartMs: 10_000,
              sourceEndMs: 100_000,
              textKo: "R2 URL 경로입니다.",
              detectedLanguage: "ko",
              emotion: null,
              billedSeconds: 90,
            }),
            {
              status: 200,
              headers: transcriptResponseHeaders(route.fingerprint),
            },
          ),
        );
      },
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 90_000, {
        route,
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "R2 URL 경로입니다." });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("preserves an ambiguous post-lease connection loss without resending it", async () => {
    const route = await qwenRoute("paid-direct");
    const wav = silentWav(1_000);
    let paidRequestCount = 0;
    const fetchImplementation = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (new URL(url).pathname === AI_QUOTA_ENDPOINT_PATH) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                status: "granted",
                leaseToken:
                  "lease_0000000000000000000000000000000000000001",
                leaseExpiresAtMs: Date.now() + 30_000,
                retryAfterMs: 0,
                activeParticipantCount: 1,
                poolInFlightCount: 0,
              }),
              { status: 200 },
            ),
          );
        }
        paidRequestCount += 1;
        expect(init?.body).toBe(wav);
        return Promise.reject(new TypeError("connection lost"));
      },
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 0, 1_000, {
        route,
        fetchImplementation,
        quota: {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "transcript-ambiguous-1",
        },
      }),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(paidRequestCount).toBe(2);
  });

  it("surfaces route drift as a non-ambiguous recovery signal without replaying the chunk", async () => {
    const route = await qwenRoute("paid-direct");
    const wav = silentWav(1_000);
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "TRANSCRIPT_ROUTE_CHANGED" },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 0, 1_000, {
        route,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "ROUTE_CHANGED",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("reuses one staged upload with a fresh quota operation after 429", async () => {
    const route = await qwenRoute("free-r2");
    const wav = silentWav(90_000);
      const ticket =
        `v2.${"a".repeat(80)}.${"b".repeat(43)}`;
      const leaseOperationIds: string[] = [];
      const leasePayloadDigests: string[] = [];
      let uploadCount = 0;
      let resolveCount = 0;
      const fetchImplementation = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (new URL(url).pathname === AI_QUOTA_ENDPOINT_PATH) {
            if (typeof init?.body !== "string") throw new TypeError("body");
            const body = JSON.parse(init.body) as {
              readonly operationId: string;
              readonly payloadDigest: string;
            };
            leaseOperationIds.push(body.operationId);
            leasePayloadDigests.push(body.payloadDigest);
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                  status: "granted",
                  leaseToken:
                    `lease_${String(leaseOperationIds.length).padStart(40, "0")}`,
                  leaseExpiresAtMs: Date.now() + 30_000,
                  retryAfterMs: 0,
                  activeParticipantCount: 1,
                  poolInFlightCount: 1,
                }),
                { status: 200 },
              ),
            );
          }
          if (url.includes("?startMs=")) {
            uploadCount += 1;
            expect(init?.body).toBe(wav);
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  schemaVersion: "1.0.0",
                  status: "staged",
                  mediaTicket: ticket,
                  expiresAtMs: Date.now() + 600_000,
                  sourceStartMs: 10_000,
                  sourceEndMs: 100_000,
                }),
                { status: 202 },
              ),
            );
          }
          resolveCount += 1;
          expect(new Headers(init?.headers).get("Content-Type")).toBe(
            BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
          );
          if (resolveCount === 1) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  error: { code: "UPSTREAM_RATE_LIMITED" },
                }),
                {
                  status: 429,
                  headers: {
                    "Content-Type": "application/json",
                    "Retry-After": "1",
                  },
                },
              ),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: "1.0.0",
                modelId: "qwen3.5-omni-flash",
                sourceStartMs: 10_000,
                sourceEndMs: 100_000,
                textKo: "같은 업로드로 재시도에 성공했습니다.",
                detectedLanguage: "ko",
                emotion: null,
                billedSeconds: 90,
              }),
              {
                status: 200,
                headers: transcriptResponseHeaders(route.fingerprint),
              },
            ),
          );
        },
      );

      const resultPromise = requestBroadcastTranscriptChunkBinary(
        wav,
        10_000,
        90_000,
        {
          route,
          fetchImplementation,
          quota: {
            participantId:
              "participant_11111111111111111111111111111111",
            runId: "analysis-run-1",
            operationId: "transcript-media-retry",
          },
        },
      );
      await expect(resultPromise).resolves.toMatchObject({
        textKo: "같은 업로드로 재시도에 성공했습니다.",
      });
      expect(uploadCount).toBe(1);
      expect(resolveCount).toBe(2);
      expect(leaseOperationIds).toHaveLength(2);
      expect(leaseOperationIds[0]).not.toBe(leaseOperationIds[1]);
      expect(new Set(leasePayloadDigests).size).toBe(1);
  });

  it("rejects a raw WAV chunk above the shared 90-second ceiling", async () => {
    const route = await qwenRoute();
    const fetchImplementation = vi.fn();
    await expect(
      requestBroadcastTranscriptChunkBinary(
        silentWav(1_000),
        0,
        90_001,
        { route, fetchImplementation },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
