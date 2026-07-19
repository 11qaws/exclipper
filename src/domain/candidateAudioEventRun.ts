import {
  CANDIDATE_AUDIO_EVENT_MODEL_DTYPE,
  CANDIDATE_AUDIO_EVENT_MODEL_ID,
  CANDIDATE_AUDIO_EVENT_MODEL_REVISION,
  CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION,
  CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE,
  MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS,
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS,
  type CandidateAudioEventCandidateGapReason,
  type CandidateAudioEventNoClearReason,
  type CandidateAudioEventWorkerIdentity,
} from "../analysis/candidateAudioEventWorkerProtocol";

export const MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES =
  MAX_CANDIDATE_AUDIO_EVENT_TARGETS;

export const CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES = [
  "completed",
  "completedWithGaps",
  "cancelled",
  "failed",
] as const;

export type CandidateAudioEventRunIdentity =
  CandidateAudioEventWorkerIdentity;

export interface CandidateAudioEventSourceBindingSnapshot {
  readonly sourceBindingId: string;
  readonly sourceBindingRevision: number;
  readonly sourceDurationMs: number;
}

export interface CandidateAudioEventModelSnapshot {
  readonly modelId: typeof CANDIDATE_AUDIO_EVENT_MODEL_ID;
  readonly modelRevision: typeof CANDIDATE_AUDIO_EVENT_MODEL_REVISION;
  readonly dtype: typeof CANDIDATE_AUDIO_EVENT_MODEL_DTYPE;
  readonly runtimeDevice: typeof CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE;
}

export interface CandidateAudioEventProposalRange {
  readonly startMs: number;
  readonly endMs: number;
}

export interface CandidateAudioEventCandidateSnapshot {
  readonly candidateId: string;
  readonly proposalRevision: number;
  readonly proposalRange: CandidateAudioEventProposalRange;
  readonly peakMs: number;
}

export interface CandidateAudioEventRunSnapshot {
  readonly identity: CandidateAudioEventRunIdentity;
  readonly sourceBinding: CandidateAudioEventSourceBindingSnapshot;
  readonly model: CandidateAudioEventModelSnapshot;
  readonly candidates: readonly CandidateAudioEventCandidateSnapshot[];
}

export type CandidateAudioEventCandidateOutcome =
  | {
      readonly candidateId: string;
      readonly status: "pending";
    }
  | {
      readonly candidateId: string;
      readonly status: "classifying";
    }
  | {
      readonly candidateId: string;
      readonly status: "detected";
      readonly detectionCount: number;
      readonly workerDisposition: "result";
    }
  | {
      readonly candidateId: string;
      readonly status: "noClear";
      readonly reasonCode: CandidateAudioEventNoClearReason;
      readonly workerDisposition: "result";
    }
  | {
      readonly candidateId: string;
      readonly status: "failed";
      readonly reasonCode: CandidateAudioEventCandidateGapReason;
      readonly workerDisposition: "gap";
    };

export interface CandidateAudioEventCompletionEnvelope {
  readonly requestedCount: number;
  readonly completedCount: number;
  readonly gapCount: number;
}

export type CandidateAudioEventCancelTerminationKind =
  | "workerAcknowledged"
  | "clientForceTerminated";

export interface CandidateAudioEventRunSummary {
  readonly totalCandidateCount: number;
  readonly pendingCount: number;
  readonly classifyingCount: number;
  readonly detectedCount: number;
  readonly noClearCount: number;
  readonly failedCount: number;
  readonly gapCount: number;
}

type CandidateAudioEventRunBase = {
  readonly snapshot: CandidateAudioEventRunSnapshot;
  readonly eligibleCandidateIds: ReadonlySet<string>;
  readonly candidateOutcomes: readonly CandidateAudioEventCandidateOutcome[];
  readonly processedEventIds: ReadonlySet<string>;
};

