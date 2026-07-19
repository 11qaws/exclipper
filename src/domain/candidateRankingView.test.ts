import { describe, expect, it } from "vitest";

import type { CandidateRankingProposal } from "../analysis/candidateRanking";
import {
  MAX_RANKING_CANDIDATE_COUNT,
  candidateRankingViewHasSessionWork,
  createCandidateRankingViewState,
  projectCandidateOrder,
  projectCandidateOrderIds,
  transitionCandidateRankingView,
  type CandidateRankingViewState,
} from "./candidateRankingView";

const canonicalOrderIds = ["candidate-a", "candidate-b", "candidate-c"] as const;

function initial(): CandidateRankingViewState {
  return createCandidateRankingViewState({
    rankingSessionId: "ranking-session-1",
    candidateSetFingerprint: "candidate-set-1",
    evidenceFingerprint: "evidence-1",
    canonicalOrderIds,
  });
}

function proposal(
  overrides: Partial<CandidateRankingProposal> = {},
): CandidateRankingProposal {
  const entries = canonicalOrderIds.map((candidateId, index) => ({
    candidateId,
    previousOrdinal: index + 1,
    proposedOrdinal: index + 1,
    relativeSupportPoints: 1_000 - index,
    breakdown: {
      audioBasePoints: 0,
      audioSemanticPoints: 0,
      chatPoints: 0,
      visualContextPoints: 0,
      audioChatAgreementPoints: 0,
      totalPoints: 0,
    },
    reasonCodes: [],
  }));
  return {
    proposalId: "ranking-proposal-1",
    rankingSessionId: "ranking-session-1",
    rankingRevision: 1,
    candidateSetFingerprint: "candidate-set-1",
    evidenceFingerprint: "evidence-1",
    expectedViewOrderRevision: 0,
    inputOrderCandidateIds: canonicalOrderIds,
    orderedCandidateIds: ["candidate-c", "candidate-a", "candidate-b"],
    entries,
    ...overrides,
  } as CandidateRankingProposal;
}

function receive(
  state: CandidateRankingViewState = initial(),
  nextProposal: CandidateRankingProposal = proposal(),
): CandidateRankingViewState {
  const transition = transitionCandidateRankingView(state, {
    type: "PROPOSAL_READY",
    proposal: nextProposal,
  });
  expect(transition).toMatchObject({ accepted: true });
  return transition.state;
}

function apply(state: CandidateRankingViewState): CandidateRankingViewState {
  const transition = transitionCandidateRankingView(state, {
    type: "APPLY_PROPOSAL",
    rankingSessionId: state.rankingSessionId,
    proposalId: state.latestProposal?.proposal.proposalId ?? "missing",
    candidateSetFingerprint: state.candidateSetFingerprint,
    evidenceFingerprint: state.evidenceFingerprint,
    expectedViewOrderRevision: state.viewOrderRevision,
  });
  expect(transition).toMatchObject({ accepted: true });
  return transition.state;
}

