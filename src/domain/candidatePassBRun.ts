export const MAX_CANDIDATE_PASS_B_CANDIDATES = 12;

export const CANDIDATE_PASS_B_TERMINAL_STATUSES = [
  "completed",
  "completedWithGaps",
  "cancelled",
  "failed",
] as const;

export type CandidatePassBRuntimeDevice = "webgpu" | "wasm" | "remote";

export interface CandidatePassBRunIdentity {
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly analysisRunId: string;
  readonly passBRunId: string;
  readonly workerEpoch: number;
  readonly workerInstanceId: string;
  readonly taskId: string;
}

export interface CandidatePassBSourceBindingSnapshot {
  readonly sourceBindingId: string;
  readonly sourceBindingRevision: number;
  readonly sourceDurationMs: number;
}

export interface CandidatePassBModelSnapshot {
  readonly modelId: string;
  readonly modelRevision: string;
  readonly runtimeDevice: CandidatePassBRuntimeDevice;
}

export interface CandidatePassBProposalRange {
  readonly startMs: number;
  readonly endMs: number;
}

export interface CandidatePassBCandidateSnapshot {
  readonly candidateId: string;
  readonly proposalRevision: number;
  readonly proposalRange: CandidatePassBProposalRange;
  readonly peakMs: number;
}

export interface CandidatePassBRunSnapshot {
  readonly identity: CandidatePassBRunIdentity;
  readonly sourceBinding: CandidatePassBSourceBindingSnapshot;
  readonly model: CandidatePassBModelSnapshot;
  readonly candidates: readonly CandidatePassBCandidateSnapshot[];
}

export type CandidatePassBNoClearSpeechReasonCode =
  | "no_speech"
  | "speech_too_quiet"
  | "low_transcript_confidence"
  | "unintelligible_speech";

export type CandidatePassBCandidateFailureReasonCode =
  | "audio_extraction_failed"
  | "audio_decode_failed"
  | "transcription_failed"
  | "worker_candidate_failed";

export type CandidatePassBRunFailureReasonCode =
  | "worker_initialization_failed"
  | "model_download_failed"
  | "model_load_failed"
  | "runtime_unavailable"
  | "protocol_error";

export type CandidatePassBCandidateOutcome =
  | {
      readonly candidateId: string;
      readonly status: "pending";
    }
  | {
      readonly candidateId: string;
      readonly status: "clueFound";
      readonly clueCount: number;
      readonly workerDisposition: "result";
    }
  | {
      readonly candidateId: string;
      readonly status: "noClearSpeech";
      readonly reasonCode: CandidatePassBNoClearSpeechReasonCode;
      readonly gapKind: "contentGap";
      readonly workerDisposition: "result" | "gap";
    }
  | {
      readonly candidateId: string;
      readonly status: "failed";
      readonly reasonCode: CandidatePassBCandidateFailureReasonCode;
      readonly gapKind: "processingGap";
      readonly workerDisposition: "gap";
    };

export interface CandidatePassBCompletionEnvelope {
  readonly requestedCount: number;
  readonly resultCount: number;
  readonly gapCount: number;
}

export type CandidatePassBCancelTerminationKind =
  | "workerAcknowledged"
  | "clientForceTerminated";

export interface CandidatePassBRunSummary {
  readonly totalCandidateCount: number;
  readonly pendingCount: number;
  readonly clueFoundCount: number;
  readonly noClearSpeechCount: number;
  readonly failedCount: number;
  readonly gapCount: number;
}

type CandidatePassBRunBase = {
  readonly snapshot: CandidatePassBRunSnapshot;
  readonly eligibleCandidateIds: ReadonlySet<string>;
  readonly candidateOutcomes: readonly CandidatePassBCandidateOutcome[];
  readonly processedEventIds: ReadonlySet<string>;
};