export type CandidateAudioEventRunState =
  | (CandidateAudioEventRunBase & { readonly status: "idle" })
  | (CandidateAudioEventRunBase & { readonly status: "preparing" })
  | (CandidateAudioEventRunBase & { readonly status: "loadingModel" })
  | (CandidateAudioEventRunBase & {
      readonly status: "classifying";
      readonly activeCandidateId: string;
    })
  | (CandidateAudioEventRunBase & { readonly status: "finalizing" })
  | (CandidateAudioEventRunBase & {
      readonly status: "cancelling";
      readonly requestedFrom:
        | "preparing"
        | "loadingModel"
        | "classifying"
        | "finalizing";
      readonly activeCandidateIdAtRequest: string | null;
    })
  | (CandidateAudioEventRunBase & {
      readonly status: "completed";
      readonly summary: CandidateAudioEventRunSummary;
      readonly completionEnvelope: CandidateAudioEventCompletionEnvelope;
    })
  | (CandidateAudioEventRunBase & {
      readonly status: "completedWithGaps";
      readonly summary: CandidateAudioEventRunSummary;
      readonly completionEnvelope: CandidateAudioEventCompletionEnvelope;
    })
  | (CandidateAudioEventRunBase & {
      readonly status: "cancelled";
      readonly summary: CandidateAudioEventRunSummary;
      readonly terminationKind: CandidateAudioEventCancelTerminationKind;
    })
  | (CandidateAudioEventRunBase & {
      readonly status: "failed";
      readonly reasonCode: CandidateAudioEventRunFailureReasonCode;
      readonly summary: CandidateAudioEventRunSummary;
    });

export type CandidateAudioEventRunFailureReasonCode =
  | "worker_initialization_failed"
  | "model_download_failed"
  | "model_load_failed"
  | "runtime_unavailable"
  | "protocol_error";

export interface CandidateAudioEventWorkerEventEnvelope
  extends CandidateAudioEventRunIdentity {
  readonly eventId: string;
}

export type CandidateAudioEventWorkerEventPayload =
  | { readonly type: "WORKER_PREPARED" }
  | { readonly type: "MODEL_READY" }
  | {
      readonly type: "MODEL_BYPASSED";
      readonly reasonCode:
        | "source_audio_unavailable"
        | "source_audio_unsupported";
    }
  | {
      readonly type: "CANDIDATE_DETECTED";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly detectionCount: number;
    }
  | {
      readonly type: "CANDIDATE_NO_CLEAR_EVENT";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly reasonCode: CandidateAudioEventNoClearReason;
    }
  | {
      readonly type: "CANDIDATE_FAILED";
      readonly candidateId: string;
      readonly expectedProposalRevision: number;
      readonly reasonCode: CandidateAudioEventCandidateGapReason;
    }
  | {
      readonly type: "RUN_COMPLETED";
      readonly requestedCount: number;
      readonly completedCount: number;
      readonly gapCount: number;
    }
  | { readonly type: "CANCEL_ACKNOWLEDGED" }
  | {
      readonly type: "RUN_FAILED";
      readonly reasonCode: CandidateAudioEventRunFailureReasonCode;
    };

export type CandidateAudioEventWorkerEvent =
  CandidateAudioEventWorkerEventEnvelope &
    CandidateAudioEventWorkerEventPayload;

export type CandidateAudioEventRunEvent =
  | { readonly type: "START_REQUESTED" }
  | { readonly type: "CANCEL_REQUESTED" }
  | { readonly type: "CLIENT_FORCE_TERMINATED" }
  | CandidateAudioEventWorkerEvent;

export type CandidateAudioEventRunRejectionReason =
  | "terminal_state_absorbing"
  | "undefined_transition"
  | "cancellation_already_requested"
  | "cancel_in_progress"
  | "protocol_version_mismatch"
  | "invalid_event_id"
  | "session_id_mismatch"
  | "writer_epoch_mismatch"
  | "analysis_run_id_mismatch"
  | "audio_event_run_id_mismatch"
  | "worker_epoch_mismatch"
  | "worker_instance_id_mismatch"
  | "task_id_mismatch"
  | "duplicate_event_id"
  | "candidate_not_eligible"
  | "candidate_already_terminal"
  | "candidate_not_active"
  | "candidate_not_classifying"
  | "expected_revision_mismatch"
  | "invalid_detection_count"
  | "invalid_completion_counts"
  | "completion_requested_count_mismatch"
  | "completion_completed_count_mismatch"
  | "completion_gap_count_mismatch";

export type CandidateAudioEventRunTransitionOutcome =
  | { readonly accepted: true; readonly state: CandidateAudioEventRunState }
  | {
      readonly accepted: false;
      readonly state: CandidateAudioEventRunState;
      readonly reason: CandidateAudioEventRunRejectionReason;
    };

