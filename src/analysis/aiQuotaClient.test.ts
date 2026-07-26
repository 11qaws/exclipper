import { describe, expect, it, vi } from "vitest";

import {
  createAiQuotaPayloadDigest,
  fetchWithAiQuota,
  getOrCreateAiQuotaParticipantId,
} from "./aiQuotaClient";
import {
  AI_QUOTA_LEASE_HEADER,
  AI_QUOTA_PARTICIPANT_HEADER,
  AI_QUOTA_SCHEMA_VERSION,
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
});
