import { afterEach, describe, expect, it, vi } from "vitest";

import { CANDIDATE_PASS_B_PROXY_ENDPOINT } from "./candidatePassBGemini";
import {
  CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
  CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
  CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
} from "./candidateInsightMediaProtocol";
import {
  AI_QUOTA_PROXY_ENDPOINT,
  AI_QUOTA_SCHEMA_VERSION,
} from "./aiQuotaProtocol";
import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
} from "./candidatePassBWorkerProtocol";

const mediaHarness = vi.hoisted(() => ({ disposedInputCount: 0 }));

vi.mock("mediabunny", () => {
  class FakeInputDisposedError extends Error {}
  class FakeUnsupportedInputFormatError extends Error {}
  class FakeBlobSource {
    public constructor() {}
  }
  class FakeInput {
    public constructor() {}

    public getPrimaryAudioTrack() {
      return Promise.resolve({ canDecode: () => Promise.resolve(true) });
    }

    public dispose(): void {
      mediaHarness.disposedInputCount += 1;
    }
  }
  class FakeAudioSampleSink {
    public constructor() {}

    public async *samples() {
      await Promise.resolve();
      const numberOfFrames = 16_000 * 30;
      yield {
        numberOfFrames,
        numberOfChannels: 1,
        sampleRate: 16_000,
        timestamp: 0,
        duration: 30,
        copyTo(destination: Float32Array): void {
          for (let index = 0; index < numberOfFrames; index += 1) {
            destination[index] =
              Math.sin((2 * Math.PI * 440 * index) / 16_000) * 0.08;
          }
        },
        close(): void {},
      };
    }
  }
  return {
    ALL_FORMATS: [],
    AudioSampleSink: FakeAudioSampleSink,
    BlobSource: FakeBlobSource,
    Input: FakeInput,
    InputDisposedError: FakeInputDisposedError,
    UnsupportedInputFormatError: FakeUnsupportedInputFormatError,
  };
});

const identity: CandidatePassBWorkerIdentity = {
  sessionId: "session-1",
  writerEpoch: 1,
  analysisRunId: "analysis-1",
  passBRunId: "pass-b-1",
  workerEpoch: 1,
  workerInstanceId: "worker-1",
  taskId: "task-1",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  mediaHarness.disposedInputCount = 0;
});

