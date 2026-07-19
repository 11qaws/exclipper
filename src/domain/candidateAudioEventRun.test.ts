import { describe, expect, it } from "vitest";

import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
} from "../analysis/candidateAudioEventWorkerProtocol";
import {
  assertCandidateAudioEventRunInvariant,
  createCandidateAudioEventRun,
  reduceCandidateAudioEventRun,
  type CandidateAudioEventRunEvent,
  type CandidateAudioEventRunRejectionReason,
  type CandidateAudioEventRunState,
  type CandidateAudioEventWorkerEvent,
  type CandidateAudioEventWorkerEventPayload,
  type CreateCandidateAudioEventRunInput,
} from "./candidateAudioEventRun";

const IDENTITY = {
  protocolVersion: CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  sessionId: "session-1",
  writerEpoch: 7,
  analysisRunId: "analysis-1",
  audioEventRunId: "audio-event-1",
  workerEpoch: 3,
  workerInstanceId: "audio-event-worker-1",
  taskId: "audio-event-task-1",
} as const;

const CANDIDATES = [
  {
    candidateId: "candidate-1",
    proposalRevision: 0,
    proposalRange: { startMs: 0, endMs: 45_000 },
    peakMs: 20_000,
  },
  {
    candidateId: "candidate-2",
    proposalRevision: 2,
    proposalRange: { startMs: 60_000, endMs: 105_000 },
    peakMs: 82_000,
  },
  {
    candidateId: "candidate-3",
    proposalRevision: 0,
    proposalRange: { startMs: 120_000, endMs: 165_000 },
    peakMs: 142_000,
  },
] as const;

function input(
  candidates: CreateCandidateAudioEventRunInput["candidates"] = CANDIDATES,
): CreateCandidateAudioEventRunInput {
  return {
    identity: IDENTITY,
    sourceBinding: {
      sourceBindingId: "source-binding-1",
      sourceBindingRevision: 0,
      sourceDurationMs: 180_000,
    },
    model: {
      modelId: CANDIDATE_AUDIO_EVENT_MODEL_ID,
      modelRevision: CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
      dtype: CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
      runtimeDevice: CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
    },
    candidates,
  };
}

function workerEvent<TPayload extends CandidateAudioEventWorkerEventPayload>(
  eventId: string,
  payload: TPayload,
): CandidateAudioEventWorkerEvent {
  return {
    ...IDENTITY,
    eventId,
    ...payload,
  };
}

function accept(
  state: CandidateAudioEventRunState,
  event: CandidateAudioEventRunEvent,
): CandidateAudioEventRunState {
  const outcome = reduceCandidateAudioEventRun(state, event);
  expect(outcome.accepted).toBe(true);
  if (!outcome.accepted) {
    throw new Error(`transition rejected: ${outcome.reason}`);
  }
  return outcome.state;
}

function reject(
  state: CandidateAudioEventRunState,
  event: CandidateAudioEventRunEvent,
  reason: CandidateAudioEventRunRejectionReason,
): void {
  const outcome = reduceCandidateAudioEventRun(state, event);
  expect(outcome).toEqual({ accepted: false, state, reason });
}

function startThroughModelReady(): CandidateAudioEventRunState {
  let state = createCandidateAudioEventRun(input());
  state = accept(state, { type: "START_REQUESTED" });
  state = accept(
    state,
    workerEvent("event-worker-prepared", { type: "WORKER_PREPARED" }),
  );
  return accept(
    state,
    workerEvent("event-model-ready", { type: "MODEL_READY" }),
  );
}

function settleAllWithoutGaps(): CandidateAudioEventRunState {
  let state = startThroughModelReady();
  state = accept(
    state,
    workerEvent("event-candidate-1", {
      type: "CANDIDATE_DETECTED",
      candidateId: "candidate-1",
      expectedProposalRevision: 0,
      detectionCount: 2,
    }),
  );
  state = accept(
    state,
    workerEvent("event-candidate-2", {
      type: "CANDIDATE_NO_CLEAR_EVENT",
      candidateId: "candidate-2",
      expectedProposalRevision: 2,
      reasonCode: "LOW_EVENT_CONFIDENCE",
    }),
  );
  return accept(
    state,
    workerEvent("event-candidate-3", {
      type: "CANDIDATE_DETECTED",
      candidateId: "candidate-3",
      expectedProposalRevision: 0,
      detectionCount: 1,
    }),
  );
}

