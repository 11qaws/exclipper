import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_QUOTA_PROXY_ENDPOINT,
  AI_QUOTA_SCHEMA_VERSION,
} from "./aiQuotaProtocol";
import { CANDIDATE_PASS_B_PROXY_ENDPOINT } from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  createCandidatePassBOperationId,
  type CandidatePassBDispatchIntent,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
} from "./candidatePassBWorkerProtocol";
import {
  candidatePassBContextFingerprint,
} from "./candidateFinalVerification";
import {
  currentCandidatePassBContext,
  currentCandidatePassBFrames,
} from "../testSupport/candidatePassBCurrentFixture";

const mediaHarness = vi.hoisted(() => ({
  disposedInputCount: 0,
  hasAudioTrack: true,
}));

vi.mock("mediabunny", () => {
  class FakeInputDisposedError extends Error {}
  class FakeUnsupportedInputFormatError extends Error {}
  class FakeBlobSource {
    public constructor() {}
  }
  class FakeInput {
    public constructor() {}

    public getPrimaryAudioTrack() {
      return Promise.resolve(
        mediaHarness.hasAudioTrack
          ? { canDecode: () => Promise.resolve(true) }
          : null,
      );
    }

    public dispose(): void {
      mediaHarness.disposedInputCount += 1;
    }
  }
  class FakeAudioSampleSink {
    public constructor() {}

    public async *samples() {
      await Promise.resolve();
      const numberOfFrames = 16_000 * 45;
      yield {
        numberOfFrames,
        numberOfChannels: 1,
        sampleRate: 16_000,
        timestamp: 0,
        duration: 45,
        copyTo(destination: Float32Array): void {
          destination.fill(0);
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
  analysisRunId: "analysis-run-1",
  passBRunId: "pass-b-run-1",
  workerEpoch: 1,
  workerInstanceId: "worker-1",
  taskId: "task-1",
};

interface WorkerHarness {
  readonly responses: CandidatePassBWorkerResponse[];
  readonly send: (request: CandidatePassBWorkerRequest) => void;
}

async function startWorkerHarness(): Promise<WorkerHarness> {
  let messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
  const responses: CandidatePassBWorkerResponse[] = [];
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
  await import("./candidatePassB.worker");
  if (messageHandler === null) throw new Error("Worker handler was not installed.");
  return {
    responses,
    send(request) {
      messageHandler!(new MessageEvent("message", { data: request }));
    },
  };
}

function analyzeRequest(): Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-analyze" }
> {
  const context = currentCandidatePassBContext();
  return {
    type: "candidate-pass-b-analyze",
    identity,
    quota: {
      participantId: "participant_11111111111111111111111111111111",
      runId: identity.analysisRunId,
      attemptOrdinal: 0,
      retryGrantId: null,
    },
    file: new File([new Uint8Array([1])], "source.mp4"),
    sourceFingerprint: "source-fingerprint-1",
    sourceDurationMs: 45_000,
    device: CANDIDATE_PASS_B_DEVICE,
    targets: [
      {
        candidateId: "candidate-1",
        startMs: 0,
        endMs: 45_000,
        videoFrames: currentCandidatePassBFrames(),
        frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
        context,
        contextFingerprint: candidatePassBContextFingerprint(context),
        outputLanguage: "ko",
        castRosterId: null,
      },
    ],
  };
}

function healthResponse(
  mode: "paid-direct" | "free-r2" | null = "paid-direct",
): Response {
  return new Response(
    JSON.stringify(
      mode === null
        ? { ok: true }
        : {
            ok: true,
            candidateTransport: { configured: true, mode },
          },
    ),
    { status: 200 },
  );
}

function quotaResponse(): Response {
  return new Response(
    JSON.stringify({
      schemaVersion: AI_QUOTA_SCHEMA_VERSION,
      status: "granted",
      leaseToken: "l".repeat(32),
      leaseExpiresAtMs: Date.now() + 60_000,
      retryAfterMs: 0,
      activeParticipantCount: 1,
      poolInFlightCount: 1,
    }),
    { status: 200 },
  );
}

function providerResponse(includeModelIdentity = true): Response {
  const analysis = {
    segments: [],
    eventSummaryKo: "대표 화면에서 조용히 결과가 바뀌고 성공 상태가 확인된다.",
    reactionSummaryKo: "발화는 없지만 네 화면에서 사건 진행과 결과가 확인된다.",
    whyGoodClipKo: "조용한 성공 사건을 화면 근거로 검토할 가치가 있다.",
    uncertaintiesKo: ["발화가 없어 감정의 세부 원인은 원본 확인이 필요하다."],
    participantPresence: "none-present",
    participantSummaryKo: "네 대표 화면에 사람이나 아바타가 보이지 않는다.",
    identifiedParticipants: [],
    clipDecision: "uncertain",
    contextConsistency: "consistent",
    programMaterial: "streamer-event",
  };
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(analysis) }] },
        },
      ],
    }),
    {
      status: 200,
      ...(includeModelIdentity
        ? {
            headers: {
              [CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER]:
                CANDIDATE_PASS_B_QWEN_MODEL_ID,
              [CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER]:
                CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
            },
          }
        : {}),
    },
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  mediaHarness.disposedInputCount = 0;
  mediaHarness.hasAudioTrack = true;
});

