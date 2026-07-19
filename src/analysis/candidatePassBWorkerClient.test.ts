import { describe, expect, it, vi } from "vitest";

import {
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_TASK,
  CandidatePassBWorkerError,
  runCandidatePassBWorker,
  type CandidatePassBTarget,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerLike,
  type RunCandidatePassBWorkerOptions,
} from "./candidatePassBWorkerClient";
import type {
  CandidatePassBWorkerRequest,
  CandidatePassBWorkerResponsePayload,
} from "./candidatePassBWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const identity: CandidatePassBWorkerIdentity = {
  sessionId: "session-1",
  writerEpoch: 4,
  analysisRunId: "analysis-1",
  passBRunId: "pass-b-1",
  workerEpoch: 2,
  workerInstanceId: "worker-1",
  taskId: "task-1",
};

const targets: readonly CandidatePassBTarget[] = [
  { candidateId: "candidate-1", startMs: 10_000, endMs: 50_000 },
  { candidateId: "candidate-2", startMs: 70_000, endMs: 120_000 },
];

class FakeWorker implements CandidatePassBWorkerLike {
  public readonly listeners = new Map<WorkerEventType, Set<WorkerListener>>();
  public readonly requests: CandidatePassBWorkerRequest[] = [];
  public terminateCount = 0;
  public throwOnPost = false;

