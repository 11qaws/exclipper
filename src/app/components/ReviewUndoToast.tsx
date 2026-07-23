import type { ReviewUndoState } from "../appViewTypes";

interface ReviewUndoToastProps {
  readonly undo: ReviewUndoState;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/**
 * Reports a decision that also moved focus on its own. Advancing to the next
 * candidate is convenient but implicit, so it is always announced with a way
 * back rather than applied silently.
 */
export function ReviewUndoToast({
  undo,
  onUndo,
  onDismiss,
}: ReviewUndoToastProps) {
  return (
    <div className="rh-review-undo" role="status" aria-live="polite">
      <span>
        후보 {undo.candidateNumber}
        {undo.appliedReviewState === "approved" ? " 사용" : " 제외"}
        {undo.advancedToCandidateId === null
          ? " · 남은 후보 없음"
          : " · 다음 후보로 이동했어요"}
      </span>
      <button className="btn btn-secondary" type="button" onClick={onUndo}>
        되돌리기
      </button>
      <button
        className="rh-review-undo-close"
        type="button"
        aria-label="알림 닫기"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}
