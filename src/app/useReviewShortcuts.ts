import { useEffect, useRef } from "react";

export type DossierTab = "summary" | "clues" | "context";

const DOSSIER_TAB_ORDER: readonly DossierTab[] = ["summary", "clues", "context"];

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
  readonly toggleApprove: () => void;
  readonly toggleReject: () => void;
  readonly undo: () => void;
  /** Whether the broadcast-map bottom sheet is currently open. */
  readonly mapSheetOpen: boolean;
  readonly toggleMapSheet: () => void;
  readonly closeMapSheet: () => void;
  /** Which dossier tab is showing. Selection persists across candidates. */
  readonly dossierTab: DossierTab;
  readonly setDossierTab: (tab: DossierTab) => void;
}

/**
 * Keyboard driving for the candidate review loop.
 *
 * Bindings are read from `event.code` rather than `event.key` so they keep
 * working while a Korean IME is active — with `event.key`, pressing A while
 * composing Hangul reports "ㅁ" and every letter shortcut would silently die.
 * Typing targets are always left alone.
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
      if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) {
        event.preventDefault();
        current.toggleHelp();
        return;
      }
      if (event.code === "Escape") {
        // Closest-first: the help overlay sits above the sheet, which sits
        // above a non-default dossier tab, which sits above the resting
        // "summary" view. Escape only ever undoes the outermost layer.
        if (current.helpOpen) {
          event.preventDefault();
          current.closeHelp();
          return;
        }
        if (current.mapSheetOpen) {
          event.preventDefault();
          current.closeMapSheet();
          return;
        }
        if (current.dossierTab !== "summary") {
          event.preventDefault();
          current.setDossierTab("summary");
        }
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
        case "ArrowLeft":
        case "KeyJ": {
          event.preventDefault();
          if (event.shiftKey) {
            current.nudgeStart(-1);
            return;
          }
          if (event.altKey) {
            current.nudgeEnd(-1);
            return;
          }
          current.focusPreviousCandidate();
          return;
        }
        case "ArrowRight":
        case "KeyL": {
          event.preventDefault();
          if (event.shiftKey) {
            current.nudgeStart(1);
            return;
          }
          if (event.altKey) {
            current.nudgeEnd(1);
            return;
          }
          current.focusNextCandidate();
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
        case "KeyM": {
          event.preventDefault();
          current.toggleMapSheet();
          return;
        }
        case "Digit1": {
          event.preventDefault();
          current.setDossierTab("summary");
          return;
        }
        case "Digit2": {
          event.preventDefault();
          current.setDossierTab("clues");
          return;
        }
        case "Digit3": {
          event.preventDefault();
          current.setDossierTab("context");
          return;
        }
        case "KeyD": {
          event.preventDefault();
          const currentIndex = DOSSIER_TAB_ORDER.indexOf(current.dossierTab);
          const nextTab =
            DOSSIER_TAB_ORDER[(currentIndex + 1) % DOSSIER_TAB_ORDER.length]!;
          current.setDossierTab(nextTab);
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
