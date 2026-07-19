import { describe, expect, it, vi } from "vitest";

import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  CandidateAudioEventWorkerError,
  runCandidateAudioEventWorker,
  type CandidateAudioEventCandidateGap,
  type CandidateAudioEventCandidateResult,
  type CandidateAudioEventRunResult,
  type CandidateAudioEventTarget,
  type CandidateAudioEventWorkerIdentity,
  type CandidateAudioEventWorkerLike,
  type RunCandidateAudioEventWorkerOptions,
} from "./candidateAudioEventWorkerClient";
import type {
  CandidateAudioEventWorkerRequest,
  CandidateAudioEventWorkerResponsePayload,
} from "./candidateAudioEventWorkerProtocol";

type WorkerEventType = "message" | "messageerror" | "error";
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const identity: CandidateAudioEventWorkerIdentity = {
  protocolVersion: CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  sessionId: "session-1",
  writerEpoch: 4,
  analysisRunId: "analysis-1",
  audioEventRunId: "audio-event-1",
  workerEpoch: 2,
  workerInstanceId: "worker-1",
  taskId: "task-1",
};

const targets: readonly CandidateAudioEventTarget[] = [
  {
    candidateId: "candidate-1",
    startMs: 10_000,
    endMs: 50_000,
    peakMs: 35_000,
  },
  {
    candidateId: "candidate-2",
    startMs: 70_000,
    endMs: 120_000,
    peakMs: 95_000,
  },
];

class FakeWorker implements CandidateAudioEventWorkerLike {
  public readonly listeners = new Map<
    WorkerEventType,
    Set<WorkerListener>
  >();
  public readonly requests: CandidateAudioEventWorkerRequest[] = [];
  public terminateCount = 0;
  public throwOnPost = false;