describe("CandidateAudioEventRun", () => {
  it("pins an independent protocol and the AST q8 WASM model contract", () => {
    expect(CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION).toBe("1.0.0");
    expect(CANDIDATE_AUDIO_EVENT_MODEL_ID).toBe(
      "Xenova/ast-finetuned-audioset-10-10-0.4593",
    );
    expect(CANDIDATE_AUDIO_EVENT_MODEL_REVISION).toBe(
      "249a1fbf0286b40e7f1ed687a8ae396997bf7dc6",
    );
    expect(CANDIDATE_AUDIO_EVENT_MODEL_DTYPE).toBe("q8");
    expect(CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE).toBe("wasm");
    expect(CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ).toBe(16_000);
    expect(MAX_CANDIDATE_AUDIO_EVENT_TARGETS).toBe(12);
  });

  it("processes candidates in snapshot order and waits in finalizing for a validated completion envelope", () => {
    let state = startThroughModelReady();
    expect(state).toMatchObject({
      status: "classifying",
      activeCandidateId: "candidate-1",
      candidateOutcomes: [
        { candidateId: "candidate-1", status: "classifying" },
        { candidateId: "candidate-2", status: "pending" },
        { candidateId: "candidate-3", status: "pending" },
      ],
    });

    state = accept(
      state,
      workerEvent("event-result-1", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 2,
      }),
    );
    expect(state).toMatchObject({
      status: "classifying",
      activeCandidateId: "candidate-2",
    });

    state = accept(
      state,
      workerEvent("event-result-2", {
        type: "CANDIDATE_NO_CLEAR_EVENT",
        candidateId: "candidate-2",
        expectedProposalRevision: 2,
        reasonCode: "NO_ALLOWLIST_EVENT",
      }),
    );
    state = accept(
      state,
      workerEvent("event-result-3", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-3",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
    );
    expect(state.status).toBe("finalizing");

    const invalidCompletion = workerEvent("event-completion", {
      type: "RUN_COMPLETED",
      requestedCount: 3,
      completedCount: 2,
      gapCount: 0,
    });
    reject(
      state,
      invalidCompletion,
      "completion_completed_count_mismatch",
    );

    state = accept(
      state,
      workerEvent("event-completion", {
        type: "RUN_COMPLETED",
        requestedCount: 3,
        completedCount: 3,
        gapCount: 0,
      }),
    );
    expect(state).toMatchObject({
      status: "completed",
      summary: {
        totalCandidateCount: 3,
        pendingCount: 0,
        classifyingCount: 0,
        detectedCount: 2,
        noClearCount: 1,
        failedCount: 0,
        gapCount: 0,
      },
      completionEnvelope: {
        requestedCount: 3,
        completedCount: 3,
        gapCount: 0,
      },
    });
  });

  it("finishes mixed result and processing-gap outcomes as completedWithGaps", () => {
    let state = startThroughModelReady();
    state = accept(
      state,
      workerEvent("mixed-result-1", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
    );
    state = accept(
      state,
      workerEvent("mixed-gap-2", {
        type: "CANDIDATE_FAILED",
        candidateId: "candidate-2",
        expectedProposalRevision: 2,
        reasonCode: "AUDIO_DECODE_FAILED",
      }),
    );
    state = accept(
      state,
      workerEvent("mixed-result-3", {
        type: "CANDIDATE_NO_CLEAR_EVENT",
        candidateId: "candidate-3",
        expectedProposalRevision: 0,
        reasonCode: "NOISY_AUDIO",
      }),
    );
    expect(state.status).toBe("finalizing");

    state = accept(
      state,
      workerEvent("mixed-completion", {
        type: "RUN_COMPLETED",
        requestedCount: 3,
        completedCount: 2,
        gapCount: 1,
      }),
    );
    expect(state).toMatchObject({
      status: "completedWithGaps",
      summary: {
        detectedCount: 1,
        noClearCount: 1,
        failedCount: 1,
        gapCount: 1,
      },
    });
  });

  it.each([
    ["protocolVersion", "9.9.9", "protocol_version_mismatch"],
    ["sessionId", "stale-session", "session_id_mismatch"],
    ["writerEpoch", 99, "writer_epoch_mismatch"],
    ["analysisRunId", "stale-analysis", "analysis_run_id_mismatch"],
    ["audioEventRunId", "stale-audio-event", "audio_event_run_id_mismatch"],
    ["workerEpoch", 99, "worker_epoch_mismatch"],
    ["workerInstanceId", "stale-worker", "worker_instance_id_mismatch"],
    ["taskId", "stale-task", "task_id_mismatch"],
  ] as const)(
    "rejects a stale %s without changing state",
    (field, value, reason) => {
      const state = startThroughModelReady();
      const stale = {
        ...workerEvent(`stale-${field}`, {
          type: "CANDIDATE_DETECTED",
          candidateId: "candidate-1",
          expectedProposalRevision: 0,
          detectionCount: 1,
        }),
        [field]: value,
      } as CandidateAudioEventRunEvent;
      reject(state, stale, reason);
    },
  );

  it("rejects duplicate and stale-revision events without poisoning reusable event IDs", () => {
    let state = startThroughModelReady();
    reject(
      state,
      workerEvent("event-model-ready", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
      "duplicate_event_id",
    );

    const staleRevision = workerEvent("reusable-candidate-result", {
      type: "CANDIDATE_DETECTED",
      candidateId: "candidate-1",
      expectedProposalRevision: 9,
      detectionCount: 1,
    });
    reject(state, staleRevision, "expected_revision_mismatch");

    state = accept(
      state,
      workerEvent("reusable-candidate-result", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
    );
    expect(state).toMatchObject({
      status: "classifying",
      activeCandidateId: "candidate-2",
    });
  });

  it("rejects unknown, out-of-order, repeated, and malformed candidate outcomes", () => {
    let state = startThroughModelReady();
    reject(
      state,
      workerEvent("unknown-candidate", {
        type: "CANDIDATE_DETECTED",
        candidateId: "not-in-snapshot",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
      "candidate_not_eligible",
    );
    reject(
      state,
      workerEvent("out-of-order", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-2",
        expectedProposalRevision: 2,
        detectionCount: 1,
      }),
      "candidate_not_active",
    );
    reject(
      state,
      workerEvent("invalid-count", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 0,
      }),
      "invalid_detection_count",
    );

    state = accept(
      state,
      workerEvent("valid-first", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
    );
    reject(
      state,
      workerEvent("repeated-first", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
      "candidate_already_terminal",
    );
  });

  it("waits for a fenced cancellation ACK and records client force termination separately", () => {
    let state = startThroughModelReady();
    state = accept(state, { type: "CANCEL_REQUESTED" });
    expect(state).toMatchObject({
      status: "cancelling",
      requestedFrom: "classifying",
      activeCandidateIdAtRequest: "candidate-1",
    });
    reject(state, { type: "CANCEL_REQUESTED" }, "cancellation_already_requested");
    reject(
      state,
      workerEvent("late-result", {
        type: "CANDIDATE_DETECTED",
        candidateId: "candidate-1",
        expectedProposalRevision: 0,
        detectionCount: 1,
      }),
      "cancel_in_progress",
    );
    state = accept(
      state,
      workerEvent("cancel-ack", { type: "CANCEL_ACKNOWLEDGED" }),
    );
    expect(state).toMatchObject({
      status: "cancelled",
      terminationKind: "workerAcknowledged",
      summary: { classifyingCount: 1, detectedCount: 0 },
    });

    let forceTerminated = createCandidateAudioEventRun(input());
    forceTerminated = accept(forceTerminated, { type: "START_REQUESTED" });
    forceTerminated = accept(
      forceTerminated,
      workerEvent("force-worker-prepared", { type: "WORKER_PREPARED" }),
    );
    forceTerminated = accept(forceTerminated, { type: "CANCEL_REQUESTED" });
    forceTerminated = accept(forceTerminated, {
      type: "CLIENT_FORCE_TERMINATED",
    });
    expect(forceTerminated).toMatchObject({
      status: "cancelled",
      terminationKind: "clientForceTerminated",
      summary: { pendingCount: 3, classifyingCount: 0 },
    });
  });

  it("keeps terminal states absorbing", () => {
    let state = settleAllWithoutGaps();
    state = accept(
      state,
      workerEvent("terminal-completion", {
        type: "RUN_COMPLETED",
        requestedCount: 3,
        completedCount: 3,
        gapCount: 0,
      }),
    );
    expect(state.status).toBe("completed");

    reject(state, { type: "CANCEL_REQUESTED" }, "terminal_state_absorbing");
    reject(
      state,
      workerEvent("late-after-completion", {
        type: "RUN_FAILED",
        reasonCode: "protocol_error",
      }),
      "terminal_state_absorbing",
    );
  });

  it("copies and freezes valid snapshots and rejects malformed pinned inputs", () => {
    const mutableCandidate = {
      candidateId: "candidate-copy",
      proposalRevision: 0,
      proposalRange: { startMs: 0, endMs: 20_000 },
      peakMs: 10_000,
    };
    const state = createCandidateAudioEventRun(input([mutableCandidate]));
    mutableCandidate.proposalRange.startMs = 5_000;
    expect(state.snapshot.candidates[0]?.proposalRange.startMs).toBe(0);
    expect(Object.isFrozen(state.snapshot)).toBe(true);
    expect(Object.isFrozen(state.snapshot.candidates)).toBe(true);
    expect(Object.isFrozen(state.snapshot.candidates[0]?.proposalRange)).toBe(true);
    expect(() => assertCandidateAudioEventRunInvariant(state)).not.toThrow();

    expect(() =>
      createCandidateAudioEventRun({
        ...input(),
        identity: {
          ...IDENTITY,
          protocolVersion: "9.9.9" as typeof CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
        },
      }),
    ).toThrow(/protocolVersion/u);
    expect(() =>
      createCandidateAudioEventRun({
        ...input(),
        candidates: [
          CANDIDATES[0],
          { ...CANDIDATES[0] },
        ],
      }),
    ).toThrow(/duplicate candidateId/u);
    expect(() =>
      createCandidateAudioEventRun({
        ...input(),
        candidates: [
          {
            ...CANDIDATES[0],
            peakMs: CANDIDATES[0].proposalRange.endMs + 1,
          },
        ],
      }),
    ).toThrow(/peakMs/u);
  });
});