describe("candidate ranking view snapshots", () => {
  it("starts with canonical and active order aligned and no proposal or undo", () => {
    const sourceIds = [...canonicalOrderIds];
    const state = createCandidateRankingViewState({
      rankingSessionId: "ranking-session-1",
      candidateSetFingerprint: "candidate-set-1",
      evidenceFingerprint: "evidence-1",
      canonicalOrderIds: sourceIds,
    });
    sourceIds.reverse();

    expect(state).toEqual({
      rankingSessionId: "ranking-session-1",
      candidateSetFingerprint: "candidate-set-1",
      evidenceFingerprint: "evidence-1",
      canonicalOrderIds,
      activeOrderIds: canonicalOrderIds,
      viewOrderRevision: 0,
      latestRankingRevision: 0,
      latestProposal: null,
      appliedProposalId: null,
      undoOrderIds: null,
    });
  });

  it("allows an empty candidate set but rejects malformed or oversized sets", () => {
    expect(
      createCandidateRankingViewState({
        rankingSessionId: "ranking-session-empty",
        candidateSetFingerprint: "candidate-set-empty",
        evidenceFingerprint: "evidence-empty",
        canonicalOrderIds: [],
      }).activeOrderIds,
    ).toEqual([]);

    const tooManyIds = Array.from(
      { length: MAX_RANKING_CANDIDATE_COUNT + 1 },
      (_, index) => `candidate-${index}`,
    );
    for (const invalidSnapshot of [
      { ...initial(), rankingSessionId: "" },
      { ...initial(), candidateSetFingerprint: " " },
      { ...initial(), evidenceFingerprint: "" },
      { ...initial(), canonicalOrderIds: ["candidate-a", "candidate-a"] },
      { ...initial(), canonicalOrderIds: ["candidate-a", ""] },
      { ...initial(), canonicalOrderIds: tooManyIds },
    ]) {
      expect(() =>
        createCandidateRankingViewState(invalidSnapshot),
      ).toThrow(TypeError);
    }
  });

  it("atomically resets order, proposal, revision, and undo for a new candidate set", () => {
    const applied = apply(receive());
    const transition = transitionCandidateRankingView(applied, {
      type: "CANDIDATE_SET_REPLACED",
      rankingSessionId: "ranking-session-2",
      candidateSetFingerprint: "candidate-set-2",
      evidenceFingerprint: "evidence-2",
      canonicalOrderIds: ["candidate-z", "candidate-y"],
    });

    expect(transition).toEqual({
      accepted: true,
      state: {
        rankingSessionId: "ranking-session-2",
        candidateSetFingerprint: "candidate-set-2",
        evidenceFingerprint: "evidence-2",
        canonicalOrderIds: ["candidate-z", "candidate-y"],
        activeOrderIds: ["candidate-z", "candidate-y"],
        viewOrderRevision: 0,
        latestRankingRevision: 0,
        latestProposal: null,
        appliedProposalId: null,
        undoOrderIds: null,
      },
    });
  });

  it("refuses an invalid replacement or a reset that reuses the current session", () => {
    const state = initial();
    const reused = transitionCandidateRankingView(state, {
      type: "CANDIDATE_SET_REPLACED",
      rankingSessionId: state.rankingSessionId,
      candidateSetFingerprint: "candidate-set-2",
      evidenceFingerprint: "evidence-2",
      canonicalOrderIds: ["candidate-z"],
    });
    const malformed = transitionCandidateRankingView(state, {
      type: "CANDIDATE_SET_REPLACED",
      rankingSessionId: "ranking-session-2",
      candidateSetFingerprint: "candidate-set-2",
      evidenceFingerprint: "evidence-2",
      canonicalOrderIds: ["candidate-z", "candidate-z"],
    });

    expect(reused).toEqual({
      accepted: false,
      state,
      reason: "ranking_session_not_replaced",
    });
    expect(malformed).toEqual({
      accepted: false,
      state,
      reason: "invalid_candidate_set",
    });
  });
});

