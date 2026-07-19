import type { CandidateRankingProposal } from "../analysis/candidateRanking";

export const MAX_RANKING_CANDIDATE_COUNT = 12;

export type CandidateRankingProposalDisposition = "fresh" | "stale";

export interface CandidateRankingProposalView {
  readonly disposition: CandidateRankingProposalDisposition;
  readonly proposal: CandidateRankingProposal;
}

/**
 * Session-only view state. Candidate objects remain in their canonical array;
 * only this ID projection changes after an explicit user command.
 */
export interface CandidateRankingViewState {
  readonly rankingSessionId: string;
  readonly candidateSetFingerprint: string;
  readonly evidenceFingerprint: string;
  readonly canonicalOrderIds: readonly string[];
  readonly activeOrderIds: readonly string[];
  readonly viewOrderRevision: number;
  /** Monotonic fence retained even when the visible proposal is dismissed. */
  readonly latestRankingRevision: number;
  readonly latestProposal: CandidateRankingProposalView | null;
  readonly appliedProposalId: string | null;
  readonly undoOrderIds: readonly string[] | null;
}

export interface CandidateRankingViewSnapshot {
  readonly rankingSessionId: string;
  readonly candidateSetFingerprint: string;
  readonly evidenceFingerprint: string;
  readonly canonicalOrderIds: readonly string[];
}

export type CandidateRankingViewEvent =
  | ({ readonly type: "CANDIDATE_SET_REPLACED" } & CandidateRankingViewSnapshot)
  | {
      readonly type: "PROPOSAL_READY";
      readonly proposal: CandidateRankingProposal;
    }
  | {
      readonly type: "APPLY_PROPOSAL";
      readonly rankingSessionId: string;
      readonly proposalId: string;
      readonly candidateSetFingerprint: string;
      readonly evidenceFingerprint: string;
      readonly expectedViewOrderRevision: number;
    }
  | {
      readonly type: "UNDO_APPLIED_ORDER";
      readonly rankingSessionId: string;
      readonly appliedProposalId: string;
      readonly expectedViewOrderRevision: number;
    }
  | {
      readonly type: "DISMISS_PROPOSAL";
      readonly rankingSessionId: string;
      readonly proposalId: string;
      readonly expectedViewOrderRevision: number;
    }
  | {
      readonly type: "EVIDENCE_CHANGED";
      readonly rankingSessionId: string;
      readonly candidateSetFingerprint: string;
      readonly evidenceFingerprint: string;
    };

export type CandidateRankingViewIgnoreReason =
  | "invalid_candidate_set"
  | "ranking_session_not_replaced"
  | "stale_session"
  | "candidate_set_mismatch"
  | "evidence_mismatch"
  | "stale_view_revision"
  | "input_order_mismatch"
  | "invalid_proposal_order"
  | "invalid_proposal_identity"
  | "stale_ranking_revision"
  | "duplicate_proposal_id"
  | "applied_order_must_be_undone"
  | "proposal_not_found"
  | "proposal_id_mismatch"
  | "proposal_stale"
  | "proposal_already_applied"
  | "invalid_active_order"
  | "nothing_to_undo"
  | "applied_proposal_mismatch"
  | "unchanged_evidence";

export type CandidateRankingViewTransition =
  | {
      readonly accepted: true;
      readonly state: CandidateRankingViewState;
    }
  | {
      readonly accepted: false;
      readonly state: CandidateRankingViewState;
      readonly reason: CandidateRankingViewIgnoreReason;
    };

export interface CandidateRankingProjectable {
  readonly id: string;
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isValidOrderIds(ids: readonly string[]): boolean {
  return (
    ids.length <= MAX_RANKING_CANDIDATE_COUNT &&
    ids.every(isNonEmptyString) &&
    new Set(ids).size === ids.length
  );
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((candidateId, index) => candidateId === right[index])
  );
}

function isExactPermutation(
  candidateIds: readonly string[],
  canonicalOrderIds: readonly string[],
): boolean {
  if (
    candidateIds.length !== canonicalOrderIds.length ||
    new Set(candidateIds).size !== candidateIds.length
  ) {
    return false;
  }
  const canonicalIds = new Set(canonicalOrderIds);
  return candidateIds.every((candidateId) => canonicalIds.has(candidateId));
}

