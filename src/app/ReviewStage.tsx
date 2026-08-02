/**
 * ReviewStage — the review step's container.
 *
 * It owns the review screen's own state and adapts the app's analysis results
 * into the surface's view model, so App.tsx holds a single element instead of
 * the screen's markup and a share of its state. The surface below stays
 * presentational; the handlers above (advance-on-decision, undo, boundary
 * nudges) are the app's existing ones, reused rather than reimplemented.
 */
import { useMemo, useState, type ReactElement } from "react";

import {
  ReviewSurface,
  type ReviewCandidate,
  type ReviewDecision,
  type ReviewPage,
} from "./ReviewSurface";

export interface ReviewStageProps {
  readonly sourceTitle: string;
  readonly sourceDurationMs: number;
  /** 이미 시간순으로 정렬되고 뷰모델로 변환된 후보들. */
  readonly candidates: readonly ReviewCandidate[];
  /** App 이 소유하는 포커스. 두 곳이 각자 기억하면 어긋난다. */
  readonly focusedCandidateId: string | null;
  readonly onFocusCandidateId: (candidateId: string) => void;
  readonly streamerName: string;
  readonly streamerImageUrl?: string;
  readonly videoSrc?: string;
  /** Prepared YouTube review when the editor has not connected a local file. */
  readonly youtubeVideoId?: string;
  /** 판단 → 다음 미검토 후보로 이동까지 포함한 앱의 기존 경로. */
  readonly onDecide: (candidateId: string, decision: ReviewDecision) => void;
  readonly onTrim: (candidateId: string, edge: "start" | "end", deltaMs: number) => void;
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  readonly onHelp?: () => void;
  readonly onToggleTheme?: () => void;
  readonly themeLabel?: string;
  /** 페이지와 두 겹의 오버레이는 키맵(Esc 체인)이 알아야 해서 App 이 소유한다. */
  readonly page: ReviewPage;
  readonly onPageChange: (page: ReviewPage) => void;
  readonly playerCardOpen: boolean;
  readonly onPlayerCardOpen: () => void;
  readonly onPlayerCardClose: () => void;
  readonly resetConfirmOpen: boolean;
  readonly onResetConfirmOpen: () => void;
  readonly onResetConfirm: () => void;
  readonly onResetCancel: () => void;
  /** 키맵이 근거 항목 이동을 호출할 수 있도록 App 이 받아 간다. */
  readonly onItemFocusMover?: (move: (delta: 1 | -1) => void) => void;
  /** 키맵이 화면 내부의 실제 플레이어를 제어할 수 있도록 노출한다. */
  readonly onPlaybackToggler?: (toggle: () => void) => void;
}

export function ReviewStage({
  sourceTitle,
  sourceDurationMs,
  candidates,
  focusedCandidateId,
  onFocusCandidateId,
  streamerName,
  streamerImageUrl,
  videoSrc,
  youtubeVideoId,
  onDecide,
  onTrim,
  onUndo,
  canUndo,
  onHelp,
  onToggleTheme,
  themeLabel,
  page,
  onPageChange,
  playerCardOpen,
  onPlayerCardOpen,
  onPlayerCardClose,
  resetConfirmOpen,
  onResetConfirmOpen,
  onResetConfirm,
  onResetCancel,
  onItemFocusMover,
  onPlaybackToggler,
}: ReviewStageProps): ReactElement {
  const activeIndex = useMemo(() => {
    const found = candidates.findIndex(({ id }) => id === focusedCandidateId);
    return found === -1 ? 0 : found;
  }, [candidates, focusedCandidateId]);

  /**
   * 후보 이동의 방향. 전환이 방향을 갖게 해서 "내가 움직였다"가 읽히게 한다
   * (§7.4 — UI 는 콘텐츠 위의 별개 레이어가 아니라 같은 공간의 다른 상태).
   */
  const [lastMoveDirection, setLastMoveDirection] = useState<"forward" | "back">("forward");
  const [seenIndex, setSeenIndex] = useState(activeIndex);
  if (activeIndex !== seenIndex) {
    setLastMoveDirection(activeIndex >= seenIndex ? "forward" : "back");
    setSeenIndex(activeIndex);
    // 후보를 넘기면 요약으로 돌아온다 (§7.3). 근거는 그 후보에 대한 것이라
    // 다음 후보의 근거를 곧바로 보여주면 무엇을 보고 있는지 놓친다.
    if (page !== "summary") onPageChange("summary");
  }

  const selectIndex = (index: number): void => {
    const target = candidates[index];
    if (target !== undefined) onFocusCandidateId(target.id);
  };

  return (
    <ReviewSurface
      sourceTitle={sourceTitle}
      sourceDurationMs={sourceDurationMs}
      candidates={candidates}
      activeIndex={activeIndex}
      page={page}
      lastMoveDirection={lastMoveDirection}
      streamerName={streamerName}
      {...(streamerImageUrl === undefined ? {} : { streamerImageUrl })}
      {...(videoSrc === undefined ? {} : { videoSrc })}
      {...(youtubeVideoId === undefined ? {} : { youtubeVideoId })}
      onSelectIndex={selectIndex}
      onPageChange={onPageChange}
      onDecide={onDecide}
      onTrim={onTrim}
      onUndo={onUndo}
      canUndo={canUndo}
      {...(onHelp === undefined ? {} : { onHelp })}
      {...(onToggleTheme === undefined ? {} : { onToggleTheme })}
      {...(themeLabel === undefined ? {} : { themeLabel })}
      playerCardOpen={playerCardOpen}
      onPlayerCardOpen={() => onPlayerCardOpen()}
      onPlayerCardClose={onPlayerCardClose}
      resetConfirmOpen={resetConfirmOpen}
      onResetConfirmOpen={onResetConfirmOpen}
      onResetConfirm={onResetConfirm}
      onResetCancel={onResetCancel}
      {...(onItemFocusMover === undefined ? {} : { onItemFocusMover })}
      {...(onPlaybackToggler === undefined ? {} : { onPlaybackToggler })}
    />
  );
}
