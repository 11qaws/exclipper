import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import type { ChannelPreanalysisReviewBundle } from "../analysis/channelPreanalysisReviewBundle";
import type { AnalysisLanguage } from "../domain/analysisLanguage";
import {
  BOUNDARY_NUDGE_MS,
  MAX_CLIP_DURATION_MS,
  MIN_CLIP_DURATION_MS,
  applyCandidateBoundaryCommand,
  createCandidateBoundaryRevision,
  type CandidateBoundaryRevision,
} from "../domain/candidateBoundaryRevision";
import { projectPreparedReviewBundle } from "./preparedReviewProjection";
import { ReviewStage } from "./ReviewStage";
import type {
  ReviewCandidate,
  ReviewDecision,
} from "./ReviewSurface";
import { useReviewShortcuts, type ReviewPage } from "./useReviewShortcuts";

const PREPARED_REVIEW_SESSION_SCHEMA_VERSION = "1.0.0" as const;

interface StoredPreparedReviewCandidate {
  readonly candidateId: string;
  readonly decision: ReviewDecision;
  readonly startMs: number;
  readonly endMs: number;
}

interface StoredPreparedReviewSession {
  readonly schemaVersion: typeof PREPARED_REVIEW_SESSION_SCHEMA_VERSION;
  readonly artifactDigest: string;
  readonly candidates: readonly StoredPreparedReviewCandidate[];
}

interface PreparedReviewEditorState {
  readonly decisions: Readonly<Record<string, ReviewDecision>>;
  readonly boundaries: Readonly<Record<string, CandidateBoundaryRevision>>;
}

interface PreparedReviewUndo {
  readonly candidateId: string;
  readonly previous: ReviewDecision;
}

export interface PreparedReviewExperienceProps {
  readonly bundle: ChannelPreanalysisReviewBundle;
  readonly artifactDigest: string;
  readonly sourceTitle: string;
  readonly analysisLanguage: AnalysisLanguage;
  readonly videoSrc?: string;
  readonly youtubeVideoId: string;
  readonly onLanguageChange: (language: AnalysisLanguage) => void;
  readonly onToggleTheme: () => void;
  readonly themeLabel: string;
  readonly onExit: () => void;
}

function sessionStorageKey(artifactDigest: string): string {
  return `exclipper:prepared-review:${artifactDigest}`;
}

function initialBoundary(
  candidate: ReviewCandidate,
  sourceDurationMs: number,
  artifactDigest: string,
): CandidateBoundaryRevision {
  return createCandidateBoundaryRevision({
    boundarySessionId: `prepared:${artifactDigest}`,
    candidateId: candidate.id,
    proposalRange: {
      startMs: candidate.startMs,
      endMs: candidate.endMs,
    },
    peakMs: candidate.peakMs,
    sourceDurationMs,
  });
}

function validStoredRange(
  stored: StoredPreparedReviewCandidate,
  candidate: ReviewCandidate,
  sourceDurationMs: number,
): boolean {
  const durationMs = stored.endMs - stored.startMs;
  return (
    Number.isSafeInteger(stored.startMs) &&
    Number.isSafeInteger(stored.endMs) &&
    stored.startMs >= 0 &&
    stored.endMs <= sourceDurationMs &&
    durationMs >= Math.min(MIN_CLIP_DURATION_MS, sourceDurationMs) &&
    durationMs <= Math.min(MAX_CLIP_DURATION_MS, sourceDurationMs) &&
    stored.startMs <= candidate.peakMs &&
    stored.endMs >= candidate.peakMs
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === "pending" || value === "used" || value === "dropped";
}

function parseStoredEditorSession(
  raw: string,
  artifactDigest: string,
): StoredPreparedReviewSession | null {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== PREPARED_REVIEW_SESSION_SCHEMA_VERSION ||
    parsed.artifactDigest !== artifactDigest ||
    !Array.isArray(parsed.candidates)
  ) {
    return null;
  }
  const candidates: StoredPreparedReviewCandidate[] = [];
  for (const value of parsed.candidates) {
    if (
      !isRecord(value) ||
      typeof value.candidateId !== "string" ||
      !isReviewDecision(value.decision) ||
      typeof value.startMs !== "number" ||
      typeof value.endMs !== "number"
    ) {
      return null;
    }
    candidates.push({
      candidateId: value.candidateId,
      decision: value.decision,
      startMs: value.startMs,
      endMs: value.endMs,
    });
  }
  return {
    schemaVersion: PREPARED_REVIEW_SESSION_SCHEMA_VERSION,
    artifactDigest,
    candidates,
  };
}

