import type { UnfinishedJobSummary } from "./unfinishedJobSummary";

/**
 * When the "이어서 할 분석" sheet is allowed to open itself.
 *
 * Two failures sit on either side of this, and both are worse than they look.
 *
 * Reopening on every render nags: the user closed it, and a panel that comes
 * back anyway teaches them to ignore it, which costs the one moment it had.
 *
 * Never reopening loses the work: once dismissed there is no path back, and the
 * analysis becomes something that "sometimes disappears". The chip left behind
 * is what prevents that — dismissing hides the sheet, never the way in.
 *
 * So it reopens only when the **list itself changed**: new unfinished work
 * appeared, or something finished and left. Progress ticking upward is not a
 * change worth interrupting for.
 */

export interface SheetVisibility {
  readonly open: boolean;
  /** 닫은 뒤에도 남는 칩. 목록이 비면 사라진다. */
  readonly chipCount: number;
  /** 닫힌 뒤 이 서명이 그대로면 다시 열지 않는다. */
  readonly dismissedSignature: string | null;
}

export const INITIAL_SHEET_VISIBILITY: SheetVisibility = {
  open: false,
  chipCount: 0,
  dismissedSignature: null,
};

/**
 * 목록의 서명. **무엇이 있는지**만 담고 얼마나 진행됐는지는 담지 않는다 —
 * 진행률이 오를 때마다 서명이 바뀌면 시트가 계속 다시 열린다.
 */
export function unfinishedSignature(
  summaries: readonly UnfinishedJobSummary[],
): string {
  return summaries
    .map((one) => `${one.jobId}:${one.action}`)
    .sort()
    .join("|");
}

export function reconcileSheetVisibility(
  previous: SheetVisibility,
  summaries: readonly UnfinishedJobSummary[],
): SheetVisibility {
  const signature = unfinishedSignature(summaries);

  // 이어서 할 것이 없으면 시트도 칩도 없다. 빈 패널을 남기지 않는다.
  if (summaries.length === 0) {
    return { open: false, chipCount: 0, dismissedSignature: null };
  }

  // 이 목록을 이미 닫았으면 닫힌 채로, 아니면 연다. 규칙은 이 한 줄이 전부이고,
  // 여기에 조건을 더 얹을 때마다 "왜 안 뜨지" 를 다시 추적하게 된다.
  const dismissedThisList = previous.dismissedSignature === signature;
  return {
    open: !dismissedThisList,
    chipCount: summaries.length,
    dismissedSignature: dismissedThisList ? signature : null,
  };
}

/** `✕` 를 눌렀을 때. 시트만 접고 칩은 남긴다. */
export function dismissSheet(
  summaries: readonly UnfinishedJobSummary[],
): SheetVisibility {
  return {
    open: false,
    chipCount: summaries.length,
    dismissedSignature: unfinishedSignature(summaries),
  };
}

/** 칩을 눌렀을 때. 사용자가 직접 열었으므로 서명은 지운다. */
export function openSheet(previous: SheetVisibility): SheetVisibility {
  return { ...previous, open: true, dismissedSignature: null };
}
