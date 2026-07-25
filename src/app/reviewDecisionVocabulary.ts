/**
 * 앱의 검토 상태 어휘 ↔ 화면의 어휘.
 *
 * 앱은 `unreviewed | approved | rejected` 로 저장하고, 화면은 편집자가 쓰는 말인
 * `pending | used | dropped` 로 말한다. 번역이 여러 곳에 흩어지면 한쪽만 바뀌어
 * 어긋나므로 이 파일에서만 옮긴다.
 */
import type { CandidateReviewState } from "./appViewTypes";
import type { ReviewDecision } from "./ReviewSurface";

const DECISION_BY_REVIEW_STATE: Record<CandidateReviewState, ReviewDecision> = {
  unreviewed: "pending",
  approved: "used",
  rejected: "dropped",
};

const REVIEW_STATE_BY_DECISION: Record<ReviewDecision, CandidateReviewState> = {
  pending: "unreviewed",
  used: "approved",
  dropped: "rejected",
};

export function reviewStateForDecision(decision: ReviewDecision): CandidateReviewState {
  return REVIEW_STATE_BY_DECISION[decision];
}

export function decisionForReviewState(state: CandidateReviewState): ReviewDecision {
  return DECISION_BY_REVIEW_STATE[state];
}
