import { describe, expect, it, vi } from "vitest";

import {
  BROADCAST_CONTEXT_PROXY_ENDPOINT,
  BroadcastContextDeepseekClientError,
  requestBroadcastContextDeepseek,
} from "./broadcastContextDeepseekClient";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "./participantRoster";

const input = {
  sourceDurationMs: 60_000,
  chapters: [
    {
      chapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: "스트리머가 실수를 인정하고 시청자에게 정확히 사과했다.",
    },
  ],
  candidates: [
    {
      candidateId: "candidate-1",
      startMs: 10_000,
      endMs: 55_000,
      transcriptKo: "제가 실수했습니다. 죄송합니다.",
      eventSummaryKo: "실수를 인정했다.",
      reactionSummaryKo: "차분하게 사과했다.",
      chatReactionSummaryKo: null,
      participantContextKo: "이 후보의 화면 등장인물은 아직 확인하지 못했습니다.",
    },
  ],
};

const result = {
  schemaVersion: "1.4.0",
  broadcastSummaryKo: "실수의 경위를 설명하고 정확히 사과한 방송이다.",
  recurringThemesKo: ["사과"],
  semanticChaptersSupported: true,
  semanticChapters: [
    {
      semanticChapterId: "semantic-001",
      startChapterId: "chapter-1",
      endChapterId: "chapter-1",
      startMs: 0,
      endMs: 60_000,
      titleKo: "사과",
      summaryKo: "실수를 인정하고 사과했다.",
      kind: "main-event",
      salience: "primary",
      relatedCandidateIds: ["candidate-1"],
      uncertaintiesKo: [],
    },
  ],
  discoveredLeadsSupported: true,
  discoveredLeads: [],
  annotations: [
    {
      candidateId: "candidate-1",
      category: "apology-accountability",
      clipDecision: "select",
      confidence: 0.94,
      rejectionReasons: [],
      contextSummaryKo: "사과 방송의 핵심 장면",
      whyThisMomentKo: "잘못을 직접 인정한 정확한 구간",
      relatedCandidateIds: [],
      uncertaintiesKo: [],
    },
  ],
  coverage: {
    status: "complete",
    coveredMs: 60_000,
    coverageRatio: 1,
    gaps: [],
    partialChapterIds: [],
  },
};