describe("candidate ranking proposal fences", () => {
  it("stores a fresh proposal without changing the visible order", () => {
    const state = initial();
    const inputOrder = [...canonicalOrderIds];
    const proposedOrder = ["candidate-c", "candidate-a", "candidate-b"];
    const nextProposal = proposal({
      inputOrderCandidateIds: inputOrder,
      orderedCandidateIds: proposedOrder,
    });
    const next = receive(state, nextProposal);

    inputOrder.reverse();
    proposedOrder.reverse();
    expect(next.activeOrderIds).toEqual(state.activeOrderIds);
    expect(next.viewOrderRevision).toBe(0);
    expect(next.latestRankingRevision).toBe(1);
    expect(next.latestProposal).toMatchObject({
      disposition: "fresh",
      proposal: {
        proposalId: "ranking-proposal-1",
        inputOrderCandidateIds: canonicalOrderIds,
        orderedCandidateIds: ["candidate-c", "candidate-a", "candidate-b"],
      },
    });
    expect(next.appliedProposalId).toBeNull();
    expect(next.undoOrderIds).toBeNull();
  });

  it.each([
    ["stale session", { rankingSessionId: "old-session" }, "stale_session"],
    [
      "candidate fingerprint mismatch",
      { candidateSetFingerprint: "old-candidates" },
      "candidate_set_mismatch",
    ],
    [
      "evidence fingerprint mismatch",
      { evidenceFingerprint: "old-evidence" },
      "evidence_mismatch",
    ],
    [
      "stale view revision",
      { expectedViewOrderRevision: 9 },
      "stale_view_revision",
    ],
    [
      "wrong input order",
      {
        inputOrderCandidateIds: [
          "candidate-b",
          "candidate-a",
          "candidate-c",
        ],
      },
      "input_order_mismatch",
    ],
    [
      "missing proposed ID",
      { orderedCandidateIds: ["candidate-c", "candidate-a"] },
      "invalid_proposal_order",
    ],
    [
      "duplicate proposed ID",
      {
        orderedCandidateIds: [
          "candidate-c",
          "candidate-a",
          "candidate-a",
        ],
      },
      "invalid_proposal_order",
    ],
    [
      "unknown proposed ID",
      {
        orderedCandidateIds: [
          "candidate-c",
          "candidate-a",
          "candidate-unknown",
        ],
      },
      "invalid_proposal_order",
    ],
    ["empty proposal ID", { proposalId: "" }, "invalid_proposal_identity"],
    ["zero revision", { rankingRevision: 0 }, "invalid_proposal_identity"],
    ["negative revision", { rankingRevision: -1 }, "invalid_proposal_identity"],
    [
      "missing ranking entry",
      { entries: proposal().entries.slice(0, 2) },
      "invalid_proposal_order",
    ],
  ])("rejects %s", (_label, overrides, expectedReason) => {
    const state = initial();
    const transition = transitionCandidateRankingView(state, {
      type: "PROPOSAL_READY",
      proposal: proposal(overrides),
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: expectedReason,
    });
  });

  it("rejects duplicate or non-increasing ranking revisions", () => {
    const first = receive();
    const duplicateId = transitionCandidateRankingView(first, {
      type: "PROPOSAL_READY",
      proposal: proposal({ rankingRevision: 2 }),
    });
    const staleRevision = transitionCandidateRankingView(first, {
      type: "PROPOSAL_READY",
      proposal: proposal({
        proposalId: "ranking-proposal-2",
        rankingRevision: 1,
      }),
    });

    expect(duplicateId).toMatchObject({
      accepted: false,
      reason: "duplicate_proposal_id",
    });
    expect(staleRevision).toMatchObject({
      accepted: false,
      reason: "stale_ranking_revision",
    });
  });

  it("retains the revision fence after dismissal so a late older proposal stays ignored", () => {
    const first = receive(
      initial(),
      proposal({ proposalId: "ranking-proposal-2", rankingRevision: 2 }),
    );
    const dismissed = transitionCandidateRankingView(first, {
      type: "DISMISS_PROPOSAL",
      rankingSessionId: first.rankingSessionId,
      proposalId: "ranking-proposal-2",
      expectedViewOrderRevision: first.viewOrderRevision,
    });
    expect(dismissed).toMatchObject({
      accepted: true,
      state: { latestProposal: null, latestRankingRevision: 2 },
    });

    const late = transitionCandidateRankingView(dismissed.state, {
      type: "PROPOSAL_READY",
      proposal: proposal({
        proposalId: "ranking-proposal-1",
        rankingRevision: 1,
      }),
    });
    expect(late).toEqual({
      accepted: false,
      state: dismissed.state,
      reason: "stale_ranking_revision",
    });
  });

  it("does not let a new proposal silently replace an applied order", () => {
    const state = apply(receive());
    const transition = transitionCandidateRankingView(state, {
      type: "PROPOSAL_READY",
      proposal: proposal({
        proposalId: "ranking-proposal-2",
        rankingRevision: 2,
        expectedViewOrderRevision: state.viewOrderRevision,
        inputOrderCandidateIds: state.activeOrderIds,
      }),
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: "applied_order_must_be_undone",
    });
  });
});