export type CandidatePassBRunState =
  | (CandidatePassBRunBase & { readonly status: "idle" })
  | (CandidatePassBRunBase & { readonly status: "preparing" })
  | (CandidatePassBRunBase & { readonly status: "loadingModel" })
  | (CandidatePassBRunBase & {
      readonly status: "transcribing";
      readonly activeCandidateId: string;
    })
  | (CandidatePassBRunBase & { readonly status: "finalizing" })
  | (CandidatePassBRunBase & {
      readonly status: "cancelling";
      readonly requestedFrom:
        | "preparing"
        | "loadingModel"
        | "transcribing"
        | "finalizing";
      readonly activeCandidateIdAtRequest: string | null;
    })
  | (CandidatePassBRunBase & {
      readonly status: "completed";
      readonly summary: CandidatePassBRunSummary;
      readonly completionEnvelope: CandidatePassBCompletionEnvelope;
    })
  | (CandidatePassBRunBase & {
      readonly status: "completedWithGaps";
      readonly summary: CandidatePassBRunSummary;
      readonly completionEnvelope: CandidatePassBCompletionEnvelope;
    })
  | (CandidatePassBRunBase & {
      readonly status: "cancelled";
      readonly summary: CandidatePassBRunSummary;
      readonly terminationKind: CandidatePassBCancelTerminationKind;
    })
  | (CandidatePassBRunBase & {
      readonly status: "failed";
      readonly reasonCode: CandidatePassBRunFailureReasonCode;
      readonly summary: CandidatePassBRunSummary;
    });

export interface CandidatePassBWorkerEventEnvelope
  extends CandidatePassBRunIdentity {
  readonly eventId: string;
}

export type CandidatePassBWorkerEventPayload =
  | { readonly type: "WORKER_PREPARED" }
  | { readonly type: "MODEL_READY" }
  | {
      readonly type: "MODEL_BYPASSED";
      readonly reasonCode: "source_audio_unavailable" | "source_audio_unsupported";
    }
  | {
      readonly type: "CANDIDATE_CLUE_FOUND";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly clueCount: number;
    }
  | {
      readonly type: "CANDIDATE_NO_CLEAR_SPEECH";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly reasonCode: CandidatePassBNoClearSpeechReasonCode;
      readonly workerDisposition: "result" | "gap";
    }
  | {
      readonly type: "CANDIDATE_FAILED";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly reasonCode: CandidatePassBCandidateFailureReasonCode;
    }
  | {
      readonly type: "RUN_COMPLETED";
      readonly requestedCount: number;
      readonly resultCount: number;
      readonly gapCount: number;
    }
  | { readonly type: "CANCEL_ACKNOWLEDGED" }
  | {
      readonly type: "RUN_FAILED";
      readonly reasonCode: CandidatePassBRunFailureReasonCode;
    };

export type CandidatePassBWorkerEvent =
  CandidatePassBWorkerEventEnvelope & CandidatePassBWorkerEventPayload;

export type CandidatePassBRunEvent =
  | { readonly type: "START_REQUESTED" }
  | { readonly type: "CANCEL_REQUESTED" }
  | { readonly type: "CLIENT_FORCE_TERMINATED" }
  | CandidatePassBWorkerEvent;

export type CandidatePassBRunRejectionReason =
  | "terminal_state_absorbing"
  | "undefined_transition"
  | "cancellation_already_requested"
  | "cancel_in_progress"
  | "invalid_event_id"
  | "session_id_mismatch"
  | "writer_epoch_mismatch"
  | "analysis_run_id_mismatch"
  | "pass_b_run_id_mismatch"
  | "worker_epoch_mismatch"
  | "worker_instance_id_mismatch"
  | "task_id_mismatch"
  | "duplicate_event_id"
  | "candidate_not_eligible"
  | "candidate_already_terminal"
  | "candidate_not_active"
  | "expected_revision_mismatch"
  | "invalid_clue_count"
  | "invalid_worker_disposition"
  | "invalid_completion_counts"
  | "completion_requested_count_mismatch"
  | "completion_result_count_mismatch"
  | "completion_gap_count_mismatch";

export type CandidatePassBRunTransitionOutcome =
  | { readonly accepted: true; readonly state: CandidatePassBRunState }
  | {
      readonly accepted: false;
      readonly state: CandidatePassBRunState;
      readonly reason: CandidatePassBRunRejectionReason;
    };

export interface CreateCandidatePassBRunInput {
  readonly identity: CandidatePassBRunIdentity;
  readonly sourceBinding: CandidatePassBSourceBindingSnapshot;
  readonly model: CandidatePassBModelSnapshot;
  readonly candidates: readonly CandidatePassBCandidateSnapshot[];
}

const TERMINAL_STATUS_SET = new Set<CandidatePassBRunState["status"]>(
  CANDIDATE_PASS_B_TERMINAL_STATUSES,
);