export interface CreateCandidateAudioEventRunInput {
  readonly identity: CandidateAudioEventRunIdentity;
  readonly sourceBinding: CandidateAudioEventSourceBindingSnapshot;
  readonly model: CandidateAudioEventModelSnapshot;
  readonly candidates: readonly CandidateAudioEventCandidateSnapshot[];
}

const TERMINAL_STATUS_SET = new Set<CandidateAudioEventRunState["status"]>(
  CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES,
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
  input: CreateCandidateAudioEventRunInput,
): CandidateAudioEventRunSnapshot {
  const { identity, sourceBinding, model } = input;

  if (identity.protocolVersion !== CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION) {
    throw new RangeError("identity.protocolVersion is not supported");
  }
  requireIdentifier(identity.sessionId, "sessionId");
  requireNonNegativeSafeInteger(identity.writerEpoch, "writerEpoch");
  requireIdentifier(identity.analysisRunId, "analysisRunId");
  requireIdentifier(identity.audioEventRunId, "audioEventRunId");
  requireNonNegativeSafeInteger(identity.workerEpoch, "workerEpoch");
  requireIdentifier(identity.workerInstanceId, "workerInstanceId");
  requireIdentifier(identity.taskId, "taskId");

  requireIdentifier(sourceBinding.sourceBindingId, "sourceBindingId");
  requireNonNegativeSafeInteger(
    sourceBinding.sourceBindingRevision,
    "sourceBindingRevision",
  );
  requirePositiveSafeInteger(sourceBinding.sourceDurationMs, "sourceDurationMs");
  if (
    sourceBinding.sourceDurationMs >
    MAX_CANDIDATE_AUDIO_EVENT_SOURCE_DURATION_MS
  ) {
    throw new RangeError("sourceDurationMs must not exceed 12 hours");
  }

  if (
    model.modelId !== CANDIDATE_AUDIO_EVENT_MODEL_ID ||
    model.modelRevision !== CANDIDATE_AUDIO_EVENT_MODEL_REVISION ||
    model.dtype !== CANDIDATE_AUDIO_EVENT_MODEL_DTYPE ||
    model.runtimeDevice !== CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE
  ) {
    throw new RangeError("model snapshot must match the pinned audio-event model");
  }

  if (
    input.candidates.length === 0 ||
    input.candidates.length > MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES
  ) {
    throw new RangeError(
      `candidates must contain between 1 and ${MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES} items`,
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

    const durationMs =
      candidate.proposalRange.endMs - candidate.proposalRange.startMs;
    if (
      durationMs <= 0 ||
      durationMs > MAX_CANDIDATE_AUDIO_EVENT_TARGET_DURATION_MS
    ) {
      throw new RangeError(
        `${label}.proposalRange must be positive and no longer than 60 seconds`,
      );
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

function baseOf(state: CandidateAudioEventRunState): CandidateAudioEventRunBase {
  return {
    snapshot: state.snapshot,
    eligibleCandidateIds: state.eligibleCandidateIds,
    candidateOutcomes: state.candidateOutcomes,
    processedEventIds: state.processedEventIds,
  };
}

function baseAfterWorkerEvent(
  state: CandidateAudioEventRunState,
  eventId: string,
  candidateOutcomes = state.candidateOutcomes,
): CandidateAudioEventRunBase {
  const processedEventIds = new Set(state.processedEventIds);
  processedEventIds.add(eventId);
  return {
    ...baseOf(state),
    candidateOutcomes,
    processedEventIds,
  };
}

function accept(
  state: CandidateAudioEventRunState,
): CandidateAudioEventRunTransitionOutcome {
  assertCandidateAudioEventRunInvariant(state);
  return { accepted: true, state };
}

function reject(
  state: CandidateAudioEventRunState,
  reason: CandidateAudioEventRunRejectionReason,
): CandidateAudioEventRunTransitionOutcome {
  return { accepted: false, state, reason };
}

function isWorkerEvent(
  event: CandidateAudioEventRunEvent,
): event is CandidateAudioEventWorkerEvent {
  return (
    event.type !== "START_REQUESTED" &&
    event.type !== "CANCEL_REQUESTED" &&
    event.type !== "CLIENT_FORCE_TERMINATED"
  );
}

function workerEventIdentityRejection(
  state: CandidateAudioEventRunState,
  event: CandidateAudioEventWorkerEvent,
): CandidateAudioEventRunRejectionReason | null {
  const identity = state.snapshot.identity;
  if (event.protocolVersion !== identity.protocolVersion) {
    return "protocol_version_mismatch";
  }
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
  if (event.audioEventRunId !== identity.audioEventRunId) {
    return "audio_event_run_id_mismatch";
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
  state: CandidateAudioEventRunState,
  candidateId: string,
): CandidateAudioEventCandidateSnapshot | undefined {
  return state.snapshot.candidates.find(
    (candidate) => candidate.candidateId === candidateId,
  );
}

function findCandidateOutcome(
  state: CandidateAudioEventRunState,
  candidateId: string,
): CandidateAudioEventCandidateOutcome | undefined {
  return state.candidateOutcomes.find(
    (candidate) => candidate.candidateId === candidateId,
  );
}

type CandidateTerminalEvent = Extract<
  CandidateAudioEventWorkerEvent,
  {
    readonly type:
      | "CANDIDATE_DETECTED"
      | "CANDIDATE_NO_CLEAR_EVENT"
      | "CANDIDATE_FAILED";
  }
>;

function candidateEventRejection(
  state: CandidateAudioEventRunState & { readonly status: "classifying" },
  event: CandidateTerminalEvent,
): CandidateAudioEventRunRejectionReason | null {
  if (!state.eligibleCandidateIds.has(event.candidateId)) {
    return "candidate_not_eligible";
  }
  const outcome = findCandidateOutcome(state, event.candidateId);
  if (
    outcome?.status === "detected" ||
    outcome?.status === "noClear" ||
    outcome?.status === "failed"
  ) {
    return "candidate_already_terminal";
  }
  if (state.activeCandidateId !== event.candidateId) {
    return "candidate_not_active";
  }
  if (outcome?.status !== "classifying") {
    return "candidate_not_classifying";
  }
  const snapshot = findCandidateSnapshot(state, event.candidateId);
  if (snapshot?.proposalRevision !== event.expectedProposalRevision) {
    return "expected_revision_mismatch";
  }
  if (
    event.type === "CANDIDATE_DETECTED" &&
    (!Number.isSafeInteger(event.detectionCount) || event.detectionCount <= 0)
  ) {
    return "invalid_detection_count";
  }
  return null;
}

function markNextCandidateClassifying(
  outcomes: readonly CandidateAudioEventCandidateOutcome[],
): {
  readonly outcomes: readonly CandidateAudioEventCandidateOutcome[];
  readonly candidateId: string;
} | null {
  const nextIndex = outcomes.findIndex((outcome) => outcome.status === "pending");
  if (nextIndex < 0) {
    return null;
  }
  const next = outcomes[nextIndex];
  if (next === undefined) {
    return null;
  }
  return {
    candidateId: next.candidateId,
    outcomes: outcomes.map((outcome, index) =>
      index === nextIndex
        ? { candidateId: outcome.candidateId, status: "classifying" as const }
        : outcome,
    ),
  };
}

function settleCandidate(
  state: CandidateAudioEventRunState & { readonly status: "classifying" },
  event: CandidateTerminalEvent,
): CandidateAudioEventRunTransitionOutcome {
  const reason = candidateEventRejection(state, event);
  if (reason !== null) {
    return reject(state, reason);
  }

  let settledOutcome: CandidateAudioEventCandidateOutcome;
  switch (event.type) {
    case "CANDIDATE_DETECTED":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "detected",
        detectionCount: event.detectionCount,
        workerDisposition: "result",
      };
      break;
    case "CANDIDATE_NO_CLEAR_EVENT":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "noClear",
        reasonCode: event.reasonCode,
        workerDisposition: "result",
      };
      break;
    case "CANDIDATE_FAILED":
      settledOutcome = {
        candidateId: event.candidateId,
        status: "failed",
        reasonCode: event.reasonCode,
        workerDisposition: "gap",
      };
      break;
  }

  const settled = state.candidateOutcomes.map((outcome) =>
    outcome.candidateId === event.candidateId ? settledOutcome : outcome,
  );
  const next = markNextCandidateClassifying(settled);
  const candidateOutcomes = next?.outcomes ?? settled;
  const base = baseAfterWorkerEvent(
    state,
    event.eventId,
    candidateOutcomes,
  );
  return next === null
    ? accept({ ...base, status: "finalizing" })
    : accept({
        ...base,
        status: "classifying",
        activeCandidateId: next.candidateId,
      });
}

function summarizeCandidateOutcomes(
  outcomes: readonly CandidateAudioEventCandidateOutcome[],
): CandidateAudioEventRunSummary {
  let pendingCount = 0;
  let classifyingCount = 0;
  let detectedCount = 0;
  let noClearCount = 0;
  let failedCount = 0;
  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "pending":
        pendingCount += 1;
        break;
      case "classifying":
        classifyingCount += 1;
        break;
      case "detected":
        detectedCount += 1;
        break;
      case "noClear":
        noClearCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
    }
  }
  return {
    totalCandidateCount: outcomes.length,
    pendingCount,
    classifyingCount,
    detectedCount,
    noClearCount,
    failedCount,
    gapCount: failedCount,
  };
}

function summarizeWorkerDispositions(
  outcomes: readonly CandidateAudioEventCandidateOutcome[],
): {
  readonly unsettledCount: number;
  readonly completedCount: number;
  readonly gapCount: number;
} {
  let unsettledCount = 0;
  let completedCount = 0;
  let gapCount = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "pending" || outcome.status === "classifying") {
      unsettledCount += 1;
    } else if (outcome.workerDisposition === "result") {
      completedCount += 1;
    } else {
      gapCount += 1;
    }
  }
  return { unsettledCount, completedCount, gapCount };
}

