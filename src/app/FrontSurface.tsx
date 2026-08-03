/**
 * FrontSurface — the input and analysis work surface.
 *
 * This component deliberately knows nothing about the analysis domain model.
 * App projects durable state into this small display contract and receives
 * user intents back. That keeps the front screen replaceable without creating
 * a second owner for source, run, recovery, or publication state.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  FrontLanguage,
  FrontPreanalysisLaneViewModel,
  FrontPreanalysisViewStatus,
  FrontProgressTrackViewModel,
  FrontRecoveryActionId,
  FrontSourceViewModel,
  FrontSurfaceViewModel,
  FrontTopicRangeViewModel,
} from "./frontSurfaceModel";

export interface FrontEvidenceRange {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly label?: string;
}

export interface FrontScopeSummary {
  readonly startMs: number;
  readonly endMs: number;
  readonly quote?: string;
  readonly summary: string;
}

export interface FrontParticipantSummary {
  readonly id: string;
  readonly name?: string;
  readonly role: string;
  readonly detail?: string;
  readonly imageUrl?: string;
}

export interface FrontSupplementalPanels {
  /** Primary empty-state entry for an already prepared replay. */
  readonly entry?: ReactNode;
  /** Input controls and provenance that do not belong on the main path. */
  readonly connections?: ReactNode;
  readonly history?: ReactNode;
  readonly details?: ReactNode;
}

export interface FrontSurfaceProps {
  /** The sole source for phase, copy, source facts, progress, and topic data. */
  readonly model: FrontSurfaceViewModel;
  readonly evidenceRanges?: readonly FrontEvidenceRange[];
  readonly selectedTopicId?: string | null;
  readonly scope?: FrontScopeSummary | null;
  readonly participants?: readonly FrontParticipantSummary[];
  readonly panels?: FrontSupplementalPanels;
  readonly themeLabel?: string;
  readonly accept?: string;
  readonly onSelectSourceFile: (file: File) => void;
  readonly onChangeSource?: () => void;
  readonly onCancelInspection?: () => void;
  readonly onStartAnalysis?: () => void;
  /** Localized explanation shown when setup is still settling and start is disabled. */
  readonly startBlocker?: string;
  readonly onStopAnalysis?: () => void;
  readonly onRecoveryAction?: (actionId: FrontRecoveryActionId) => void;
  readonly onSelectTopic?: (topicId: string) => void;
  readonly onLanguageChange?: (language: FrontLanguage) => void;
  /** The analysis output language is immutable once a source/run exists. */
  readonly languageLocked?: boolean;
  readonly onToggleTheme?: () => void;
  readonly onHistoryRequest?: () => void;
  readonly onConnectionsRequest?: (target: "summary" | "youtube" | "chat") => void;
  readonly onDetailsRequest?: () => void;
}

type SheetKind = "connections" | "history" | "details";
type IconName =
  | "add"
  | "arrow"
  | "chat"
  | "close"
  | "file"
  | "history"
  | "link"
  | "moon"
  | "pause"
  | "retry";

