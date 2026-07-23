/**
 * Thin wrappers over browser APIs the app shell needs at startup or on user
 * action. Each one degrades safely when the capability is missing or blocked,
 * so a hardened browser profile never breaks the editing flow.
 */
import type { AnalysisLanguage } from "../domain/analysisLanguage";
import {
  reduceAnalysisRun,
  type AnalysisRunEvent,
  type AnalysisRunState,
} from "../domain/analysisRun";
import {
  reduceSourceCheck,
  type SourceCheckEvent,
  type SourceCheckState,
} from "../domain/sourceCheck";
import type { Theme } from "./appViewTypes";

export function createOperationId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function candidateElementId(prefix: string, candidateId: string): string {
  return `${prefix}-${encodeURIComponent(candidateId)}`;
}

export function initialTheme(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem("retto-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Theme persistence is optional when storage is unavailable or blocked.
  }
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true
    ? "dark"
    : "light";
}

export function initialAnalysisLanguage(): AnalysisLanguage {
  try {
    const stored = globalThis.localStorage?.getItem("exclipper-language");
    if (stored === "ko" || stored === "en") return stored;
  } catch {
    // Language persistence is optional when storage is unavailable.
  }
  return "ko";
}

export function triggerClipDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Applies a source-check transition, refusing any move the machine rejects. */
export function applySourceEvent(
  state: SourceCheckState,
  event: SourceCheckEvent,
): SourceCheckState {
  const outcome = reduceSourceCheck(state, event);
  if (!outcome.accepted) {
    throw new Error(`SourceCheck 전이가 거부되었습니다: ${outcome.reason}`);
  }
  return outcome.state;
}

/** Applies an analysis-run transition, refusing any move the machine rejects. */
export function applyAnalysisEvent(
  state: AnalysisRunState,
  event: AnalysisRunEvent,
): AnalysisRunState {
  const outcome = reduceAnalysisRun(state, event);
  if (!outcome.accepted) {
    throw new Error(`AnalysisRun 전이가 거부되었습니다: ${outcome.reason}`);
  }
  return outcome.state;
}