function createInitialEditorState(
  candidates: readonly ReviewCandidate[],
  sourceDurationMs: number,
  artifactDigest: string,
): PreparedReviewEditorState {
  const decisions: Record<string, ReviewDecision> = {};
  const boundaries: Record<string, CandidateBoundaryRevision> = {};
  for (const candidate of candidates) {
    decisions[candidate.id] = "pending";
    boundaries[candidate.id] = initialBoundary(
      candidate,
      sourceDurationMs,
      artifactDigest,
    );
  }
  return { decisions, boundaries };
}

function restoreEditorState(
  candidates: readonly ReviewCandidate[],
  sourceDurationMs: number,
  artifactDigest: string,
): PreparedReviewEditorState {
  const initial = createInitialEditorState(
    candidates,
    sourceDurationMs,
    artifactDigest,
  );
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(sessionStorageKey(artifactDigest)) ?? null;
  } catch {
    return initial;
  }
  if (raw === null) return initial;

  try {
    const parsed = parseStoredEditorSession(raw, artifactDigest);
    if (parsed === null) return initial;
    const storedById = new Map(
      parsed.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const decisions = { ...initial.decisions };
    const boundaries = { ...initial.boundaries };
    for (const candidate of candidates) {
      const stored = storedById.get(candidate.id);
      if (
        stored === undefined ||
        !["pending", "used", "dropped"].includes(stored.decision) ||
        !validStoredRange(stored, candidate, sourceDurationMs)
      ) {
        continue;
      }
      decisions[candidate.id] = stored.decision;
      const proposal = boundaries[candidate.id];
      if (proposal === undefined) continue;
      boundaries[candidate.id] =
        stored.startMs === candidate.startMs && stored.endMs === candidate.endMs
          ? proposal
          : {
              ...proposal,
              effectiveRange: {
                startMs: stored.startMs,
                endMs: stored.endMs,
              },
              revision: 1,
              provenance: "userAdjusted",
            };
    }
    return { decisions, boundaries };
  } catch {
    return initial;
  }
}

function saveEditorState(
  artifactDigest: string,
  candidates: readonly ReviewCandidate[],
  state: PreparedReviewEditorState,
): void {
  const stored: StoredPreparedReviewSession = {
    schemaVersion: PREPARED_REVIEW_SESSION_SCHEMA_VERSION,
    artifactDigest,
    candidates: candidates.map((candidate) => {
      const boundary = state.boundaries[candidate.id];
      return {
        candidateId: candidate.id,
        decision: state.decisions[candidate.id] ?? "pending",
        startMs: boundary?.effectiveRange.startMs ?? candidate.startMs,
        endMs: boundary?.effectiveRange.endMs ?? candidate.endMs,
      };
    }),
  };
  try {
    globalThis.localStorage?.setItem(
      sessionStorageKey(artifactDigest),
      JSON.stringify(stored),
    );
  } catch {
    // The immutable remote bundle remains available even when local decisions
    // cannot be persisted in this browser.
  }
}

function withEditorState(
  candidates: readonly ReviewCandidate[],
  state: PreparedReviewEditorState,
): readonly ReviewCandidate[] {
  return candidates.map((candidate) => {
    const range = state.boundaries[candidate.id]?.effectiveRange;
    return {
      ...candidate,
      decision: state.decisions[candidate.id] ?? "pending",
      startMs: range?.startMs ?? candidate.startMs,
      endMs: range?.endMs ?? candidate.endMs,
    };
  });
}