  public addEventListener(type: WorkerEventType, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: WorkerEventType,
    listener: WorkerListener,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  public postMessage(message: CandidateAudioEventWorkerRequest): void {
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

  public emitMessageError(): void {
    const event = new MessageEvent("messageerror");
    for (const listener of this.listeners.get("messageerror") ?? []) {
      listener(event);
    }
  }

  public emitError(message = "worker crashed"): void {
    const event = new ErrorEvent("error", { message });
    for (const listener of this.listeners.get("error") ?? []) {
      listener(event);
    }
  }

  public hasNoListeners(): boolean {
    return [...this.listeners.values()].every(
      (listeners) => listeners.size === 0,
    );
  }
}

type StartOverrides = {
  readonly identity?: CandidateAudioEventWorkerIdentity;
  readonly sourceDurationMs?: number;
  readonly targets?: readonly CandidateAudioEventTarget[];
  readonly signal?: AbortSignal;
  readonly onModelProgress?: RunCandidateAudioEventWorkerOptions["onModelProgress"];
  readonly onCandidateProgress?: RunCandidateAudioEventWorkerOptions["onCandidateProgress"];
  readonly onPartialResult?: RunCandidateAudioEventWorkerOptions["onPartialResult"];
  readonly onCandidateGap?: RunCandidateAudioEventWorkerOptions["onCandidateGap"];
  readonly onCancellationAcknowledged?: RunCandidateAudioEventWorkerOptions["onCancellationAcknowledged"];
  readonly timeoutMs?: number;
  readonly cancelAcknowledgementTimeoutMs?: number;
};

function startWith(
  worker: FakeWorker,
  overrides: StartOverrides = {},
): Promise<CandidateAudioEventRunResult> {
  return runCandidateAudioEventWorker(
    new File([new Uint8Array([1, 2, 3])], "source.mp4", {
      type: "video/mp4",
    }),
    {
      identity: overrides.identity ?? identity,
      sourceDurationMs: overrides.sourceDurationMs ?? 180_000,
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
      ...(overrides.timeoutMs === undefined
        ? {}
        : { timeoutMs: overrides.timeoutMs }),
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
  payload: CandidateAudioEventWorkerResponsePayload,
  identityOverride: Readonly<Record<string, unknown>> = {},
): void {
  worker.emitMessage({
    ...identity,
    ...identityOverride,
    eventId,
    ...payload,
  });
}

function detectedFor(
  target: CandidateAudioEventTarget,
): CandidateAudioEventCandidateResult {
  return {
    mode: "candidate-audio-event",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reactionPeakMs: target.peakMs,
    analyzedWindowCount: 3,
    quality: "provisional-audio-event",
    model: {
      id: CANDIDATE_AUDIO_EVENT_MODEL_ID,
      revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
      dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
      device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
    },
    sampleRateHz: CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
    status: "detected",
    detections: [
      {
        kind: "laughter",
        strength: "strong",
        sourceStartMs: target.peakMs - 2_000,
        sourceEndMs: target.peakMs + 3_000,
      },
      {
        kind: "applause-or-cheering",
        strength: "possible",
        sourceStartMs: target.peakMs + 3_000,
        sourceEndMs: target.peakMs + 6_000,
      },
    ],
  };
}

function noClearFor(
  target: CandidateAudioEventTarget,
): CandidateAudioEventCandidateResult {
  return {
    mode: "candidate-audio-event",
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reactionPeakMs: target.peakMs,
    analyzedWindowCount: 2,
    quality: "provisional-audio-event",
    model: {
      id: CANDIDATE_AUDIO_EVENT_MODEL_ID,
      revision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
      dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
      device: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
    },
    sampleRateHz: CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
    status: "no-clear-event",
    reasonCode: "NO_ALLOWLIST_EVENT",
    detections: [],
  };
}

function gapFor(
  target: CandidateAudioEventTarget,
): CandidateAudioEventCandidateGap {
  return {
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reactionPeakMs: target.peakMs,
    reasonCode: "AUDIO_DECODE_FAILED",
    message: "이 후보의 오디오를 읽지 못했어요.",
  };
}

function emitCandidateProgress(
  worker: FakeWorker,
  eventId: string,
  candidateIndex: number,
  stage: "decoding" | "classifying" | "complete" | "gap",
  ratio: number,
): void {
  const target = targets[candidateIndex] as CandidateAudioEventTarget;
  emit(worker, eventId, {
    type: "candidate-audio-event-candidate-progress",
    progress: {
      candidateId: target.candidateId,
      candidateOrdinal: candidateIndex + 1,
      targetCount: targets.length,
      stage,
      ratio,
    },
  });
}

function emitModelReady(worker: FakeWorker, eventId: string): void {
  emit(worker, eventId, {
    type: "candidate-audio-event-model-progress",
    progress: {
      stage: "ready",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    },
  });
}

describe("runCandidateAudioEventWorker", () => {
  it("streams score-ordered candidates and resolves only after every result or gap is accounted for", async () => {
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
      type: "candidate-audio-event-analyze",
      identity,
      sourceDurationMs: 180_000,
      targets,
    });

    emit(worker, "event-1", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.4,
        loadedBytes: 40,
        totalBytes: 100,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "ready",
        ratio: 1,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    emitCandidateProgress(worker, "event-3", 0, "decoding", 0.1);
    emitCandidateProgress(worker, "event-4", 0, "classifying", 0.7);
    emitCandidateProgress(worker, "event-5", 0, "complete", 1);
    const firstResult = detectedFor(targets[0] as CandidateAudioEventTarget);
    emit(worker, "event-6", {
      type: "candidate-audio-event-partial-result",
      result: firstResult,
    });
    emitCandidateProgress(worker, "event-7", 1, "decoding", 0);
    emitCandidateProgress(worker, "event-8", 1, "gap", 1);
    const secondGap = gapFor(targets[1] as CandidateAudioEventTarget);
    emit(worker, "event-9", {
      type: "candidate-audio-event-candidate-gap",
      gap: secondGap,
    });
    emit(worker, "event-10", {
      type: "candidate-audio-event-completed",
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });

    await expect(promise).resolves.toEqual({
      results: [firstResult],
      gaps: [secondGap],
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });
    expect(onModelProgress).toHaveBeenCalledTimes(2);
    expect(onCandidateProgress).toHaveBeenCalledTimes(5);
    expect(onPartialResult).toHaveBeenCalledWith(firstResult);
    expect(onCandidateGap).toHaveBeenCalledWith(secondGap);
    expect(worker.terminateCount).toBe(1);
    expect(worker.hasNoListeners()).toBe(true);
  });

  it("accepts a structurally exact no-clear result as a completed candidate", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });
    const result = noClearFor(target);

    emitModelReady(worker, "event-1");
    emit(worker, "event-2", {
      type: "candidate-audio-event-partial-result",
      result,
    });
    emit(worker, "event-3", {
      type: "candidate-audio-event-completed",
      summary: { requestedCount: 1, completedCount: 1, gapCount: 0 },
    });

    await expect(promise).resolves.toEqual({
      results: [result],
      gaps: [],
      summary: { requestedCount: 1, completedCount: 1, gapCount: 0 },
    });
  });

  it("rejects a candidate result before the pinned model is ready", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });

