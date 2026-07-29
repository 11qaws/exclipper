import { describe, expect, it, vi } from "vitest";

import {
  createAiQuotaPayloadDigest,
  fetchWithAiQuota,
  fetchWithPreparedAiQuota,
  getOrCreateAiQuotaParticipantId,
} from "./aiQuotaClient";
import {
  AI_QUOTA_LEASE_HEADER,
  AI_QUOTA_PARTICIPANT_HEADER,
  AI_QUOTA_SCHEMA_VERSION,
  type AiQuotaLeaseHeaders,
} from "./aiQuotaProtocol";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestJsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new TypeError("Expected a JSON string request body.");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("AI quota browser client", () => {
  it("reuses one opaque participant ID across tabs sharing storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    const first = getOrCreateAiQuotaParticipantId(storage);
    const second = getOrCreateAiQuotaParticipantId(storage);

    expect(second).toBe(first);
    expect(first).toMatch(/^participant_[a-f0-9]{32}$/u);
  });

  it("creates the same digest for equivalent string and UTF-8 byte bodies", async () => {
    const text = JSON.stringify({ hello: "안녕" });
    await expect(createAiQuotaPayloadDigest(text)).resolves.toBe(
      await createAiQuotaPayloadDigest(new TextEncoder().encode(text)),
    );
  });

  it("waits for a lease before sending the paid request", async () => {
    let leasePoll = 0;
    const calls: string[] = [];
    const fetchImplementation = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        calls.push(url);
        if (url.endsWith("/v1/ai-quota")) {
          leasePoll += 1;
          return Promise.resolve(
            new Response(
              JSON.stringify(
                leasePoll === 1
                  ? {
                      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                      status: "queued",
                      retryAfterMs: 1,
                      activeParticipantCount: 2,
                      poolInFlightCount: 1,
                    }
                  : {
                      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                      status: "granted",
                      leaseToken: "lease_0000000000000000000000000000000000000001",
                      leaseExpiresAtMs: Date.now() + 30_000,
                      retryAfterMs: 0,
                      activeParticipantCount: 2,
                      poolInFlightCount: 2,
                    },
              ),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        const headers = new Headers(init?.headers);
        expect(headers.get(AI_QUOTA_PARTICIPANT_HEADER)).toBe(
          "participant_11111111111111111111111111111111",
        );
        expect(headers.get(AI_QUOTA_LEASE_HEADER)).toBe(
          "lease_0000000000000000000000000000000000000001",
        );
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );

    const response = await fetchWithAiQuota(
      "https://worker.example/v1/broadcast-context",
      { method: "POST", body: "{}" },
      {
        participantId: "participant_11111111111111111111111111111111",
        runId: "analysis-run-1",
        operationId: "context-overview-1",
        pool: "context",
        fetchImplementation,
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      expect.stringMatching(/\/v1\/ai-quota$/u),
      expect.stringMatching(/\/v1\/ai-quota$/u),
      "https://worker.example/v1/broadcast-context",
    ]);
  });

  it("cancels an abandoned queued operation when the analysis is aborted", async () => {
    const controller = new AbortController();
    const quotaActions: string[] = [];
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = requestJsonBody(init) as {
          readonly action: string;
        };
        quotaActions.push(request.action);
        if (request.action === "cancel") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                status: "cancelled",
                retryAfterMs: 0,
                activeParticipantCount: 1,
                poolInFlightCount: 0,
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: AI_QUOTA_SCHEMA_VERSION,
              status: "queued",
              retryAfterMs: 75,
              activeParticipantCount: 1,
              poolInFlightCount: 0,
            }),
            { status: 200 },
          ),
        );
      },
    );

    await expect(
      fetchWithAiQuota(
        "https://worker.example/v1/broadcast-context",
        { method: "POST", body: "{}" },
        {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "context-aborted",
          pool: "context",
          signal: controller.signal,
          fetchImplementation,
          onWait: () => controller.abort(),
        },
      ),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(quotaActions).toEqual(["lease", "cancel"]);
  });

  it("does not cancel an operation the coordinator already marked terminal", async () => {
    const quotaActions: string[] = [];
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = requestJsonBody(init) as {
          readonly action: string;
        };
        quotaActions.push(request.action);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: AI_QUOTA_SCHEMA_VERSION,
              status: "terminal",
              retryAfterMs: 0,
              activeParticipantCount: 1,
              poolInFlightCount: 0,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    );

    await expect(
      fetchWithAiQuota(
        "https://worker.example/v1/broadcast-context",
        { method: "POST", body: "{}" },
        {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "context-terminal",
          pool: "context",
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: "COORDINATOR_REJECTED",
      coordinatorStatus: "terminal",
    });
    expect(quotaActions).toEqual(["lease"]);
  });

  it("does not cancel an operation after the paid endpoint returns 502", async () => {
    const quotaActions: string[] = [];
    const calls: string[] = [];
    const fetchImplementation = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        calls.push(url);
        if (url.endsWith("/v1/ai-quota")) {
          const request = requestJsonBody(init) as {
            readonly action: string;
          };
          quotaActions.push(request.action);
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
                poolInFlightCount: 1,
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "UPSTREAM_UNAVAILABLE" },
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    );

    const response = await fetchWithAiQuota(
      "https://worker.example/v1/broadcast-context",
      { method: "POST", body: "{}" },
      {
        participantId: "participant_11111111111111111111111111111111",
        runId: "analysis-run-1",
        operationId: "context-upstream-failure",
        pool: "context",
        fetchImplementation,
      },
    );

    expect(response.status).toBe(502);
    expect(quotaActions).toEqual(["lease"]);
    expect(calls).toEqual([
      expect.stringMatching(/\/v1\/ai-quota$/u),
      "https://worker.example/v1/broadcast-context",
    ]);
  });

  it("adds the payload digest to the bounded operation ID", async () => {
    const operationIds: string[] = [];
    const fetchImplementation = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (requestUrl(input).endsWith("/v1/ai-quota")) {
          const request = requestJsonBody(init) as {
            readonly operationId: string;
          };
          operationIds.push(request.operationId);
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
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );
    const common = {
      participantId: "participant_11111111111111111111111111111111",
      runId: "analysis-run-1",
      operationId: "same-visible-candidate-range",
      pool: "candidate" as const,
      fetchImplementation,
    };

    await fetchWithAiQuota(
      "https://worker.example/v1/candidate-insights",
      { method: "POST", body: '{"candidate":1}' },
      common,
    );
    await fetchWithAiQuota(
      "https://worker.example/v1/candidate-insights",
      { method: "POST", body: '{"candidate":2}' },
      common,
    );

    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).not.toBe(operationIds[1]);
    expect(operationIds.every((value) => value.length <= 160)).toBe(true);
  });

  it("keeps a prepared media operation bound to the raw WAV digest", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const expectedDigest = await createAiQuotaPayloadDigest(wav);
    const preparedFetch = vi.fn((lease: AiQuotaLeaseHeaders) => {
      expect(lease.payloadDigest).toBe(expectedDigest);
      expect(lease.pool).toBe("transcript");
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(requestJsonBody(init)).toMatchObject({
          action: "lease",
          pool: "transcript",
          payloadDigest: expectedDigest,
        });
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
      },
    );

    const response = await fetchWithPreparedAiQuota(
      wav,
      {
        participantId: "participant_11111111111111111111111111111111",
        runId: "analysis-run-1",
        operationId: "transcript-media-1",
        pool: "transcript",
        fetchImplementation,
      },
      preparedFetch,
    );

    expect(response.status).toBe(200);
    expect(preparedFetch).toHaveBeenCalledTimes(1);
  });

  it("releases an unused transcript lease when the route changes before quota consumption", async () => {
    const quotaActions: string[] = [];
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = requestJsonBody(init) as {
          readonly action: string;
        };
        quotaActions.push(request.action);
        return Promise.resolve(
          new Response(
            JSON.stringify(
              request.action === "cancel"
                ? {
                    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                    status: "cancelled",
                    retryAfterMs: 0,
                    activeParticipantCount: 1,
                    poolInFlightCount: 0,
                  }
                : {
                    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
                    status: "granted",
                    leaseToken:
                      "lease_0000000000000000000000000000000000000001",
                    leaseExpiresAtMs: Date.now() + 30_000,
                    retryAfterMs: 0,
                    activeParticipantCount: 1,
                    poolInFlightCount: 0,
                  },
            ),
            { status: 200 },
          ),
        );
      },
    );

    const response = await fetchWithPreparedAiQuota(
      new Uint8Array([82, 73, 70, 70]),
      {
        participantId: "participant_11111111111111111111111111111111",
        runId: "analysis-run-1",
        operationId: "transcript-route-change",
        pool: "transcript",
        fetchImplementation,
      },
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "TRANSCRIPT_ROUTE_CHANGED" },
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    expect(response.status).toBe(409);
    expect(quotaActions).toEqual(["lease", "cancel"]);
  });

  it("replays the same lease once, then classifies a persistent connection loss as outcome unknown", async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(requestJsonBody(init)).toMatchObject({ action: "lease" });
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
      },
    );
    const preparedFetch = vi.fn(() =>
      Promise.reject(new TypeError("network disconnected")),
    );

    await expect(
      fetchWithPreparedAiQuota(
        new Uint8Array([1, 2, 3]),
        {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "transcript-fragment-1",
          pool: "transcript",
          fetchImplementation,
        },
        preparedFetch,
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(preparedFetch).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("recovers a one-off transport loss with the same lease and no new paid generation", async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(requestJsonBody(init)).toMatchObject({ action: "lease" });
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
      },
    );
    let transportAttempt = 0;
    const preparedFetch = vi.fn(() => {
      transportAttempt += 1;
      return transportAttempt === 1
        ? Promise.reject(new TypeError("connection reset"))
        : Promise.resolve(new Response("{}", { status: 200 }));
    });

    await expect(
      fetchWithPreparedAiQuota(
        new Uint8Array([1, 2, 3]),
        {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "transcript-fragment-replay",
          pool: "transcript",
          fetchImplementation,
        },
        preparedFetch,
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(preparedFetch).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not allocate a fresh operation when same-lease replay reports a conflict", async () => {
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(requestJsonBody(init)).toMatchObject({ action: "lease" });
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
      },
    );
    let transportAttempt = 0;
    const preparedFetch = vi.fn(() => {
      transportAttempt += 1;
      return transportAttempt === 1
        ? Promise.reject(new TypeError("connection reset"))
        : Promise.resolve(new Response("conflict", { status: 409 }));
    });

    await expect(
      fetchWithPreparedAiQuota(
        new Uint8Array([1, 2, 3]),
        {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "transcript-fragment-conflict",
          pool: "transcript",
          fetchImplementation,
        },
        preparedFetch,
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(preparedFetch).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
