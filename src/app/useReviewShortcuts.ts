import { useEffect, useRef } from "react";

/**
 * 검토 화면은 두 페이지다. 이전 3탭(요약/단서/맥락)은 이 둘로 합쳐졌다
 * (명세 §6, §10.2).
 */
export type ReviewPage = "summary" | "evidence";

export interface ReviewShortcutActions {
  /** True once the review workspace is showing candidates the editor can judge. */
  readonly active: boolean;
  readonly helpOpen: boolean;
  readonly canUndo: boolean;
  readonly toggleHelp: () => void;
  readonly closeHelp: () => void;
  readonly togglePlayback: () => void;
  readonly focusPreviousCandidate: () => void;
  readonly focusNextCandidate: () => void;
  /** -1 moves the boundary earlier, 1 moves it later. */
  readonly nudgeStart: (direction: -1 | 1) => void;
  readonly nudgeEnd: (direction: -1 | 1) => void;
  /**
   * 근거 항목 사이 포커스 이동. `←/→` 는 후보 축이라 쓰지 않는다(§7.7).
   * 1 은 다음, -1 은 이전.
   */
  readonly moveItemFocus: (delta: 1 | -1) => void;
  readonly toggleApprove: () => void;
  readonly toggleReject: () => void;
  readonly undo: () => void;
  /** 요약 ⇄ 근거. 후보를 넘기면 요약으로 리셋된다(§7.3) — 그 리셋은 화면이 한다. */
  readonly page: ReviewPage;
  readonly setPage: (page: ReviewPage) => void;
  /** 후보 전체 리셋 확인창. 여는 것만 키가 하고, 확정은 확인창 안에서만. */
  readonly resetConfirmOpen: boolean;
  readonly openResetConfirm: () => void;
  readonly confirmReset: () => void;
  readonly cancelReset: () => void;
}

/**
 * Keyboard driving for the candidate review loop. This is the only place the
 * review keymap lives — the surface renders keycaps but binds nothing itself,
 * so there is one table to check against the spec rather than two that drift.
 *
 * Bindings are read from `event.code` rather than `event.key` so they keep
 * working while a Korean IME is active — with `event.key`, pressing A while
 * composing Hangul reports "ㅁ" and every letter shortcut would silently die.
 * Typing targets are always left alone.
 *
 * Nothing binds `Alt`+arrow: in Chromium `Alt+←` is browser Back, so a mistimed
 * boundary nudge would leave the page and lose the session. Boundaries use the
 * editing-tool convention instead — `[` `]` for the start, `Shift` for the end
 * (명세 §11).
 */
export function useReviewShortcuts(actions: ReviewShortcutActions): void {
  const latestActions = useRef(actions);
  useEffect(() => {
    latestActions.current = actions;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const current = latestActions.current;
      if (event.ctrlKey || event.metaKey || event.isComposing || event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      // 리셋 확인창은 파괴적이고 모달이다. 떠 있는 동안에는 확인과 취소만
      // 존재한다. 여는 키(Backspace)와 확정 키(Enter)가 달라 연타로는 확정되지
      // 않는다 (명세 §11.1).
      if (current.resetConfirmOpen) {
        if (event.code === "Enter" || event.code === "NumpadEnter") {
          event.preventDefault();
          current.confirmReset();
        } else if (event.code === "Escape") {
          event.preventDefault();
          current.cancelReset();
        }
        return;
      }

      if (event.key === "?" || event.code === "Slash") {
        event.preventDefault();
        current.toggleHelp();
        return;
      }

      if (event.code === "Escape") {
        // 한 방향으로, 한 겹씩, 가까운 것부터. 도움말이 가장 바깥(모달)이고,
        // 그 아래 근거 페이지, 마지막이 포커스 취소다.
        if (current.helpOpen) {
          event.preventDefault();
          current.closeHelp();
          return;
        }
        if (current.page !== "summary") {
          event.preventDefault();
          current.setPage("summary");
          return;
        }
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (current.helpOpen || !current.active) {
        return;
      }

      switch (event.code) {
        case "Space": {
          event.preventDefault();
          current.togglePlayback();
          return;
        }
        case "ArrowLeft": {
          event.preventDefault();
          current.focusPreviousCandidate();
          return;
        }
        case "ArrowDown":
        case "KeyJ": {
          event.preventDefault();
          current.moveItemFocus(1);
          return;
        }
        case "ArrowUp":
        case "KeyK": {
          event.preventDefault();
          current.moveItemFocus(-1);
          return;
        }
        case "ArrowRight": {
          event.preventDefault();
          current.focusNextCandidate();
          return;
        }
        case "BracketLeft": {
          event.preventDefault();
          if (event.shiftKey) current.nudgeEnd(-1);
          else current.nudgeStart(-1);
          return;
        }
        case "BracketRight": {
          event.preventDefault();
          if (event.shiftKey) current.nudgeEnd(1);
          else current.nudgeStart(1);
          return;
        }
        case "KeyQ": {
          event.preventDefault();
          current.setPage(current.page === "summary" ? "evidence" : "summary");
          return;
        }
        case "KeyA": {
          event.preventDefault();
          current.toggleApprove();
          return;
        }
        case "KeyR": {
          event.preventDefault();
          current.toggleReject();
          return;
        }
        case "KeyZ": {
          if (current.canUndo) {
            event.preventDefault();
            current.undo();
          }
          return;
        }
        case "Backspace": {
          event.preventDefault();
          current.openResetConfirm();
          return;
        }
        default:
          return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
