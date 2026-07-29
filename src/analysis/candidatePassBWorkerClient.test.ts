import { describe, expect, it, vi } from "vitest";
import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_TASK,
  runCandidatePassBWorker,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerError,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerLike,
} from "./candidatePassBWorkerClient";
import {
  CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
  createCandidatePassBOperationId,
  type CandidatePassBDispatchIntent,
  type CandidatePassBQuotaIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponsePayload,
} from "./candidatePassBWorkerProtocol";
import {
  candidatePassBContextFingerprint,
} from "./candidateFinalVerification";
import {
  currentCandidatePassBContext,
  currentCandidatePassBDispatch,
  currentCandidatePassBFrames,
  currentCandidatePassBInsight,
  currentCandidatePassBSettlement,
} from "../testSupport/candidatePassBCurrentFixture";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const identity: CandidatePassBWorkerIdentity = {
  sessionId: "session-1",
  writerEpoch: 1,
  analysisRunId: "analysis-run-1",
  passBRunId: "pass-b-run-1",
  workerEpoch: 1,
  workerInstanceId: "worker-1",
  taskId: "task-1",
};
const context = currentCandidatePassBContext();
const target = {
  candidateId: "candidate-1",
  startMs: 60_000,
  endMs: 105_000,
  videoFrames: currentCandidatePassBFrames(),
  frameExtractionRevision: CANDIDATE_PASS_B_FRAME_EXTRACTION_REVISION,
  context,
  contextFingerprint: candidatePassBContextFingerprint(context),
  outputLanguage: "ko",
  castRosterId: null,
} as const;

class FakeWorker implements CandidatePassBWorkerLike {
  public readonly listeners = new Map<WorkerEventType, Set<WorkerListener>>();
  public readonly requests: CandidatePassBWorkerRequest[] = [];
  public terminateCount = 0;

  public addEventListener(type: WorkerEventType, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: WorkerEventType, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public postMessage(message: CandidatePassBWorkerRequest): void {
    this.requests.push(message);
  }

  public terminate(): void {
    this.terminateCount += 1;
  }

  public emitMessage(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }

  public emitError(): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({} as ErrorEvent);
    }
  }
}

function emit(
  worker: FakeWorker,
  eventId: string,
  payload: CandidatePassBWorkerResponsePayload,
): void {
  worker.emitMessage({ ...identity, eventId, ...payload });
}

function transcriptFor(
  dispatch: CandidatePassBDispatchIntent,
): CandidatePassBTranscriptResult {
  const settlement = currentCandidatePassBSettlement(dispatch);
  return {
    mode: "candidate-pass-b-transcript",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    text: "",
    segments: [],
    insight: currentCandidatePassBInsight(),
    model: {
      id: settlement.providerModelId,
      revision: settlement.providerModelRevision,
      dtype: CANDIDATE_PASS_B_DTYPE,
      device: CANDIDATE_PASS_B_DEVICE,
    },
    language: CANDIDATE_PASS_B_LANGUAGE,
    task: CANDIDATE_PASS_B_TASK,
    sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    settlement,
  };
}

function start(
  worker: FakeWorker,
  onDispatchIntent: (intent: CandidatePassBDispatchIntent) => Promise<boolean>,
  options?: {
    readonly quota?: CandidatePassBQuotaIdentity;
    readonly signal?: AbortSignal;
    readonly onPartialResult?: (
      result: CandidatePassBTranscriptResult,
    ) => Promise<boolean>;
    readonly onOutcomeUnknown?: Parameters<
      typeof runCandidatePassBWorker
    >[1]["onOutcomeUnknown"];
  },
) {
  return runCandidatePassBWorker(
    new File([new Uint8Array([1])], "source.mp4", { type: "video/mp4" }),
    {
      identity,
      quota:
        options?.quota ?? {
          participantId: "participant_11111111111111111111111111111111",
          runId: identity.analysisRunId,
          attemptOrdinal: 0,
          retryGrantId: null,
        },
      sourceFingerprint: "source-fingerprint-1",
      sourceDurationMs: 180_000,
      device: CANDIDATE_PASS_B_DEVICE,
      targets: [target],
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      workerFactory: () => worker,
      onDispatchIntent,
      onPartialResult:
        options?.onPartialResult ?? (() => Promise.resolve(true)),
      onOutcomeUnknown:
        options?.onOutcomeUnknown ?? (() => Promise.resolve(true)),
    },
  );
}