function completionEventRejection(
  state: CandidateAudioEventRunState & { readonly status: "finalizing" },
  event: Extract<
    CandidateAudioEventWorkerEvent,
    { readonly type: "RUN_COMPLETED" }
  >,
): CandidateAudioEventRunRejectionReason | null {
  if (
    !Number.isSafeInteger(event.requestedCount) ||
    event.requestedCount <= 0 ||
    !Number.isSafeInteger(event.completedCount) ||
    event.completedCount < 0 ||
    !Number.isSafeInteger(event.gapCount) ||
    event.gapCount < 0
  ) {
    return "invalid_completion_counts";
  }
  const dispositions = summarizeWorkerDispositions(state.candidateOutcomes);
  if (event.requestedCount !== state.snapshot.candidates.length) {
    return "completion_requested_count_mismatch";
  }
  if (event.completedCount !== dispositions.completedCount) {
    return "completion_completed_count_mismatch";
  }
  if (event.gapCount !== dispositions.gapCount) {
    return "completion_gap_count_mismatch";
  }
  if (
    dispositions.unsettledCount !== 0 ||
    event.completedCount + event.gapCount !== event.requestedCount
  ) {
    return "invalid_completion_counts";
  }
  return null;
}

function completeRun(
  state: CandidateAudioEventRunState & { readonly status: "finalizing" },
  event: Extract<
    CandidateAudioEventWorkerEvent,
    { readonly type: "RUN_COMPLETED" }
  >,
): CandidateAudioEventRunTransitionOutcome {
  const reason = completionEventRejection(state, event);
  if (reason !== null) {
    return reject(state, reason);
  }
  const summary = summarizeCandidateOutcomes(state.candidateOutcomes);
  const completionEnvelope = Object.freeze({
    requestedCount: event.requestedCount,
    completedCount: event.completedCount,
    gapCount: event.gapCount,
  });
  const base = baseAfterWorkerEvent(state, event.eventId);
  return summary.gapCount === 0
    ? accept({
        ...base,
        status: "completed",
        summary,
        completionEnvelope,
      })
    : accept({
        ...base,
        status: "completedWithGaps",
        summary,
        completionEnvelope,
      });
}

