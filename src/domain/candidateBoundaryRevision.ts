export const MIN_CLIP_DURATION_MS = 30_000;
export const MAX_CLIP_DURATION_MS = 60_000;
export const BOUNDARY_NUDGE_MS = 5_000;

export interface CandidateTimeRange {
  readonly startMs: number;
  readonly endMs: number;
}

export type CandidateBoundaryProvenance =
  | "aiProposal"
  | "userAdjusted"
  | "userResetToAi";

export interface CandidateBoundaryRevision {
  readonly boundarySessionId: string;
  readonly candidateId: string;
  readonly revision: number;
  readonly proposalRange: CandidateTimeRange;
  readonly effectiveRange: CandidateTimeRange;
  readonly peakMs: number;
  readonly sourceDurationMs: number;
  readonly provenance: CandidateBoundaryProvenance;
}

interface BoundaryCommandBase {
  readonly boundarySessionId: string;
  readonly candidateId: string;
  readonly expectedRevision: number;
}

export type CandidateBoundaryCommand =
  | (BoundaryCommandBase & {
      readonly kind: "SHIFT_START";
      readonly deltaMs: -5_000 | 5_000;
    })
  | (BoundaryCommandBase & {
      readonly kind: "SHIFT_END";
      readonly deltaMs: -5_000 | 5_000;
    })
  | (BoundaryCommandBase & {
      readonly kind: "SET_START_FROM_PLAYER";
      readonly playerMs: number | null;
    })
  | (BoundaryCommandBase & {
      readonly kind: "SET_END_FROM_PLAYER";
      readonly playerMs: number | null;
    })
  | (BoundaryCommandBase & { readonly kind: "RESET_TO_AI" });

export type CandidateBoundaryIgnoreReason =
  | "stale_session"
  | "candidate_mismatch"
  | "stale_revision";

export type CandidateBoundaryRejectionReason =
  | "player_time_unavailable"
  | "player_time_out_of_source"
  | "range_out_of_source"
  | "would_exclude_peak"
  | "duration_below_minimum"
  | "duration_above_maximum"
  | "already_at_proposal"
  | "no_effective_change";

export type CandidateBoundaryAdjustmentReason =
  | "source_start"
  | "source_end"
  | "minimum_duration"
  | "maximum_duration"
  | "reaction_peak";

export type CandidateBoundaryTransition =
  | {
      readonly status: "applied";
      readonly state: CandidateBoundaryRevision;
      readonly requestedRange: CandidateTimeRange;
      readonly adjustmentReasons: readonly CandidateBoundaryAdjustmentReason[];
    }
  | {
      readonly status: "rejected";
      readonly state: CandidateBoundaryRevision;
      readonly reason: CandidateBoundaryRejectionReason;
    }
  | {
      readonly status: "ignored";
      readonly state: CandidateBoundaryRevision;
      readonly reason: CandidateBoundaryIgnoreReason;
    };

export interface CandidateBoundaryProposalInput {
  readonly boundarySessionId: string;
  readonly candidateId: string;
  readonly proposalRange: CandidateTimeRange;
  readonly peakMs: number;
  readonly sourceDurationMs: number;
}

export interface CandidateWithProposalRange {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
}