async function currentDispatch(
  attempt: {
    readonly attemptOrdinal: number;
    readonly retryGrantId: string | null;
  } = { attemptOrdinal: 0, retryGrantId: null },
): Promise<CandidatePassBDispatchIntent> {
  const dispatch = {
    ...currentCandidatePassBDispatch(context),
    ...attempt,
  };
  return {
    ...dispatch,
    operationId: await createCandidatePassBOperationId({
      analysisRunId: dispatch.analysisRunId,
      sourceFingerprint: dispatch.sourceFingerprint,
      candidateId: dispatch.candidateId,
      sourceStartMs: dispatch.sourceStartMs,
      sourceEndMs: dispatch.sourceEndMs,
      contextFingerprint: dispatch.contextFingerprint,
      outputLanguage: dispatch.outputLanguage,
      castRosterId: dispatch.castRosterId,
      routingModelRevision: dispatch.routingModelRevision,
      attemptOrdinal: dispatch.attemptOrdinal,
      retryGrantId: dispatch.retryGrantId,
      transportMode: dispatch.transportMode,
      providerPayloadDigest:
        dispatch.mediaReceipt.providerPayloadDigest,
    }),
  };
}

describe("runCandidatePassBWorker durable dispatch", () => {
  it("does not acknowledge the Worker until durable arm readback resolves", async () => {
    const worker = new FakeWorker();
    let resolveArm!: (accepted: boolean) => void;
    const arm = new Promise<boolean>((resolve) => {
      resolveArm = resolve;
    });
    const promise = start(worker, () => arm);
    const dispatch = await currentDispatch();

    emit(worker, "event-intent", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await Promise.resolve();
    expect(worker.requests).toHaveLength(1);

    resolveArm(true);
    await vi.waitFor(() => {
      expect(worker.requests[1]).toMatchObject({
        type: "candidate-pass-b-dispatch-arm-ack",
        operationId: dispatch.operationId,
        accepted: true,
      });
    });

    emit(worker, "event-result", {
      type: "candidate-pass-b-partial-result",
      result: transcriptFor(dispatch),
    });
    await vi.waitFor(() => {
      expect(worker.requests.at(-1)).toMatchObject({
        type: "candidate-pass-b-terminal-result-ack",
        terminalEventId: "event-result",
        candidateId: target.candidateId,
        settlement: transcriptFor(dispatch).settlement,
        accepted: true,
      });
    });
    emit(worker, "event-result-progress", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: target.candidateId,
        candidateOrdinal: 1,
        targetCount: 1,
        stage: "complete",
        ratio: 1,
      },
    });
    emit(worker, "event-complete", {
      type: "candidate-pass-b-completed",
      summary: { requestedCount: 1, completedCount: 1, gapCount: 0 },
    });
    await expect(promise).resolves.toMatchObject({
      results: [{ candidateId: "candidate-1" }],
      outcomeUnknowns: [],
    });
  });

  it("does not ACK or finish a completed result before durable readback resolves", async () => {
    const worker = new FakeWorker();
    let resolveReadback!: (accepted: boolean) => void;
    const readback = new Promise<boolean>((resolve) => {
      resolveReadback = resolve;
    });
    const promise = start(worker, () => Promise.resolve(true), {
      onPartialResult: () => readback,
    });
    const dispatch = await currentDispatch();
    emit(worker, "event-intent-terminal-barrier", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));

    emit(worker, "event-result-terminal-barrier", {
      type: "candidate-pass-b-partial-result",
      result: transcriptFor(dispatch),
    });
    await Promise.resolve();
    expect(
      worker.requests.filter(
        ({ type }) => type === "candidate-pass-b-terminal-result-ack",
      ),
    ).toHaveLength(0);
    let finished = false;
    void promise.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    await Promise.resolve();
    expect(finished).toBe(false);

    resolveReadback(true);
    await vi.waitFor(() => {
      expect(worker.requests.at(-1)).toMatchObject({
        type: "candidate-pass-b-terminal-result-ack",
        terminalEventId: "event-result-terminal-barrier",
        accepted: true,
      });
    });
    emit(worker, "event-complete-terminal-barrier", {
      type: "candidate-pass-b-completed",
      summary: { requestedCount: 1, completedCount: 1, gapCount: 0 },
    });
    await expect(promise).resolves.toMatchObject({
      results: [{ candidateId: target.candidateId }],
    });
  });

  it.each([
    {
      label: "returns false",
      callback: () => Promise.resolve(false),
    },
    {
      label: "throws",
      callback: () => Promise.reject(new Error("durable storage failed")),
    },
  ])(
    "returns a negative terminal ACK and cancels when durable storage $label",
    async ({ callback }) => {
      const worker = new FakeWorker();
      const promise = start(worker, () => Promise.resolve(true), {
        onPartialResult: callback,
      });
      const dispatch = await currentDispatch();
      emit(worker, "event-intent-storage-failure", {
        type: "candidate-pass-b-dispatch-intent",
        intent: dispatch,
      });
      await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
      emit(worker, "event-result-storage-failure", {
        type: "candidate-pass-b-partial-result",
        result: transcriptFor(dispatch),
      });
      await vi.waitFor(() => {
        expect(worker.requests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "candidate-pass-b-terminal-result-ack",
              terminalEventId: "event-result-storage-failure",
              accepted: false,
            }),
            expect.objectContaining({
              type: "candidate-pass-b-cancel",
            }),
          ]),
        );
      });
      emit(worker, `event-cancel-${worker.requests.length}`, {
        type: "candidate-pass-b-cancel-acknowledged",
      });
      await expect(promise).rejects.toMatchObject({
        code: "RESULT_CALLBACK_FAILED",
      });
    },
  );

  it("drains an in-progress terminal readback before rejecting a crashed Worker", async () => {
    const worker = new FakeWorker();
    let resolveReadback!: (accepted: boolean) => void;
    const readback = new Promise<boolean>((resolve) => {
      resolveReadback = resolve;
    });
    const onOutcomeUnknown = vi.fn(() => Promise.resolve(true));
    const promise = start(worker, () => Promise.resolve(true), {
      onPartialResult: () => readback,
      onOutcomeUnknown,
    });
    const dispatch = await currentDispatch();
    emit(worker, "event-intent-before-crash", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    emit(worker, "event-result-before-crash", {
      type: "candidate-pass-b-partial-result",
      result: transcriptFor(dispatch),
    });
    await Promise.resolve();
    worker.emitError();
    let runSettled = false;
    void promise.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      },
    );
    await Promise.resolve();
    expect(runSettled).toBe(false);

    resolveReadback(true);
    await expect(promise).rejects.toMatchObject({ code: "WORKER_FAILED" });
    expect(
      worker.requests.filter(
        ({ type }) => type === "candidate-pass-b-terminal-result-ack",
      ),
    ).toHaveLength(0);
    expect(onOutcomeUnknown).not.toHaveBeenCalled();
  });

  it("persists an armed dispatch as outcome-unknown before rejecting a crashed Worker", async () => {
    const worker = new FakeWorker();
    let resolveArm!: (accepted: boolean) => void;
    const arm = new Promise<boolean>((resolve) => {
      resolveArm = resolve;
    });
    let resolveOutcomeUnknown!: (accepted: boolean) => void;
    const outcomeUnknownReadback = new Promise<boolean>((resolve) => {
      resolveOutcomeUnknown = resolve;
    });
    const onOutcomeUnknown = vi.fn(() => outcomeUnknownReadback);
    const promise = start(worker, () => arm, { onOutcomeUnknown });
    const dispatch = await currentDispatch();

    emit(worker, "event-intent-before-arm-crash", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await Promise.resolve();
    worker.emitError();
    resolveArm(true);

    await vi.waitFor(() => {
      expect(onOutcomeUnknown).toHaveBeenCalledWith({
        candidateId: target.candidateId,
        sourceStartMs: target.startMs,
        sourceEndMs: target.endMs,
        settlement: {
          schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
          status: "outcome-unknown",
          operationId: dispatch.operationId,
          providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
          outputLanguage: dispatch.outputLanguage,
          castRosterId: dispatch.castRosterId,
          reason: "armed-dispatch-interrupted",
        },
      });
    });
    expect(worker.terminateCount).toBe(0);

    resolveOutcomeUnknown(true);
    await expect(promise).rejects.toMatchObject({ code: "WORKER_FAILED" });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a result whose settlement was not preceded by an armed dispatch", async () => {
    const worker = new FakeWorker();
    const promise = start(worker, () => Promise.resolve(true));
    const dispatch = await currentDispatch();

    emit(worker, "event-result", {
      type: "candidate-pass-b-partial-result",
      result: transcriptFor(dispatch),
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    } satisfies Partial<CandidatePassBWorkerError>);
  });

  it("rejects a paid result that omits a current decision field", async () => {
    const worker = new FakeWorker();
    const promise = start(worker, () => Promise.resolve(true));
    const dispatch = await currentDispatch();
    emit(worker, "event-intent", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    const result = transcriptFor(dispatch);
    const malformedInsight: Record<string, unknown> = {
      ...result.insight,
    };
    delete malformedInsight.clipDecision;
    worker.emitMessage({
      ...identity,
      eventId: "event-malformed-result",
      type: "candidate-pass-b-partial-result",
      result: {
        ...result,
        insight: malformedInsight,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    } satisfies Partial<CandidatePassBWorkerError>);
  });

  it("rejects dispatch digest/range drift before invoking durable storage", async () => {
    const worker = new FakeWorker();
    const onDispatchIntent = vi.fn(() => Promise.resolve(true));
    const promise = start(worker, onDispatchIntent);
    const dispatch = await currentDispatch();

    emit(worker, "event-intent", {
      type: "candidate-pass-b-dispatch-intent",
      intent: {
        ...dispatch,
        sourceEndMs: dispatch.sourceEndMs + 1,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onDispatchIntent).not.toHaveBeenCalled();
  });

  it("rejects a dispatch whose retry grant differs from the quota fence", async () => {
    const worker = new FakeWorker();
    const onDispatchIntent = vi.fn(() => Promise.resolve(true));
    const quota: CandidatePassBQuotaIdentity = {
      participantId: "participant_11111111111111111111111111111111",
      runId: identity.analysisRunId,
      attemptOrdinal: 1,
      retryGrantId: "grant-current-1",
    };
    const promise = start(worker, onDispatchIntent, { quota });
    const dispatch = await currentDispatch({
      attemptOrdinal: 1,
      retryGrantId: "grant-other-1",
    });

    emit(worker, "event-retry-grant-drift", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onDispatchIntent).not.toHaveBeenCalled();
  });

  it("rejects an operation ID that is not derived from the complete dispatch fence", async () => {
    const worker = new FakeWorker();
    const onDispatchIntent = vi.fn(() => Promise.resolve(true));
    const promise = start(worker, onDispatchIntent);
    const dispatch = await currentDispatch();

    emit(worker, "event-operation-id-drift", {
      type: "candidate-pass-b-dispatch-intent",
      intent: {
        ...dispatch,
        operationId: `${dispatch.operationId}0`,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onDispatchIntent).not.toHaveBeenCalled();
  });

  it("keeps quota outcome-unknown terminal and distinct from a retryable gap", async () => {
    const worker = new FakeWorker();
    const onOutcomeUnknown = vi.fn(() => Promise.resolve(true));
    const promise = start(worker, () => Promise.resolve(true), {
      onOutcomeUnknown,
    });
    const dispatch = await currentDispatch();
    emit(worker, "event-intent", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    const settlement = {
      schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
      status: "outcome-unknown" as const,
      operationId: dispatch.operationId,
      providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
      outputLanguage: dispatch.outputLanguage,
      castRosterId: dispatch.castRosterId,
      reason: "quota-outcome-unknown" as const,
    };
    emit(worker, "event-unknown", {
      type: "candidate-pass-b-outcome-unknown",
      outcome: {
        candidateId: target.candidateId,
        sourceStartMs: target.startMs,
        sourceEndMs: target.endMs,
        settlement,
      },
    });
    await vi.waitFor(() => {
      expect(worker.requests.at(-1)).toMatchObject({
        type: "candidate-pass-b-terminal-result-ack",
        terminalEventId: "event-unknown",
        candidateId: target.candidateId,
        settlement,
        accepted: true,
      });
    });
    emit(worker, "event-complete", {
      type: "candidate-pass-b-completed",
      summary: { requestedCount: 1, completedCount: 0, gapCount: 1 },
    });

    await expect(promise).resolves.toMatchObject({
      results: [],
      gaps: [],
      outcomeUnknowns: [{ settlement }],
    });
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();
  });

  it("finishes an in-progress durable arm and terminal settlement before cancellation completes", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    let resolveArm!: (accepted: boolean) => void;
    const arm = new Promise<boolean>((resolve) => {
      resolveArm = resolve;
    });
    const onOutcomeUnknown = vi.fn(() => Promise.resolve(true));
    const promise = start(worker, () => arm, {
      signal: controller.signal,
      onOutcomeUnknown,
    });
    const dispatch = await currentDispatch();

    emit(worker, "event-intent-cancel-race", {
      type: "candidate-pass-b-dispatch-intent",
      intent: dispatch,
    });
    await Promise.resolve();
    controller.abort();
    expect(worker.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "candidate-pass-b-cancel" }),
      ]),
    );

    resolveArm(true);
    await vi.waitFor(() => {
      expect(worker.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "candidate-pass-b-dispatch-arm-ack",
            operationId: dispatch.operationId,
            accepted: true,
          }),
        ]),
      );
    });

    const settlement = {
      schemaVersion: CANDIDATE_PASS_B_SETTLEMENT_SCHEMA_VERSION,
      status: "outcome-unknown" as const,
      operationId: dispatch.operationId,
      providerPayloadDigest: dispatch.mediaReceipt.providerPayloadDigest,
      outputLanguage: dispatch.outputLanguage,
      castRosterId: dispatch.castRosterId,
      reason: "armed-dispatch-interrupted" as const,
    };
    emit(worker, "event-outcome-cancel-race", {
      type: "candidate-pass-b-outcome-unknown",
      outcome: {
        candidateId: target.candidateId,
        sourceStartMs: target.startMs,
        sourceEndMs: target.endMs,
        settlement,
      },
    });
    await vi.waitFor(() => {
      expect(worker.requests.at(-1)).toMatchObject({
        type: "candidate-pass-b-terminal-result-ack",
        terminalEventId: "event-outcome-cancel-race",
        settlement,
        accepted: true,
      });
    });
    expect(onOutcomeUnknown).toHaveBeenCalledOnce();

    emit(worker, "event-cancel-after-terminal", {
      type: "candidate-pass-b-cancel-acknowledged",
    });
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  });
});