export function summarizeCandidateAudioEventRun(
  state: CandidateAudioEventRunState,
): CandidateAudioEventRunSummary {
  return summarizeCandidateOutcomes(state.candidateOutcomes);
}

export function isCandidateAudioEventRunTerminal(
  state: CandidateAudioEventRunState,
): boolean {
  return TERMINAL_STATUS_SET.has(state.status);
}

function sameSummary(
  left: CandidateAudioEventRunSummary,
  right: CandidateAudioEventRunSummary,
): boolean {
  return (
    left.totalCandidateCount === right.totalCandidateCount &&
    left.pendingCount === right.pendingCount &&
    left.classifyingCount === right.classifyingCount &&
    left.detectedCount === right.detectedCount &&
    left.noClearCount === right.noClearCount &&
    left.failedCount === right.failedCount &&
    left.gapCount === right.gapCount
  );
}

export function assertCandidateAudioEventRunInvariant(
  state: CandidateAudioEventRunState,
): void {
  const snapshotIds = state.snapshot.candidates.map(
    (candidate) => candidate.candidateId,
  );
  const outcomeIds = state.candidateOutcomes.map(
    (candidate) => candidate.candidateId,
  );
  if (
    snapshotIds.length !== state.eligibleCandidateIds.size ||
    snapshotIds.some(
      (candidateId) => !state.eligibleCandidateIds.has(candidateId),
    )
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
    [...state.processedEventIds].some(
      (eventId) => eventId.trim().length === 0,
    )
  ) {
    throw new Error("processed event IDs must be non-empty");
  }

  for (const outcome of state.candidateOutcomes) {
    if (
      (outcome.status === "detected" &&
        (outcome.workerDisposition !== "result" ||
          !Number.isSafeInteger(outcome.detectionCount) ||
          outcome.detectionCount <= 0)) ||
      (outcome.status === "noClear" &&
        outcome.workerDisposition !== "result") ||
      (outcome.status === "failed" && outcome.workerDisposition !== "gap")
    ) {
      throw new Error("terminal candidate outcomes must be internally valid");
    }
  }

  const summary = summarizeCandidateAudioEventRun(state);
  const dispositions = summarizeWorkerDispositions(state.candidateOutcomes);
  const classifyingIndexes = state.candidateOutcomes.flatMap(
    (outcome, index) => (outcome.status === "classifying" ? [index] : []),
  );

  if (
    state.status === "idle" ||
    state.status === "preparing" ||
    state.status === "loadingModel"
  ) {
    if (
      state.candidateOutcomes.some((outcome) => outcome.status !== "pending")
    ) {
      throw new Error(`${state.status} requires every candidate to be pending`);
    }
  }

  if (state.status === "classifying") {
    const activeIndex = state.candidateOutcomes.findIndex(
      (outcome) => outcome.candidateId === state.activeCandidateId,
    );
    if (
      classifyingIndexes.length !== 1 ||
      classifyingIndexes[0] !== activeIndex ||
      activeIndex < 0
    ) {
      throw new Error("classifying requires exactly one matching active candidate");
    }
    if (
      state.candidateOutcomes.slice(0, activeIndex).some(
        (outcome) =>
          outcome.status === "pending" || outcome.status === "classifying",
      ) ||
      state.candidateOutcomes
        .slice(activeIndex + 1)
        .some((outcome) => outcome.status !== "pending")
    ) {
      throw new Error("candidate processing must preserve snapshot order");
    }
  }

  if (
    state.status === "finalizing" &&
    (summary.pendingCount !== 0 || summary.classifyingCount !== 0)
  ) {
    throw new Error("finalizing requires every candidate to be terminal");
  }

  if (state.status === "cancelling") {
    if (state.requestedFrom === "classifying") {
      const activeAtRequest =
        state.activeCandidateIdAtRequest === null
          ? undefined
          : findCandidateOutcome(state, state.activeCandidateIdAtRequest);
      if (activeAtRequest?.status !== "classifying") {
        throw new Error("classification cancellation must retain its active candidate");
      }
    } else if (state.activeCandidateIdAtRequest !== null) {
      throw new Error("only classification cancellation may retain an active candidate");
    }
    if (
      state.requestedFrom === "finalizing" &&
      (summary.pendingCount !== 0 || summary.classifyingCount !== 0)
    ) {
      throw new Error("finalizing cancellation cannot regain unsettled candidates");
    }
  }

  if (
    (state.status === "completed" || state.status === "completedWithGaps") &&
    (summary.pendingCount !== 0 || summary.classifyingCount !== 0)
  ) {
    throw new Error("a completed run cannot contain unsettled candidates");
  }
  if (state.status === "completed" && summary.gapCount !== 0) {
    throw new Error("completed is reserved for runs without candidate gaps");
  }
  if (state.status === "completedWithGaps" && summary.gapCount === 0) {
    throw new Error("completedWithGaps requires at least one explicit gap");
  }
  if (state.status === "completed" || state.status === "completedWithGaps") {
    if (
      state.completionEnvelope.requestedCount !==
        state.snapshot.candidates.length ||
      state.completionEnvelope.completedCount !== dispositions.completedCount ||
      state.completionEnvelope.gapCount !== dispositions.gapCount ||
      state.completionEnvelope.completedCount +
          state.completionEnvelope.gapCount !==
        state.completionEnvelope.requestedCount
    ) {
      throw new Error("completion envelope must match every terminal outcome");
    }
  }
  if (
    state.status === "cancelled" &&
    state.terminationKind !== "workerAcknowledged" &&
    state.terminationKind !== "clientForceTerminated"
  ) {
    throw new Error("cancelled runs must record how termination was confirmed");
  }
  if ("summary" in state && !sameSummary(state.summary, summary)) {
    throw new Error("stored run summary must match candidate outcomes");
  }
}

