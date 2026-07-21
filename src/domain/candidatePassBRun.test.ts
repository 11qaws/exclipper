import { describe, expect, it } from "vitest";

import {
  assertCandidatePassBRunInvariant,
  createCandidatePassBRun,
  isCandidatePassBRunTerminal,
  MAX_CANDIDATE_PASS_B_CANDIDATES,
  reduceCandidatePassBRun,
  summarizeCandidatePassBRun,
  type CandidatePassBCandidateSnapshot,
  type CandidatePassBRunEvent,
  type CandidatePassBRunIdentity,
  type CandidatePassBRunRejectionReason,
  type CandidatePassBRunState,
  type CandidatePassBWorkerEvent,
  type CandidatePassBWorkerEventPayload,
  type CreateCandidatePassBRunInput,
} from "./candidatePassBRun";

const IDENTITY = {
  sessionId: "session-1",
  writerEpoch: 4,
  analysisRunId: "analysis-run-1",
  passBRunId: "pass-b-run-1",
  workerEpoch: 2,
  workerInstanceId: "worker-1",
  taskId: "task-1",
} as const satisfies CandidatePassBRunIdentity;

const CANDIDATES = [
  {
    candidateId: "candidate-1",
    proposalRevision: 3,
    proposalRange: { startMs: 10_000, endMs: 50_000 },
    peakMs: 32_000,
  },
  {
    candidateId: "candidate-2",
    proposalRevision: 7,
    proposalRange: { startMs: 70_000, endMs: 120_000 },
    peakMs: 95_000,
  },
] as const satisfies readonly CandidatePassBCandidateSnapshot[];

function makeInput(
  candidates: readonly CandidatePassBCandidateSnapshot[] = CANDIDATES,
): CreateCandidatePassBRunInput {
  return {
    identity: IDENTITY,
    sourceBinding: {
      sourceBindingId: "source-1",
      sourceBindingRevision: 5,
      sourceDurationMs: 180_000,
    },
    model: {
      modelId: "onnx-community/whisper-small",
      modelRevision: "model-revision-1",
      runtimeDevice: "wasm",
    },
    candidates,
  };
}

function workerEvent(
  eventId: string,
  payload: CandidatePassBWorkerEventPayload,
): CandidatePassBWorkerEvent {
  return { ...IDENTITY, eventId, ...payload };
}

function apply(
  state: CandidatePassBRunState,
  event: CandidatePassBRunEvent,
): CandidatePassBRunState {
  const outcome = reduceCandidatePassBRun(state, event);
  expect(outcome.accepted).toBe(true);
  if (!outcome.accepted) {
    throw new Error(`Expected accepted transition, got ${outcome.reason}`);
  }
  return outcome.state;
}

function expectRejected(
  state: CandidatePassBRunState,
  event: CandidatePassBRunEvent,
  reason: CandidatePassBRunRejectionReason,
): void {
  const outcome = reduceCandidatePassBRun(state, event);
  expect(outcome).toEqual({ accepted: false, state, reason });
}

function makePreparing(): CandidatePassBRunState {
  return apply(createCandidatePassBRun(makeInput()), {
    type: "START_REQUESTED",
  });
}

function makeLoadingModel(): CandidatePassBRunState {
  return apply(
    makePreparing(),
    workerEvent("event-worker-prepared", { type: "WORKER_PREPARED" }),
  );
}

function makeTranscribing(): CandidatePassBRunState {
  return apply(
    makeLoadingModel(),
    workerEvent("event-model-ready", { type: "MODEL_READY" }),
  );
}

function makeFinalizing(): CandidatePassBRunState {
  let state = makeTranscribing();
  state = apply(
    state,
    workerEvent("event-finalizing-candidate-1", {
      type: "CANDIDATE_CLUE_FOUND",
      candidateId: "candidate-1",
      expectedProposalRevision: 3,
      clueCount: 1,
    }),
  );
  return apply(
    state,
    workerEvent("event-finalizing-candidate-2", {
      type: "CANDIDATE_CLUE_FOUND",
      candidateId: "candidate-2",
      expectedProposalRevision: 7,
      clueCount: 1,
    }),
  );
}