function validSnapshot(snapshot: CandidateRankingViewSnapshot): boolean {
  return (
    isNonEmptyString(snapshot.rankingSessionId) &&
    isNonEmptyString(snapshot.candidateSetFingerprint) &&
    isNonEmptyString(snapshot.evidenceFingerprint) &&
    isValidOrderIds(snapshot.canonicalOrderIds)
  );
}

function snapshotState(
  snapshot: CandidateRankingViewSnapshot,
): CandidateRankingViewState {
  const canonicalOrderIds = [...snapshot.canonicalOrderIds];
  return {
    rankingSessionId: snapshot.rankingSessionId,
    candidateSetFingerprint: snapshot.candidateSetFingerprint,
    evidenceFingerprint: snapshot.evidenceFingerprint,
    canonicalOrderIds,
    activeOrderIds: [...canonicalOrderIds],
    viewOrderRevision: 0,
    latestRankingRevision: 0,
    latestProposal: null,
    appliedProposalId: null,
    undoOrderIds: null,
  };
}

function snapshotProposal(
  proposal: CandidateRankingProposal,
): CandidateRankingProposal {
  return {
    ...proposal,
    inputOrderCandidateIds: [...proposal.inputOrderCandidateIds],
    orderedCandidateIds: [...proposal.orderedCandidateIds],
    entries: proposal.entries.map((entry) => ({
      ...entry,
      breakdown: { ...entry.breakdown },
      reasonCodes: [...entry.reasonCodes],
    })),
  };
}

function accepted(
  state: CandidateRankingViewState,
): CandidateRankingViewTransition {
  return { accepted: true, state };
}

function ignored(
  state: CandidateRankingViewState,
  reason: CandidateRankingViewIgnoreReason,
): CandidateRankingViewTransition {
  return { accepted: false, state, reason };
}

export function createCandidateRankingViewState(
  snapshot: CandidateRankingViewSnapshot,
): CandidateRankingViewState {
  if (!validSnapshot(snapshot)) {
    throw new TypeError(
      `Ranking view requires a non-empty session and fingerprints plus at most ${MAX_RANKING_CANDIDATE_COUNT} unique candidate IDs.`,
    );
  }
  return snapshotState(snapshot);
}

function receiveProposal(
  state: CandidateRankingViewState,
  proposal: CandidateRankingProposal,
): CandidateRankingViewTransition {
  if (
    !isNonEmptyString(proposal.proposalId) ||
    !Number.isSafeInteger(proposal.rankingRevision) ||
    proposal.rankingRevision < 1
  ) {
    return ignored(state, "invalid_proposal_identity");
  }
  if (proposal.rankingSessionId !== state.rankingSessionId) {
    return ignored(state, "stale_session");
  }
  if (proposal.candidateSetFingerprint !== state.candidateSetFingerprint) {
    return ignored(state, "candidate_set_mismatch");
  }
  if (proposal.evidenceFingerprint !== state.evidenceFingerprint) {
    return ignored(state, "evidence_mismatch");
  }
  if (state.appliedProposalId !== null || state.undoOrderIds !== null) {
    return ignored(state, "applied_order_must_be_undone");
  }
  if (proposal.expectedViewOrderRevision !== state.viewOrderRevision) {
    return ignored(state, "stale_view_revision");
  }
  if (!sameOrder(proposal.inputOrderCandidateIds, state.activeOrderIds)) {
    return ignored(state, "input_order_mismatch");
  }
  if (
    !isExactPermutation(
      proposal.orderedCandidateIds,
      state.canonicalOrderIds,
    ) ||
    !isExactPermutation(
      proposal.entries.map(({ candidateId }) => candidateId),
      state.canonicalOrderIds,
    )
  ) {
    return ignored(state, "invalid_proposal_order");
  }
  if (state.latestProposal !== null) {
    if (proposal.proposalId === state.latestProposal.proposal.proposalId) {
      return ignored(state, "duplicate_proposal_id");
    }
  }
  if (proposal.rankingRevision <= state.latestRankingRevision) {
    return ignored(state, "stale_ranking_revision");
  }

  return accepted({
    ...state,
    latestRankingRevision: proposal.rankingRevision,
    latestProposal: {
      disposition: "fresh",
      proposal: snapshotProposal(proposal),
    },
  });
}