describe("requestBroadcastContextDeepseek", () => {
  it("sends the bounded public request and revalidates the parsed result", async () => {
    let receivedInit: RequestInit | undefined;
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        receivedInit = init;
        return Promise.resolve(new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        }));
      },
    );
    const response = await requestBroadcastContextDeepseek(input, {
      fetchImplementation,
    });

    expect(response.annotations[0]?.clipDecision).toBe("select");
    expect(fetchImplementation).toHaveBeenCalledWith(
      BROADCAST_CONTEXT_PROXY_ENDPOINT,
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
    const body = receivedInit?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual({
      ...input,
      outputLanguage: "ko",
    });
  });

  it("compacts oversized saved chapter maps at the final request boundary", async () => {
    const chapters = Array.from({ length: 145 }, (_, index) => ({
      chapterId: `saved-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: `${index + 1}번째 저장 구간`,
    }));
    let receivedBody: Record<string, unknown> | undefined;
    const response = await requestBroadcastContextDeepseek(
      { ...input, sourceDurationMs: 145_000, chapters },
      {
        fetchImplementation: (_request, init) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("Expected a serialized context request.");
          }
          receivedBody = JSON.parse(init.body) as Record<string, unknown>;
          const sentChapters = receivedBody.chapters as typeof chapters;
          const boundedResult = {
            ...result,
            semanticChapters: [
              {
                ...result.semanticChapters[0],
                startChapterId: sentChapters[0]?.chapterId,
                endChapterId: sentChapters.at(-1)?.chapterId,
                startMs: 0,
                endMs: 145_000,
              },
            ],
            coverage: {
              ...result.coverage,
              coveredMs: 145_000,
            },
          };
          return Promise.resolve(
            new Response(JSON.stringify(boundedResult), { status: 200 }),
          );
        },
      },
    );

    expect(receivedBody?.chapters).toHaveLength(144);
    expect(response.semanticChapters[0]?.endMs).toBe(145_000);
  });

  it("rejects malformed successful responses", async () => {
    await expect(
      requestBroadcastContextDeepseek(input, {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(JSON.stringify({ annotations: [] }), { status: 200 }),
          ),
      }),
    ).rejects.toMatchObject({
      code: "PROXY_INVALID_RESPONSE",
    });
  });

  it.each([
    [502, "UPSTREAM_OUTCOME_UNKNOWN"],
    [502, "UPSTREAM_INVALID_RESPONSE"],
    [502, "UPSTREAM_REJECTED"],
    [502, "UPSTREAM_UNAVAILABLE"],
    [504, "UPSTREAM_TIMEOUT"],
    [429, "UPSTREAM_RATE_LIMITED"],
    [409, "OPERATION_ALREADY_FINISHED"],
  ])(
    "preserves bounded proxy failure identity for HTTP %i %s",
    async (status, proxyErrorCode) => {
      const request = requestBroadcastContextDeepseek(input, {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: proxyErrorCode,
                  message: "provider raw text must not escape",
                },
              }),
              {
                status,
                headers: {
                  "Content-Type": "application/json; charset=utf-8",
                  "Retry-After": status === 429 ? "60" : "9999",
                  "X-ExClipper-Primary-Failure": "invalid-response",
                  "X-ExClipper-Fallback-Failure": "unavailable",
                  "X-ExClipper-Fallback-Reason": "invalid-response",
                  "X-Provider-Raw": "provider raw text must not escape",
                },
              },
            ),
          ),
      });

      try {
        await request;
        throw new Error("Expected the proxy request to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(BroadcastContextDeepseekClientError);
        expect(error).toMatchObject({
          code: "PROXY_REJECTED",
          status,
          proxyErrorCode,
        });
        const clientError = error as BroadcastContextDeepseekClientError;
        expect(clientError.message).not.toContain("provider raw text");
        expect(clientError.diagnosticHeaders).toEqual({
          ...(status === 429 ? { "Retry-After": "60" } : {}),
          "X-ExClipper-Fallback-Reason": "invalid-response",
          "X-ExClipper-Primary-Failure": "invalid-response",
          "X-ExClipper-Fallback-Failure": "unavailable",
        });
        expect(
          (clientError.diagnosticHeaders as Record<string, string>)[
            "X-Provider-Raw"
          ],
        ).toBeUndefined();
        expect(JSON.stringify(clientError)).not.toContain("provider raw text");
      }
    },
  );

  it("preserves a terminal quota conflict without sending a second cancel", async () => {
    const quotaActions: string[] = [];
    const paidRequests: string[] = [];
    const fetchImplementation = vi.fn(
      (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (url.endsWith("/v1/ai-quota")) {
          if (typeof init?.body !== "string") {
            throw new TypeError("Expected a serialized quota request.");
          }
          const body = JSON.parse(init.body) as { readonly action: string };
          quotaActions.push(body.action);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                schemaVersion: "1.0.0",
                status: "terminal",
                retryAfterMs: 0,
                activeParticipantCount: 1,
                poolInFlightCount: 0,
              }),
              {
                status: 409,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        paidRequests.push(url);
        return Promise.resolve(new Response("{}", { status: 500 }));
      },
    );

    await expect(
      requestBroadcastContextDeepseek(input, {
        quota: {
          participantId: "participant_11111111111111111111111111111111",
          runId: "analysis-run-1",
          operationId: "context-overview-restored",
        },
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "PROXY_REJECTED",
      status: 409,
      proxyErrorCode: "OPERATION_ALREADY_FINISHED",
    });
    expect(quotaActions).toEqual(["lease"]);
    expect(paidRequests).toEqual([]);
  });

  it("stops reading oversized proxy error bodies and exposes no raw payload", async () => {
    let pulls = 0;
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1_024).fill(65));
        if (pulls >= 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      requestBroadcastContextDeepseek(input, {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(oversizedBody, {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      }),
    ).rejects.toMatchObject({
      code: "PROXY_REJECTED",
      status: 502,
      proxyErrorCode: null,
      diagnosticHeaders: {},
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(20);
  });

  it("drops malformed proxy codes and unapproved diagnostic values", async () => {
    await expect(
      requestBroadcastContextDeepseek(input, {
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "not a bounded public code",
                  message: "secret provider explanation",
                },
              }),
              {
                status: 502,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": "3600",
                  "X-ExClipper-Primary-Failure":
                    "secret provider explanation",
                },
              },
            ),
          ),
      }),
    ).rejects.toMatchObject({
      status: 502,
      proxyErrorCode: null,
      diagnosticHeaders: {},
    });
  });

  it("sends the explicit refinement mode without changing the validated input", async () => {
    let receivedBody: unknown;
    const response = await requestBroadcastContextDeepseek(input, {
      analysisMode: "refinement",
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a serialized refinement request.");
        }
        receivedBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(
          new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    });

    expect(response.broadcastSummaryKo).toContain("사과");
    expect(receivedBody).toEqual({
      ...input,
      outputLanguage: "ko",
      analysisMode: "refinement",
    });
  });

  it("forwards only a validated closed roster identifier", async () => {
    let receivedBody: unknown;
    await requestBroadcastContextDeepseek(
      { ...input, castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID },
      {
        fetchImplementation: (_input, init) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("Expected a serialized context request.");
          }
          receivedBody = JSON.parse(init.body) as unknown;
          return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }));
        },
      },
    );
    expect(receivedBody).toEqual({
      ...input,
      outputLanguage: "ko",
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    });
  });
});