describe("explicit apply, evidence staleness, and one-level undo", () => {
  it("dismisses an unapplied proposal without changing either candidate order", () => {
    const state = receive();
    const transition = transitionCandidateRankingView(state, {
      type: "DISMISS_PROPOSAL",
      rankingSessionId: state.rankingSessionId,
      proposalId: state.latestProposal!.proposal.proposalId,
      expectedViewOrderRevision: state.viewOrderRevision,
    });

    expect(transition).toEqual({
      accepted: true,
      state: {
        ...state,
        latestProposal: null,
      },
    });
    expect(transition.state.activeOrderIds).toEqual(canonicalOrderIds);
    expect(transition.state.canonicalOrderIds).toEqual(canonicalOrderIds);
  });

  it.each([
    ["stale session", { rankingSessionId: "old-session" }, "stale_session"],
    [
      "stale revision",
      { expectedViewOrderRevision: 4 },
      "stale_view_revision",
    ],
    ["wrong proposal", { proposalId: "other-proposal" }, "proposal_id_mismatch"],
  ])("rejects dismiss with %s", (_label, overrides, expectedReason) => {
    const state = receive();
    const transition = transitionCandidateRankingView(state, {
      type: "DISMISS_PROPOSAL",
      rankingSessionId: state.rankingSessionId,
      proposalId: state.latestProposal!.proposal.proposalId,
      expectedViewOrderRevision: state.viewOrderRevision,
      ...overrides,
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: expectedReason,
    });
  });

  it("does not let dismissal become an implicit undo", () => {
    const state = apply(receive());
    const transition = transitionCandidateRankingView(state, {
      type: "DISMISS_PROPOSAL",
      rankingSessionId: state.rankingSessionId,
      proposalId: state.latestProposal!.proposal.proposalId,
      expectedViewOrderRevision: state.viewOrderRevision,
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: "applied_order_must_be_undone",
    });
  });

  it("applies only the ID order and saves the complete prior order once", () => {
    const state = receive();
    const next = apply(state);

    expect(next).toMatchObject({
      activeOrderIds: ["candidate-c", "candidate-a", "candidate-b"],
      viewOrderRevision: 1,
      appliedProposalId: "ranking-proposal-1",
      undoOrderIds: canonicalOrderIds,
    });
    expect(next.canonicalOrderIds).toEqual(canonicalOrderIds);
    expect(state.activeOrderIds).toEqual(canonicalOrderIds);
  });

  it.each([
    ["stale session", { rankingSessionId: "old-session" }, "stale_session"],
    [
      "candidate fingerprint mismatch",
      { candidateSetFingerprint: "old-candidates" },
      "candidate_set_mismatch",
    ],
    [
      "evidence fingerprint mismatch",
      { evidenceFingerprint: "old-evidence" },
      "evidence_mismatch",
    ],
    [
      "stale view revision",
      { expectedViewOrderRevision: 3 },
      "stale_view_revision",
    ],
    ["wrong proposal", { proposalId: "other-proposal" }, "proposal_id_mismatch"],
  ])("rejects apply with %s", (_label, overrides, expectedReason) => {
    const state = receive();
    const transition = transitionCandidateRankingView(state, {
      type: "APPLY_PROPOSAL",
      rankingSessionId: state.rankingSessionId,
      proposalId: "ranking-proposal-1",
      candidateSetFingerprint: state.candidateSetFingerprint,
      evidenceFingerprint: state.evidenceFingerprint,
      expectedViewOrderRevision: state.viewOrderRevision,
      ...overrides,
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: expectedReason,
    });
  });

  it("refuses stale proposals and repeated application", () => {
    const fresh = receive();
    const evidenceChanged = transitionCandidateRankingView(fresh, {
      type: "EVIDENCE_CHANGED",
      rankingSessionId: fresh.rankingSessionId,
      candidateSetFingerprint: fresh.candidateSetFingerprint,
      evidenceFingerprint: "evidence-2",
    });
    expect(evidenceChanged.accepted).toBe(true);
    const stale = evidenceChanged.state;
    const staleApply = transitionCandidateRankingView(stale, {
      type: "APPLY_PROPOSAL",
      rankingSessionId: stale.rankingSessionId,
      proposalId: "ranking-proposal-1",
      candidateSetFingerprint: stale.candidateSetFingerprint,
      evidenceFingerprint: stale.evidenceFingerprint,
      expectedViewOrderRevision: stale.viewOrderRevision,
    });
    expect(staleApply).toMatchObject({
      accepted: false,
      reason: "proposal_stale",
    });

    const applied = apply(fresh);
    const repeated = transitionCandidateRankingView(applied, {
      type: "APPLY_PROPOSAL",
      rankingSessionId: applied.rankingSessionId,
      proposalId: "ranking-proposal-1",
      candidateSetFingerprint: applied.candidateSetFingerprint,
      evidenceFingerprint: applied.evidenceFingerprint,
      expectedViewOrderRevision: applied.viewOrderRevision,
    });
    expect(repeated).toMatchObject({
      accepted: false,
      reason: "proposal_already_applied",
    });
  });

  it("marks a proposal stale without moving an already-applied order or its undo", () => {
    const applied = apply(receive());
    const transition = transitionCandidateRankingView(applied, {
      type: "EVIDENCE_CHANGED",
      rankingSessionId: applied.rankingSessionId,
      candidateSetFingerprint: applied.candidateSetFingerprint,
      evidenceFingerprint: "evidence-2",
    });

    expect(transition).toMatchObject({
      accepted: true,
      state: {
        evidenceFingerprint: "evidence-2",
        activeOrderIds: applied.activeOrderIds,
        undoOrderIds: applied.undoOrderIds,
        appliedProposalId: applied.appliedProposalId,
        latestProposal: { disposition: "stale" },
      },
    });
  });

  it("ignores unchanged or wrongly fenced evidence events", () => {
    const state = receive();
    const unchanged = transitionCandidateRankingView(state, {
      type: "EVIDENCE_CHANGED",
      rankingSessionId: state.rankingSessionId,
      candidateSetFingerprint: state.candidateSetFingerprint,
      evidenceFingerprint: state.evidenceFingerprint,
    });
    const oldSession = transitionCandidateRankingView(state, {
      type: "EVIDENCE_CHANGED",
      rankingSessionId: "old-session",
      candidateSetFingerprint: state.candidateSetFingerprint,
      evidenceFingerprint: "evidence-2",
    });
    const wrongSet = transitionCandidateRankingView(state, {
      type: "EVIDENCE_CHANGED",
      rankingSessionId: state.rankingSessionId,
      candidateSetFingerprint: "old-candidates",
      evidenceFingerprint: "evidence-2",
    });

    expect(unchanged).toMatchObject({
      accepted: false,
      reason: "unchanged_evidence",
    });
    expect(oldSession).toMatchObject({ accepted: false, reason: "stale_session" });
    expect(wrongSet).toMatchObject({
      accepted: false,
      reason: "candidate_set_mismatch",
    });
  });

  it("restores the previous full order, increments revision, and makes repeat undo a no-op", () => {
    const applied = apply(receive());
    const undone = transitionCandidateRankingView(applied, {
      type: "UNDO_APPLIED_ORDER",
      rankingSessionId: applied.rankingSessionId,
      appliedProposalId: applied.appliedProposalId!,
      expectedViewOrderRevision: applied.viewOrderRevision,
    });

    expect(undone).toMatchObject({
      accepted: true,
      state: {
        activeOrderIds: canonicalOrderIds,
        viewOrderRevision: 2,
        appliedProposalId: null,
        undoOrderIds: null,
        latestProposal: { disposition: "stale" },
      },
    });

    const repeated = transitionCandidateRankingView(undone.state, {
      type: "UNDO_APPLIED_ORDER",
      rankingSessionId: undone.state.rankingSessionId,
      appliedProposalId: "ranking-proposal-1",
      expectedViewOrderRevision: undone.state.viewOrderRevision,
    });
    expect(repeated).toEqual({
      accepted: false,
      state: undone.state,
      reason: "nothing_to_undo",
    });
  });

  it.each([
    ["stale session", { rankingSessionId: "old-session" }, "stale_session"],
    [
      "stale revision",
      { expectedViewOrderRevision: 0 },
      "stale_view_revision",
    ],
    [
      "wrong applied proposal",
      { appliedProposalId: "other-proposal" },
      "applied_proposal_mismatch",
    ],
  ])("rejects undo with %s", (_label, overrides, expectedReason) => {
    const state = apply(receive());
    const transition = transitionCandidateRankingView(state, {
      type: "UNDO_APPLIED_ORDER",
      rankingSessionId: state.rankingSessionId,
      appliedProposalId: state.appliedProposalId!,
      expectedViewOrderRevision: state.viewOrderRevision,
      ...overrides,
    });

    expect(transition).toEqual({
      accepted: false,
      state,
      reason: expectedReason,
    });
  });
});