function applyProposal(
  state: CandidateRankingViewState,
  event: Extract<CandidateRankingViewEvent, { readonly type: "APPLY_PROPOSAL" }>,
): CandidateRankingViewTransition {
  if (event.rankingSessionId !== state.rankingSessionId) {
    return ignored(state, "stale_session");
  }
  if (event.candidateSetFingerprint !== state.candidateSetFingerprint) {
    return ignored(state, "candidate_set_mismatch");
  }
  if (event.evidenceFingerprint !== state.evidenceFingerprint) {
    return ignored(state, "evidence_mismatch");
  }
  if (event.expectedViewOrderRevision !== state.viewOrderRevision) {
    return ignored(state, "stale_view_revision");
  }
  if (state.latestProposal === null) {
    return ignored(state, "proposal_not_found");
  }
  if (event.proposalId !== state.latestProposal.proposal.proposalId) {
    return ignored(state, "proposal_id_mismatch");
  }
  if (state.appliedProposalId !== null || state.undoOrderIds !== null) {
    return ignored(state, "proposal_already_applied");
  }
  if (state.latestProposal.disposition !== "fresh") {
    return ignored(state, "proposal_stale");
  }
  const proposal = state.latestProposal.proposal;
  if (
    proposal.rankingSessionId !== state.rankingSessionId ||
    proposal.candidateSetFingerprint !== state.candidateSetFingerprint
  ) {
    return ignored(state, "candidate_set_mismatch");
  }
  if (proposal.evidenceFingerprint !== state.evidenceFingerprint) {
    return ignored(state, "evidence_mismatch");
  }
  if (proposal.expectedViewOrderRevision !== state.viewOrderRevision) {
    return ignored(state, "stale_view_revision");
  }
  if (!isExactPermutation(state.activeOrderIds, state.canonicalOrderIds)) {
    return ignored(state, "invalid_active_order");
  }
  if (!sameOrder(proposal.inputOrderCandidateIds, state.activeOrderIds)) {
    return ignored(state, "input_order_mismatch");
  }
  if (
    !isExactPermutation(
      proposal.orderedCandidateIds,
      state.canonicalOrderIds,
    ) ||
    !isExactPermutation(
      proposal.entries.map(({ candidateId }) => candidateId),
      state.canonicalOrderIds,
    )
  ) {
    return ignored(state, "invalid_proposal_order");
  }

  return accepted({
    ...state,
    activeOrderIds: [...proposal.orderedCandidateIds],
    viewOrderRevision: state.viewOrderRevision + 1,
    appliedProposalId: proposal.proposalId,
    undoOrderIds: [...state.activeOrderIds],
  });
}

function undoAppliedOrder(
  state: CandidateRankingViewState,
  event: Extract<
    CandidateRankingViewEvent,
    { readonly type: "UNDO_APPLIED_ORDER" }
  >,
): CandidateRankingViewTransition {
  if (event.rankingSessionId !== state.rankingSessionId) {
    return ignored(state, "stale_session");
  }
  if (event.expectedViewOrderRevision !== state.viewOrderRevision) {
    return ignored(state, "stale_view_revision");
  }
  if (state.appliedProposalId === null || state.undoOrderIds === null) {
    return ignored(state, "nothing_to_undo");
  }
  if (event.appliedProposalId !== state.appliedProposalId) {
    return ignored(state, "applied_proposal_mismatch");
  }
  if (!isExactPermutation(state.undoOrderIds, state.canonicalOrderIds)) {
    return ignored(state, "invalid_active_order");
  }

  return accepted({
    ...state,
    activeOrderIds: [...state.undoOrderIds],
    viewOrderRevision: state.viewOrderRevision + 1,
    latestProposal:
      state.latestProposal === null
        ? null
        : { ...state.latestProposal, disposition: "stale" },
    appliedProposalId: null,
    undoOrderIds: null,
  });
}