const COPY = {
  ko: {
    productSubtitle: "클립 분석 AI",
    history: "이력",
    historyAria: "저장된 분석 이력 열기",
    theme: "테마 전환",
    korean: "한국어",
    english: "English",
    languageGroup: "분석 언어",
    newAnalysis: "새 분석",
    emptyTitle: "방송 원본을 선택해 주세요",
    emptyDescription: "고르면 저장된 자막과 화면 지문을 먼저 대조합니다.",
    sourceLimit: "최대 12시간 · MP4, WebM 권장",
    dropTitle: "영상 파일을 놓거나 선택",
    chooseFile: "영상 파일 고르기",
    youtube: "YouTube 다시보기",
    youtubeDetail: "주소를 알고 있을 때만 연결",
    chzzk: "CHZZK 채팅",
    chzzkDetail: "있으면 반응 신호에 함께 사용",
    pastAnalysis: "지난 분석",
    pastAnalysisDetail: "저장된 작업을 이어서 검토",
    add: "추가",
    open: "열기",
    cancelInspection: "확인 취소",
    startAnalysis: "AI로 하이라이트 찾기",
    startUnavailable: "준비 중인 자료 확인이 끝나면 시작할 수 있어요.",
    changeSource: "원본 바꾸기",
    newSource: "새 영상 분석하기",
    connections: "자료 연결",
    connectionDetails: "자료 연결 세부 정보",
    progressUnknown: "진행 중",
    flowTitle: "방송 흐름",
    flowDescription: "주제는 확인되는 즉시 나타나고, 최종 장면은 분석이 끝난 뒤 공개됩니다.",
    flowEmpty: "확인된 주제가 이 시간 위치에 나타납니다.",
    exploring: "확인 중",
    topicLegend: "확인된 주제",
    evidenceLegend: "대사·화면 근거",
    exploringLegend: "탐색 중",
    safelyStop: "안전하게 멈추기",
    retry: "다시 시도",
    connectionHeading: "자료 연결",
    selectedTopic: "선택한 주제",
    currentScope: "지금 확인하는 범위",
    noScope: "다음 맥락 범위를 준비하고 있어요.",
    participants: "맥락에 전달할 인물",
    noParticipants: "확인된 등장인물이 없습니다.",
    unknownPerson: "이름 미확인",
    moreDetails: "세부 진행 보기",
    connectionsSheet: "자료 연결",
    historySheet: "지난 분석",
    detailsSheet: "세부 진행",
    closeSheet: "닫기",
    noHistory: "이 브라우저에 저장된 분석 이력이 없습니다.",
    noConnections: "추가로 연결된 자료가 없습니다.",
    noDetails: "표시할 세부 진행 기록이 없습니다.",
    connected: "연결됨",
    checking: "확인 중",
    pending: "분석 예정",
    unavailable: "사용 안 함",
    error: "확인 필요",
    sourceFallback: "선택한 방송",
    sourceReady: "원본 준비 완료",
  },
  en: {
    productSubtitle: "Clip analysis AI",
    history: "History",
    historyAria: "Open saved analysis history",
    theme: "Switch theme",
    korean: "한국어",
    english: "English",
    languageGroup: "Analysis language",
    newAnalysis: "New analysis",
    emptyTitle: "Choose a broadcast recording",
    emptyDescription: "ExClipper checks saved captions and visual fingerprints first.",
    sourceLimit: "Up to 12 hours · MP4 or WebM recommended",
    dropTitle: "Drop or choose a video file",
    chooseFile: "Choose video file",
    youtube: "YouTube VOD",
    youtubeDetail: "Connect only when you know the URL",
    chzzk: "CHZZK chat",
    chzzkDetail: "Adds viewer reactions when available",
    pastAnalysis: "Past analysis",
    pastAnalysisDetail: "Continue a saved editing session",
    add: "Add",
    open: "Open",
    cancelInspection: "Cancel check",
    startAnalysis: "Find highlights with AI",
    startUnavailable: "Analysis can start after the pending material check finishes.",
    changeSource: "Change source",
    newSource: "Analyse another video",
    connections: "Connections",
    connectionDetails: "Connection details",
    progressUnknown: "In progress",
    flowTitle: "Broadcast flow",
    flowDescription: "Topics appear as they are verified. Final moments appear only after analysis finishes.",
    flowEmpty: "Verified topics will appear at their source times.",
    exploring: "Checking",
    topicLegend: "Verified topic",
    evidenceLegend: "Dialogue · visual evidence",
    exploringLegend: "Exploring",
    safelyStop: "Stop safely",
    retry: "Retry",
    connectionHeading: "Connections",
    selectedTopic: "Selected topic",
    currentScope: "Range being checked",
    noScope: "Preparing the next context range.",
    participants: "People sent into context",
    noParticipants: "No people were identified.",
    unknownPerson: "Name unknown",
    moreDetails: "View detailed progress",
    connectionsSheet: "Connections",
    historySheet: "Past analysis",
    detailsSheet: "Detailed progress",
    closeSheet: "Close",
    noHistory: "No analysis history is saved in this browser.",
    noConnections: "No additional material is connected.",
    noDetails: "No detailed progress is available.",
    connected: "Connected",
    checking: "Checking",
    pending: "Planned",
    unavailable: "Not used",
    error: "Needs attention",
    sourceFallback: "Selected broadcast",
    sourceReady: "Source ready",
  },
} as const;

