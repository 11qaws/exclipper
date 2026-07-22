import { describe, expect, it, vi } from "vitest";

import {
  BROADCAST_CONTEXT_PROXY_ENDPOINT,
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
    expect(JSON.parse(typeof body === "string" ? body : "null")).toEqual(input);
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
    expect(receivedBody).toEqual({ ...input, analysisMode: "refinement" });
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
      castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    });
  });
});