function changeEvidence(
  state: CandidateRankingViewState,
  event: Extract<CandidateRankingViewEvent, { readonly type: "EVIDENCE_CHANGED" }>,
): CandidateRankingViewTransition {
  if (event.rankingSessionId !== state.rankingSessionId) {
    return ignored(state, "stale_session");
  }
  if (event.candidateSetFingerprint !== state.candidateSetFingerprint) {
    return ignored(state, "candidate_set_mismatch");
  }
  if (!isNonEmptyString(event.evidenceFingerprint)) {
    return ignored(state, "evidence_mismatch");
  }
  if (event.evidenceFingerprint === state.evidenceFingerprint) {
    return ignored(state, "unchanged_evidence");
  }

  return accepted({
    ...state,
    evidenceFingerprint: event.evidenceFingerprint,
    latestProposal:
      state.latestProposal === null
        ? null
        : { ...state.latestProposal, disposition: "stale" },
  });
}

function dismissProposal(
  state: CandidateRankingViewState,
  event: Extract<
    CandidateRankingViewEvent,
    { readonly type: "DISMISS_PROPOSAL" }
  >,
): CandidateRankingViewTransition {
  if (event.rankingSessionId !== state.rankingSessionId) {
    return ignored(state, "stale_session");
  }
  if (event.expectedViewOrderRevision !== state.viewOrderRevision) {
    return ignored(state, "stale_view_revision");
  }
  if (state.appliedProposalId !== null || state.undoOrderIds !== null) {
    return ignored(state, "applied_order_must_be_undone");
  }
  if (state.latestProposal === null) {
    return ignored(state, "proposal_not_found");
  }
  if (event.proposalId !== state.latestProposal.proposal.proposalId) {
    return ignored(state, "proposal_id_mismatch");
  }
  return accepted({ ...state, latestProposal: null });
}

/** Applies one identity-fenced event without mutating the prior state. */
export function transitionCandidateRankingView(
  state: CandidateRankingViewState,
  event: CandidateRankingViewEvent,
): CandidateRankingViewTransition {
  switch (event.type) {
    case "CANDIDATE_SET_REPLACED":
      if (!validSnapshot(event)) {
        return ignored(state, "invalid_candidate_set");
      }
      if (event.rankingSessionId === state.rankingSessionId) {
        return ignored(state, "ranking_session_not_replaced");
      }
      return accepted(snapshotState(event));
    case "PROPOSAL_READY":
      return receiveProposal(state, event.proposal);
    case "APPLY_PROPOSAL":
      return applyProposal(state, event);
    case "UNDO_APPLIED_ORDER":
      return undoAppliedOrder(state, event);
    case "DISMISS_PROPOSAL":
      return dismissProposal(state, event);
    case "EVIDENCE_CHANGED":
      return changeEvidence(state, event);
  }
}

/** Returns a safe ID projection, falling back to canonical order on corruption. */
export function projectCandidateOrderIds(
  state: CandidateRankingViewState,
): readonly string[] {
  return isExactPermutation(state.activeOrderIds, state.canonicalOrderIds)
    ? [...state.activeOrderIds]
    : [...state.canonicalOrderIds];
}

/**
 * Projects candidate objects by ID. A stale/malformed state never hides a
 * subset: malformed active order falls back to canonical, while a mismatched
 * candidate collection is returned unchanged for the caller to recover.
 */
export function projectCandidateOrder<TCandidate extends CandidateRankingProjectable>(
  candidates: readonly TCandidate[],
  state: CandidateRankingViewState,
): readonly TCandidate[] {
  const candidateById = new Map<string, TCandidate>();
  for (const candidate of candidates) {
    if (candidateById.has(candidate.id)) return [...candidates];
    candidateById.set(candidate.id, candidate);
  }
  if (
    candidates.length !== state.canonicalOrderIds.length ||
    state.canonicalOrderIds.some(
      (candidateId) => !candidateById.has(candidateId),
    )
  ) {
    return [...candidates];
  }
  return projectCandidateOrderIds(state).map(
    (candidateId) => candidateById.get(candidateId)!,
  );
}

export function candidateRankingViewHasSessionWork(
  state: CandidateRankingViewState,
): boolean {
  return (
    state.latestProposal !== null ||
    !sameOrder(state.activeOrderIds, state.canonicalOrderIds)
  );
}