export function PreparedReviewExperience({
  bundle,
  artifactDigest,
  sourceTitle,
  analysisLanguage,
  videoSrc,
  youtubeVideoId,
  onLanguageChange,
  onToggleTheme,
  themeLabel,
  onExit,
}: PreparedReviewExperienceProps): ReactElement {
  const projection = useMemo(
    () => projectPreparedReviewBundle(bundle),
    [bundle],
  );
  const [editorState, setEditorState] = useState(() =>
    restoreEditorState(
      projection.candidates,
      bundle.sourceDurationMs,
      artifactDigest,
    ),
  );
  const candidates = useMemo(
    () => withEditorState(projection.candidates, editorState),
    [editorState, projection.candidates],
  );
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(
    candidates[0]?.id ?? null,
  );
  const [undo, setUndo] = useState<PreparedReviewUndo | null>(null);
  const [page, setPage] = useState<ReviewPage>("summary");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const playbackTogglerRef = useRef<(() => void) | null>(null);
  const itemFocusMoverRef = useRef<((delta: 1 | -1) => void) | null>(null);

  useEffect(() => {
    saveEditorState(
      artifactDigest,
      projection.candidates,
      editorState,
    );
  }, [artifactDigest, editorState, projection.candidates]);

  const focusedIndex = Math.max(
    0,
    candidates.findIndex(({ id }) => id === focusedCandidateId),
  );
  const focused = candidates[focusedIndex];

  const focusRelative = (delta: -1 | 1): void => {
    if (candidates.length === 0) return;
    const nextIndex = Math.min(
      candidates.length - 1,
      Math.max(0, focusedIndex + delta),
    );
    const next = candidates[nextIndex];
    if (next !== undefined) setFocusedCandidateId(next.id);
  };

  const decide = (candidateId: string, decision: ReviewDecision): void => {
    const previous = editorState.decisions[candidateId] ?? "pending";
    setUndo({ candidateId, previous });
    setEditorState((current) => ({
      ...current,
      decisions: { ...current.decisions, [candidateId]: decision },
    }));
    if (decision === "pending") return;
    const currentIndex = candidates.findIndex(({ id }) => id === candidateId);
    const ordered = [
      ...candidates.slice(currentIndex + 1),
      ...candidates.slice(0, Math.max(0, currentIndex)),
    ];
    const next = ordered.find(
      (candidate) =>
        candidate.id !== candidateId &&
        (editorState.decisions[candidate.id] ?? "pending") === "pending",
    );
    if (next !== undefined) setFocusedCandidateId(next.id);
  };

  const trim = (
    candidateId: string,
    edge: "start" | "end",
    deltaMs: number,
  ): void => {
    if (deltaMs !== -BOUNDARY_NUDGE_MS && deltaMs !== BOUNDARY_NUDGE_MS) return;
    const boundedDelta: -5_000 | 5_000 = deltaMs < 0 ? -5_000 : 5_000;
    setEditorState((current) => {
      const boundary = current.boundaries[candidateId];
      if (boundary === undefined) return current;
      const transition = applyCandidateBoundaryCommand(boundary, {
        boundarySessionId: boundary.boundarySessionId,
        candidateId,
        expectedRevision: boundary.revision,
        kind: edge === "start" ? "SHIFT_START" : "SHIFT_END",
        deltaMs: boundedDelta,
      });
      if (transition.status !== "applied") return current;
      return {
        ...current,
        boundaries: {
          ...current.boundaries,
          [candidateId]: transition.state,
        },
      };
    });
  };

  const undoDecision = (): void => {
    if (undo === null) return;
    setEditorState((current) => ({
      ...current,
      decisions: {
        ...current.decisions,
        [undo.candidateId]: undo.previous,
      },
    }));
    setFocusedCandidateId(undo.candidateId);
    setUndo(null);
  };

  const resetFocused = (): void => {
    if (focused === undefined) return;
    const proposal = initialBoundary(
      projection.candidates.find(({ id }) => id === focused.id) ?? focused,
      bundle.sourceDurationMs,
      artifactDigest,
    );
    setEditorState((current) => ({
      decisions: { ...current.decisions, [focused.id]: "pending" },
      boundaries: { ...current.boundaries, [focused.id]: proposal },
    }));
    setUndo(null);
  };

  useReviewShortcuts({
    active: candidates.length > 0,
    helpOpen: false,
    canUndo: undo !== null,
    toggleHelp: () => undefined,
    closeHelp: () => undefined,
    togglePlayback: () => playbackTogglerRef.current?.(),
    focusPreviousCandidate: () => focusRelative(-1),
    focusNextCandidate: () => focusRelative(1),
    nudgeStart: (direction) => {
      if (focused !== undefined) {
        trim(focused.id, "start", direction * BOUNDARY_NUDGE_MS);
      }
    },
    nudgeEnd: (direction) => {
      if (focused !== undefined) {
        trim(focused.id, "end", direction * BOUNDARY_NUDGE_MS);
      }
    },
    moveItemFocus: (delta) => itemFocusMoverRef.current?.(delta),
    toggleApprove: () => {
      if (focused !== undefined) {
        decide(focused.id, focused.decision === "used" ? "pending" : "used");
      }
    },
    toggleReject: () => {
      if (focused !== undefined) {
        decide(
          focused.id,
          focused.decision === "dropped" ? "pending" : "dropped",
        );
      }
    },
    undo: undoDecision,
    page,
    setPage,
    resetConfirmOpen,
    openResetConfirm: () => setResetConfirmOpen(true),
    confirmReset: () => {
      setResetConfirmOpen(false);
      resetFocused();
    },
    cancelReset: () => setResetConfirmOpen(false),
  });

  const ko = analysisLanguage === "ko";
  return (
    <main className="prv">
      <header className="prv-toolbar">
        <div>
          <span className="prv-eyebrow">
            {ko ? "사전 분석 완료" : "Prepared analysis ready"}
          </span>
          <strong>{sourceTitle}</strong>
          <span>
            {ko
              ? "저장된 전체 맥락과 화면·대사 검증본을 불러왔어요."
              : "Loaded the saved whole-context, frames, and dialogue review."}
          </span>
        </div>
        <div className="prv-tools">
          <div className="prv-language" role="group" aria-label={ko ? "언어 선택" : "Language"}>
            {(["ko", "en"] as const).map((language) => (
              <button
                key={language}
                type="button"
                data-active={analysisLanguage === language}
                aria-pressed={analysisLanguage === language}
                onClick={() => onLanguageChange(language)}
              >
                {language === "ko" ? "한국어" : "English"}
              </button>
            ))}
          </div>
          <button className="prv-exit" type="button" onClick={onExit}>
            {ko ? "다른 영상" : "Another video"}
          </button>
        </div>
      </header>

      {projection.outcome === "verified-empty" ? (
        <section className="prv-empty" aria-labelledby="prv-empty-title">
          <span aria-hidden="true">✓</span>
          <div>
            <h1 id="prv-empty-title">
              {ko ? "검증된 클립 후보가 없어요" : "No verified clip candidates"}
            </h1>
            <p>{projection.display.broadcastSummaryKo}</p>
            <small>
              {ko
                ? "분석 실패가 아니라 전체 흐름·화면·대사 검증을 마친 결과입니다."
                : "This is a completed verified-empty result, not an analysis failure."}
            </small>
          </div>
        </section>
      ) : (
        <ReviewStage
          sourceTitle={sourceTitle}
          sourceDurationMs={bundle.sourceDurationMs}
          candidates={candidates}
          focusedCandidateId={focusedCandidateId}
          onFocusCandidateId={setFocusedCandidateId}
          streamerName={
            projection.display.streamerNameKo ??
            projection.display.sourceDisplayNameKo
          }
          {...(videoSrc === undefined ? {} : { videoSrc })}
          {...(videoSrc === undefined ? { youtubeVideoId } : {})}
          onDecide={decide}
          onTrim={trim}
          onUndo={undoDecision}
          canUndo={undo !== null}
          onToggleTheme={onToggleTheme}
          themeLabel={themeLabel}
          page={page}
          onPageChange={setPage}
          resetConfirmOpen={resetConfirmOpen}
          onResetConfirmOpen={() => setResetConfirmOpen(true)}
          onResetConfirm={() => {
            setResetConfirmOpen(false);
            resetFocused();
          }}
          onResetCancel={() => setResetConfirmOpen(false)}
          onItemFocusMover={(move) => {
            itemFocusMoverRef.current = move;
          }}
          onPlaybackToggler={(toggle) => {
            playbackTogglerRef.current = toggle;
          }}
        />
      )}
    </main>
  );
}
