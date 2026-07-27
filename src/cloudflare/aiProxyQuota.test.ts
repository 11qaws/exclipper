import { describe, expect, it, vi } from "vitest";

import {
  AI_QUOTA_LEASE_HEADER,
  AI_QUOTA_OPERATION_HEADER,
  AI_QUOTA_PARTICIPANT_HEADER,
  AI_QUOTA_PAYLOAD_DIGEST_HEADER,
  AI_QUOTA_RUN_HEADER,
  AI_QUOTA_SCHEMA_VERSION,
  type AiQuotaLeaseHeaders,
} from "../analysis/aiQuotaProtocol";
import {
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
} from "../analysis/candidatePassBGemini";
import { CANDIDATE_PASS_B_SAMPLE_RATE_HZ } from "../analysis/candidatePassBWorkerProtocol";
import {
  handleBroadcastTranscriptRequest,
  handleBroadcastContextRequest,
  handleCandidateInsightRequest,
  handleAiQuotaRequest,
  type AiProxyEnvironment,
} from "./aiProxy.worker";

const TRANSCRIPT_ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-transcript";
const CANDIDATE_ENDPOINT =
  "https://rettohighlight-gemini.example/v1/candidate-insights";
const CONTEXT_ENDPOINT =
  "https://rettohighlight-gemini.example/v1/broadcast-context";
const PRODUCTION_ORIGIN = "https://11qaws.github.io";
const PUBLIC_LEASE_TOKEN = `public_${"a".repeat(40)}`;
const INTERNAL_LEASE_TOKEN = `internal_${"b".repeat(40)}`;

type CoordinatorRequest = Readonly<{
  action:
    | "inspect"
    | "release-upload"
    | "consume"
    | "complete"
    | "lease";
  participantId: string;
  runId: string;
  operationId: string;
  pool: "transcript" | "candidate" | "context";
  payloadDigest: string;
  leaseToken?: string;
  tokenReservation?: number;
  outcome?: string;
}>;

function silentWav(durationMs: number): Uint8Array {
  const sampleCount = Math.ceil(
    (durationMs / 1_000) * CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  return encodeCandidatePassBPcm16Wav(
    new Float32Array(sampleCount),
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
}

async function payloadDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes as Uint8Array<ArrayBuffer>,
    ),
  );
  const hex = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  digest.fill(0);
  return `sha256:${hex}`;
}

function quotaLease(
  digest: string,
  pool: AiQuotaLeaseHeaders["pool"] = "transcript",
  operationId = "transcript-chunk-1",
): AiQuotaLeaseHeaders {
  return {
    participantId: "participant_00000000000001",
    runId: "run-quota-1",
    operationId,
    pool,
    payloadDigest: digest,
    leaseToken: PUBLIC_LEASE_TOKEN,
  };
}

function quotaHeaders(lease: AiQuotaLeaseHeaders): Record<string, string> {
  return {
    [AI_QUOTA_PARTICIPANT_HEADER]: lease.participantId,
    [AI_QUOTA_RUN_HEADER]: lease.runId,
    [AI_QUOTA_OPERATION_HEADER]: lease.operationId,
    [AI_QUOTA_PAYLOAD_DIGEST_HEADER]: lease.payloadDigest,
    [AI_QUOTA_LEASE_HEADER]: lease.leaseToken,
  };
}

function binaryTranscriptRequest(
  wav: Uint8Array,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    `${TRANSCRIPT_ENDPOINT}?startMs=0&durationMs=2000`,
    {
      method: "POST",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Content-Type": "audio/wav",
        "CF-Connecting-IP": "203.0.113.42",
        ...headers,
      },
      body: wav as Uint8Array<ArrayBuffer>,
    },
  );
}

function base64TranscriptRequest(
  audioBase64: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    `${TRANSCRIPT_ENDPOINT}?startMs=0&durationMs=2000`,
    {
      method: "POST",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Content-Type": "application/vnd.exclipper.transcript-base64",
        "CF-Connecting-IP": "203.0.113.42",
        ...headers,
      },
      body: audioBase64,
    },
  );
}