describe("candidatePassB.worker current durable multimodal path", () => {
  it.each([
    ["silent audio", true],
    ["no audio track", false],
  ] as const)(
    "sends four frames for %s and waits for durable arm before provider fetch",
    async (_label, hasAudioTrack) => {
      mediaHarness.hasAudioTrack = hasAudioTrack;
      const fetchCalls: string[] = [];
      const providerBodies: unknown[] = [];
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = requestUrl(input);
          fetchCalls.push(url);
          if (url.endsWith("/healthz")) return Promise.resolve(healthResponse());
          if (url === AI_QUOTA_PROXY_ENDPOINT) {
            return Promise.resolve(quotaResponse());
          }
          if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
            providerBodies.push(
              typeof init?.body === "string"
                ? (JSON.parse(init.body) as unknown)
                : null,
            );
            return Promise.resolve(providerResponse());
          }
          return Promise.resolve(new Response(null, { status: 404 }));
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      const harness = await startWorkerHarness();
      harness.send(analyzeRequest());

      await vi.waitFor(() => {
        expect(
          harness.responses.some(
            ({ type }) => type === "candidate-pass-b-dispatch-intent",
          ),
        ).toBe(true);
      });
      const intentResponse = harness.responses.find(
        (response) => response.type === "candidate-pass-b-dispatch-intent",
      );
      expect(intentResponse?.type).toBe("candidate-pass-b-dispatch-intent");
      const intent = (intentResponse as {
        readonly intent: CandidatePassBDispatchIntent;
      }).intent;
      expect(intent.mediaReceipt.frames).toHaveLength(4);
      expect(intent.mediaReceipt.audio.kind).toBe("verified-no-speech");
      expect(intent.retryGrantId).toBeNull();
      expect(intent.transportMode).toBe("paid-direct");
      await expect(
        createCandidatePassBOperationId({
          analysisRunId: intent.analysisRunId,
          sourceFingerprint: intent.sourceFingerprint,
          candidateId: intent.candidateId,
          sourceStartMs: intent.sourceStartMs,
          sourceEndMs: intent.sourceEndMs,
          contextFingerprint: intent.contextFingerprint,
          outputLanguage: intent.outputLanguage,
          castRosterId: intent.castRosterId,
          routingModelRevision: intent.routingModelRevision,
          attemptOrdinal: intent.attemptOrdinal,
          retryGrantId: intent.retryGrantId,
          transportMode: intent.transportMode,
          providerPayloadDigest:
            intent.mediaReceipt.providerPayloadDigest,
        }),
      ).resolves.toBe(intent.operationId);
      expect(fetchCalls).toEqual([
        "https://rettohighlight-gemini.11qaws.workers.dev/healthz",
      ]);

      harness.send({
        type: "candidate-pass-b-dispatch-arm-ack",
        identity,
        operationId: intent.operationId,
        accepted: true,
      });
      await vi.waitFor(() => {
        expect(
          harness.responses.some(
            ({ type }) => type === "candidate-pass-b-partial-result",
          ),
        ).toBe(true);
      });
      const result = harness.responses.find(
        (response) => response.type === "candidate-pass-b-partial-result",
      );
      expect(result?.type).toBe("candidate-pass-b-partial-result");
      if (result?.type === "candidate-pass-b-partial-result") {
        expect(result.result.settlement.operationId).toBe(intent.operationId);
        expect(
          harness.responses.some(
            ({ type }) => type === "candidate-pass-b-completed",
          ),
        ).toBe(false);
        harness.send({
          type: "candidate-pass-b-terminal-result-ack",
          identity,
          terminalEventId: result.eventId,
          candidateId: result.result.candidateId,
          settlement: result.result.settlement,
          accepted: true,
        });
        expect(result.result.insight.eventSummaryKo).toContain("대표 화면");
      }
      await vi.waitFor(() => {
        expect(
          harness.responses.some(
            ({ type }) => type === "candidate-pass-b-completed",
          ),
        ).toBe(true);
      });
      expect(fetchCalls).toContain(AI_QUOTA_PROXY_ENDPOINT);
      expect(fetchCalls).toContain(CANDIDATE_PASS_B_PROXY_ENDPOINT);
      expect(providerBodies).toHaveLength(1);
      const providerBody = providerBodies[0];
      if (typeof providerBody !== "object" || providerBody === null) {
        throw new Error("Missing provider request body.");
      }
      const providerRecord = providerBody as Record<string, unknown>;
      expect(typeof providerRecord.audioBase64).toBe("string");
      expect(providerRecord.videoFrames).toEqual(currentCandidatePassBFrames());
    },
  );

  it("binds an explicit retry grant and resolved free-R2 transport into the operation ID", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/healthz")) {
        return Promise.resolve(healthResponse("free-r2"));
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    const request = analyzeRequest();
    harness.send({
      ...request,
      quota: {
        ...request.quota,
        attemptOrdinal: 1,
        retryGrantId: "retry-grant-1",
      },
    });

    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-dispatch-intent",
        ),
      ).toBe(true);
    });
    const intentResponse = harness.responses.find(
      (response) => response.type === "candidate-pass-b-dispatch-intent",
    );
    if (intentResponse?.type !== "candidate-pass-b-dispatch-intent") {
      throw new Error("Missing retry dispatch intent.");
    }
    const intent = intentResponse.intent;
    expect(intent.attemptOrdinal).toBe(1);
    expect(intent.retryGrantId).toBe("retry-grant-1");
    expect(intent.transportMode).toBe("free-r2");
    await expect(
      createCandidatePassBOperationId({
        analysisRunId: intent.analysisRunId,
        sourceFingerprint: intent.sourceFingerprint,
        candidateId: intent.candidateId,
        sourceStartMs: intent.sourceStartMs,
        sourceEndMs: intent.sourceEndMs,
        contextFingerprint: intent.contextFingerprint,
        outputLanguage: intent.outputLanguage,
        castRosterId: intent.castRosterId,
        routingModelRevision: intent.routingModelRevision,
        attemptOrdinal: intent.attemptOrdinal,
        retryGrantId: intent.retryGrantId,
        transportMode: intent.transportMode,
        providerPayloadDigest:
          intent.mediaReceipt.providerPayloadDigest,
      }),
    ).resolves.toBe(intent.operationId);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    harness.send({
      type: "candidate-pass-b-dispatch-arm-ack",
      identity,
      operationId: intent.operationId,
      accepted: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.find(
          (response) => response.type === "candidate-pass-b-failed",
        ),
      ).toMatchObject({ reasonCode: "DISPATCH_NOT_ARMED" });
    });
  });

  it("ignores a mismatched terminal ACK and fails on the exact negative ACK", async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.endsWith("/healthz")) {
          return Promise.resolve(healthResponse());
        }
        if (url === AI_QUOTA_PROXY_ENDPOINT) {
          return Promise.resolve(quotaResponse());
        }
        if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
          return Promise.resolve(providerResponse());
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    harness.send(analyzeRequest());
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-dispatch-intent",
        ),
      ).toBe(true);
    });
    const intent = harness.responses.find(
      (response) => response.type === "candidate-pass-b-dispatch-intent",
    );
    if (intent?.type !== "candidate-pass-b-dispatch-intent") {
      throw new Error("Missing dispatch intent.");
    }
    harness.send({
      type: "candidate-pass-b-dispatch-arm-ack",
      identity,
      operationId: intent.intent.operationId,
      accepted: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-partial-result",
        ),
      ).toBe(true);
    });
    const terminal = harness.responses.find(
      (response) => response.type === "candidate-pass-b-partial-result",
    );
    if (terminal?.type !== "candidate-pass-b-partial-result") {
      throw new Error("Missing terminal result.");
    }

    harness.send({
      type: "candidate-pass-b-terminal-result-ack",
      identity,
      terminalEventId: `${terminal.eventId}-late`,
      candidateId: terminal.result.candidateId,
      settlement: terminal.result.settlement,
      accepted: true,
    });
    await Promise.resolve();
    expect(
      harness.responses.some(
        ({ type }) =>
          type === "candidate-pass-b-completed" ||
          type === "candidate-pass-b-failed",
      ),
    ).toBe(false);

    harness.send({
      type: "candidate-pass-b-terminal-result-ack",
      identity,
      terminalEventId: terminal.eventId,
      candidateId: terminal.result.candidateId,
      settlement: terminal.result.settlement,
      accepted: false,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.find(
          (response) => response.type === "candidate-pass-b-failed",
        ),
      ).toMatchObject({ reasonCode: "TERMINAL_NOT_ACKNOWLEDGED" });
    });
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-completed",
      ),
    ).toBe(false);
  });

  it("fails closed when health does not explicitly declare a current transport", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(healthResponse(null)));
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    harness.send(analyzeRequest());

    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-failed",
        ),
      ).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-dispatch-intent",
      ),
    ).toBe(false);
  });

  it("terminalizes an armed response whose provider identity is missing", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/healthz")) return Promise.resolve(healthResponse());
      if (url === AI_QUOTA_PROXY_ENDPOINT) return Promise.resolve(quotaResponse());
      if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
        return Promise.resolve(providerResponse(false));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    harness.send(analyzeRequest());
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-dispatch-intent",
        ),
      ).toBe(true);
    });
    const intent = harness.responses.find(
      (response) => response.type === "candidate-pass-b-dispatch-intent",
    );
    if (intent?.type !== "candidate-pass-b-dispatch-intent") {
      throw new Error("Missing dispatch intent.");
    }
    harness.send({
      type: "candidate-pass-b-dispatch-arm-ack",
      identity,
      operationId: intent.intent.operationId,
      accepted: true,
    });

    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-outcome-unknown",
        ),
      ).toBe(true);
    });
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-partial-result",
      ),
    ).toBe(false);
    const outcome = harness.responses.find(
      (response) => response.type === "candidate-pass-b-outcome-unknown",
    );
    expect(outcome).toMatchObject({
      outcome: {
        candidateId: "candidate-1",
        settlement: {
          operationId: intent.intent.operationId,
          status: "outcome-unknown",
          reason: "armed-dispatch-interrupted",
        },
      },
    });
    if (outcome?.type !== "candidate-pass-b-outcome-unknown") {
      throw new Error("Missing terminal outcome.");
    }
    harness.send({
      type: "candidate-pass-b-terminal-result-ack",
      identity,
      terminalEventId: outcome.eventId,
      candidateId: outcome.outcome.candidateId,
      settlement: outcome.outcome.settlement,
      accepted: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-completed",
        ),
      ).toBe(true);
    });
  });

  it("emits outcome-unknown after an armed provider transport loses both replies", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/healthz")) return Promise.resolve(healthResponse());
      if (url === AI_QUOTA_PROXY_ENDPOINT) return Promise.resolve(quotaResponse());
      if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
        return Promise.reject(new TypeError("connection lost"));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    harness.send(analyzeRequest());
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-dispatch-intent",
        ),
      ).toBe(true);
    });
    const intent = harness.responses.find(
      (response) => response.type === "candidate-pass-b-dispatch-intent",
    );
    if (intent?.type !== "candidate-pass-b-dispatch-intent") {
      throw new Error("Missing dispatch intent.");
    }
    harness.send({
      type: "candidate-pass-b-dispatch-arm-ack",
      identity,
      operationId: intent.intent.operationId,
      accepted: true,
    });

    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-outcome-unknown",
        ),
      ).toBe(true);
    });
    const outcomeResponse = harness.responses.find(
      (response) => response.type === "candidate-pass-b-outcome-unknown",
    );
    expect(outcomeResponse).toMatchObject({
      outcome: {
        settlement: {
          status: "outcome-unknown",
          reason: "quota-outcome-unknown",
          operationId: intent.intent.operationId,
        },
      },
    });
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-completed",
      ),
    ).toBe(false);
    if (outcomeResponse?.type !== "candidate-pass-b-outcome-unknown") {
      throw new Error("Missing outcome-unknown response.");
    }
    harness.send({
      type: "candidate-pass-b-terminal-result-ack",
      identity,
      terminalEventId: outcomeResponse.eventId,
      candidateId: outcomeResponse.outcome.candidateId,
      settlement: outcomeResponse.outcome.settlement,
      accepted: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-completed",
        ),
      ).toBe(true);
    });
  });

  it("acknowledges cancellation only after the armed operation is durably terminal", async () => {
    let providerStarted = false;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.endsWith("/healthz")) {
          return Promise.resolve(healthResponse());
        }
        if (url === AI_QUOTA_PROXY_ENDPOINT) {
          return Promise.resolve(quotaResponse());
        }
        if (url === CANDIDATE_PASS_B_PROXY_ENDPOINT) {
          providerStarted = true;
          return new Promise<Response>((_resolve, reject) => {
            const rejectAsAborted = () =>
              reject(new DOMException("aborted", "AbortError"));
            if (init?.signal?.aborted) {
              rejectAsAborted();
              return;
            }
            init?.signal?.addEventListener("abort", rejectAsAborted, {
              once: true,
            });
          });
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = await startWorkerHarness();
    harness.send(analyzeRequest());
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-dispatch-intent",
        ),
      ).toBe(true);
    });
    const intent = harness.responses.find(
      (response) => response.type === "candidate-pass-b-dispatch-intent",
    );
    if (intent?.type !== "candidate-pass-b-dispatch-intent") {
      throw new Error("Missing dispatch intent.");
    }
    harness.send({
      type: "candidate-pass-b-dispatch-arm-ack",
      identity,
      operationId: intent.intent.operationId,
      accepted: true,
    });
    await vi.waitFor(() => expect(providerStarted).toBe(true));

    harness.send({
      type: "candidate-pass-b-cancel",
      identity,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-outcome-unknown",
        ),
      ).toBe(true);
    });
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-cancel-acknowledged",
      ),
    ).toBe(false);
    const outcome = harness.responses.find(
      (response) => response.type === "candidate-pass-b-outcome-unknown",
    );
    if (outcome?.type !== "candidate-pass-b-outcome-unknown") {
      throw new Error("Missing cancellation terminal outcome.");
    }
    expect(outcome.outcome.settlement.operationId).toBe(
      intent.intent.operationId,
    );
    harness.send({
      type: "candidate-pass-b-terminal-result-ack",
      identity,
      terminalEventId: outcome.eventId,
      candidateId: outcome.outcome.candidateId,
      settlement: outcome.outcome.settlement,
      accepted: true,
    });
    await vi.waitFor(() => {
      expect(
        harness.responses.some(
          ({ type }) => type === "candidate-pass-b-cancel-acknowledged",
        ),
      ).toBe(true);
    });
    expect(
      harness.responses.some(
        ({ type }) => type === "candidate-pass-b-completed",
      ),
    ).toBe(false);
  });
});