function clampRatio(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

const TIMELINE_LABEL_STEPS_MS = [5, 10, 15, 30, 60, 120, 180, 240].map(
  (minutes) => minutes * 60_000,
);
const HALF_HOUR_MS = 30 * 60_000;

function buildTimelineScale(durationMs: number): {
  readonly labels: readonly number[];
  readonly gridStepPercent: number;
} {
  if (durationMs <= 0) return { labels: [0], gridStepPercent: 100 };

  const targetStep = durationMs / 6;
  const labelStep =
    TIMELINE_LABEL_STEPS_MS.find((step) => step >= targetStep) ??
    TIMELINE_LABEL_STEPS_MS[TIMELINE_LABEL_STEPS_MS.length - 1] ??
    durationMs;
  const labels: number[] = [];
  for (let time = 0; time < durationMs; time += labelStep) labels.push(time);
  const last = labels[labels.length - 1] ?? 0;
  if (durationMs - last < labelStep * 0.38 && labels.length > 1) {
    labels[labels.length - 1] = durationMs;
  } else if (last !== durationMs) {
    labels.push(durationMs);
  }

  const gridStepMs = durationMs >= HALF_HOUR_MS ? HALF_HOUR_MS : labelStep;
  return {
    labels,
    gridStepPercent: Math.min(100, Math.max(0.35, (gridStepMs / durationMs) * 100)),
  };
}

function packTopicLanes(topics: readonly FrontTopicRangeViewModel[]): {
  readonly laneById: ReadonlyMap<string, number>;
  readonly laneCount: number;
} {
  const laneEnds: number[] = [];
  const laneById = new Map<string, number>();
  const minimumVisualRatio = 0.12;

  for (const topic of [...topics].sort(
    (left, right) => left.startRatio - right.startRatio || left.endRatio - right.endRatio,
  )) {
    const visualEnd = Math.min(
      1,
      Math.max(topic.endRatio, topic.startRatio + minimumVisualRatio),
    );
    let lane = laneEnds.findIndex((end) => end + 0.012 <= topic.startRatio);
    if (lane < 0 && laneEnds.length < 4) lane = laneEnds.length;
    if (lane < 0) {
      lane = laneEnds.reduce(
        (best, end, index) => (end < (laneEnds[best] ?? Number.POSITIVE_INFINITY) ? index : best),
        0,
      );
    }
    laneEnds[lane] = visualEnd;
    laneById.set(topic.id, lane);
  }

  return { laneById, laneCount: Math.max(1, laneEnds.length) };
}

function FrontIcon({ name }: { readonly name: IconName }): ReactElement {
  const pathByName: Readonly<Record<IconName, ReactNode>> = {
    add: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 18 6-6-6-6" />,
    chat: <path d="M5 17.5 3.5 21l4.1-1.8A9 9 0 1 0 5 17.5Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    file: <path d="M7 3h7l4 4v14H7zM14 3v5h5" />,
    history: <path d="M3.5 12a8.5 8.5 0 1 0 2.1-5.6L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2" />,
    link: <path d="M10 13a4 4 0 0 0 5.7 0l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2" />,
    moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    retry: <path d="M20 7v5h-5M4 17v-5h5M18.6 9A7 7 0 0 0 6.2 6.4L4 9M5.4 15A7 7 0 0 0 17.8 17.6L20 15" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      {pathByName[name]}
    </svg>
  );
}

function connectionStateLabel(
  state: FrontPreanalysisViewStatus,
  language: FrontLanguage,
): string {
  const copy = COPY[language];
  if (state === "ready") return copy.connected;
  if (state === "checking") return copy.checking;
  if (state === "error") return copy.error;
  if (state === "unavailable" || state === "incompatible") return copy.unavailable;
  return copy.pending;
}

function ConnectionList({
  items,
  language,
}: {
  readonly items: readonly FrontPreanalysisLaneViewModel[];
  readonly language: FrontLanguage;
}): ReactElement {
  const copy = COPY[language];
  if (items.length === 0) return <p className="frt-empty-note">{copy.noConnections}</p>;

  return (
    <ul className="frt-connection-list">
      {items.map((item) => (
        <li key={item.id} data-state={item.state}>
          <span className="frt-state-mark" aria-hidden="true" />
          <span className="frt-connection-copy">
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </span>
          <span className="frt-connection-state">
            {connectionStateLabel(item.state, language)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProgressTrackList({
  tracks,
  emptyLabel,
}: {
  readonly tracks: readonly FrontProgressTrackViewModel[];
  readonly emptyLabel: string;
}): ReactElement {
  if (tracks.length === 0) return <p className="frt-empty-note">{emptyLabel}</p>;

  return (
    <ul className="frt-track-list">
      {tracks.map((track) => {
        const ratio = clampRatio(track.ratio);
        const percent = Math.round((ratio ?? 0) * 100);
        return (
          <li key={track.id}>
            <span className="frt-track-heading">
              <strong>{track.label}</strong>
              <small>{track.status}</small>
            </span>
            <span
              className="frt-track-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ratio === null ? undefined : percent}
              aria-valuetext={ratio === null ? track.status : `${percent}%`}
              aria-label={`${track.label} · ${track.status}`}
              data-indeterminate={ratio === null}
            >
              <i style={{ inlineSize: `${percent}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FrontSheet({
  title,
  closeLabel,
  onClose,
  children,
}: {
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="frt-sheet-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="frt-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="frt-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={closeLabel}>
            <FrontIcon name="close" />
          </button>
        </header>
        <div className="frt-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function SourceRibbon({
  source,
  identityLabel,
  fallbackLabel,
  readyLabel,
  changeLabel,
  showChange,
  onChangeSource,
}: {
  readonly source: FrontSourceViewModel | null;
  readonly identityLabel?: string;
  readonly fallbackLabel: string;
  readonly readyLabel: string;
  readonly changeLabel: string;
  readonly showChange: boolean;
  readonly onChangeSource?: () => void;
}): ReactElement {
  return (
    <div className="frt-source-ribbon">
      <span className="frt-source-icon">
        <FrontIcon name="file" />
      </span>
      <span className="frt-source-copy">
        <strong title={source?.title ?? fallbackLabel}>
          {source?.title ?? fallbackLabel}
        </strong>
        <small>
          {[source?.durationLabel, source?.sizeLabel].filter(Boolean).join(" · ") || readyLabel}
        </small>
      </span>
      {identityLabel !== undefined && (
        <span className="frt-source-identity">{identityLabel}</span>
      )}
      {showChange && onChangeSource !== undefined && (
        <button className="frt-quiet-button" type="button" onClick={onChangeSource}>
          {changeLabel}
        </button>
      )}
    </div>
  );
}

export function FrontSurface({
  model,
  evidenceRanges = [],
  selectedTopicId = null,
  scope = null,
  participants = [],
  panels,
  themeLabel,
  accept = "video/*,.mp4,.webm",
  onSelectSourceFile,
  onChangeSource,
  onCancelInspection,
  onStartAnalysis,
  startBlocker,
  onStopAnalysis,
  onRecoveryAction,
  onSelectTopic,
  onLanguageChange,
  languageLocked = false,
  onToggleTheme,
  onHistoryRequest,
  onConnectionsRequest,
  onDetailsRequest,
}: FrontSurfaceProps): ReactElement {
  const {
    mode: phase,
    language,
    stage,
    source,
    progress,
    preanalysis: connections,
    tracks: progressTracks,
    topics,
    topicStatus,
    recovery,
  } = model;
  const copy = COPY[language];
  const fileInputId = useId();
  const startBlockerId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const progressRatio = clampRatio(progress?.ratio);
  const progressPercent =
    progress?.percent ?? Math.round((progressRatio ?? 0) * 100);
  const visibleStartBlocker =
    startBlocker ??
    (onStartAnalysis === undefined ? copy.startUnavailable : undefined);
  const selectedTopic = topics.find(({ id }) => id === selectedTopicId) ?? null;
  const durationMs = Math.max(0, source?.durationMs ?? 0);
  const timelineScale = buildTimelineScale(durationMs);
  const topicLanes = packTopicLanes(topics);
  const identityLane = connections.find(({ id }) => id === "video-identity");
  const verifiedIdentityLabel =
    identityLane?.state === "ready" ? identityLane.label : undefined;

  const requestSheet = (
    kind: SheetKind,
    request?: () => void,
  ): void => {
    request?.();
    setSheet(kind);
  };

  const requestConnections = (target: "summary" | "youtube" | "chat"): void => {
    requestSheet("connections", () => onConnectionsRequest?.(target));
  };

  const handleFiles = (files: FileList | null): void => {
    const file = files?.item(0);
    if (file !== null && file !== undefined) onSelectSourceFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const renderStatusHeading = (headingId: string): ReactElement => (
    <header className="frt-status-heading">
      <div>
        <p>{stage.eyebrow}</p>
        <h1 id={headingId}>{stage.title}</h1>
        <span>{stage.description}</span>
      </div>
      {(phase === "running" || phase === "recoverable") && progress !== null && (
        <div className="frt-eta">
          <strong>{progress.remainingLabel ?? copy.progressUnknown}</strong>
          <small>
            {progress.percent === null ? copy.progressUnknown : `${progress.percent}%`}
          </small>
        </div>
      )}
    </header>
  );

  const renderProgress = (forceIndeterminate = false): ReactElement => {
    const indeterminate = forceIndeterminate || progress?.indeterminate === true;
    return (
      <div
        className="frt-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : progressPercent}
        aria-valuetext={indeterminate ? copy.progressUnknown : `${progressPercent}%`}
        aria-label={stage.title}
        data-indeterminate={indeterminate}
      >
        <i style={{ inlineSize: `${progressPercent}%` }} />
      </div>
    );
  };

  const renderTimeline = (): ReactElement => {
    return (
      <section className="frt-flow" aria-labelledby="frt-flow-heading">
        <header>
          <div>
            <h2 id="frt-flow-heading">{copy.flowTitle}</h2>
            <p>{copy.flowDescription}</p>
          </div>
          <span className="frt-topic-status" data-state={topicStatus.state}>
            {topicStatus.label}
          </span>
        </header>
        <div className="frt-timeline-scroll" tabIndex={0} aria-label={copy.flowTitle}>
          <div className="frt-timeline">
            <div className="frt-time-labels" aria-hidden="true">
              {timelineScale.labels.map((tick, index) => (
                <time
                  key={`${index}-${tick}`}
                  data-edge={index === 0 ? "start" : index === timelineScale.labels.length - 1 ? "end" : undefined}
                  style={{ insetInlineStart: `${durationMs === 0 ? 0 : (tick / durationMs) * 100}%` }}
                >
                  {formatTime(tick)}
                </time>
              ))}
            </div>
            <div
              className="frt-time-ruler"
              aria-hidden="true"
              style={{ "--frt-grid-step": `${timelineScale.gridStepPercent}%` } as CSSProperties}
            />
            <div
              className="frt-topic-track"
              data-empty={topics.length === 0}
              data-state={topicStatus.state}
              style={{ "--frt-topic-track-height": `${12 + topicLanes.laneCount * 64}px` } as CSSProperties}
            >
              {topics.length === 0 && (
                <p>{topicStatus.label || copy.flowEmpty}</p>
              )}
              {topics.map((topic) => {
                const left = topic.startRatio * 100;
                const right = topic.endRatio * 100;
                const width = Math.max(1.5, right - left);
                const lane = topicLanes.laneById.get(topic.id) ?? 0;
                const topicStyle = {
                  "--frt-topic-left": `${Math.min(100, left)}%`,
                  "--frt-topic-width": `${Math.min(100 - left, width)}%`,
                  "--frt-topic-top": `${12 + lane * 64}px`,
                } as CSSProperties;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    className="frt-topic"
                    style={topicStyle}
                    data-family={topic.family}
                    aria-pressed={topic.id === selectedTopicId}
                    aria-label={`${topic.title}, ${formatTime(topic.startMs)}–${formatTime(topic.endMs)}, ${topic.summary}`}
                    disabled={onSelectTopic === undefined}
                    onClick={() => onSelectTopic?.(topic.id)}
                  >
                    <strong>{topic.title}</strong>
                    <small>{topic.summary}</small>
                  </button>
                );
              })}
            </div>
            <div className="frt-evidence-track">
              {evidenceRanges.map((evidence) => {
                const left = durationMs === 0 ? 0 : (Math.max(0, evidence.startMs) / durationMs) * 100;
                const right =
                  durationMs === 0
                    ? left
                    : (Math.min(durationMs, evidence.endMs) / durationMs) * 100;
                return (
                  <span
                    key={evidence.id}
                    aria-hidden="true"
                    title={evidence.label}
                    style={{
                      insetInlineStart: `${Math.min(100, left)}%`,
                      inlineSize: `${Math.max(0.8, Math.min(100 - left, right - left))}%`,
                    }}
                  />
                );
              })}
            </div>
            <div className="frt-map-legend">
              <span><i data-kind="topic" />{copy.topicLegend}</span>
              <span><i data-kind="evidence" />{copy.evidenceLegend}</span>
              {topicStatus.state === "waiting" && (
                <span><i data-kind="exploring" />{copy.exploringLegend}</span>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderInspector = (): ReactElement => (
    <aside className="frt-inspector" aria-label={copy.connectionHeading}>
      <section>
        <h2>{copy.connectionHeading}</h2>
        <ConnectionList items={connections} language={language} />
      </section>

      <section className="frt-scope">
        <h2>{selectedTopic === null ? copy.currentScope : copy.selectedTopic}</h2>
        {selectedTopic !== null ? (
          <>
            <time>{formatTime(selectedTopic.startMs)}–{formatTime(selectedTopic.endMs)}</time>
            <strong>{selectedTopic.title}</strong>
            <p>{selectedTopic.summary}</p>
          </>
        ) : scope !== null ? (
          <>
            <time>{formatTime(scope.startMs)}–{formatTime(scope.endMs)}</time>
            {scope.quote !== undefined && <blockquote>{scope.quote}</blockquote>}
            <p>{scope.summary}</p>
          </>
        ) : (
          <p>{copy.noScope}</p>
        )}
      </section>

      <section className="frt-participants">
        <h2>{copy.participants}</h2>
        {participants.length === 0 ? (
          <p className="frt-empty-note">{copy.noParticipants}</p>
        ) : (
          <ul>
            {participants.map((participant) => (
              <li key={participant.id}>
                <span className="frt-avatar" aria-hidden="true">
                  {participant.imageUrl === undefined ? (
                    (participant.name ?? copy.unknownPerson).slice(0, 1)
                  ) : (
                    <img src={participant.imageUrl} alt="" />
                  )}
                </span>
                <span>
                  <strong>{participant.name ?? copy.unknownPerson}</strong>
                  <small>
                    {[participant.role, participant.detail].filter(Boolean).join(" · ")}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="frt-detail-button"
        type="button"
        onClick={() => requestSheet("details", onDetailsRequest)}
      >
        {copy.moreDetails}
        <FrontIcon name="arrow" />
      </button>
    </aside>
  );

  const renderEmpty = (): ReactElement => (
    <section
      className="frt-surface frt-empty"
      aria-labelledby="frt-empty-heading"
      data-has-entry={panels?.entry !== undefined}
    >
      <header className="frt-empty-heading">
        <p>{stage.eyebrow}</p>
        <h1 id="frt-empty-heading">{stage.title}</h1>
        <span>{copy.sourceLimit}</span>
      </header>

      <div
        className="frt-dropzone"
        data-drag-active={dragActive}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <span className="frt-drop-icon"><FrontIcon name="add" /></span>
        <strong>{copy.dropTitle}</strong>
        <small>{stage.description}</small>
        <button className="frt-primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
          {copy.chooseFile}
        </button>
      </div>

      {panels?.entry}

      <nav className="frt-source-options" aria-label={copy.connections}>
        <button type="button" onClick={() => requestConnections("chat")}>
          <FrontIcon name="chat" />
          <span><strong>{copy.chzzk}</strong><small>{copy.chzzkDetail}</small></span>
          <em>{copy.add}</em>
        </button>
        <button type="button" onClick={() => requestSheet("history", onHistoryRequest)}>
          <FrontIcon name="history" />
          <span><strong>{copy.pastAnalysis}</strong><small>{copy.pastAnalysisDetail}</small></span>
          <em>{copy.open}</em>
        </button>
      </nav>
    </section>
  );

  const renderInspecting = (): ReactElement => (
    <section className="frt-surface" aria-labelledby="frt-status-title">
      <SourceRibbon
        source={source}
        {...(verifiedIdentityLabel === undefined
          ? {}
          : { identityLabel: verifiedIdentityLabel })}
        fallbackLabel={copy.sourceFallback}
        readyLabel={copy.sourceReady}
        changeLabel={copy.changeSource}
        showChange={false}
      />
      <div className="frt-centered-state">
        <span className="frt-working-mark" aria-hidden="true" />
        {renderStatusHeading("frt-status-title")}
        {renderProgress(true)}
        {progress !== null && <p className="frt-current-activity">{progress.currentTask}</p>}
        {onCancelInspection !== undefined && (
          <button className="frt-quiet-button frt-state-action" type="button" onClick={onCancelInspection}>
            {copy.cancelInspection}
          </button>
        )}
      </div>
    </section>
  );

  const renderReady = (): ReactElement => (
    <section className="frt-surface frt-surface--ready" aria-labelledby="frt-ready-title">
      <SourceRibbon
        source={source}
        {...(verifiedIdentityLabel === undefined
          ? {}
          : { identityLabel: verifiedIdentityLabel })}
        fallbackLabel={copy.sourceFallback}
        readyLabel={copy.sourceReady}
        changeLabel={copy.changeSource}
        showChange
        {...(onChangeSource === undefined ? {} : { onChangeSource })}
      />
      <div className="frt-ready">
        <div>{renderStatusHeading("frt-ready-title")}</div>
        <div className="frt-ready-connections">
          <ConnectionList items={connections} language={language} />
        </div>
        <div className="frt-ready-actions">
          <button
            className="frt-text-button"
            type="button"
            onClick={() => requestConnections("summary")}
          >
            {copy.connectionDetails}
            <FrontIcon name="arrow" />
          </button>
          <span className="frt-start-action">
            <button
              className="frt-primary-button"
              type="button"
              disabled={onStartAnalysis === undefined}
              {...(visibleStartBlocker === undefined
                ? {}
                : { "aria-describedby": startBlockerId })}
              onClick={onStartAnalysis}
            >
              {copy.startAnalysis}
            </button>
            {visibleStartBlocker !== undefined && (
              <small id={startBlockerId} role="status">
                {visibleStartBlocker}
              </small>
            )}
          </span>
        </div>
      </div>
    </section>
  );

  const renderAnalysis = (): ReactElement => (
    <section className="frt-surface" aria-labelledby="frt-analysis-title">
      <SourceRibbon
        source={source}
        {...(verifiedIdentityLabel === undefined
          ? {}
          : { identityLabel: verifiedIdentityLabel })}
        fallbackLabel={copy.sourceFallback}
        readyLabel={copy.sourceReady}
        changeLabel={copy.changeSource}
        showChange={false}
      />
      <div className="frt-analysis-layout">
        <article className="frt-analysis-main">
          <div>{renderStatusHeading("frt-analysis-title")}</div>
          {renderProgress()}
          {progress !== null && (
            <div className="frt-live-status" aria-live="polite">
              <span>{progress.currentTask}</span>
              <small>{progress.checkpointLabel}</small>
            </div>
          )}

          {phase === "recoverable" && (
            <div className="frt-recovery" role="alert">
              <span><FrontIcon name="retry" /></span>
              <div>
                <strong>{recovery?.title ?? stage.title}</strong>
                <small>{recovery?.detail ?? progress?.checkpointLabel}</small>
              </div>
              <button
                className="frt-primary-button"
                type="button"
                disabled={onRecoveryAction === undefined || recovery === null}
                onClick={() => {
                  if (recovery?.primaryAction.id === "choose-source") {
                    fileInputRef.current?.click();
                    return;
                  }
                  if (recovery !== null) onRecoveryAction?.(recovery.primaryAction.id);
                }}
              >
                {recovery?.primaryAction.label ?? copy.retry}
              </button>
            </div>
          )}

          {renderTimeline()}

          {((phase === "running" && onStopAnalysis !== undefined) ||
            (phase === "zero" && onChangeSource !== undefined)) && (
            <footer className="frt-analysis-footer">
              {phase === "running" && onStopAnalysis !== undefined && (
              <button className="frt-quiet-button" type="button" onClick={onStopAnalysis}>
                <FrontIcon name="pause" />
                {copy.safelyStop}
              </button>
              )}
              {phase === "zero" && onChangeSource !== undefined && (
                <button className="frt-primary-button" type="button" onClick={onChangeSource}>
                  {copy.newSource}
                </button>
              )}
            </footer>
          )}
        </article>
        {renderInspector()}
      </div>
    </section>
  );

  const sheetContent = (): ReactNode => {
    if (sheet === "connections") {
      return panels?.connections ?? <ConnectionList items={connections} language={language} />;
    }
    if (sheet === "history") {
      return panels?.history ?? <p className="frt-empty-note">{copy.noHistory}</p>;
    }
    return (
      panels?.details ?? (
        <ProgressTrackList tracks={progressTracks} emptyLabel={copy.noDetails} />
      )
    );
  };

  const sheetTitle =
    sheet === "connections"
      ? copy.connectionsSheet
      : sheet === "history"
        ? copy.historySheet
        : copy.detailsSheet;

  return (
    <div className="frt-app" data-phase={phase}>
      <input
        id={fileInputId}
        ref={fileInputRef}
        className="frt-visually-hidden"
        type="file"
        accept={accept}
        onChange={(event) => {
          handleFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <header className="frt-app-header">
        <div className="frt-brand">
          <strong>Ex<span>Clipper</span></strong>
          <i aria-hidden="true" />
          <b>{copy.productSubtitle}</b>
        </div>

        <span className="frt-stage-chip">
          <b>{stage.index} / {stage.total}</b>
          <span>· {stage.eyebrow}</span>
        </span>

        <div className="frt-header-tools">
          <button
            className="frt-history-button"
            type="button"
            onClick={() => requestSheet("history", onHistoryRequest)}
            aria-label={copy.historyAria}
          >
            <FrontIcon name="history" />
            <span>{copy.history}</span>
          </button>
          <div className="frt-language" role="group" aria-label={copy.languageGroup}>
            <button
              type="button"
              aria-pressed={language === "ko"}
              disabled={languageLocked}
              onClick={() => onLanguageChange?.("ko")}
            >
              {copy.korean}
            </button>
            <button
              type="button"
              aria-pressed={language === "en"}
              disabled={languageLocked}
              onClick={() => onLanguageChange?.("en")}
            >
              {copy.english}
            </button>
          </div>
          <button
            className="frt-theme-button"
            type="button"
            disabled={onToggleTheme === undefined}
            onClick={onToggleTheme}
            aria-label={themeLabel ?? copy.theme}
            title={themeLabel ?? copy.theme}
          >
            <FrontIcon name="moon" />
          </button>
        </div>
      </header>

      <main className="frt-stage">
        {phase === "empty" && renderEmpty()}
        {phase === "inspecting" && renderInspecting()}
        {phase === "ready" && renderReady()}
        {(phase === "running" || phase === "recoverable" || phase === "zero") && renderAnalysis()}
      </main>

      {sheet !== null && (
        <FrontSheet title={sheetTitle} closeLabel={copy.closeSheet} onClose={closeSheet}>
          {sheetContent()}
        </FrontSheet>
      )}
    </div>
  );
}