  public addEventListener(type: WorkerEventType, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: WorkerEventType, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public postMessage(message: CandidatePassBWorkerRequest): void {
    if (this.throwOnPost) {
      throw new Error("post failed");
    }
    this.requests.push(message);
  }

  public terminate(): void {
    this.terminateCount += 1;
  }

  public emitMessage(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

function transcriptFor(target: CandidatePassBTarget): CandidatePassBTranscriptResult {
  return {
    mode: "candidate-pass-b-transcript",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    text: "정말 이게 되네 대박",
    segments: [
      {
        startMs: target.startMs + 1_000,
        endMs: target.startMs + 3_500,
        text: "정말 이게 되네",
      },
      {
        startMs: target.startMs + 3_500,
        endMs: target.startMs + 4_500,
        text: "대박",
      },
    ],
    model: {
      id: CANDIDATE_PASS_B_MODEL_ID,
      revision: CANDIDATE_PASS_B_MODEL_REVISION,
      dtype: CANDIDATE_PASS_B_DTYPE,
      device: "wasm",
    },
    language: CANDIDATE_PASS_B_LANGUAGE,
    task: CANDIDATE_PASS_B_TASK,
    sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  };
}

function startWith(
  worker: FakeWorker,
  overrides: Partial<
    Pick<
      RunCandidatePassBWorkerOptions,
      | "targets"
      | "signal"
      | "onModelProgress"
      | "onCandidateProgress"
      | "onPartialResult"
      | "onCandidateGap"
      | "onCancellationAcknowledged"
      | "cancelAcknowledgementTimeoutMs"
    >
  > = {},
) {
  return runCandidatePassBWorker(
    new File([new Uint8Array([1, 2, 3])], "source.mp4", {
      type: "video/mp4",
    }),
    {
      identity,
      sourceDurationMs: 180_000,
      device: "wasm",
      targets: overrides.targets ?? targets,
      workerFactory: () => worker,
      ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
      ...(overrides.onModelProgress === undefined
        ? {}
        : { onModelProgress: overrides.onModelProgress }),
      ...(overrides.onCandidateProgress === undefined
        ? {}
        : { onCandidateProgress: overrides.onCandidateProgress }),
      ...(overrides.onPartialResult === undefined
        ? {}
        : { onPartialResult: overrides.onPartialResult }),
      ...(overrides.onCandidateGap === undefined
        ? {}
        : { onCandidateGap: overrides.onCandidateGap }),
      ...(overrides.onCancellationAcknowledged === undefined
        ? {}
        : {
            onCancellationAcknowledged:
              overrides.onCancellationAcknowledged,
          }),
      ...(overrides.cancelAcknowledgementTimeoutMs === undefined
        ? {}
        : {
            cancelAcknowledgementTimeoutMs:
              overrides.cancelAcknowledgementTimeoutMs,
          }),
    },
  );
}

function emit(
  worker: FakeWorker,
  eventId: string,
  payload: CandidatePassBWorkerResponsePayload,
  identityOverride: Partial<CandidatePassBWorkerIdentity> = {},
): void {
  worker.emitMessage({
    ...identity,
    ...identityOverride,
    eventId,
    ...payload,
  });
}

describe("runCandidatePassBWorker", () => {
  it("streams fenced progress, isolates a candidate gap, and resolves with later partial results", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn();
    const onCandidateProgress = vi.fn();
    const onPartialResult = vi.fn();
    const onCandidateGap = vi.fn();
    const promise = startWith(worker, {
      onModelProgress,
      onCandidateProgress,
      onPartialResult,
      onCandidateGap,
    });

    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      type: "candidate-pass-b-analyze",
      identity,
      sourceDurationMs: 180_000,
      device: "wasm",
      targets,
    });

    emit(worker, "event-1", {
      type: "candidate-pass-b-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.4,
        loadedBytes: 40,
        totalBytes: 100,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-pass-b-model-progress",
      progress: {
        stage: "ready",
        ratio: 1,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    emit(worker, "event-3", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: targets[0]?.candidateId ?? "",
        candidateOrdinal: 1,
        targetCount: 2,
        stage: "decoding",
        ratio: 0.2,
      },
    });
    emit(worker, "event-4", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: targets[0]?.candidateId ?? "",
        candidateOrdinal: 1,
        targetCount: 2,
        stage: "gap",
        ratio: 1,
      },
    });
    emit(worker, "event-5", {
      type: "candidate-pass-b-candidate-gap",
      gap: {
        candidateId: "candidate-1",
        sourceStartMs: 10_000,
        sourceEndMs: 50_000,
        reasonCode: "TRANSCRIPTION_FAILED",
        message: "첫 후보의 말은 글로 바꾸지 못했어요.",
      },
    });
    emit(worker, "event-6", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: targets[1]?.candidateId ?? "",
        candidateOrdinal: 2,
        targetCount: 2,
        stage: "decoding",
        ratio: 0,
      },
    });
    emit(worker, "event-7", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: targets[1]?.candidateId ?? "",
        candidateOrdinal: 2,
        targetCount: 2,
        stage: "transcribing",
        ratio: 0.5,
      },
    });
    emit(worker, "event-8", {
      type: "candidate-pass-b-candidate-progress",
      progress: {
        candidateId: targets[1]?.candidateId ?? "",
        candidateOrdinal: 2,
        targetCount: 2,
        stage: "complete",
        ratio: 1,
      },
    });
    const secondTranscript = transcriptFor(targets[1] as CandidatePassBTarget);
    emit(worker, "event-9", {
      type: "candidate-pass-b-partial-result",
      result: secondTranscript,
    });
    emit(worker, "event-10", {
      type: "candidate-pass-b-completed",
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });

    await expect(promise).resolves.toEqual({
      results: [secondTranscript],
      gaps: [
        {
          candidateId: "candidate-1",
          sourceStartMs: 10_000,
          sourceEndMs: 50_000,
          reasonCode: "TRANSCRIPTION_FAILED",
          message: "첫 후보의 말은 글로 바꾸지 못했어요.",
        },
      ],
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });
    expect(onModelProgress).toHaveBeenCalledTimes(2);
    expect(onCandidateProgress).toHaveBeenCalledTimes(5);
    expect(onCandidateGap).toHaveBeenCalledTimes(1);
    expect(onPartialResult).toHaveBeenCalledWith(secondTranscript);
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a correctly shaped event from a stale Pass B run", async () => {
    const worker = new FakeWorker();
    const promise = startWith(worker);

    emit(
      worker,
      "event-1",
      {
        type: "candidate-pass-b-model-progress",
        progress: {
          stage: "loading",
          ratio: 0,
          loadedBytes: null,
          totalBytes: null,
        },
      },
      { passBRunId: "stale-pass-b" },
    );

    await expect(promise).rejects.toMatchObject({
      code: "EVENT_FENCE_REJECTED",
      fenceReason: "pass_b_run_id_mismatch",
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a duplicate event id before exposing the second event", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn();
    const promise = startWith(worker, { onModelProgress });

    emit(worker, "same-event", {
      type: "candidate-pass-b-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.2,
        loadedBytes: 20,
        totalBytes: 100,
      },
    });
    emit(worker, "same-event", {
      type: "candidate-pass-b-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.3,
        loadedBytes: 30,
        totalBytes: 100,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "EVENT_FENCE_REJECTED",
      fenceReason: "duplicate_event_id",
    });
    expect(onModelProgress).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed partial result without exposing transcript text", async () => {
    const worker = new FakeWorker();
    const onPartialResult = vi.fn();
    const promise = startWith(worker, {
      targets: [targets[0] as CandidatePassBTarget],
      onPartialResult,
    });
    const malformed = {
      ...transcriptFor(targets[0] as CandidatePassBTarget),
      model: {
        ...transcriptFor(targets[0] as CandidatePassBTarget).model,
        revision: "moving-main-revision",
      },
    };

    worker.emitMessage({
      ...identity,
      eventId: "event-1",
      type: "candidate-pass-b-partial-result",
      result: malformed,
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onPartialResult).not.toHaveBeenCalled();
    expect(worker.terminateCount).toBe(1);
  });

  it("waits for a fenced cancellation ACK and reports only the real ACK", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const onCancellationAcknowledged = vi.fn();
    const promise = startWith(worker, {
      signal: controller.signal,
      onCancellationAcknowledged,
    });
    const rejection = expect(promise).rejects.toMatchObject({ code: "ABORTED" });

    controller.abort();

    expect(worker.requests).toHaveLength(2);
    expect(worker.requests[1]).toEqual({
      type: "candidate-pass-b-cancel",
      identity,
    });
    expect(worker.terminateCount).toBe(0);
    expect(onCancellationAcknowledged).not.toHaveBeenCalled();

    emit(worker, "cancel-ack", {
      type: "candidate-pass-b-cancel-acknowledged",
    });

    await rejection;
    expect(onCancellationAcknowledged).toHaveBeenCalledTimes(1);
    expect(worker.terminateCount).toBe(1);
  });

  it("does not report a cancellation ACK when the ACK deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const controller = new AbortController();
      const onCancellationAcknowledged = vi.fn();
      const promise = startWith(worker, {
        signal: controller.signal,
        onCancellationAcknowledged,
        cancelAcknowledgementTimeoutMs: 50,
      });
      const rejection = expect(promise).rejects.toMatchObject({ code: "ABORTED" });

      controller.abort();
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(onCancellationAcknowledged).not.toHaveBeenCalled();
      expect(worker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up and reports a cancellation ACK callback failure", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = startWith(worker, {
      signal: controller.signal,
      onCancellationAcknowledged: () => {
        throw new Error("reducer rejected ACK");
      },
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "CANCEL_ACK_CALLBACK_FAILED",
    });

    controller.abort();
    emit(worker, "cancel-ack", {
      type: "candidate-pass-b-cancel-acknowledged",
    });

    await rejection;
    expect(worker.terminateCount).toBe(1);
    expect(
      [...worker.listeners.values()].every((listeners) => listeners.size === 0),
    ).toBe(true);
  });

  it("cancels and cleans up if a progress callback throws", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn(() => {
      throw new Error("render failed");
    });
    const promise = startWith(worker, { onModelProgress });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "PROGRESS_CALLBACK_FAILED",
    });

    emit(worker, "event-1", {
      type: "candidate-pass-b-model-progress",
      progress: {
        stage: "loading",
        ratio: 0,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    expect(worker.requests[1]).toEqual({
      type: "candidate-pass-b-cancel",
      identity,
    });
    emit(worker, "event-2", {
      type: "candidate-pass-b-cancel-acknowledged",
    });

    await rejection;
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects before creating a Worker when more than twelve targets are supplied", async () => {
    let factoryCalls = 0;
    const tooManyTargets = Array.from({ length: 13 }, (_, index) => ({
      candidateId: `candidate-${index}`,
      startMs: index * 1_000,
      endMs: index * 1_000 + 500,
    }));

    const promise = runCandidatePassBWorker(
      new File([new Uint8Array([1])], "source.mp4"),
      {
        identity,
        sourceDurationMs: 180_000,
        device: "wasm",
        targets: tooManyTargets,
        workerFactory: () => {
          factoryCalls += 1;
          return new FakeWorker();
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(CandidatePassBWorkerError);
    await expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(factoryCalls).toBe(0);
  });
});
