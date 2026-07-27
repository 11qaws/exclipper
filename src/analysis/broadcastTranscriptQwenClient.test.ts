import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE,
  BROADCAST_TRANSCRIPT_PROXY_ENDPOINT,
  requestBroadcastTranscriptChunkBinary,
  requestBroadcastTranscriptQwenChunk,
} from "./broadcastTranscriptQwenClient";
import type { BroadcastTranscriptQwenClientError } from "./broadcastTranscriptQwenClient";
import { encodeCandidatePassBPcm16Wav } from "./candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "./candidatePassBWorkerProtocol";
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

describe("broadcastTranscriptQwenClient", () => {
  it("sends only audio and source offsets and accepts a matching result", async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=10000&durationMs=1000`,
        );
        if (typeof init?.body !== "string") throw new TypeError("body");
        expect(init.body).toBe("UklGRg==");
        expect(new Headers(init.headers).get("Content-Type")).toBe(
          BROADCAST_TRANSCRIPT_BASE64_CONTENT_TYPE,
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.0.0",
              modelId: "qwen3-asr-flash",
              sourceStartMs: 10_000,
              sourceEndMs: 11_000,
              textKo: "조용히 성공했다고 말한다.",
              detectedLanguage: "ko",
              emotion: "happy",
              billedSeconds: 1,
            }),
            { status: 200 },
          ),
        );
      },
    );
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 10_000, 1_000, {
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "조용히 성공했다고 말한다." });
  });

  it("rejects a result whose source fence does not match the request", async () => {
    const fetchImplementation = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: "1.0.0",
            modelId: "qwen3-asr-flash",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            textKo: "다른 구간",
            detectedLanguage: "ko",
            emotion: null,
            billedSeconds: 1,
          }),
          { status: 200 },
        ),
      );
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 10_000, 1_000, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
  });

  it("rejects a direct chunk above the 30-second production ceiling locally", async () => {
    const fetchImplementation = vi.fn();
    await expect(
      requestBroadcastTranscriptQwenChunk("UklGRg==", 0, 30_001, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses one raw WAV request when the server selects paid-direct", async () => {
    const wav = silentWav(90_000);
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          `${BROADCAST_TRANSCRIPT_PROXY_ENDPOINT}?startMs=10000&durationMs=90000`,
        );
        expect(init?.body).toBe(wav);
        expect(new Headers(init?.headers).get("Content-Type")).toBe("audio/wav");
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
            { status: 200 },
          ),
        );
      },
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 90_000, {
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "유료 직접 경로입니다." });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("resolves a Free R2 staged ticket without uploading the WAV twice", async () => {
    const wav = silentWav(90_000);
    const ticket = `v1.${"a".repeat(32)}.${Date.now() + 600_000}.${"b".repeat(43)}`;
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (fetchImplementation.mock.calls.length === 1) {
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
        expect(_input).toBe(BROADCAST_TRANSCRIPT_PROXY_ENDPOINT);
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE,
        );
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
            { status: 200 },
          ),
        );
      },
    );

    await expect(
      requestBroadcastTranscriptChunkBinary(wav, 10_000, 90_000, {
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ textKo: "R2 URL 경로입니다." });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("preserves an ambiguous post-lease connection loss without resending it", async () => {
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

  it("reuses one staged upload with a fresh quota operation after 429", async () => {
    const wav = silentWav(90_000);
      const ticket =
        `v1.${"a".repeat(80)}.${"b".repeat(43)}`;
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
              { status: 200 },
            ),
          );
        },
      );

      const resultPromise = requestBroadcastTranscriptChunkBinary(
        wav,
        10_000,
        90_000,
        {
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
    const fetchImplementation = vi.fn();
    await expect(
      requestBroadcastTranscriptChunkBinary(
        silentWav(1_000),
        0,
        90_001,
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    } satisfies Partial<BroadcastTranscriptQwenClientError>);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