function jsonQuotaRequest(
  endpoint: string,
  serializedBody: string,
  lease: AiQuotaLeaseHeaders,
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
      ...quotaHeaders(lease),
    },
    body: serializedBody,
  });
}

function hangingQuotaRequest(
  endpoint: string,
  contentType: "application/json" | "audio/wav",
  lease: AiQuotaLeaseHeaders,
  onCancel?: () => void,
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Content-Type": contentType,
      "CF-Connecting-IP": "203.0.113.42",
      ...quotaHeaders(lease),
    },
    body: new ReadableStream<Uint8Array>({
      cancel() {
        onCancel?.();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function candidateInsightBody(candidateDurationMs = 1_000): {
  readonly audioBase64: string;
  readonly candidateDurationMs: number;
  readonly videoFrames: readonly [
    {
      readonly timestampMs: number;
      readonly mimeType: "image/jpeg";
      readonly dataBase64: string;
    },
    {
      readonly timestampMs: number;
      readonly mimeType: "image/jpeg";
      readonly dataBase64: string;
    },
  ];
} {
  return {
    audioBase64: encodeCandidatePassBBase64(silentWav(candidateDurationMs)),
    candidateDurationMs,
    videoFrames: [
      {
        timestampMs: 100,
        mimeType: "image/jpeg",
        dataBase64: "aGVsbG8=",
      },
      {
        timestampMs: candidateDurationMs - 100,
        mimeType: "image/jpeg",
        dataBase64: "d29ybGQ=",
      },
    ],
  };
}

function hangingSuccessfulResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>(), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function hangingRejectedResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>(), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createCoordinator(
  onRequest?: (request: CoordinatorRequest) => Response | Promise<Response>,
): {
  readonly requests: CoordinatorRequest[];
  readonly fetch: ReturnType<typeof vi.fn>;
  readonly namespace: NonNullable<
    AiProxyEnvironment["AI_QUOTA_COORDINATOR"]
  >;
} {
  const requests: CoordinatorRequest[] = [];
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body !== "string") {
        throw new TypeError("Coordinator request body was not JSON.");
      }
      const request = JSON.parse(init.body) as CoordinatorRequest;
      requests.push(request);
      if (onRequest !== undefined) return onRequest(request);
      if (request.action === "lease") {
        return jsonResponse({
          schemaVersion: AI_QUOTA_SCHEMA_VERSION,
          status: "granted",
          leaseToken: INTERNAL_LEASE_TOKEN,
          leaseExpiresAtMs: Date.now() + 30_000,
          retryAfterMs: 0,
          activeParticipantCount: 1,
          poolInFlightCount: 1,
        });
      }
      return jsonResponse({
        ok: true,
        status:
          request.action === "inspect"
            ? "valid"
            : request.action === "release-upload"
              ? "released"
            : request.action === "consume"
              ? "consumed"
              : "completed",
      });
    },
  );
  return {
    requests,
    fetch,
    namespace: {
      getByName: vi.fn(() => ({ fetch })),
    },
  };
}

function createEnvironment(
  coordinator: ReturnType<typeof createCoordinator>,
): {
  readonly environment: AiProxyEnvironment;
  readonly clientLimiter: ReturnType<typeof vi.fn>;
  readonly globalLimiter: ReturnType<typeof vi.fn>;
} {
  const clientLimiter = vi.fn().mockResolvedValue({ success: true });
  const globalLimiter = vi.fn().mockResolvedValue({ success: true });
  return {
    clientLimiter,
    globalLimiter,
    environment: {
      GEMINI_API_KEY: "gemini-secret",
      QWEN_API_KEY: "qwen-secret",
      BROADCAST_TRANSCRIPT_PROVIDER: "qwen",
      BROADCAST_TRANSCRIPT_TRANSPORT_MODE: "paid-direct",
      AI_PROVIDER_FALLBACK_MODE: "bounded",
      AI_QUOTA_MODE: "required",
      AI_QUOTA_COORDINATOR: coordinator.namespace,
      RATE_LIMITER: { limit: globalLimiter },
      IP_RATE_LIMITER: { limit: clientLimiter },
    },
  };
}