describe("candidatePassB.worker remote lifecycle", () => {
  it("posts only candidate audio to the fixed proxy and aborts before acknowledging cancellation", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    const fakeSelf = {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") {
          messageHandler = handler;
        }
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    };
    let fetchSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          fetchSignal = init?.signal ?? null;
          fetchSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("self", fakeSelf);
    vi.stubGlobal("fetch", fetchMock);

    await import("./candidatePassB.worker");
    expect(messageHandler).not.toBeNull();

    const analyzeRequest: CandidatePassBWorkerRequest = {
      type: "candidate-pass-b-analyze",
      identity,
      file: new File([new Uint8Array([1])], "source.mp4"),
      sourceDurationMs: 30_000,
      device: CANDIDATE_PASS_B_DEVICE,
      targets: [{ candidateId: "candidate-1", startMs: 0, endMs: 30_000 }],
    };
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", { data: analyzeRequest }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe(CANDIDATE_PASS_B_PROXY_ENDPOINT);
    expect(firstCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const rawProxyBody = firstCall?.[1]?.body;
    expect(typeof rawProxyBody).toBe("string");
    if (typeof rawProxyBody !== "string") {
      throw new TypeError("Expected a serialized proxy request body.");
    }
    const proxyBody = JSON.parse(rawProxyBody) as Record<string, unknown>;
    expect(Object.keys(proxyBody)).toEqual(["audioBase64", "candidateDurationMs"]);
    expect(proxyBody.candidateDurationMs).toBe(30_000);
    expect(proxyBody.audioBase64).toEqual(expect.stringMatching(/^UklGR/));
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(false);

    const cancelRequest: CandidatePassBWorkerRequest = {
      type: "candidate-pass-b-cancel",
      identity,
    };
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", { data: cancelRequest }),
    );

    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(
      responses.some(
        (response) => response.type === "candidate-pass-b-cancel-acknowledged",
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(mediaHarness.disposedInputCount).toBe(1));
    expect(
      responses.some((response) => response.type === "candidate-pass-b-failed"),
    ).toBe(false);
  });

  it("isolates a proxy-invalid Gemini response as one candidate gap and continues", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    const fakeSelf = {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") {
          messageHandler = handler;
        }
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    };
    const validAnalysis = {
      segments: [
        { relativeStartMs: 1_000, relativeEndMs: 2_000, text: "정말 대박" },
      ],
      eventSummaryKo: "짧은 한국어 발화가 들려요.",
      reactionSummaryKo: "목소리가 잠시 커지는 반응 단서가 들려요.",
      whyGoodClipKo: "발화와 소리 변화가 가까워 먼저 확인할 만해요.",
      uncertaintiesKo: ["화자와 화면 사건은 오디오만으로 알 수 없어요."],
      participantPresence: "insufficient-evidence",
      participantSummaryKo: "대표 화면이 없어 등장인물을 확인하지 못했습니다.",
      identifiedParticipants: [],
    };
    const fetchMock = vi
      .fn<(_input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "UPSTREAM_INVALID_RESPONSE",
              message: "Gemini 응답을 확인하지 못했어요.",
            },
          }),
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify(validAnalysis) }] },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]:
                CANDIDATE_PASS_B_GEMINI_MODEL_ID,
              [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]:
                CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
            },
          },
        ),
      );
    vi.stubGlobal("self", fakeSelf);
    vi.stubGlobal("fetch", fetchMock);

    await import("./candidatePassB.worker");
    const analyzeRequest: CandidatePassBWorkerRequest = {
      type: "candidate-pass-b-analyze",
      identity,
      file: new File([new Uint8Array([1])], "source.mp4"),
      sourceDurationMs: 30_000,
      device: CANDIDATE_PASS_B_DEVICE,
      targets: [
        { candidateId: "candidate-1", startMs: 0, endMs: 30_000 },
        { candidateId: "candidate-2", startMs: 0, endMs: 30_000 },
      ],
    };
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", { data: analyzeRequest }),
    );

    await vi.waitFor(() =>
      expect(
        responses.some((response) => response.type === "candidate-pass-b-completed"),
      ).toBe(true),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      responses.find((response) => response.type === "candidate-pass-b-candidate-gap"),
    ).toMatchObject({
      gap: { candidateId: "candidate-1", reasonCode: "TRANSCRIPTION_FAILED" },
    });
    expect(
      responses.find((response) => response.type === "candidate-pass-b-partial-result"),
    ).toMatchObject({
      result: {
        candidateId: "candidate-2",
        model: {
          id: CANDIDATE_PASS_B_GEMINI_MODEL_ID,
          revision: CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
        },
      },
    });
    expect(
      responses.find((response) => response.type === "candidate-pass-b-completed"),
    ).toMatchObject({
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });
    expect(
      responses.some((response) => response.type === "candidate-pass-b-failed"),
    ).toBe(false);
  });

  it("starts the next candidate request before the previous Gemini response arrives", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    const deferredResponses: Array<(response: Response) => void> = [];
    const validAnalysis = {
      segments: [
        { relativeStartMs: 1_000, relativeEndMs: 2_000, text: "테스트 발화" },
      ],
      eventSummaryKo: "후보 사건 요약",
      reactionSummaryKo: "스트리머 반응 요약",
      whyGoodClipKo: "반응이 분명한 후보",
      uncertaintiesKo: ["화면 맥락은 재생 확인이 필요합니다."],
      participantPresence: "insufficient-evidence",
      participantSummaryKo: "대표 화면이 없어 등장인물을 확인하지 못했습니다.",
      identifiedParticipants: [],
    };
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          deferredResponses.push(resolve);
        }),
    );
    vi.stubGlobal("self", {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") {
          messageHandler = handler;
        }
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("./candidatePassB.worker");
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", {
        data: {
          type: "candidate-pass-b-analyze",
          identity,
          file: new File([new Uint8Array([1])], "source.mp4"),
          sourceDurationMs: 60_000,
          device: CANDIDATE_PASS_B_DEVICE,
          targets: [
            { candidateId: "candidate-1", startMs: 0, endMs: 30_000 },
            { candidateId: "candidate-2", startMs: 0, endMs: 30_000 },
          ],
        } satisfies CandidatePassBWorkerRequest,
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(deferredResponses).toHaveLength(2);
    for (const resolve of deferredResponses) {
      resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify(validAnalysis) }] },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }
    await vi.waitFor(() =>
      expect(
        responses.some((response) => response.type === "candidate-pass-b-completed"),
      ).toBe(true),
    );
    expect(
      responses.find((response) => response.type === "candidate-pass-b-completed"),
    ).toMatchObject({ summary: { requestedCount: 2, completedCount: 2, gapCount: 0 } });
  });

  it("stages raw media and re-stages exactly once after an explicit expired-ticket response", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    const calls: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];
    const mediaTickets = [
      `v1.${"a".repeat(96)}.${"b".repeat(43)}`,
      `v1.${"c".repeat(96)}.${"d".repeat(43)}`,
    ] as const;
    let stageCount = 0;
    let resolveCount = 0;
    const validAnalysis = {
      segments: [
        { relativeStartMs: 1_000, relativeEndMs: 2_000, text: "실제 한국어 발화" },
      ],
      eventSummaryKo: "화면과 대사를 함께 확인한 후보 사건입니다.",
      reactionSummaryKo: "스트리머가 사건을 알아차리고 놀라 반응합니다.",
      whyGoodClipKo: "사건과 반응의 인과관계가 분명한 장면입니다.",
      uncertaintiesKo: [],
      participantPresence: "present-unidentified",
      participantSummaryKo: "화면에 진행자가 있으나 이름은 확인되지 않았습니다.",
      identifiedParticipants: [],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
    };
    const fetchMock = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        await Promise.resolve();
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        calls.push({ url, init });
        if (url === `${new URL(CANDIDATE_PASS_B_PROXY_ENDPOINT).origin}/healthz`) {
          return new Response(
            JSON.stringify({
              ok: true,
              candidateTransport: { mode: "free-r2", configured: true },
            }),
            { status: 200 },
          );
        }
        if (url === AI_QUOTA_PROXY_ENDPOINT) {
          return new Response(
            JSON.stringify({
              schemaVersion: AI_QUOTA_SCHEMA_VERSION,
              status: "granted",
              leaseToken: `lease_${"a".repeat(40)}`,
              leaseExpiresAtMs: Date.now() + 60_000,
              retryAfterMs: 0,
              activeParticipantCount: 1,
              poolInFlightCount: 1,
            }),
            { status: 200 },
          );
        }
        if (
          new URL(url).pathname === CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH
        ) {
          expect(init?.headers).toMatchObject({
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE,
          });
          expect(init?.body).toBeInstanceOf(Uint8Array);
          const bundle = init?.body as Uint8Array;
          expect(new TextDecoder().decode(bundle.slice(0, 4))).toBe("RIFF");
          expect(bundle.byteLength).toBe(960_044 + 4 * 7);
          const mediaTicket = mediaTickets[stageCount];
          stageCount += 1;
          if (mediaTicket === undefined) {
            throw new Error("Candidate media was staged more than twice.");
          }
          return new Response(
            JSON.stringify({
              schemaVersion: CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
              status: "staged",
              mediaTicket,
              expiresAtMs: Date.now() + 60_000,
              candidateHash: new URL(url).searchParams.get("candidateHash"),
              candidateDurationMs: 30_000,
              frameCount: 4,
            }),
            { status: 202 },
          );
        }
        if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
          expect(init?.headers).toMatchObject({
            "Content-Type": CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE,
          });
          resolveCount += 1;
          if (resolveCount === 1) {
            return new Response(
              JSON.stringify({
                error: {
                  code: "CANDIDATE_MEDIA_TICKET_INVALID",
                  message: "Candidate media ticket expired.",
                },
              }),
              { status: 409 },
            );
          }
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: JSON.stringify(validAnalysis) }] },
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    );
    vi.stubGlobal("self", {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") messageHandler = handler;
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("./candidatePassB.worker");
    const jpegBase64 = btoa(
      String.fromCharCode(0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9),
    );
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", {
        data: {
          type: "candidate-pass-b-analyze",
          identity,
          quota: {
            participantId: "participant_00000000000001",
            runId: "run-candidate-r2",
            attemptOrdinal: 2,
          },
          file: new File([new Uint8Array([1])], "source.mp4"),
          sourceDurationMs: 30_000,
          device: CANDIDATE_PASS_B_DEVICE,
          targets: [
            {
              candidateId: "candidate-stable-id",
              startMs: 0,
              endMs: 30_000,
              videoFrames: [1_000, 5_000, 10_000, 20_000].map(
                (timestampMs) => ({
                  timestampMs,
                  mimeType: "image/jpeg" as const,
                  dataBase64: jpegBase64,
                }),
              ),
            },
          ],
        } satisfies CandidatePassBWorkerRequest,
      }),
    );

    await vi.waitFor(() =>
      expect(
        responses.some(
          (response) => response.type === "candidate-pass-b-completed",
        ),
      ).toBe(true),
    );
    const stageCall = calls.find(
      (call) =>
        new URL(call.url).pathname === CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH,
    );
    expect(stageCall).toBeDefined();
    expect(stageCount).toBe(2);
    expect(resolveCount).toBe(2);
    const resolveCalls = calls.filter(
      (call) => call.url === CANDIDATE_PASS_B_PROXY_ENDPOINT,
    );
    expect(resolveCalls).toHaveLength(2);
    expect(typeof resolveCalls[0]?.init?.body).toBe("string");
    expect((resolveCalls[0]?.init?.body as string).length).toBeLessThan(2_000);
    expect(resolveCalls[0]?.init?.body).toContain(mediaTickets[0]);
    expect(resolveCalls[1]?.init?.body).toContain(mediaTickets[1]);
    const quotaCalls = calls.filter(
      (call) => call.url === AI_QUOTA_PROXY_ENDPOINT,
    );
    expect(quotaCalls).toHaveLength(2);
    const operationIds = quotaCalls.map((call) => {
      const quotaBody = call.init?.body;
      if (typeof quotaBody !== "string") {
        throw new TypeError("Expected a JSON quota request.");
      }
      const quotaRequest: unknown = JSON.parse(quotaBody);
      expect(quotaRequest).toBeTypeOf("object");
      return (quotaRequest as Record<string, unknown>).operationId;
    });
    expect(operationIds[0]).toMatch(
      /^candidate-g2-[a-f0-9]{24}-0-30000-m0\./,
    );
    expect(operationIds[1]).toMatch(
      /^candidate-g2-[a-f0-9]{24}-0-30000-m1\./,
    );
  });

  it("does not cache a 503 transport, then shares a healthy lookup for sixty seconds", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    let nowMs = Date.UTC(2026, 6, 27, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    let healthCallCount = 0;
    const validAnalysis = {
      segments: [
        { relativeStartMs: 1_000, relativeEndMs: 2_000, text: "테스트 발화" },
      ],
      eventSummaryKo: "후보 사건과 반응이 이어지는 장면입니다.",
      reactionSummaryKo: "스트리머가 상황을 알아차리고 반응합니다.",
      whyGoodClipKo: "사건과 반응의 인과관계가 분명합니다.",
      uncertaintiesKo: [],
      participantPresence: "insufficient-evidence",
      participantSummaryKo: "대표 화면 근거가 없어 인물을 특정하지 않았습니다.",
      identifiedParticipants: [],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        await Promise.resolve();
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url === `${new URL(CANDIDATE_PASS_B_PROXY_ENDPOINT).origin}/healthz`) {
          healthCallCount += 1;
          if (healthCallCount === 1) {
            return new Response(
              JSON.stringify({
                ok: false,
                candidateTransport: {
                  mode: "free-r2",
                  configured: true,
                },
              }),
              { status: 503 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url === AI_QUOTA_PROXY_ENDPOINT) {
          return new Response(
            JSON.stringify({
              schemaVersion: AI_QUOTA_SCHEMA_VERSION,
              status: "granted",
              leaseToken: `lease_${"a".repeat(40)}`,
              leaseExpiresAtMs: nowMs + 60_000,
              retryAfterMs: 0,
              activeParticipantCount: 1,
              poolInFlightCount: 1,
            }),
            { status: 200 },
          );
        }
        if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: JSON.stringify(validAnalysis) }] },
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    );
    vi.stubGlobal("self", {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") messageHandler = handler;
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await import("./candidatePassB.worker");
      const runOneCandidate = async (ordinal: number): Promise<void> => {
        const terminalBefore = responses.filter(
          (response) =>
            response.type === "candidate-pass-b-completed" ||
            response.type === "candidate-pass-b-failed",
        ).length;
        const requestIdentity: CandidatePassBWorkerIdentity = {
          ...identity,
          analysisRunId: `analysis-cache-${ordinal}`,
          passBRunId: `pass-b-cache-${ordinal}`,
          taskId: `task-cache-${ordinal}`,
        };
        messageHandler?.(
          new MessageEvent("message", {
            data: {
              type: "candidate-pass-b-analyze",
              identity: requestIdentity,
              quota: {
                participantId: "participant_00000000000001",
                runId: `run-cache-${ordinal}`,
              },
              file: new File([new Uint8Array([1])], "source.mp4"),
              sourceDurationMs: 30_000,
              device: CANDIDATE_PASS_B_DEVICE,
              targets: Array.from(
                { length: ordinal === 1 ? 2 : 1 },
                (_, targetIndex) => ({
                  candidateId: `candidate-cache-${ordinal}-${targetIndex}`,
                  startMs: 0,
                  endMs: 30_000,
                }),
              ),
            } satisfies CandidatePassBWorkerRequest,
          }),
        );
        await vi.waitFor(() =>
          expect(
            responses.filter(
              (response) =>
                response.type === "candidate-pass-b-completed" ||
                response.type === "candidate-pass-b-failed",
            ),
          ).toHaveLength(terminalBefore + 1),
        );
      };

      await runOneCandidate(0);
      expect(healthCallCount).toBe(1);
      await runOneCandidate(1);
      expect(healthCallCount).toBe(2);
      nowMs += 59_999;
      await runOneCandidate(2);
      expect(healthCallCount).toBe(2);
      nowMs += 2;
      await runOneCandidate(3);
      expect(healthCallCount).toBe(3);
      expect(
        responses.filter(
          (response) => response.type === "candidate-pass-b-failed",
        ),
      ).toHaveLength(1);
      expect(
        responses.filter(
          (response) => response.type === "candidate-pass-b-completed",
        ),
      ).toHaveLength(3);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("maps a network rejection to a key-free safe Worker failure", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    vi.stubGlobal("self", {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") {
          messageHandler = handler;
        }
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error("raw network detail containing private infrastructure detail"),
      ),
    );

    await import("./candidatePassB.worker");
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", {
        data: {
          type: "candidate-pass-b-analyze",
          identity,
          file: new File([new Uint8Array([1])], "source.mp4"),
          sourceDurationMs: 30_000,
          device: CANDIDATE_PASS_B_DEVICE,
          targets: [{ candidateId: "candidate-1", startMs: 0, endMs: 30_000 }],
        } satisfies CandidatePassBWorkerRequest,
      }),
    );

    await vi.waitFor(() =>
      expect(
        responses.some((response) => response.type === "candidate-pass-b-failed"),
      ).toBe(true),
    );
    const failure = responses.find(
      (response) => response.type === "candidate-pass-b-failed",
    );
    expect(failure).toMatchObject({ reasonCode: "PROXY_UNAVAILABLE" });
    expect(JSON.stringify(failure)).not.toContain("private infrastructure detail");
    expect(JSON.stringify(failure)).not.toContain("raw network detail");
  });

  it("rejects a candidate longer than sixty seconds before decoding or sending", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
    const responses: CandidatePassBWorkerResponse[] = [];
    const fetchMock = vi.fn();
    vi.stubGlobal("self", {
      crypto: globalThis.crypto,
      addEventListener(
        type: string,
        handler: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") {
          messageHandler = handler;
        }
      },
      postMessage(message: CandidatePassBWorkerResponse): void {
        responses.push(message);
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("./candidatePassB.worker");
    (messageHandler as ((event: MessageEvent<unknown>) => void) | null)?.(
      new MessageEvent("message", {
        data: {
          type: "candidate-pass-b-analyze",
          identity,
          file: new File([new Uint8Array([1])], "source.mp4"),
          sourceDurationMs: 180_000,
          device: CANDIDATE_PASS_B_DEVICE,
          targets: [
            { candidateId: "candidate-too-long", startMs: 0, endMs: 60_001 },
          ],
        },
      }),
    );

    await vi.waitFor(() =>
      expect(
        responses.some((response) => response.type === "candidate-pass-b-failed"),
      ).toBe(true),
    );
    expect(responses[0]).toMatchObject({ reasonCode: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mediaHarness.disposedInputCount).toBe(0);
  });
});