describe("candidate ranking projection", () => {
  const candidates = canonicalOrderIds.map((id, index) => ({
    id,
    stableValue: `value-${index}`,
  }));

  it("projects the active ID order without cloning or changing candidate objects", () => {
    const state = apply(receive());
    const projected = projectCandidateOrder(candidates, state);

    expect(projected.map(({ id }) => id)).toEqual([
      "candidate-c",
      "candidate-a",
      "candidate-b",
    ]);
    expect(projected[0]).toBe(candidates[2]);
    expect(projected[1]).toBe(candidates[0]);
    expect(projected[2]).toBe(candidates[1]);
  });

  it.each([
    ["missing", ["candidate-c", "candidate-a"]],
    [
      "duplicate",
      ["candidate-c", "candidate-a", "candidate-a"],
    ],
    [
      "unknown",
      ["candidate-c", "candidate-a", "candidate-unknown"],
    ],
  ])("falls back to canonical order for a %s active projection", (_label, activeOrderIds) => {
    const malformed = { ...initial(), activeOrderIds };

    expect(projectCandidateOrderIds(malformed)).toEqual(canonicalOrderIds);
    expect(projectCandidateOrder(candidates, malformed)).toEqual(candidates);
  });

  it("returns a mismatched candidate collection intact instead of hiding items", () => {
    const state = apply(receive());
    const incomplete = candidates.slice(0, 2);
    const duplicate = [candidates[0]!, candidates[0]!, candidates[2]!];

    expect(projectCandidateOrder(incomplete, state)).toEqual(incomplete);
    expect(projectCandidateOrder(duplicate, state)).toEqual(duplicate);
  });

  it("reports session-only work after a proposal exists or an order is active", () => {
    const clean = initial();
    const proposed = receive(clean);
    const applied = apply(proposed);

    expect(candidateRankingViewHasSessionWork(clean)).toBe(false);
    expect(candidateRankingViewHasSessionWork(proposed)).toBe(true);
    expect(candidateRankingViewHasSessionWork(applied)).toBe(true);
  });
});