export function createCandidateAudioEventRun(
  input: CreateCandidateAudioEventRunInput,
): CandidateAudioEventRunState {
  const snapshot = copyAndValidateSnapshot(input);
  const state: CandidateAudioEventRunState = {
    status: "idle",
    snapshot,
    eligibleCandidateIds: new Set(
      snapshot.candidates.map((candidate) => candidate.candidateId),
    ),
    candidateOutcomes: snapshot.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      status: "pending" as const,
    })),
    processedEventIds: new Set(),
  };
  assertCandidateAudioEventRunInvariant(state);
  return state;
}

export function reduceCandidateAudioEventRun(
  state: CandidateAudioEventRunState,
  event: CandidateAudioEventRunEvent,
): CandidateAudioEventRunTransitionOutcome {
  if (isCandidateAudioEventRunTerminal(state)) {
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
        summary: summarizeCandidateAudioEventRun(state),
        terminationKind: "workerAcknowledged",
      });
    }
    if (event.type === "CLIENT_FORCE_TERMINATED") {
      return accept({
        ...baseOf(state),
        status: "cancelled",
        summary: summarizeCandidateAudioEventRun(state),
        terminationKind: "clientForceTerminated",
      });
    }
    return reject(state, "cancel_in_progress");
  }

  if (event.type === "START_REQUESTED") {
    return state.status === "idle"
      ? accept({ ...baseOf(state), status: "preparing" })
      : reject(state, "undefined_transition");
  }

  if (event.type === "CANCEL_REQUESTED") {
    if (
      state.status !== "preparing" &&
      state.status !== "loadingModel" &&
      state.status !== "classifying" &&
      state.status !== "finalizing"
    ) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseOf(state),
      status: "cancelling",
      requestedFrom: state.status,
      activeCandidateIdAtRequest:
        state.status === "classifying" ? state.activeCandidateId : null,
    });
  }

  if (event.type === "WORKER_PREPARED") {
    return state.status === "preparing"
      ? accept({
          ...baseAfterWorkerEvent(state, event.eventId),
          status: "loadingModel",
        })
      : reject(state, "undefined_transition");
  }

  if (event.type === "MODEL_READY" || event.type === "MODEL_BYPASSED") {
    if (state.status !== "loadingModel") {
      return reject(state, "undefined_transition");
    }
    const next = markNextCandidateClassifying(state.candidateOutcomes);
    if (next === null) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseAfterWorkerEvent(state, event.eventId, next.outcomes),
      status: "classifying",
      activeCandidateId: next.candidateId,
    });
  }

  if (
    event.type === "CANDIDATE_DETECTED" ||
    event.type === "CANDIDATE_NO_CLEAR_EVENT" ||
    event.type === "CANDIDATE_FAILED"
  ) {
    return state.status === "classifying"
      ? settleCandidate(state, event)
      : reject(state, "undefined_transition");
  }

  if (event.type === "RUN_COMPLETED") {
    return state.status === "finalizing"
      ? completeRun(state, event)
      : reject(state, "undefined_transition");
  }

  if (event.type === "RUN_FAILED") {
    if (
      state.status !== "preparing" &&
      state.status !== "loadingModel" &&
      state.status !== "classifying" &&
      state.status !== "finalizing"
    ) {
      return reject(state, "undefined_transition");
    }
    return accept({
      ...baseAfterWorkerEvent(state, event.eventId),
      status: "failed",
      reasonCode: event.reasonCode,
      summary: summarizeCandidateAudioEventRun(state),
    });
  }

  return reject(state, "undefined_transition");
}