function requireIdentifier(value: string, label: string): void {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty, trimmed string`);
  }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function copyAndValidateSnapshot(
  input: CreateCandidatePassBRunInput,
): CandidatePassBRunSnapshot {
  const { identity, sourceBinding, model } = input;

  requireIdentifier(identity.sessionId, "sessionId");
  requireNonNegativeSafeInteger(identity.writerEpoch, "writerEpoch");
  requireIdentifier(identity.analysisRunId, "analysisRunId");
  requireIdentifier(identity.passBRunId, "passBRunId");
  requireNonNegativeSafeInteger(identity.workerEpoch, "workerEpoch");
  requireIdentifier(identity.workerInstanceId, "workerInstanceId");
  requireIdentifier(identity.taskId, "taskId");

  requireIdentifier(sourceBinding.sourceBindingId, "sourceBindingId");
  requireNonNegativeSafeInteger(
    sourceBinding.sourceBindingRevision,
    "sourceBindingRevision",
  );
  requirePositiveSafeInteger(sourceBinding.sourceDurationMs, "sourceDurationMs");

  requireIdentifier(model.modelId, "modelId");
  requireIdentifier(model.modelRevision, "modelRevision");

  if (
    input.candidates.length === 0 ||
    input.candidates.length > MAX_CANDIDATE_PASS_B_CANDIDATES
  ) {
    throw new RangeError(
      `candidates must contain between 1 and ${MAX_CANDIDATE_PASS_B_CANDIDATES} items`,
    );
  }

  const candidateIds = new Set<string>();
  const candidates = input.candidates.map((candidate, index) => {
    const label = `candidates[${index}]`;
    requireIdentifier(candidate.candidateId, `${label}.candidateId`);
    requireNonNegativeSafeInteger(
      candidate.proposalRevision,
      `${label}.proposalRevision`,
    );
    requireNonNegativeSafeInteger(
      candidate.proposalRange.startMs,
      `${label}.proposalRange.startMs`,
    );
    requireNonNegativeSafeInteger(
      candidate.proposalRange.endMs,
      `${label}.proposalRange.endMs`,
    );
    requireNonNegativeSafeInteger(candidate.peakMs, `${label}.peakMs`);

    if (candidateIds.has(candidate.candidateId)) {
      throw new RangeError(`duplicate candidateId: ${candidate.candidateId}`);
    }
    candidateIds.add(candidate.candidateId);

    if (candidate.proposalRange.startMs >= candidate.proposalRange.endMs) {
      throw new RangeError(`${label}.proposalRange must have positive duration`);
    }
    if (candidate.proposalRange.endMs > sourceBinding.sourceDurationMs) {
      throw new RangeError(`${label}.proposalRange exceeds source duration`);
    }
    if (
      candidate.peakMs < candidate.proposalRange.startMs ||
      candidate.peakMs > candidate.proposalRange.endMs
    ) {
      throw new RangeError(`${label}.peakMs must be inside proposalRange`);
    }

    return Object.freeze({
      candidateId: candidate.candidateId,
      proposalRevision: candidate.proposalRevision,
      proposalRange: Object.freeze({ ...candidate.proposalRange }),
      peakMs: candidate.peakMs,
    });
  });

  return Object.freeze({
    identity: Object.freeze({ ...identity }),
    sourceBinding: Object.freeze({ ...sourceBinding }),
    model: Object.freeze({ ...model }),
    candidates: Object.freeze(candidates),
  });
}

function baseOf(state: CandidatePassBRunState): CandidatePassBRunBase {
  return {
    snapshot: state.snapshot,
    eligibleCandidateIds: state.eligibleCandidateIds,
    candidateOutcomes: state.candidateOutcomes,
    processedEventIds: state.processedEventIds,
  };
}

function baseAfterWorkerEvent(
  state: CandidatePassBRunState,
  eventId: string,
  candidateOutcomes = state.candidateOutcomes,
): CandidatePassBRunBase {
  const processedEventIds = new Set(state.processedEventIds);
  processedEventIds.add(eventId);

  return {
    ...baseOf(state),
    candidateOutcomes,
    processedEventIds,
  };
}

function accept(
  state: CandidatePassBRunState,
): CandidatePassBRunTransitionOutcome {
  assertCandidatePassBRunInvariant(state);
  return { accepted: true, state };
}

function reject(
  state: CandidatePassBRunState,
  reason: CandidatePassBRunRejectionReason,
): CandidatePassBRunTransitionOutcome {
  return { accepted: false, state, reason };
}

function isWorkerEvent(
  event: CandidatePassBRunEvent,
): event is CandidatePassBWorkerEvent {
  return (
    event.type !== "START_REQUESTED" &&
    event.type !== "CANCEL_REQUESTED" &&
    event.type !== "CLIENT_FORCE_TERMINATED"
  );
}

function workerEventIdentityRejection(
  state: CandidatePassBRunState,
  event: CandidatePassBWorkerEvent,
): CandidatePassBRunRejectionReason | null {
  const identity = state.snapshot.identity;

  if (typeof event.eventId !== "string" || event.eventId.trim().length === 0) {
    return "invalid_event_id";
  }
  if (event.sessionId !== identity.sessionId) {
    return "session_id_mismatch";
  }
  if (event.writerEpoch !== identity.writerEpoch) {
    return "writer_epoch_mismatch";
  }
  if (event.analysisRunId !== identity.analysisRunId) {
    return "analysis_run_id_mismatch";
  }
  if (event.passBRunId !== identity.passBRunId) {
    return "pass_b_run_id_mismatch";
  }
  if (event.workerEpoch !== identity.workerEpoch) {
    return "worker_epoch_mismatch";
  }
  if (event.workerInstanceId !== identity.workerInstanceId) {
    return "worker_instance_id_mismatch";
  }
  if (event.taskId !== identity.taskId) {
    return "task_id_mismatch";
  }
  if (state.processedEventIds.has(event.eventId)) {
    return "duplicate_event_id";
  }

  return null;
}

function findCandidateSnapshot(
  state: CandidatePassBRunState,
  candidateId: string,
): CandidatePassBCandidateSnapshot | undefined {
  return state.snapshot.candidates.find(
    (candidate) => candidate.candidateId === candidateId,
  );
}

function findCandidateOutcome(
  state: CandidatePassBRunState,
  candidateId: string,
): CandidatePassBCandidateOutcome | undefined {
  return state.candidateOutcomes.find(
    (candidate) => candidate.candidateId === candidateId,
  );
}

function candidateEventRejection(
  state: CandidatePassBRunState & { readonly status: "transcribing" },
  event: Extract<
    CandidatePassBWorkerEvent,
    {
      readonly type:
        | "CANDIDATE_CLUE_FOUND"
        | "CANDIDATE_NO_CLEAR_SPEECH"
        | "CANDIDATE_FAILED";
    }
  >,
): CandidatePassBRunRejectionReason | null {
  if (!state.eligibleCandidateIds.has(event.candidateId)) {
    return "candidate_not_eligible";
  }

  const outcome = findCandidateOutcome(state, event.candidateId);
  if (outcome?.status !== "pending") {
    return "candidate_already_terminal";
  }

  const snapshot = findCandidateSnapshot(state, event.candidateId);
  if (snapshot?.proposalRevision !== event.expectedProposalRevision) {
    return "expected_revision_mismatch";
  }
  if (
    event.type === "CANDIDATE_CLUE_FOUND" &&
    (!Number.isSafeInteger(event.clueCount) || event.clueCount <= 0)
  ) {
    return "invalid_clue_count";
  }
  if (
    event.type === "CANDIDATE_NO_CLEAR_SPEECH" &&
    event.workerDisposition !== "result" &&
    event.workerDisposition !== "gap"
  ) {
    return "invalid_worker_disposition";
  }

  return null;
}

function settleCandidate(
  state: CandidatePassBRunState & { readonly status: "transcribing" },
  event: Extract<
    CandidatePassBWorkerEvent,
    {
      readonly type:
        | "CANDIDATE_CLUE_FOUND"
        | "CANDIDATE_NO_CLEAR_SPEECH"
        | "CANDIDATE_FAILED";
    }
  >,
): CandidatePassBRunTransitionOutcome {
  const reason = candidateEventRejection(state, event);
  if (reason !== null) {
    return reject(state, reason);
  }

  let settledOutcome: CandidatePassBCandidateOutcome;
  switch (event.type) {
    case "CANDIDATE_CLUE_FOUND":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "clueFound",
        clueCount: event.clueCount,
        workerDisposition: "result",
      };
      break;
    case "CANDIDATE_NO_CLEAR_SPEECH":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "noClearSpeech",
        reasonCode: event.reasonCode,
        gapKind: "contentGap",
        workerDisposition: event.workerDisposition,
      };
      break;
    case "CANDIDATE_FAILED":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "failed",
        reasonCode: event.reasonCode,
        gapKind: "processingGap",
        workerDisposition: "gap",
      };
      break;
  }

  const candidateOutcomes = state.candidateOutcomes.map((outcome) =>
    outcome.candidateId === event.candidateId ? settledOutcome : outcome,
  );
  const nextCandidate = candidateOutcomes.find(
    (outcome) => outcome.status === "pending",
  );
  const base = baseAfterWorkerEvent(state, event.eventId, candidateOutcomes);

  if (nextCandidate !== undefined) {
    return accept({
      ...base,
      status: "transcribing",
      activeCandidateId: nextCandidate.candidateId,
    });
  }

  return accept({ ...base, status: "finalizing" });
}

function summarizeCandidateOutcomes(
  outcomes: readonly CandidatePassBCandidateOutcome[],
): CandidatePassBRunSummary {
  let pendingCount = 0;
  let clueFoundCount = 0;
  let noClearSpeechCount = 0;
  let failedCount = 0;

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "pending":
        pendingCount += 1;
        break;
      case "clueFound":
        clueFoundCount += 1;
        break;
      case "noClearSpeech":
        noClearSpeechCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
    }
  }

  return {
    totalCandidateCount: outcomes.length,
    pendingCount,
    clueFoundCount,
    noClearSpeechCount,
    failedCount,
    gapCount: noClearSpeechCount + failedCount,
  };
}

function summarizeWorkerDispositions(
  outcomes: readonly CandidatePassBCandidateOutcome[],
): {
  readonly pendingCount: number;
  readonly resultCount: number;
  readonly gapCount: number;
} {
  let pendingCount = 0;
  let resultCount = 0;
  let gapCount = 0;

  for (const outcome of outcomes) {
    if (outcome.status === "pending") {
      pendingCount += 1;
    } else if (outcome.workerDisposition === "result") {
      resultCount += 1;
    } else {
      gapCount += 1;
    }
  }

  return { pendingCount, resultCount, gapCount };
}

function completionEventRejection(
  state: CandidatePassBRunState & { readonly status: "finalizing" },
  event: Extract<CandidatePassBWorkerEvent, { readonly type: "RUN_COMPLETED" }>,
): CandidatePassBRunRejectionReason | null {
  if (
    !Number.isSafeInteger(event.requestedCount) ||
    event.requestedCount <= 0 ||
    !Number.isSafeInteger(event.resultCount) ||
    event.resultCount < 0 ||
    !Number.isSafeInteger(event.gapCount) ||
    event.gapCount < 0
  ) {
    return "invalid_completion_counts";
  }

  const dispositions = summarizeWorkerDispositions(state.candidateOutcomes);
  if (event.requestedCount !== state.snapshot.candidates.length) {
    return "completion_requested_count_mismatch";
  }
  if (event.resultCount !== dispositions.resultCount) {
    return "completion_result_count_mismatch";
  }
  if (event.gapCount !== dispositions.gapCount) {
    return "completion_gap_count_mismatch";
  }
  if (event.resultCount + event.gapCount !== event.requestedCount) {
    return "invalid_completion_counts";
  }
  return null;
}

function completeRun(
  state: CandidatePassBRunState & { readonly status: "finalizing" },
  event: Extract<CandidatePassBWorkerEvent, { readonly type: "RUN_COMPLETED" }>,
): CandidatePassBRunTransitionOutcome {
  const reason = completionEventRejection(state, event);
  if (reason !== null) {
    return reject(state, reason);
  }

  const summary = summarizeCandidateOutcomes(state.candidateOutcomes);
  const completionEnvelope: CandidatePassBCompletionEnvelope = Object.freeze({
    requestedCount: event.requestedCount,
    resultCount: event.resultCount,
    gapCount: event.gapCount,
  });
  const base = baseAfterWorkerEvent(state, event.eventId);
  if (summary.gapCount === 0) {
    return accept({
      ...base,
      status: "completed",
      summary,
      completionEnvelope,
    });
  }
  return accept({
    ...base,
    status: "completedWithGaps",
    summary,
    completionEnvelope,
  });
}

export function summarizeCandidatePassBRun(
  state: CandidatePassBRunState,
): CandidatePassBRunSummary {
  return summarizeCandidateOutcomes(state.candidateOutcomes);
}

export function isCandidatePassBRunTerminal(
  state: CandidatePassBRunState,
): boolean {
  return TERMINAL_STATUS_SET.has(state.status);
}

export function assertCandidatePassBRunInvariant(
  state: CandidatePassBRunState,
): void {
  const snapshotIds = state.snapshot.candidates.map(
    (candidate) => candidate.candidateId,
  );
  const outcomeIds = state.candidateOutcomes.map(
    (candidate) => candidate.candidateId,
  );

  if (
    snapshotIds.length !== state.eligibleCandidateIds.size ||
    snapshotIds.some((candidateId) => !state.eligibleCandidateIds.has(candidateId))
  ) {
    throw new Error("eligible candidate set must exactly match the start snapshot");
  }
  if (
    outcomeIds.length !== snapshotIds.length ||
    outcomeIds.some((candidateId, index) => candidateId !== snapshotIds[index])
  ) {
    throw new Error("candidate outcomes must preserve the start snapshot order");
  }
  if (
    [...state.processedEventIds].some((eventId) => eventId.trim().length === 0)
  ) {
    throw new Error("processed event IDs must be non-empty");
  }

  for (const outcome of state.candidateOutcomes) {
    if (
      (outcome.status === "clueFound" && outcome.workerDisposition !== "result") ||
      (outcome.status === "noClearSpeech" &&
        outcome.workerDisposition !== "result" &&
        outcome.workerDisposition !== "gap") ||
      (outcome.status === "failed" && outcome.workerDisposition !== "gap")
    ) {
      throw new Error("terminal candidate outcomes must record their Worker disposition");
    }
  }

  const summary = summarizeCandidatePassBRun(state);
  const workerDispositions = summarizeWorkerDispositions(state.candidateOutcomes);
  if (state.status === "transcribing") {
    const active = findCandidateOutcome(state, state.activeCandidateId);
    if (active?.status !== "pending") {
      throw new Error("the active candidate must be eligible and pending");
    }
  }
  if (state.status === "finalizing" && summary.pendingCount !== 0) {
    throw new Error("finalizing requires every candidate to be terminal");
  }
  if (state.status === "cancelling") {
    if (state.requestedFrom === "transcribing") {
      const activeAtRequest =
        state.activeCandidateIdAtRequest === null
          ? undefined
          : findCandidateOutcome(state, state.activeCandidateIdAtRequest);
      if (activeAtRequest?.status !== "pending") {
        throw new Error("transcription cancellation must retain its pending active candidate");
      }
    } else if (state.activeCandidateIdAtRequest !== null) {
      throw new Error("only transcription cancellation may retain an active candidate");
    }
    if (state.requestedFrom === "finalizing" && summary.pendingCount !== 0) {
      throw new Error("finalizing cancellation cannot regain pending candidates");
    }
  }
  if (
    (state.status === "completed" || state.status === "completedWithGaps") &&
    summary.pendingCount !== 0
  ) {
    throw new Error("a completed run cannot contain pending candidates");
  }
  if (state.status === "completed" && summary.gapCount !== 0) {
    throw new Error("completed is reserved for runs without candidate gaps");
  }
  if (state.status === "completedWithGaps" && summary.gapCount === 0) {
    throw new Error("completedWithGaps requires at least one explicit gap");
  }
  if (state.status === "completed" || state.status === "completedWithGaps") {
    if (
      state.completionEnvelope.requestedCount !== state.snapshot.candidates.length ||
      state.completionEnvelope.resultCount !== workerDispositions.resultCount ||
      state.completionEnvelope.gapCount !== workerDispositions.gapCount ||
      state.completionEnvelope.resultCount + state.completionEnvelope.gapCount !==
        state.completionEnvelope.requestedCount
    ) {
      throw new Error("completion envelope must match every terminal candidate outcome");
    }
  }
  if (
    state.status === "cancelled" &&
    state.terminationKind !== "workerAcknowledged" &&
    state.terminationKind !== "clientForceTerminated"
  ) {
    throw new Error("cancelled runs must record how termination was confirmed");
  }
  if (
    "summary" in state &&
    (state.summary.pendingCount !== summary.pendingCount ||
      state.summary.clueFoundCount !== summary.clueFoundCount ||
      state.summary.noClearSpeechCount !== summary.noClearSpeechCount ||
      state.summary.failedCount !== summary.failedCount ||
      state.summary.gapCount !== summary.gapCount ||
      state.summary.totalCandidateCount !== summary.totalCandidateCount)
  ) {
    throw new Error("stored run summary must match candidate outcomes");
  }
}

export function createCandidatePassBRun(
  input: CreateCandidatePassBRunInput,
): CandidatePassBRunState {
  const snapshot = copyAndValidateSnapshot(input);
  const state: CandidatePassBRunState = {
    status: "idle",
    snapshot,
    eligibleCandidateIds: new Set(
      snapshot.candidates.map((candidate) => candidate.candidateId),
    ),
    candidateOutcomes: snapshot.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      status: "pending",
    })),
    processedEventIds: new Set(),
  };

  assertCandidatePassBRunInvariant(state);
  return state;
}

export function reduceCandidatePassBRun(
  state: CandidatePassBRunState,
  event: CandidatePassBRunEvent,
): CandidatePassBRunTransitionOutcome {
  if (isCandidatePassBRunTerminal(state)) {
    return reject(state, "terminal_state_absorbing");
  }

  if (isWorkerEvent(event)) {
    const identityReason = workerEventIdentityRejection(state, event);
    if (identityReason !== null) {
      return reject(state, identityReason);
    }
  }

  if (state.status === "cancelling") {
    if (event.type === "CANCEL_REQUESTED") {
      return reject(state, "cancellation_already_requested");
    }
    if (event.type === "CANCEL_ACKNOWLEDGED") {
      return accept({
        ...baseAfterWorkerEvent(state, event.eventId),
        status: "cancelled",
        summary: summarizeCandidatePassBRun(state),
        terminationKind: "workerAcknowledged",
      });
    }
    if (event.type === "CLIENT_FORCE_TERMINATED") {
      return accept({
        ...baseOf(state),
        status: "cancelled",
        summary: summarizeCandidatePassBRun(state),
        terminationKind: "clientForceTerminated",
      });
    }
    return reject(state, "cancel_in_progress");
  }

  if (event.type === "START_REQUESTED") {
    if (state.status !== "idle") {
      return reject(state, "undefined_transition");
    }
    return accept({ ...baseOf(state), status: "preparing" });
  }

  if (event.type === "CANCEL_REQUESTED") {
    if (
      state.status !== "preparing" &&
      state.status !== "loadingModel" &&
      state.status !== "transcribing" &&
      state.status !== "finalizing"
    ) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseOf(state),
      status: "cancelling",
      requestedFrom: state.status,
      activeCandidateIdAtRequest:
        state.status === "transcribing" ? state.activeCandidateId : null,
    });
  }

  if (event.type === "WORKER_PREPARED") {
    if (state.status !== "preparing") {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseAfterWorkerEvent(state, event.eventId),
      status: "loadingModel",
    });
  }

  if (event.type === "MODEL_READY" || event.type === "MODEL_BYPASSED") {
    if (state.status !== "loadingModel") {
      return reject(state, "undefined_transition");
    }
    const firstCandidate = state.candidateOutcomes[0];
    if (firstCandidate === undefined) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseAfterWorkerEvent(state, event.eventId),
      status: "transcribing",
      activeCandidateId: firstCandidate.candidateId,
    });
  }

  if (
    event.type === "CANDIDATE_CLUE_FOUND" ||
    event.type === "CANDIDATE_NO_CLEAR_SPEECH" ||
    event.type === "CANDIDATE_FAILED"
  ) {
    if (state.status !== "transcribing") {
      return reject(state, "undefined_transition");
    }
    return settleCandidate(state, event);
  }

  if (event.type === "RUN_COMPLETED") {
    if (state.status !== "finalizing") {
      return reject(state, "undefined_transition");
    }
    return completeRun(state, event);
  }

  if (event.type === "RUN_FAILED") {
    if (
      state.status !== "preparing" &&
      state.status !== "loadingModel" &&
      state.status !== "transcribing" &&
      state.status !== "finalizing"
    ) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseAfterWorkerEvent(state, event.eventId),
      status: "failed",
      reasonCode: event.reasonCode,
      summary: summarizeCandidatePassBRun(state),
    });
  }

  return reject(state, "undefined_transition");
}