function qwenSseSuccess(text: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({
        choices: [{ delta: { content: text }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "" }, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { status: 200 },
  );
}

function geminiTranscriptSuccess(textKo: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: JSON.stringify({ textKo }) }],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

async function responseErrorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

describe("AI quota integration at the paid Worker boundary", () => {
  it("reports an unhealthy service when required quota coordination is unavailable", async () => {
    const coordinator = createCoordinator();
    coordinator.fetch.mockRejectedValue(new Error("coordinator unavailable"));
    const { environment } = createEnvironment(coordinator);

    const response = await handleCandidateInsightRequest(
      new Request("https://rettohighlight-gemini.example/healthz"),
      environment,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      quota: {
        mode: "required",
        coordinatorReady: false,
        maximumActiveParticipants: 5,
      },
    });
  });

  it("rejects a missing lease in required mode before reading media or spending any limiter/upstream work", async () => {
    const wav = silentWav(2_000);
    const coordinator = createCoordinator();
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    const request = binaryTranscriptRequest(wav);
    if (request.body === null) throw new Error("Expected request body.");
    const bodyReader = vi.spyOn(request.body, "getReader");
    const upstreamFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      request,
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(428);
    expect(await responseErrorCode(response)).toBe("QUOTA_LEASE_REQUIRED");
    expect(request.bodyUsed).toBe(false);
    expect(bodyReader).not.toHaveBeenCalled();
    expect(coordinator.fetch).not.toHaveBeenCalled();
    expect(clientLimiter).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("bounds a stalled public quota request instead of holding a Worker forever", async () => {
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const request = new Request(
      "https://rettohighlight-gemini.example/v1/ai-quota",
      {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": "application/json",
        },
        body: new ReadableStream<Uint8Array>(),
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await handleAiQuotaRequest(request, environment, {
      requestBodyTimeoutMs: 10,
    });

    expect(response.status).toBe(408);
    expect(await responseErrorCode(response)).toBe("REQUEST_BODY_TIMEOUT");
    expect(coordinator.fetch).not.toHaveBeenCalled();
  });

  it("treats cancellation of an already-terminal operation as idempotent success", async () => {
    const coordinator = createCoordinator(() =>
      jsonResponse({
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        status: "terminal",
        reason: "OPERATION_ALREADY_FINISHED",
        retryAfterMs: 0,
        activeParticipantCount: 1,
        poolInFlightCount: 0,
      }),
    );
    const { environment } = createEnvironment(coordinator);
    const request = new Request(
      "https://rettohighlight-gemini.example/v1/ai-quota",
      {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: AI_QUOTA_SCHEMA_VERSION,
          action: "cancel",
          participantId: "participant_00000000000001",
          runId: "run-quota-1",
          operationId: "context-overview-g1",
          pool: "context",
          payloadDigest: `sha256:${"a".repeat(64)}`,
        }),
      },
    );

    const response = await handleAiQuotaRequest(request, environment);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "terminal",
      reason: "OPERATION_ALREADY_FINISHED",
    });
  });

  it("keeps a terminal lease request as a 409 conflict", async () => {
    const coordinator = createCoordinator(() =>
      jsonResponse({
        schemaVersion: AI_QUOTA_SCHEMA_VERSION,
        status: "terminal",
        reason: "OPERATION_ALREADY_FINISHED",
        retryAfterMs: 0,
        activeParticipantCount: 1,
        poolInFlightCount: 0,
      }),
    );
    const { environment } = createEnvironment(coordinator);
    const request = new Request(
      "https://rettohighlight-gemini.example/v1/ai-quota",
      {
        method: "POST",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: AI_QUOTA_SCHEMA_VERSION,
          action: "lease",
          participantId: "participant_00000000000001",
          runId: "run-quota-1",
          operationId: "context-overview-g1",
          pool: "context",
          payloadDigest: `sha256:${"a".repeat(64)}`,
        }),
      },
    );

    const response = await handleAiQuotaRequest(request, environment);

    expect(response.status).toBe(409);
  });

  it("atomically consumes a valid lease before the paid fetch and completes it after the response is read", async () => {
    const wav = silentWav(2_000);
    const lease = quotaLease(await payloadDigest(wav));
    const events: string[] = [];
    const coordinator = createCoordinator((request) => {
      events.push(request.action);
      return jsonResponse({
        ok: true,
        status:
          request.action === "inspect"
            ? "valid"
            : request.action === "consume"
              ? "consumed"
              : "completed",
      });
    });
    const { environment } = createEnvironment(coordinator);
    const upstreamFetch = vi.fn(() => {
      events.push("paid-fetch");
      return Promise.resolve(qwenSseSuccess("조용히 성공했다고 말했다."));
    });

    const response = await handleBroadcastTranscriptRequest(
      binaryTranscriptRequest(wav, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      textKo: "조용히 성공했다고 말했다.",
    });
    expect(events).toEqual([
      "inspect",
      "consume",
      "paid-fetch",
      "complete",
    ]);
    expect(coordinator.requests[1]).toMatchObject({
      action: "consume",
      tokenReservation: 1_294,
    });
    expect(coordinator.requests.at(-1)).toMatchObject({
      action: "complete",
      operationId: lease.operationId,
      leaseToken: PUBLIC_LEASE_TOKEN,
      outcome: "succeeded",
    });
  });

  it("binds the direct Base64 body to its lease before the paid fetch", async () => {
    const audioBase64 = encodeCandidatePassBBase64(silentWav(2_000));
    const bodyBytes = new TextEncoder().encode(audioBase64);
    const lease = quotaLease(await payloadDigest(bodyBytes));
    bodyBytes.fill(0);
    const events: string[] = [];
    const coordinator = createCoordinator((request) => {
      events.push(request.action);
      return jsonResponse({
        ok: true,
        status:
          request.action === "inspect"
            ? "valid"
            : request.action === "consume"
              ? "consumed"
              : "completed",
      });
    });
    const { environment } = createEnvironment(coordinator);
    const upstreamFetch = vi.fn(() => {
      events.push("paid-fetch");
      return Promise.resolve(qwenSseSuccess("직접 전송 경로입니다."));
    });

    const response = await handleBroadcastTranscriptRequest(
      base64TranscriptRequest(audioBase64, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      "inspect",
      "consume",
      "paid-fetch",
      "complete",
    ]);
  });

  it("releases a direct Base64 upload ticket when the body digest differs", async () => {
    const audioBase64 = encodeCandidatePassBBase64(silentWav(2_000));
    const lease = quotaLease(`sha256:${"f".repeat(64)}`);
    const coordinator = createCoordinator();
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    const upstreamFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      base64TranscriptRequest(audioBase64, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(409);
    expect(await responseErrorCode(response)).toBe("QUOTA_PAYLOAD_MISMATCH");
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "release-upload",
    ]);
    expect(clientLimiter).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("waits for coordinator execution readiness before starting the paid fetch exactly once", async () => {
    const wav = silentWav(2_000);
    const lease = quotaLease(await payloadDigest(wav));
    const events: string[] = [];
    let consumeAttemptCount = 0;
    const coordinator = createCoordinator((request) => {
      if (request.action === "consume") {
        consumeAttemptCount += 1;
        events.push(`consume-${consumeAttemptCount}`);
        if (consumeAttemptCount <= 2) {
          return jsonResponse({
            ok: false,
            status: "not-ready",
            retryAfterMs: 75,
          });
        }
        return jsonResponse({ ok: true, status: "consumed" });
      }
      events.push(request.action);
      return jsonResponse({
        ok: true,
        status: request.action === "inspect" ? "valid" : "completed",
      });
    });
    const { environment } = createEnvironment(coordinator);
    const upstreamFetch = vi.fn(() => {
      events.push("paid-fetch");
      return Promise.resolve(qwenSseSuccess("준비된 실행 슬롯에서 전사했습니다."));
    });

    const response = await handleBroadcastTranscriptRequest(
      binaryTranscriptRequest(wav, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      textKo: "준비된 실행 슬롯에서 전사했습니다.",
    });
    expect(consumeAttemptCount).toBe(3);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "inspect",
      "consume-1",
      "consume-2",
      "consume-3",
      "paid-fetch",
      "complete",
    ]);
  });

  it("times out a stalled candidate upload and immediately releases its unused ticket", async () => {
    const lease = quotaLease(
      `sha256:${"a".repeat(64)}`,
      "candidate",
      "candidate-ingress-timeout",
    );
    const coordinator = createCoordinator();
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    const upstreamFetch = vi.fn();
    let requestBodyCancelled = false;

    const response = await handleCandidateInsightRequest(
      hangingQuotaRequest(
        CANDIDATE_ENDPOINT,
        "application/json",
        lease,
        () => {
          requestBodyCancelled = true;
        },
      ),
      environment,
      {
        fetchImplementation: upstreamFetch,
        requestBodyTimeoutMs: 10,
      },
    );

    expect(response.status).toBe(408);
    expect(await responseErrorCode(response)).toBe("REQUEST_BODY_TIMEOUT");
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "release-upload",
    ]);
    expect(clientLimiter).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(requestBodyCancelled).toBe(true);
  });

  it("keeps the original 408 when upload-ticket release coordination stalls", async () => {
    vi.useFakeTimers();
    try {
      const lease = quotaLease(
        `sha256:${"c".repeat(64)}`,
        "candidate",
        "candidate-release-timeout",
      );
      const coordinator = createCoordinator((request) => {
        if (request.action === "inspect") {
          return jsonResponse({ ok: true, status: "valid" });
        }
        if (request.action === "release-upload") {
          return new Promise<Response>(() => undefined);
        }
        return jsonResponse({ ok: false, status: "missing" });
      });
      const { environment } = createEnvironment(coordinator);
      const responsePromise = handleCandidateInsightRequest(
        hangingQuotaRequest(CANDIDATE_ENDPOINT, "application/json", lease),
        environment,
        {
          fetchImplementation: vi.fn(),
          requestBodyTimeoutMs: 10,
        },
      );

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(1_000);
      const response = await responsePromise;

      expect(response.status).toBe(408);
      expect(await responseErrorCode(response)).toBe("REQUEST_BODY_TIMEOUT");
      expect(coordinator.requests.map(({ action }) => action)).toEqual([
        "inspect",
        "release-upload",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled raw transcript upload without misreporting it as oversized", async () => {
    const lease = quotaLease(
      `sha256:${"b".repeat(64)}`,
      "transcript",
      "transcript-ingress-timeout",
    );
    const coordinator = createCoordinator();
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    const upstreamFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      hangingQuotaRequest(
        `${TRANSCRIPT_ENDPOINT}?startMs=0&durationMs=2000`,
        "audio/wav",
        lease,
      ),
      environment,
      {
        fetchImplementation: upstreamFetch,
        requestBodyTimeoutMs: 10,
      },
    );

    expect(response.status).toBe(408);
    expect(await responseErrorCode(response)).toBe("REQUEST_BODY_TIMEOUT");
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "release-upload",
    ]);
    expect(clientLimiter).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not pay for a candidate fallback when a 200 response body never finishes", async () => {
    const serializedBody = JSON.stringify(candidateInsightBody());
    const lease = quotaLease(
      await payloadDigest(new TextEncoder().encode(serializedBody)),
      "candidate",
      "candidate-body-timeout",
    );
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const candidateEnvironment: AiProxyEnvironment = {
      ...environment,
      CANDIDATE_INSIGHT_PROVIDER: "gemini",
    };
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(hangingSuccessfulResponse()),
    );

    const response = await handleCandidateInsightRequest(
      jsonQuotaRequest(CANDIDATE_ENDPOINT, serializedBody, lease),
      candidateEnvironment,
      {
        fetchImplementation: upstreamFetch,
        upstreamTimeoutMs: 20,
        upstreamRetryDelaysMs: [],
      },
    );

    expect(response.status).toBe(502);
    expect(await responseErrorCode(response)).toBe(
      "UPSTREAM_OUTCOME_UNKNOWN",
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "consume",
      "complete",
    ]);
    expect(coordinator.requests[1]?.tokenReservation).toBeGreaterThan(2_048);
    expect(coordinator.requests[1]?.tokenReservation).toBeLessThanOrEqual(
      100_000,
    );
    expect(
      coordinator.requests.some(
        ({ action, operationId }) =>
          action === "lease" || operationId.endsWith(".provider-1"),
      ),
    ).toBe(false);
    expect(coordinator.requests.at(-1)).toMatchObject({
      action: "complete",
      operationId: lease.operationId,
      pool: "candidate",
      outcome: "outcome-unknown",
    });
  });

  it("bounds a stalled provider error body while preserving the known 400 outcome", async () => {
    const serializedBody = JSON.stringify(candidateInsightBody());
    const lease = quotaLease(
      await payloadDigest(new TextEncoder().encode(serializedBody)),
      "candidate",
      "candidate-error-body-timeout",
    );
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const candidateEnvironment: AiProxyEnvironment = {
      ...environment,
      CANDIDATE_INSIGHT_PROVIDER: "gemini",
    };
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(hangingRejectedResponse()),
    );

    const response = await handleCandidateInsightRequest(
      jsonQuotaRequest(CANDIDATE_ENDPOINT, serializedBody, lease),
      candidateEnvironment,
      {
        fetchImplementation: upstreamFetch,
        upstreamTimeoutMs: 20,
        upstreamRetryDelaysMs: [],
      },
    );

    expect(response.status).toBe(502);
    expect(await responseErrorCode(response)).toBe("UPSTREAM_REJECTED");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "consume",
      "complete",
    ]);
    expect(coordinator.requests.at(-1)).toMatchObject({
      action: "complete",
      operationId: lease.operationId,
      outcome: "failed",
    });
  });

  it("does not pay for a context fallback when a 200 response body never finishes", async () => {
    const serializedBody = JSON.stringify({
      sourceDurationMs: 60_000,
      chapters: [
        {
          chapterId: "chapter-1",
          startMs: 0,
          endMs: 60_000,
          evidenceMode: "complete-transcript",
          evidenceCoverageRatio: 1,
          summaryKo: "스트리머가 방송 중 있었던 일을 차분하게 설명합니다.",
        },
      ],
      candidates: [
        {
          candidateId: "candidate-1",
          startMs: 5_000,
          endMs: 50_000,
          transcriptKo: "방금 있었던 일을 다시 설명할게요.",
          eventSummaryKo: "방송 중 발생한 사건을 설명합니다.",
          reactionSummaryKo: "차분한 목소리로 상황을 정리합니다.",
          chatReactionSummaryKo: null,
        },
      ],
    });
    const lease = quotaLease(
      await payloadDigest(new TextEncoder().encode(serializedBody)),
      "context",
      "context-body-timeout",
    );
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const contextEnvironment: AiProxyEnvironment = {
      ...environment,
      BROADCAST_CONTEXT_PROVIDER: "qwen",
    };
    const upstreamFetch = vi.fn(() =>
      Promise.resolve(hangingSuccessfulResponse()),
    );

    const response = await handleBroadcastContextRequest(
      jsonQuotaRequest(CONTEXT_ENDPOINT, serializedBody, lease),
      contextEnvironment,
      {
        fetchImplementation: upstreamFetch,
        upstreamTimeoutMs: 20,
        upstreamRetryDelaysMs: [],
      },
    );

    expect(response.status).toBe(502);
    expect(await responseErrorCode(response)).toBe(
      "UPSTREAM_OUTCOME_UNKNOWN",
    );
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "consume",
      "complete",
    ]);
    expect(coordinator.requests[1]?.tokenReservation).toBeGreaterThan(
      serializedBody.length,
    );
    expect(coordinator.requests[1]?.tokenReservation).toBeLessThanOrEqual(
      5_000_000,
    );
    expect(
      coordinator.requests.some(
        ({ action, operationId }) =>
          action === "lease" || operationId.endsWith(".provider-1"),
      ),
    ).toBe(false);
    expect(coordinator.requests.at(-1)).toMatchObject({
      action: "complete",
      operationId: lease.operationId,
      pool: "context",
      outcome: "outcome-unknown",
    });
  });

  it("acquires and consumes a distinct internal lease before a paid provider fallback", async () => {
    const wav = silentWav(2_000);
    const lease = quotaLease(await payloadDigest(wav));
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const upstreamFetch = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(geminiTranscriptSuccess("폴백 전사가 성공했다."));

    const response = await handleBroadcastTranscriptRequest(
      binaryTranscriptRequest(wav, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      textKo: "폴백 전사가 성공했다.",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "consume",
      "complete",
      "lease",
      "consume",
      "complete",
    ]);
    expect(coordinator.requests[2]).toMatchObject({
      action: "complete",
      operationId: lease.operationId,
      outcome: "retryable",
    });
    expect(coordinator.requests[3]).toMatchObject({
      action: "lease",
      operationId: `${lease.operationId}.provider-1`,
      payloadDigest: lease.payloadDigest,
    });
    expect(coordinator.requests[4]).toMatchObject({
      action: "consume",
      operationId: `${lease.operationId}.provider-1`,
      leaseToken: INTERNAL_LEASE_TOKEN,
    });
    expect(coordinator.requests[5]).toMatchObject({
      action: "complete",
      operationId: `${lease.operationId}.provider-1`,
      leaseToken: INTERNAL_LEASE_TOKEN,
      outcome: "succeeded",
    });
  });

  it("allows every custom quota request header through CORS preflight", async () => {
    const coordinator = createCoordinator();
    const { environment } = createEnvironment(coordinator);
    const response = await handleBroadcastTranscriptRequest(
      new Request(TRANSCRIPT_ENDPOINT, {
        method: "OPTIONS",
        headers: { Origin: PRODUCTION_ORIGIN },
      }),
      environment,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    const allowedHeaders =
      response.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
    for (const header of [
      AI_QUOTA_PARTICIPANT_HEADER,
      AI_QUOTA_RUN_HEADER,
      AI_QUOTA_OPERATION_HEADER,
      AI_QUOTA_PAYLOAD_DIGEST_HEADER,
      AI_QUOTA_LEASE_HEADER,
    ]) {
      expect(allowedHeaders).toContain(header.toLowerCase());
    }
    expect(
      response.headers
        .get("Access-Control-Expose-Headers")
        ?.toLowerCase(),
    ).toContain("retry-after");
  });

  it("exposes Retry-After on an actual transcript rate-limit response", async () => {
    const wav = silentWav(2_000);
    const lease = quotaLease(await payloadDigest(wav));
    const coordinator = createCoordinator();
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    clientLimiter.mockResolvedValueOnce({ success: false });
    const upstreamFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      binaryTranscriptRequest(wav, quotaHeaders(lease)),
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(429);
    expect(await responseErrorCode(response)).toBe("RATE_LIMITED");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(
      response.headers
        .get("Access-Control-Expose-Headers")
        ?.toLowerCase(),
    ).toContain("retry-after");
    expect(coordinator.requests.map(({ action }) => action)).toEqual([
      "inspect",
      "release-upload",
    ]);
    expect(clientLimiter).toHaveBeenCalledTimes(1);
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("fails closed when a supplied lease cannot be checked by the coordinator", async () => {
    const wav = silentWav(2_000);
    const lease = quotaLease(await payloadDigest(wav));
    const coordinator = createCoordinator(() =>
      Promise.reject(new Error("coordinator unavailable")),
    );
    const { environment, clientLimiter, globalLimiter } =
      createEnvironment(coordinator);
    const request = binaryTranscriptRequest(wav, quotaHeaders(lease));
    if (request.body === null) throw new Error("Expected request body.");
    const bodyReader = vi.spyOn(request.body, "getReader");
    const upstreamFetch = vi.fn();

    const response = await handleBroadcastTranscriptRequest(
      request,
      environment,
      { fetchImplementation: upstreamFetch },
    );

    expect(response.status).toBe(503);
    expect(await responseErrorCode(response)).toBe(
      "QUOTA_COORDINATOR_UNAVAILABLE",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(request.bodyUsed).toBe(false);
    expect(bodyReader).not.toHaveBeenCalled();
    expect(coordinator.fetch).toHaveBeenCalledTimes(1);
    expect(clientLimiter).not.toHaveBeenCalled();
    expect(globalLimiter).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