function isSafeMillisecond(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function clipDurationBounds(sourceDurationMs: number): {
  readonly minimumMs: number;
  readonly maximumMs: number;
} {
  return {
    minimumMs: Math.min(MIN_CLIP_DURATION_MS, sourceDurationMs),
    maximumMs: Math.min(MAX_CLIP_DURATION_MS, sourceDurationMs),
  };
}

function invalidRangeReason(
  range: CandidateTimeRange,
  peakMs: number,
  sourceDurationMs: number,
): CandidateBoundaryRejectionReason | null {
  if (
    !isSafeMillisecond(range.startMs) ||
    !isSafeMillisecond(range.endMs) ||
    range.startMs >= range.endMs ||
    range.endMs > sourceDurationMs
  ) {
    return "range_out_of_source";
  }
  if (peakMs < range.startMs || peakMs > range.endMs) {
    return "would_exclude_peak";
  }
  const durationMs = range.endMs - range.startMs;
  const { minimumMs, maximumMs } = clipDurationBounds(sourceDurationMs);
  if (durationMs < minimumMs) {
    return "duration_below_minimum";
  }
  if (durationMs > maximumMs) {
    return "duration_above_maximum";
  }
  return null;
}

export function createCandidateBoundaryRevision(
  input: CandidateBoundaryProposalInput,
): CandidateBoundaryRevision {
  if (input.boundarySessionId.length === 0 || input.candidateId.length === 0) {
    throw new TypeError("Boundary session and candidate IDs must not be empty.");
  }
  if (!isSafeMillisecond(input.sourceDurationMs) || input.sourceDurationMs === 0) {
    throw new RangeError("Source duration must be a positive safe integer.");
  }
  if (!isSafeMillisecond(input.peakMs) || input.peakMs > input.sourceDurationMs) {
    throw new RangeError("Reaction peak must be inside the source duration.");
  }
  const invalidReason = invalidRangeReason(
    input.proposalRange,
    input.peakMs,
    input.sourceDurationMs,
  );
  if (invalidReason !== null) {
    throw new RangeError(`AI proposal range is invalid: ${invalidReason}`);
  }
  return {
    ...input,
    proposalRange: { ...input.proposalRange },
    effectiveRange: { ...input.proposalRange },
    revision: 0,
    provenance: "aiProposal",
  };
}

function sameRange(left: CandidateTimeRange, right: CandidateTimeRange): boolean {
  return left.startMs === right.startMs && left.endMs === right.endMs;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function shiftStart(
  state: CandidateBoundaryRevision,
  deltaMs: -5_000 | 5_000,
): {
  readonly requestedRange: CandidateTimeRange;
  readonly appliedRange: CandidateTimeRange;
  readonly adjustmentReasons: readonly CandidateBoundaryAdjustmentReason[];
} {
  const current = state.effectiveRange;
  const { minimumMs, maximumMs } = clipDurationBounds(state.sourceDurationMs);
  const minimumStartMs = Math.max(0, current.endMs - maximumMs);
  const maximumStartMs = Math.min(state.peakMs, current.endMs - minimumMs);
  const requestedStartMs = current.startMs + deltaMs;
  const appliedStartMs = clamp(requestedStartMs, minimumStartMs, maximumStartMs);
  const reasons: CandidateBoundaryAdjustmentReason[] = [];
  if (appliedStartMs !== requestedStartMs) {
    if (requestedStartMs < 0) reasons.push("source_start");
    if (requestedStartMs < current.endMs - maximumMs) reasons.push("maximum_duration");
    if (requestedStartMs > current.endMs - minimumMs) reasons.push("minimum_duration");
    if (requestedStartMs > state.peakMs) reasons.push("reaction_peak");
  }
  return {
    requestedRange: { startMs: requestedStartMs, endMs: current.endMs },
    appliedRange: { startMs: appliedStartMs, endMs: current.endMs },
    adjustmentReasons: reasons,
  };
}

function shiftEnd(
  state: CandidateBoundaryRevision,
  deltaMs: -5_000 | 5_000,
): {
  readonly requestedRange: CandidateTimeRange;
  readonly appliedRange: CandidateTimeRange;
  readonly adjustmentReasons: readonly CandidateBoundaryAdjustmentReason[];
} {
  const current = state.effectiveRange;
  const { minimumMs, maximumMs } = clipDurationBounds(state.sourceDurationMs);
  const minimumEndMs = Math.max(state.peakMs, current.startMs + minimumMs);
  const maximumEndMs = Math.min(
    state.sourceDurationMs,
    current.startMs + maximumMs,
  );
  const requestedEndMs = current.endMs + deltaMs;
  const appliedEndMs = clamp(requestedEndMs, minimumEndMs, maximumEndMs);
  const reasons: CandidateBoundaryAdjustmentReason[] = [];
  if (appliedEndMs !== requestedEndMs) {
    if (requestedEndMs > state.sourceDurationMs) reasons.push("source_end");
    if (requestedEndMs > current.startMs + maximumMs) reasons.push("maximum_duration");
    if (requestedEndMs < current.startMs + minimumMs) reasons.push("minimum_duration");
    if (requestedEndMs < state.peakMs) reasons.push("reaction_peak");
  }
  return {
    requestedRange: { startMs: current.startMs, endMs: requestedEndMs },
    appliedRange: { startMs: current.startMs, endMs: appliedEndMs },
    adjustmentReasons: reasons,
  };
}

function rejectionForUnchangedShift(
  state: CandidateBoundaryRevision,
  requestedRange: CandidateTimeRange,
): CandidateBoundaryRejectionReason {
  return (
    invalidRangeReason(requestedRange, state.peakMs, state.sourceDurationMs) ??
    "no_effective_change"
  );
}

export function applyCandidateBoundaryCommand(
  state: CandidateBoundaryRevision,
  command: CandidateBoundaryCommand,
): CandidateBoundaryTransition {
  if (command.boundarySessionId !== state.boundarySessionId) {
    return { status: "ignored", state, reason: "stale_session" };
  }
  if (command.candidateId !== state.candidateId) {
    return { status: "ignored", state, reason: "candidate_mismatch" };
  }
  if (command.expectedRevision !== state.revision) {
    return { status: "ignored", state, reason: "stale_revision" };
  }

  if (command.kind === "RESET_TO_AI") {
    if (sameRange(state.effectiveRange, state.proposalRange)) {
      return { status: "rejected", state, reason: "already_at_proposal" };
    }
    return {
      status: "applied",
      state: {
        ...state,
        effectiveRange: { ...state.proposalRange },
        revision: state.revision + 1,
        provenance: "userResetToAi",
      },
      requestedRange: state.proposalRange,
      adjustmentReasons: [],
    };
  }

  let requestedRange: CandidateTimeRange;
  let appliedRange: CandidateTimeRange;
  let adjustmentReasons: readonly CandidateBoundaryAdjustmentReason[] = [];
  if (command.kind === "SHIFT_START") {
    const shift = shiftStart(state, command.deltaMs);
    ({ requestedRange, appliedRange, adjustmentReasons } = shift);
  } else if (command.kind === "SHIFT_END") {
    const shift = shiftEnd(state, command.deltaMs);
    ({ requestedRange, appliedRange, adjustmentReasons } = shift);
  } else {
    if (command.playerMs === null || !Number.isFinite(command.playerMs)) {
      return { status: "rejected", state, reason: "player_time_unavailable" };
    }
    const playerMs = Math.round(command.playerMs);
    if (playerMs < 0 || playerMs > state.sourceDurationMs) {
      return { status: "rejected", state, reason: "player_time_out_of_source" };
    }
    requestedRange =
      command.kind === "SET_START_FROM_PLAYER"
        ? { startMs: playerMs, endMs: state.effectiveRange.endMs }
        : { startMs: state.effectiveRange.startMs, endMs: playerMs };
    appliedRange = requestedRange;
  }

  if (sameRange(appliedRange, state.effectiveRange)) {
    return {
      status: "rejected",
      state,
      reason: rejectionForUnchangedShift(state, requestedRange),
    };
  }
  const invalidReason = invalidRangeReason(
    appliedRange,
    state.peakMs,
    state.sourceDurationMs,
  );
  if (invalidReason !== null) {
    return { status: "rejected", state, reason: invalidReason };
  }
  return {
    status: "applied",
    state: {
      ...state,
      effectiveRange: appliedRange,
      revision: state.revision + 1,
      provenance: "userAdjusted",
    },
    requestedRange,
    adjustmentReasons,
  };
}

export function effectiveCandidateRange(
  candidate: CandidateWithProposalRange,
  revision: CandidateBoundaryRevision | null | undefined,
): CandidateTimeRange {
  if (
    revision !== undefined &&
    revision !== null &&
    revision.candidateId === candidate.id &&
    revision.proposalRange.startMs === candidate.startMs &&
    revision.proposalRange.endMs === candidate.endMs
  ) {
    return revision.effectiveRange;
  }
  return { startMs: candidate.startMs, endMs: candidate.endMs };
}

export function candidateRangeWasAdjusted(
  revision: CandidateBoundaryRevision | null | undefined,
): boolean {
  return (
    revision !== undefined &&
    revision !== null &&
    !sameRange(revision.proposalRange, revision.effectiveRange)
  );
}
