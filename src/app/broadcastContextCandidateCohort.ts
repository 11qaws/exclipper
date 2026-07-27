import { MAX_BROADCAST_CONTEXT_CANDIDATES } from "../analysis/broadcastContextProtocol";

export interface BroadcastContextCandidateIdentity {
  readonly id: string;
}

/**
 * Uses the protocol's real 32-candidate bound. The former hard-coded 12 left
 * five of a 17-candidate broadcast permanently outside whole-context analysis.
 */
export function selectBroadcastContextCandidateCohort<
  TCandidate extends BroadcastContextCandidateIdentity,
>(candidates: readonly TCandidate[]): readonly TCandidate[] {
  return candidates.slice(0, MAX_BROADCAST_CONTEXT_CANDIDATES);
}