    emit(worker, "event-1", {
      type: "candidate-audio-event-partial-result",
      result: detectedFor(target),
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("rejects a classification gap before the pinned model is ready", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });

    emit(worker, "event-1", {
      type: "candidate-audio-event-candidate-progress",
      progress: {
        candidateId: target.candidateId,
        candidateOrdinal: 1,
        targetCount: 1,
        stage: "gap",
        ratio: 1,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-candidate-gap",
      gap: {
        ...gapFor(target),
        reasonCode: "CLASSIFICATION_FAILED",
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("accepts a source-level all-gap completion without loading the model", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });
    const gap: CandidateAudioEventCandidateGap = {
      ...gapFor(target),
      reasonCode: "NO_AUDIO_TRACK",
    };

    emit(worker, "event-1", {
      type: "candidate-audio-event-candidate-progress",
      progress: {
        candidateId: target.candidateId,
        candidateOrdinal: 1,
        targetCount: 1,
        stage: "gap",
        ratio: 1,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-candidate-gap",
      gap,
    });
    emit(worker, "event-3", {
      type: "candidate-audio-event-completed",
      summary: { requestedCount: 1, completedCount: 0, gapCount: 1 },
    });

    await expect(promise).resolves.toEqual({
      results: [],
      gaps: [gap],
      summary: { requestedCount: 1, completedCount: 0, gapCount: 1 },
    });
  });

  it.each([
    ["protocolVersion", "9.9.9", "protocol_version_mismatch"],
    ["sessionId", "stale-session", "session_id_mismatch"],
    ["writerEpoch", 99, "writer_epoch_mismatch"],
    ["analysisRunId", "stale-analysis", "analysis_run_id_mismatch"],
    [
      "audioEventRunId",
      "stale-audio-run",
      "audio_event_run_id_mismatch",
    ],
    ["workerEpoch", 99, "worker_epoch_mismatch"],
    [
      "workerInstanceId",
      "stale-worker",
      "worker_instance_id_mismatch",
    ],
    ["taskId", "stale-task", "task_id_mismatch"],
  ])(
    "rejects a correctly shaped event when %s belongs to another run",
    async (key, staleValue, fenceReason) => {
      const worker = new FakeWorker();
      const promise = startWith(worker);

      emit(
        worker,
        "event-1",
        {
          type: "candidate-audio-event-model-progress",
          progress: {
            stage: "loading",
            ratio: 0,
            loadedBytes: null,
            totalBytes: null,
          },
        },
        { [key]: staleValue },
      );

      await expect(promise).rejects.toMatchObject({
        code: "EVENT_FENCE_REJECTED",
        fenceReason,
      });
      expect(worker.terminateCount).toBe(1);
      expect(worker.hasNoListeners()).toBe(true);
    },
  );

  it("rejects a duplicate event ID before exposing its second payload", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn();
    const promise = startWith(worker, { onModelProgress });

    emit(worker, "same-event", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.2,
        loadedBytes: 20,
        totalBytes: 100,
      },
    });
    emit(worker, "same-event", {
      type: "candidate-audio-event-model-progress",
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

  it("rejects extra response fields instead of silently widening the protocol", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn();
    const promise = startWith(worker, { onModelProgress });

    worker.emitMessage({
      ...identity,
      eventId: "event-1",
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0,
        loadedBytes: null,
        totalBytes: null,
      },
      unexpected: true,
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onModelProgress).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a non-allowlisted label",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        detections: [
          {
            ...(result.status === "detected" ? result.detections[0] : {}),
            kind: "music",
          },
        ],
      }),
    ],
    [
      "a raw score that the boundary must not expose",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        detections: [
          {
            ...(result.status === "detected" ? result.detections[0] : {}),
            score: 0.99,
          },
        ],
      }),
    ],
    [
      "more than the product maximum of two detections",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        detections:
          result.status === "detected"
            ? [
                ...result.detections,
                {
                  kind: "scream",
                  strength: "possible",
                  sourceStartMs: 42_000,
                  sourceEndMs: 44_000,
                },
              ]
            : [],
      }),
    ],
    [
      "a moving model revision",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        model: { ...result.model, revision: "main" },
      }),
    ],
    [
      "a detection outside the immutable target",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        detections: [
          {
            ...(result.status === "detected" ? result.detections[0] : {}),
            sourceStartMs: 9_000,
            sourceEndMs: 12_000,
          },
        ],
      }),
    ],
    [
      "an incorrect reaction peak",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        reactionPeakMs: result.reactionPeakMs + 1,
      }),
    ],
    [
      "too many analyzed windows",
      (result: CandidateAudioEventCandidateResult) => ({
        ...result,
        analyzedWindowCount: 4,
      }),
    ],
  ])("rejects a result containing %s", async (_, makeMalformed) => {
    const worker = new FakeWorker();
    const onPartialResult = vi.fn();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, {
      targets: [target],
      onPartialResult,
    });

    emitModelReady(worker, "model-ready");
    worker.emitMessage({
      ...identity,
      eventId: "event-1",
      type: "candidate-audio-event-partial-result",
      result: makeMalformed(detectedFor(target)),
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onPartialResult).not.toHaveBeenCalled();
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects candidate progress that skips the immutable candidate order", async () => {
    const worker = new FakeWorker();
    const onCandidateProgress = vi.fn();
    const promise = startWith(worker, { onCandidateProgress });

    emitModelReady(worker, "model-ready");
    emitCandidateProgress(worker, "event-1", 1, "decoding", 0);

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onCandidateProgress).not.toHaveBeenCalled();
  });

  it("rejects regressing model and candidate progress", async () => {
    const worker = new FakeWorker();
    const onModelProgress = vi.fn();
    const promise = startWith(worker, { onModelProgress });

    emit(worker, "event-1", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.8,
        loadedBytes: 80,
        totalBytes: 100,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0.7,
        loadedBytes: 70,
        totalBytes: 100,
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(onModelProgress).toHaveBeenCalledTimes(1);
  });

  it("rejects a gap after progress declared that candidate complete", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });

    emitModelReady(worker, "model-ready");
    emit(worker, "event-1", {
      type: "candidate-audio-event-candidate-progress",
      progress: {
        candidateId: target.candidateId,
        candidateOrdinal: 1,
        targetCount: 1,
        stage: "complete",
        ratio: 1,
      },
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-candidate-gap",
      gap: gapFor(target),
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("rejects completion until the full requested candidate ID set is terminal", async () => {
    const worker = new FakeWorker();
    const promise = startWith(worker);

    emitModelReady(worker, "model-ready");
    emit(worker, "event-1", {
      type: "candidate-audio-event-partial-result",
      result: detectedFor(targets[0] as CandidateAudioEventTarget),
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-completed",
      summary: { requestedCount: 2, completedCount: 1, gapCount: 1 },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("cross-checks completion counts against observed result and gap IDs", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, { targets: [target] });

    emitModelReady(worker, "model-ready");
    emit(worker, "event-1", {
      type: "candidate-audio-event-partial-result",
      result: detectedFor(target),
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-completed",
      summary: { requestedCount: 1, completedCount: 0, gapCount: 1 },
    });

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
  });

  it("waits for a fully fenced cancellation ACK before terminating", async () => {
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
      type: "candidate-audio-event-cancel",
      identity,
    });
    expect(worker.terminateCount).toBe(0);
    expect(onCancellationAcknowledged).not.toHaveBeenCalled();

    emit(worker, "cancel-ack", {
      type: "candidate-audio-event-cancel-acknowledged",
    });

    await rejection;
    expect(onCancellationAcknowledged).toHaveBeenCalledTimes(1);
    expect(worker.terminateCount).toBe(1);
    expect(worker.hasNoListeners()).toBe(true);
  });

  it("rejects a cancellation ACK from a stale audio-event run", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const onCancellationAcknowledged = vi.fn();
    const promise = startWith(worker, {
      signal: controller.signal,
      onCancellationAcknowledged,
    });

    controller.abort();
    emit(
      worker,
      "cancel-ack",
      { type: "candidate-audio-event-cancel-acknowledged" },
      { audioEventRunId: "stale-run" },
    );

    await expect(promise).rejects.toMatchObject({
      code: "EVENT_FENCE_REJECTED",
      fenceReason: "audio_event_run_id_mismatch",
    });
    expect(onCancellationAcknowledged).not.toHaveBeenCalled();
    expect(worker.terminateCount).toBe(1);
  });

  it("force-terminates after five seconds when cancellation is not acknowledged", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const controller = new AbortController();
      const onCancellationAcknowledged = vi.fn();
      const promise = startWith(worker, {
        signal: controller.signal,
        onCancellationAcknowledged,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: "ABORTED",
      });

      controller.abort();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(worker.terminateCount).toBe(0);
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
      expect(onCancellationAcknowledged).not.toHaveBeenCalled();
      expect(worker.terminateCount).toBe(1);
      expect(worker.hasNoListeners()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels safely when a progress callback throws", async () => {
    const worker = new FakeWorker();
    const promise = startWith(worker, {
      onModelProgress: () => {
        throw new Error("render failed");
      },
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "PROGRESS_CALLBACK_FAILED",
    });

    emit(worker, "event-1", {
      type: "candidate-audio-event-model-progress",
      progress: {
        stage: "loading",
        ratio: 0,
        loadedBytes: null,
        totalBytes: null,
      },
    });
    expect(worker.requests[1]).toEqual({
      type: "candidate-audio-event-cancel",
      identity,
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-cancel-acknowledged",
    });

    await rejection;
    expect(worker.terminateCount).toBe(1);
  });

  it("cancels safely when a result callback throws", async () => {
    const worker = new FakeWorker();
    const target = targets[0] as CandidateAudioEventTarget;
    const promise = startWith(worker, {
      targets: [target],
      onPartialResult: () => {
        throw new Error("state update failed");
      },
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "RESULT_CALLBACK_FAILED",
    });

    emitModelReady(worker, "model-ready");
    emit(worker, "event-1", {
      type: "candidate-audio-event-partial-result",
      result: detectedFor(target),
    });
    expect(worker.requests[1]).toEqual({
      type: "candidate-audio-event-cancel",
      identity,
    });
    emit(worker, "event-2", {
      type: "candidate-audio-event-cancel-acknowledged",
    });

    await rejection;
    expect(worker.terminateCount).toBe(1);
  });

  it("cleans up when the cancellation ACK callback throws", async () => {
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
      type: "candidate-audio-event-cancel-acknowledged",
    });

    await rejection;
    expect(worker.terminateCount).toBe(1);
    expect(worker.hasNoListeners()).toBe(true);
  });

  it.each([
    [
      "more than twelve targets",
      Array.from({ length: 13 }, (_, index) => ({
        candidateId: `candidate-${index}`,
        startMs: index * 1_000,
        endMs: index * 1_000 + 500,
        peakMs: index * 1_000 + 250,
      })),
    ],
    [
      "a peak outside its target",
      [{ candidateId: "candidate-1", startMs: 1_000, endMs: 2_000, peakMs: 999 }],
    ],
    [
      "duplicate candidate IDs",
      [
        { candidateId: "same", startMs: 1_000, endMs: 2_000, peakMs: 1_500 },
        { candidateId: "same", startMs: 3_000, endMs: 4_000, peakMs: 3_500 },
      ],
    ],
  ])("rejects %s before creating a Worker", async (_, invalidTargets) => {
    let factoryCalls = 0;
    const promise = runCandidateAudioEventWorker(
      new File([new Uint8Array([1])], "source.mp4"),
      {
        identity,
        sourceDurationMs: 180_000,
        targets: invalidTargets,
        workerFactory: () => {
          factoryCalls += 1;
          return new FakeWorker();
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(CandidateAudioEventWorkerError);
    await expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(factoryCalls).toBe(0);
  });

  it("rejects an already aborted run before creating a Worker", async () => {
    const controller = new AbortController();
    controller.abort();
    let factoryCalls = 0;

    const promise = runCandidateAudioEventWorker(
      new File([new Uint8Array([1])], "source.mp4"),
      {
        identity,
        sourceDurationMs: 180_000,
        targets,
        signal: controller.signal,
        workerFactory: () => {
          factoryCalls += 1;
          return new FakeWorker();
        },
      },
    );

    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    expect(factoryCalls).toBe(0);
  });

  it("terminates and removes listeners if the initial postMessage fails", async () => {
    const worker = new FakeWorker();
    worker.throwOnPost = true;

    await expect(startWith(worker)).rejects.toMatchObject({
      code: "WORKER_FAILED",
    });
    expect(worker.terminateCount).toBe(1);
    expect(worker.hasNoListeners()).toBe(true);
  });

  it("maps Worker message errors and Worker-declared failures to safe errors", async () => {
    const messageErrorWorker = new FakeWorker();
    const messageErrorPromise = startWith(messageErrorWorker);
    messageErrorWorker.emitMessageError();
    await expect(messageErrorPromise).rejects.toMatchObject({
      code: "WORKER_MESSAGE_ERROR",
    });
    expect(messageErrorWorker.terminateCount).toBe(1);

    const failedWorker = new FakeWorker();
    const failedPromise = startWith(failedWorker);
    emit(failedWorker, "event-1", {
      type: "candidate-audio-event-failed",
      reasonCode: "MODEL_LOAD_FAILED",
      message: "고정 모델을 불러오지 못했어요.",
    });
    await expect(failedPromise).rejects.toMatchObject({
      code: "WORKER_FAILED",
      workerReasonCode: "MODEL_LOAD_FAILED",
    });
    expect(failedWorker.terminateCount).toBe(1);
  });

  it("terminates and removes every listener when the operation times out", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const promise = startWith(worker, { timeoutMs: 25 });
      const rejection = expect(promise).rejects.toMatchObject({
        code: "WORKER_TIMEOUT",
      });

      await vi.advanceTimersByTimeAsync(25);
      await rejection;

      expect(worker.terminateCount).toBe(1);
      expect(worker.hasNoListeners()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