describe("CandidatePassBRun reducer", () => {
  it("waits in finalizing after every candidate settles and completes only after the fenced envelope", () => {
    let state = createCandidatePassBRun(makeInput());

    expect(state.status).toBe("idle");
    expect([...state.eligibleCandidateIds]).toEqual([
      "candidate-1",
      "candidate-2",
    ]);
    expect(summarizeCandidatePassBRun(state)).toMatchObject({
      totalCandidateCount: 2,
      pendingCount: 2,
    });

    state = apply(state, { type: "START_REQUESTED" });
    expect(state.status).toBe("preparing");
    state = apply(
      state,
      workerEvent("event-worker-prepared", { type: "WORKER_PREPARED" }),
    );
    expect(state.status).toBe("loadingModel");
    state = apply(
      state,
      workerEvent("event-model-ready", { type: "MODEL_READY" }),
    );
    expect(state).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-1",
    });

    state = apply(
      state,
      workerEvent("event-candidate-1", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        clueCount: 2,
      }),
    );
    expect(state).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-2",
    });
    expect(summarizeCandidatePassBRun(state)).toEqual({
      totalCandidateCount: 2,
      pendingCount: 1,
      clueFoundCount: 1,
      noClearSpeechCount: 0,
      failedCount: 0,
      gapCount: 0,
    });

    state = apply(
      state,
      workerEvent("event-candidate-2", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-2",
        expectedProposalRevision: 7,
        clueCount: 1,
      }),
    );
    expect(state).toMatchObject({
      status: "finalizing",
    });
    expect(isCandidatePassBRunTerminal(state)).toBe(false);

    state = apply(
      state,
      workerEvent("event-run-completed", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      }),
    );
    expect(state).toMatchObject({
      status: "completed",
      summary: {
        totalCandidateCount: 2,
        pendingCount: 0,
        clueFoundCount: 2,
        noClearSpeechCount: 0,
        failedCount: 0,
        gapCount: 0,
      },
      completionEnvelope: {
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      },
    });
    expect(isCandidatePassBRunTerminal(state)).toBe(true);
  });

  it("bypasses model loading explicitly when source audio cannot be decoded, then records every candidate gap", () => {
    let state = makeLoadingModel();

    state = apply(
      state,
      workerEvent("event-model-bypassed", {
        type: "MODEL_BYPASSED",
        reasonCode: "source_audio_unsupported",
      }),
    );
    expect(state).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-1",
    });

    state = apply(
      state,
      workerEvent("event-candidate-1-gap", {
        type: "CANDIDATE_FAILED",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        reasonCode: "audio_decode_failed",
      }),
    );
    state = apply(
      state,
      workerEvent("event-candidate-2-gap", {
        type: "CANDIDATE_FAILED",
        candidateId: "candidate-2",
        expectedProposalRevision: 7,
        reasonCode: "audio_decode_failed",
      }),
    );

    expect(state.status).toBe("finalizing");
    state = apply(
      state,
      workerEvent("event-all-gaps-completed", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 0,
        gapCount: 2,
      }),
    );
    expect(state).toMatchObject({
      status: "completedWithGaps",
      summary: {
        pendingCount: 0,
        failedCount: 2,
      },
    });
  });

  it("continues after content and processing gaps, then reports completedWithGaps", () => {
    const candidates = [
      ...CANDIDATES,
      {
        candidateId: "candidate-3",
        proposalRevision: 1,
        proposalRange: { startMs: 125_000, endMs: 170_000 },
        peakMs: 150_000,
      },
    ] satisfies readonly CandidatePassBCandidateSnapshot[];

    let state = createCandidatePassBRun(makeInput(candidates));
    state = apply(state, { type: "START_REQUESTED" });
    state = apply(
      state,
      workerEvent("event-worker-prepared", { type: "WORKER_PREPARED" }),
    );
    state = apply(
      state,
      workerEvent("event-model-ready", { type: "MODEL_READY" }),
    );
    state = apply(
      state,
      workerEvent("event-no-speech", {
        type: "CANDIDATE_NO_CLEAR_SPEECH",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        reasonCode: "no_speech",
        workerDisposition: "result",
      }),
    );
    expect(state).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-2",
    });
    expect(state.candidateOutcomes[0]).toEqual({
      candidateId: "candidate-1",
      status: "noClearSpeech",
      reasonCode: "no_speech",
      gapKind: "contentGap",
      workerDisposition: "result",
    });

    state = apply(
      state,
      workerEvent("event-decode-failed", {
        type: "CANDIDATE_FAILED",
        candidateId: "candidate-2",
        expectedProposalRevision: 7,
        reasonCode: "audio_decode_failed",
      }),
    );
    expect(state).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-3",
    });
    expect(state.candidateOutcomes[1]).toEqual({
      candidateId: "candidate-2",
      status: "failed",
      reasonCode: "audio_decode_failed",
      gapKind: "processingGap",
      workerDisposition: "gap",
    });

    state = apply(
      state,
      workerEvent("event-last-clue", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-3",
        expectedProposalRevision: 1,
        clueCount: 1,
      }),
    );
    expect(state).toMatchObject({
      status: "finalizing",
    });
    state = apply(
      state,
      workerEvent("event-mixed-run-completed", {
        type: "RUN_COMPLETED",
        requestedCount: 3,
        resultCount: 2,
        gapCount: 1,
      }),
    );
    expect(state).toMatchObject({
      status: "completedWithGaps",
      summary: {
        totalCandidateCount: 3,
        pendingCount: 0,
        clueFoundCount: 1,
        noClearSpeechCount: 1,
        failedCount: 1,
        gapCount: 2,
      },
    });
  });

  it.each([
    [
      "invalid numeric counts",
      { requestedCount: 2, resultCount: -1, gapCount: 3 },
      "invalid_completion_counts",
    ],
    [
      "requested count mismatch",
      { requestedCount: 3, resultCount: 2, gapCount: 0 },
      "completion_requested_count_mismatch",
    ],
    [
      "result count mismatch",
      { requestedCount: 2, resultCount: 1, gapCount: 0 },
      "completion_result_count_mismatch",
    ],
    [
      "gap count mismatch",
      { requestedCount: 2, resultCount: 2, gapCount: 1 },
      "completion_gap_count_mismatch",
    ],
  ] as const)("rejects a completion envelope with %s", (_label, counts, reason) => {
    const state = makeFinalizing();
    const event = workerEvent("event-rejected-completion", {
      type: "RUN_COMPLETED",
      ...counts,
    });

    expectRejected(state, event, reason);
    expect(state.processedEventIds.has("event-rejected-completion")).toBe(false);
    expect(state.status).toBe("finalizing");
  });

  it("fences completion identity and lets a corrected envelope reuse a rejected event ID", () => {
    let state = makeFinalizing();
    expectRejected(
      state,
      {
        ...workerEvent("event-completion-reusable", {
          type: "RUN_COMPLETED",
          requestedCount: 2,
          resultCount: 2,
          gapCount: 0,
        }),
        passBRunId: "stale-pass-b-run",
      },
      "pass_b_run_id_mismatch",
    );

    expectRejected(
      state,
      workerEvent("event-completion-reusable", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 1,
        gapCount: 0,
      }),
      "completion_result_count_mismatch",
    );
    expect(state.processedEventIds.has("event-completion-reusable")).toBe(false);

    state = apply(
      state,
      workerEvent("event-completion-reusable", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      }),
    );
    expect(state.status).toBe("completed");
  });

  it("accepts parallel candidate results while rejecting stale, repeated, and invalid results", () => {
    let state = makeTranscribing();

    expectRejected(
      state,
      workerEvent("event-unknown", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "not-eligible",
        expectedProposalRevision: 0,
        clueCount: 1,
      }),
      "candidate_not_eligible",
    );
    const parallelState = apply(
      state,
      workerEvent("event-out-of-order", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-2",
        expectedProposalRevision: 7,
        clueCount: 1,
      }),
    );
    expect(parallelState).toMatchObject({
      status: "transcribing",
      activeCandidateId: "candidate-1",
    });
    expect(parallelState.candidateOutcomes[1]).toMatchObject({
      candidateId: "candidate-2",
      status: "clueFound",
    });
    expectRejected(
      state,
      workerEvent("event-stale-revision", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 2,
        clueCount: 1,
      }),
      "expected_revision_mismatch",
    );
    expectRejected(
      state,
      workerEvent("event-zero-clues", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        clueCount: 0,
      }),
      "invalid_clue_count",
    );
    expectRejected(
      state,
      {
        ...IDENTITY,
        eventId: "event-invalid-disposition",
        type: "CANDIDATE_NO_CLEAR_SPEECH",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        reasonCode: "no_speech",
        workerDisposition: "unknown",
      } as unknown as CandidatePassBRunEvent,
      "invalid_worker_disposition",
    );

    state = apply(
      state,
      workerEvent("event-settle-first", {
        type: "CANDIDATE_NO_CLEAR_SPEECH",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        reasonCode: "low_transcript_confidence",
        workerDisposition: "result",
      }),
    );
    expectRejected(
      state,
      workerEvent("event-repeat-first", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        clueCount: 1,
      }),
      "candidate_already_terminal",
    );
  });

  it.each<
    [
      keyof CandidatePassBRunIdentity,
      string | number,
      CandidatePassBRunRejectionReason,
    ]
  >([
    ["sessionId", "stale-session", "session_id_mismatch"],
    ["writerEpoch", 3, "writer_epoch_mismatch"],
    ["analysisRunId", "stale-analysis", "analysis_run_id_mismatch"],
    ["passBRunId", "stale-pass-b", "pass_b_run_id_mismatch"],
    ["workerEpoch", 1, "worker_epoch_mismatch"],
    ["workerInstanceId", "stale-worker", "worker_instance_id_mismatch"],
    ["taskId", "stale-task", "task_id_mismatch"],
  ])("rejects stale worker identity field %s", (field, value, reason) => {
    const state = makePreparing();
    const event = {
      ...workerEvent("event-stale", { type: "WORKER_PREPARED" }),
      [field]: value,
    };

    expectRejected(state, event, reason);
    expect(state.processedEventIds.size).toBe(0);
  });

  it("rejects blank and duplicate event IDs without letting rejected events poison the fence", () => {
    let state = makePreparing();
    expectRejected(
      state,
      workerEvent("   ", { type: "WORKER_PREPARED" }),
      "invalid_event_id",
    );

    const stale = {
      ...workerEvent("event-reusable", { type: "WORKER_PREPARED" }),
      passBRunId: "old-pass-b-run",
    };
    expectRejected(state, stale, "pass_b_run_id_mismatch");
    expect(state.processedEventIds.has("event-reusable")).toBe(false);

    const accepted = workerEvent("event-reusable", { type: "WORKER_PREPARED" });
    state = apply(state, accepted);
    expect(state.processedEventIds.has("event-reusable")).toBe(true);
    expectRejected(state, accepted, "duplicate_event_id");
  });

  it("waits for cancellation acknowledgement and starts no further candidate", () => {
    let state = makeTranscribing();
    state = apply(state, { type: "CANCEL_REQUESTED" });
    expect(state).toMatchObject({
      status: "cancelling",
      requestedFrom: "transcribing",
      activeCandidateIdAtRequest: "candidate-1",
    });

    expectRejected(
      state,
      workerEvent("event-result-after-cancel", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        clueCount: 1,
      }),
      "cancel_in_progress",
    );
    expectRejected(
      state,
      { type: "CANCEL_REQUESTED" },
      "cancellation_already_requested",
    );
    expect(summarizeCandidatePassBRun(state).pendingCount).toBe(2);

    expectRejected(
      state,
      {
        ...workerEvent("event-stale-ack", {
          type: "CANCEL_ACKNOWLEDGED",
        }),
        workerInstanceId: "old-worker",
      },
      "worker_instance_id_mismatch",
    );
    state = apply(
      state,
      workerEvent("event-cancel-ack", { type: "CANCEL_ACKNOWLEDGED" }),
    );
    expect(state).toMatchObject({
      status: "cancelled",
      summary: { pendingCount: 2, gapCount: 0 },
      terminationKind: "workerAcknowledged",
    });
    expect(isCandidatePassBRunTerminal(state)).toBe(true);
  });

  it.each(["preparing", "loadingModel"] as const)(
    "allows cancellation while %s but still requires acknowledgement",
    (status) => {
      let state = status === "preparing" ? makePreparing() : makeLoadingModel();
      state = apply(state, { type: "CANCEL_REQUESTED" });
      expect(state).toMatchObject({
        status: "cancelling",
        requestedFrom: status,
        activeCandidateIdAtRequest: null,
      });
      state = apply(
        state,
        workerEvent(`event-${status}-cancel-ack`, {
          type: "CANCEL_ACKNOWLEDGED",
        }),
      );
      expect(state.status).toBe("cancelled");
    },
  );

  it("records a client-forced termination separately when cancellation ACK never arrives", () => {
    let state = makeTranscribing();
    state = apply(state, { type: "CANCEL_REQUESTED" });
    const processedBeforeTermination = state.processedEventIds;

    state = apply(state, { type: "CLIENT_FORCE_TERMINATED" });

    expect(state).toMatchObject({
      status: "cancelled",
      terminationKind: "clientForceTerminated",
      summary: { pendingCount: 2 },
    });
    expect(state.processedEventIds).toBe(processedBeforeTermination);
    expect(isCandidatePassBRunTerminal(state)).toBe(true);
  });

  it("allows cancellation while finalizing and rejects a raced Worker completion until termination", () => {
    let state = makeFinalizing();
    state = apply(state, { type: "CANCEL_REQUESTED" });
    expect(state).toMatchObject({
      status: "cancelling",
      requestedFrom: "finalizing",
      activeCandidateIdAtRequest: null,
    });

    expectRejected(
      state,
      workerEvent("event-completed-after-cancel", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      }),
      "cancel_in_progress",
    );
    state = apply(state, { type: "CLIENT_FORCE_TERMINATED" });
    expect(state).toMatchObject({
      status: "cancelled",
      terminationKind: "clientForceTerminated",
      summary: { pendingCount: 0, clueFoundCount: 2 },
    });
  });

  it("keeps candidate results intact when a run-level failure terminates processing", () => {
    let state = makeTranscribing();
    state = apply(
      state,
      workerEvent("event-first-clue", {
        type: "CANDIDATE_CLUE_FOUND",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        clueCount: 2,
      }),
    );
    state = apply(
      state,
      workerEvent("event-model-failed", {
        type: "RUN_FAILED",
        reasonCode: "model_load_failed",
      }),
    );

    expect(state).toMatchObject({
      status: "failed",
      reasonCode: "model_load_failed",
      summary: {
        pendingCount: 1,
        clueFoundCount: 1,
        gapCount: 0,
      },
    });
    expect(state.candidateOutcomes[0]).toMatchObject({
      status: "clueFound",
      clueCount: 2,
    });
  });

  it("allows a fenced run failure to terminate finalizing without inventing success", () => {
    let state = makeFinalizing();
    state = apply(
      state,
      workerEvent("event-finalizing-failed", {
        type: "RUN_FAILED",
        reasonCode: "protocol_error",
      }),
    );

    expect(state).toMatchObject({
      status: "failed",
      reasonCode: "protocol_error",
      summary: { pendingCount: 0, clueFoundCount: 2 },
    });
  });

  it("makes terminal states absorbing", () => {
    let state = makeTranscribing();
    state = apply(
      state,
      workerEvent("event-run-failed", {
        type: "RUN_FAILED",
        reasonCode: "runtime_unavailable",
      }),
    );

    expectRejected(state, { type: "CANCEL_REQUESTED" }, "terminal_state_absorbing");
    expectRejected(
      state,
      workerEvent("event-late-model", { type: "MODEL_READY" }),
      "terminal_state_absorbing",
    );
  });

  it("rejects transitions that are not defined for the current lifecycle state", () => {
    const idle = createCandidatePassBRun(makeInput());
    expectRejected(
      idle,
      workerEvent("event-too-early-model", { type: "MODEL_READY" }),
      "undefined_transition",
    );
    expectRejected(idle, { type: "CANCEL_REQUESTED" }, "undefined_transition");
    expectRejected(
      idle,
      { type: "CLIENT_FORCE_TERMINATED" },
      "undefined_transition",
    );

    const preparing = apply(idle, { type: "START_REQUESTED" });
    expectRejected(
      preparing,
      { type: "START_REQUESTED" },
      "undefined_transition",
    );
    expectRejected(
      preparing,
      workerEvent("event-too-early-candidate", {
        type: "CANDIDATE_NO_CLEAR_SPEECH",
        candidateId: "candidate-1",
        expectedProposalRevision: 3,
        reasonCode: "no_speech",
        workerDisposition: "result",
      }),
      "undefined_transition",
    );

    const transcribing = makeTranscribing();
    expectRejected(
      transcribing,
      workerEvent("event-too-early-completion", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      }),
      "undefined_transition",
    );
    expectRejected(
      transcribing,
      workerEvent("event-unsolicited-cancel-ack", {
        type: "CANCEL_ACKNOWLEDGED",
      }),
      "undefined_transition",
    );
  });

  it("copies and freezes the immutable start snapshot", () => {
    const mutableCandidate = {
      candidateId: "candidate-mutable",
      proposalRevision: 1,
      proposalRange: { startMs: 1_000, endMs: 40_000 },
      peakMs: 20_000,
    };
    const mutableCandidates = [mutableCandidate];
    const state = createCandidatePassBRun(makeInput(mutableCandidates));

    mutableCandidate.proposalRange.startMs = 5_000;
    mutableCandidates.push({
      candidateId: "candidate-added-later",
      proposalRevision: 0,
      proposalRange: { startMs: 50_000, endMs: 90_000 },
      peakMs: 70_000,
    });

    expect(state.snapshot.candidates).toHaveLength(1);
    expect(state.snapshot.candidates[0]?.proposalRange.startMs).toBe(1_000);
    expect(Object.isFrozen(state.snapshot)).toBe(true);
    expect(Object.isFrozen(state.snapshot.candidates)).toBe(true);
    expect(Object.isFrozen(state.snapshot.candidates[0]?.proposalRange)).toBe(true);
  });

  it("rejects malformed or ambiguous start snapshots", () => {
    expect(() => createCandidatePassBRun(makeInput([]))).toThrow(RangeError);

    const tooMany = Array.from(
      { length: MAX_CANDIDATE_PASS_B_CANDIDATES + 1 },
      (_, index) => ({
        candidateId: `candidate-${index}`,
        proposalRevision: 0,
        proposalRange: { startMs: index * 1_000, endMs: index * 1_000 + 500 },
        peakMs: index * 1_000 + 250,
      }),
    );
    expect(() => createCandidatePassBRun(makeInput(tooMany))).toThrow(
      RangeError,
    );

    expect(() =>
      createCandidatePassBRun(makeInput([CANDIDATES[0], CANDIDATES[0]])),
    ).toThrow(/duplicate candidateId/);

    expect(() =>
      createCandidatePassBRun(
        makeInput([
          {
            ...CANDIDATES[0],
            proposalRange: { startMs: 50_000, endMs: 50_000 },
          },
        ]),
      ),
    ).toThrow(/positive duration/);

    expect(() =>
      createCandidatePassBRun(
        makeInput([{ ...CANDIDATES[0], peakMs: 60_000 }]),
      ),
    ).toThrow(/inside proposalRange/);

    expect(() =>
      createCandidatePassBRun({
        ...makeInput(),
        identity: { ...IDENTITY, passBRunId: "  " },
      }),
    ).toThrow(/passBRunId/);
  });

  it("detects impossible externally fabricated completion states", () => {
    const idle = createCandidatePassBRun(makeInput());
    const impossible = {
      ...idle,
      status: "completed",
      summary: summarizeCandidatePassBRun(idle),
    } as CandidatePassBRunState;

    expect(() => assertCandidatePassBRunInvariant(impossible)).toThrow(
      /cannot contain pending candidates/,
    );
  });

  it("detects fabricated finalizing state while candidates are still pending", () => {
    const idle = createCandidatePassBRun(makeInput());
    const impossible = {
      ...idle,
      status: "finalizing",
    } as CandidatePassBRunState;

    expect(() => assertCandidatePassBRunInvariant(impossible)).toThrow(
      /finalizing requires every candidate to be terminal/,
    );
  });

  it("detects a fabricated success whose completion envelope disagrees with outcomes", () => {
    const completed = apply(
      makeFinalizing(),
      workerEvent("event-valid-completion", {
        type: "RUN_COMPLETED",
        requestedCount: 2,
        resultCount: 2,
        gapCount: 0,
      }),
    );
    const impossible = {
      ...completed,
      completionEnvelope: {
        requestedCount: 2,
        resultCount: 1,
        gapCount: 1,
      },
    } as CandidatePassBRunState;

    expect(() => assertCandidatePassBRunInvariant(impossible)).toThrow(
      /completion envelope must match every terminal candidate outcome/,
    );
  });
});
