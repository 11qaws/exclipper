/**
 * ReviewSurface — the rebuilt review screen.
 *
 * Presentational by design: it takes a view model and emits intents. All
 * analysis types stay on the App side, so this file never has to track their
 * churn, and the screen can be rendered from fixtures in a harness.
 *
 * It binds no keys. The review keymap lives only in `useReviewShortcuts`, so
 * there is one table to check against the spec instead of two that drift — an
 * earlier duplicate here had already drifted in seven places. For the same
 * reason the layered states the keymap must reason about (page and reset
 * confirmation) are owned by the container and passed in, not held here.
 *
 * Motion follows §7.4: the UI is not a separate layer floating over the
 * content, it is the same space in another state. The evidence page unfolds
 * from the summary in place, and moving between candidates carries a direction.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

export type ReviewDecision = "pending" | "used" | "dropped";
export type ReviewPage = "summary" | "evidence";

export interface ReviewPerson {
  /** 이름이 확인되지 않았으면 비운다 — 화면에는 "이름 미확인"으로 나온다. */
  readonly name?: string;
  /** 진행자 / 게스트 등, 이미 확정된 표시용 문자열. */
  readonly role: string;
  readonly imageUrl?: string;
}

export interface ReviewCue {
  readonly id: string;
  readonly atMs: number;
  readonly text: string;
  /** 화자 이름이 확인된 경우에만. */
  readonly speaker?: string;
  /** 신뢰도가 낮을 때만 채운다. 높은 값은 표시하지 않는다(§6). */
  readonly lowConfidenceNote?: string;
}

export interface ReviewContextItem {
  readonly id: string;
  /** "바로 직전" 같은 추정이 아니라, 관계를 서술한 라벨. */
  readonly label: string;
  readonly text: string;
  readonly atMs: number;
}

export interface ReviewFrame {
  readonly id: string;
  readonly atMs: number;
  readonly imageUrl?: string;
}

export interface ReviewCandidate {
  readonly id: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly peakMs: number;
  readonly decision: ReviewDecision;
  /** 장면에서 실제로 벌어진 사건. */
  readonly event: string;
  /** 사건에 대한 스트리머의 반응. */
  readonly reaction: string;
  /** 편집 후보로 남길 가치. */
  readonly clipReason: string;
  /** 방송 전체 흐름 속 한 줄 위치. */
  readonly contextSummary?: string;
  /** 해당 시점의 방송 주제. */
  readonly contextTopic?: string;
  /** 실제 대사 cue에서 고른 대표 인용 한 줄(있을 때). */
  readonly quote?: string;
  readonly people: readonly ReviewPerson[];
  readonly cues: readonly ReviewCue[];
  readonly context: readonly ReviewContextItem[];
  readonly frames: readonly ReviewFrame[];
}

export interface ReviewSurfaceProps {
  readonly sourceTitle: string;
  readonly sourceDurationMs: number;
  readonly candidates: readonly ReviewCandidate[];
  readonly activeIndex: number;
  readonly page: ReviewPage;
  /** 후보 이동 방향. 전환 애니가 방향을 갖게 한다(다음=우, 이전=좌). */
  readonly lastMoveDirection?: "forward" | "back";
  readonly streamerName: string;
  readonly streamerImageUrl?: string;
  /** 재생용. 없으면 포스터 자리표시자만 보여준다. */
  readonly videoSrc?: string;
  /** 검증된 사전 분석본을 링크만으로 검토할 때 쓰는 정확한 YouTube ID. */
  readonly youtubeVideoId?: string;
  readonly onSelectIndex: (index: number) => void;
  readonly onPageChange: (page: ReviewPage) => void;
  readonly onDecide: (id: string, decision: ReviewDecision) => void;
  readonly onTrim: (id: string, edge: "start" | "end", deltaMs: number) => void;
  readonly onUndo?: () => void;
  readonly canUndo?: boolean;
  readonly onHelp?: () => void;
  readonly onToggleTheme?: () => void;
  readonly themeLabel?: string;
  /** 후보 전체 리셋 확인창 — 컨테이너가 소유. */
  readonly resetConfirmOpen: boolean;
  readonly onResetConfirmOpen: () => void;
  readonly onResetConfirm: () => void;
  readonly onResetCancel: () => void;
  /** 컨테이너가 키맵에 연결할 수 있도록, 항목 이동 함수를 넘겨준다. */
  readonly onItemFocusMover?: (move: (delta: 1 | -1) => void) => void;
  readonly onPlaybackToggler?: (toggle: () => void) => void;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function Keycap({ children }: { readonly children: string }): ReactElement {
  return <kbd className="kc">{children}</kbd>;
}

const TRIM_STEP_MS = 5_000;

export function ReviewSurface({
  sourceTitle,
  sourceDurationMs,
  candidates,
  activeIndex,
  page,
  lastMoveDirection = "forward",
  streamerName,
  streamerImageUrl,
  videoSrc,
  youtubeVideoId,
  onSelectIndex,
  onPageChange,
  onDecide,
  onTrim,
  onUndo,
  canUndo = false,
  onHelp,
  onToggleTheme,
  themeLabel,
  resetConfirmOpen,
  onResetConfirmOpen,
  onResetConfirm,
  onResetCancel,
  onItemFocusMover,
  onPlaybackToggler,
}: ReviewSurfaceProps): ReactElement {
  const active = candidates[activeIndex];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(active?.startMs ?? 0);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);

  const approvedCount = useMemo(
    () => candidates.filter((c) => c.decision === "used").length,
    [candidates],
  );
  const remainingCount = useMemo(
    () => candidates.filter((c) => c.decision === "pending").length,
    [candidates],
  );

  /*
   * Moving to another candidate resets the transient playback state — a stale
   * position from the previous clip must never look like this one's. Done while
   * rendering rather than in an effect so the stale frame is never committed.
   */
  const [syncedCandidateId, setSyncedCandidateId] = useState(active?.id);
  if (active?.id !== syncedCandidateId) {
    setSyncedCandidateId(active?.id);
    setPositionMs(active?.startMs ?? 0);
    setPlaying(false);
    setSelectedMarkId(null);
  }

  const activeCandidateId = active?.id;
  const activeCandidateStartMs = active?.startMs;
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || activeCandidateStartMs === undefined) return;

    // 후보 전환은 표시 상태뿐 아니라 실제 디코더도 함께 멈추고 이동해야 한다.
    // 그렇지 않으면 새 후보를 열었는데 이전 후보의 소리가 이어질 수 있다.
    video.pause();
    video.currentTime = activeCandidateStartMs / 1_000;
  }, [activeCandidateId, activeCandidateStartMs, videoSrc]);

  /**
   * 재생은 후보 구간 안으로 묶는다(§7.6). 구간 밖으로 흘러가면 검토 대상이
   * 아닌 장면을 보고 판단하게 된다. 트림 확인을 위해 **드래그로는** 경계 밖으로
   * 나갈 수 있게 열어 두되, 자동 재생은 끝에서 멈춘다.
   */
  const clampToClip = useCallback(
    (ms: number): number => {
      if (active === undefined) return ms;
      return Math.min(Math.max(ms, active.startMs), active.endMs);
    },
    [active],
  );

  const seek = useCallback(
    (ms: number, options?: { readonly allowOutside?: boolean }) => {
      const next = options?.allowOutside === true ? ms : clampToClip(ms);
      setPositionMs(next);
      const video = videoRef.current;
      if (video !== null) video.currentTime = next / 1000;
      if (video === null && youtubeVideoId !== undefined) {
        setPlaying(false);
      }
    },
    [clampToClip, youtubeVideoId],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      if (youtubeVideoId !== undefined) {
        setPlaying((current) => !current);
      }
      return;
    }
    if (video.paused) {
      if (active !== undefined && video.currentTime * 1000 >= active.endMs - 50) {
        video.currentTime = active.startMs / 1000;
      }
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [active, youtubeVideoId]);

  /** 근거의 모든 표기는 고정 검토 플레이어의 재생 진입점이다(§7.5). */
  const playFrom = useCallback(
    (atMs: number, markId: string) => {
      seek(atMs);
      setSelectedMarkId(markId);
    },
    [seek],
  );

  /*
   * 근거 항목 사이 이동 (§7.7). `←/→` 는 후보 축이라 쓰지 않고, `↑/↓` 와
   * `J/K` 로 옮긴다. 순서는 DOM 순서를 그대로 쓴다 — 화면에 보이는 순서가 곧
   * 이동 순서여야 예측할 수 있다.
   */
  const evidenceRef = useRef<HTMLDivElement | null>(null);
  const moveItemFocus = useCallback((delta: 1 | -1) => {
    const root = evidenceRef.current;
    if (root === null) return;
    const items = [...root.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = current === -1
      ? (delta === 1 ? 0 : items.length - 1)
      : (current + delta + items.length) % items.length;
    items[next]?.focus();
  }, []);

  // 컨테이너의 키맵이 이 함수를 부를 수 있도록 올려 보낸다. 화면만이 자기
  // DOM 순서를 알고 있으므로, 이동 자체는 여기 두고 호출권만 넘긴다.
  useEffect(() => {
    onItemFocusMover?.(moveItemFocus);
  }, [moveItemFocus, onItemFocusMover]);

  useEffect(() => {
    onPlaybackToggler?.(togglePlay);
  }, [onPlaybackToggler, togglePlay]);

  if (active === undefined) {
    return (
      <div className="rvw">
        <nav className="rvw-rail" aria-label="검토 도구">
          <span className="who" aria-hidden="true">
            {streamerImageUrl !== undefined
              ? <img src={streamerImageUrl} alt="" />
              : streamerName.slice(0, 1)}
          </span>
        </nav>
        <div className="rvw-screen">
          <div className="rvw-empty">
            <p>
              <strong>검토할 후보가 없습니다.</strong>
              분석이 후보를 만들지 못했거나, 모두 검토를 마쳤습니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const durationMs = Math.max(1, active.endMs - active.startMs);
  const playedRatio = Math.min(1, Math.max(0, (positionMs - active.startMs) / durationMs));
  const ratioOf = (atMs: number): number =>
    Math.min(1, Math.max(0, (atMs - active.startMs) / durationMs));
  const youtubeEmbedUrl = youtubeVideoId === undefined
    ? null
    : `https://www.youtube-nocookie.com/embed/${youtubeVideoId}` +
      `?start=${Math.max(0, Math.floor(positionMs / 1_000))}` +
      `&end=${Math.max(1, Math.ceil(active.endMs / 1_000))}` +
      `&autoplay=${playing ? "1" : "0"}&playsinline=1&rel=0`;

  /** 진행 바 드래그 seek. 트림 확인을 위해 경계 밖도 허용한다(§7.6). */
  const seekFromPointer = (clientX: number): void => {
    const bar = barRef.current;
    if (bar === null) return;
    const rect = bar.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    seek(active.startMs + ratio * durationMs, { allowOutside: true });
  };

  const renderPlayer = (compact = false): ReactElement => (
    <div className={`rvw-player${compact ? " compact" : ""}`}>
      <div className="rvw-media">
        {videoSrc !== undefined ? (
          <video
            ref={videoRef}
            src={videoSrc}
            onLoadedMetadata={(event) => {
              event.currentTarget.pause();
              event.currentTarget.currentTime = active.startMs / 1_000;
              setPositionMs(active.startMs);
              setPlaying(false);
            }}
            onTimeUpdate={(event) => {
              const ms = event.currentTarget.currentTime * 1_000;
              setPositionMs(ms);
              if (ms >= active.endMs) {
                event.currentTarget.pause();
                setPlaying(false);
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : youtubeEmbedUrl !== null ? (
          <iframe
            key={youtubeEmbedUrl}
            className="rvw-youtube"
            src={youtubeEmbedUrl}
            title={`${active.title} YouTube 재생`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="rvw-poster">재생할 원본이 없습니다</div>
        )}
      </div>
      <div className="rvw-pbar">
        <button
          className="rvw-play"
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="tc">{formatTime(positionMs)}</span>
        <div
          className="pb"
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="재생 위치"
          aria-valuemin={active.startMs}
          aria-valuemax={active.endMs}
          aria-valuenow={Math.round(positionMs)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) seekFromPointer(event.clientX);
          }}
        >
          <span className="played" style={{ width: `${playedRatio * 100}%` }} />
          <span className="mk peak" style={{ left: `${ratioOf(active.peakMs) * 100}%` }} />
          {active.cues.map((cue) => (
            <span key={cue.id} className="mk cue" style={{ left: `${ratioOf(cue.atMs) * 100}%` }} />
          ))}
          {active.frames.map((frame) => (
            <span key={frame.id} className="mk frame" style={{ left: `${ratioOf(frame.atMs) * 100}%` }} />
          ))}
        </div>
        <span className="tc">{formatTime(active.endMs)}</span>
      </div>
    </div>
  );

  const decisionBadge = active.decision !== "pending" && (
    <span className={`rvw-stbadge ${active.decision === "used" ? "use" : "no"}`}>
      ● {active.decision === "used" ? "사용" : "뺌"}
    </span>
  );

  const pageTabs = (
    <div className="rvw-tabs" role="tablist" aria-label="요약과 근거">
      <Keycap>Q</Keycap>
      <button
        type="button"
        role="tab"
        aria-selected={page === "summary"}
        onClick={() => onPageChange("summary")}
      >
        요약
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={page === "evidence"}
        onClick={() => onPageChange("evidence")}
      >
        근거
      </button>
    </div>
  );

  const decisionButtons = (
    <>
      <button
        type="button"
        onClick={() => onDecide(active.id, active.decision === "dropped" ? "pending" : "dropped")}
      >
        {active.decision === "dropped" ? "빼기 취소" : "빼기"}
        <Keycap>R</Keycap>
      </button>
      <button
        className="use"
        type="button"
        onClick={() => onDecide(active.id, active.decision === "used" ? "pending" : "used")}
      >
        {active.decision === "used" ? "사용 취소" : "사용"}
        <Keycap>A</Keycap>
      </button>
    </>
  );

  return (
    <div className="rvw" data-move={lastMoveDirection}>
      <nav className="rvw-rail" aria-label="검토 도구">
        <span className="who" title={streamerName}>
          {streamerImageUrl !== undefined
            ? <img src={streamerImageUrl} alt="" />
            : streamerName.slice(0, 1)}
        </span>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="방금 판단 되돌리기"
          title="되돌리기 (Z)"
        >
          ↺
        </button>
        {onHelp !== undefined && (
          <button type="button" onClick={onHelp} aria-label="단축키 도움말" title="도움말 (?)">
            ⌨
          </button>
        )}
        <span className="sp" />
        {onToggleTheme !== undefined && (
          <button type="button" onClick={onToggleTheme} aria-label={themeLabel ?? "테마 전환"}>
            ☾
          </button>
        )}
      </nav>

      <div className="rvw-screen">
        <header className="rvw-head">
          <h2 className="ttl">
            {sourceTitle}
            <span className="len">{formatTime(sourceDurationMs)}</span>
          </h2>
          <span className="chip">
            후보 <b>{activeIndex + 1}/{candidates.length}</b>
            {" · 남음 "}<b>{remainingCount}</b>
            {" · 사용 "}<b>{approvedCount}</b>
          </span>
        </header>

        {/* 화면을 보지 않는 사용자에게 후보 이동을 알린다(§2). */}
        <p className="rvw-sr" role="status" aria-live="polite">
          후보 {activeIndex + 1} / {candidates.length} · {active.title}
        </p>

        {/* 마커는 클릭으로도 후보를 옮긴다(§2) — 키보드만의 화면이 아니다. */}
        <div className="rvw-strip">
          <div className="r" aria-hidden="true" />
          {candidates.map((candidate, index) => {
            const left = `${(candidate.peakMs / Math.max(1, sourceDurationMs)) * 100}%`;
            const state = candidate.decision === "used"
              ? "ok"
              : candidate.decision === "dropped" ? "no" : "";
            const decisionLabel = candidate.decision === "used"
              ? "사용"
              : candidate.decision === "dropped" ? "뺌" : "미검토";
            return (
              <button
                key={candidate.id}
                type="button"
                className={`${state}${index === activeIndex ? " cur" : ""}`.trim()}
                style={{ left }}
                aria-current={index === activeIndex ? "true" : undefined}
                aria-label={`후보 ${index + 1} · ${candidate.title} · ${decisionLabel}`}
                onClick={() => onSelectIndex(index)}
              />
            );
          })}
        </div>
        <div className="rvw-stripmeta">
          <span>사용 ● 뺌 ✕ 미검토 ○</span>
          <span>{formatTime(active.peakMs)} / {formatTime(sourceDurationMs)}</span>
        </div>

        <div className="rvw-body" data-page={page}>
          {page === "summary" ? (
            <div className="rvw-sum" key="summary">
              <div className="rvw-stagecol">
                {renderPlayer()}

                <div className="rvw-dock">
                  <button
                    type="button"
                    onClick={() => onDecide(active.id, active.decision === "dropped" ? "pending" : "dropped")}
                  >
                    {active.decision === "dropped" ? "빼기 취소" : "빼기"}
                    <Keycap>R</Keycap>
                  </button>
                  <button type="button" onClick={togglePlay} aria-label={playing ? "일시정지" : "재생"}>
                    {playing ? "❚❚" : "▶"}
                    <Keycap>Space</Keycap>
                  </button>
                  <button
                    className="use"
                    type="button"
                    onClick={() => onDecide(active.id, active.decision === "used" ? "pending" : "used")}
                  >
                    {active.decision === "used" ? "사용 취소" : "사용"}
                    <Keycap>A</Keycap>
                  </button>
                </div>

                <div className="rvw-trim">
                  <span>앞 구간</span>
                  <button type="button" onClick={() => onTrim(active.id, "start", -TRIM_STEP_MS)}>
                    <Keycap>[</Keycap>
                  </button>
                  <button type="button" onClick={() => onTrim(active.id, "start", TRIM_STEP_MS)}>
                    <Keycap>]</Keycap>
                  </button>
                  <span>끝 구간</span>
                  <button type="button" onClick={() => onTrim(active.id, "end", -TRIM_STEP_MS)}>
                    <Keycap>⇧[</Keycap>
                  </button>
                  <button type="button" onClick={() => onTrim(active.id, "end", TRIM_STEP_MS)}>
                    <Keycap>⇧]</Keycap>
                  </button>
                  <span className="rvw-range">
                    {formatTime(active.startMs)} – {formatTime(active.endMs)}
                  </span>
                  <button
                    type="button"
                    className="rvw-reset"
                    onClick={onResetConfirmOpen}
                    aria-label="후보 전체 초기화"
                    title="후보 전체 초기화 (Backspace)"
                  >
                    ⌫
                  </button>
                </div>
              </div>

              <div className="rvw-narr">
                <div className="rvw-titlerow">
                  <div>
                    <span className="rvw-eyebrow">편집자 브리프</span>
                    <h3 className="ttl">
                      {active.title}
                      {decisionBadge}
                    </h3>
                  </div>
                  {pageTabs}
                </div>

                <div className="rvw-brieflist">
                  <section className="rvw-brief">
                    <span className="rvw-sub">무슨 일이 있었나</span>
                    <p>{active.event}</p>
                  </section>
                  <section className="rvw-brief">
                    <span className="rvw-sub">스트리머 반응</span>
                    <p>{active.reaction}</p>
                  </section>
                  <section className="rvw-brief accent">
                    <span className="rvw-sub">왜 클립인가</span>
                    <p>{active.clipReason}</p>
                  </section>
                </div>

                <section className="rvw-quotegrp">
                  <span className="rvw-sub">확인한 실제 대사</span>
                  {active.quote !== undefined
                    ? <blockquote className="rvw-quote">{active.quote}</blockquote>
                    : <p className="rvw-note">또렷하게 확인된 대사가 없습니다.</p>}
                </section>

                {(active.contextTopic !== undefined || active.contextSummary !== undefined) && (
                  <section className="rvw-contextline">
                    {active.contextTopic !== undefined && (
                      <span className="rvw-topic">{active.contextTopic}</span>
                    )}
                    {active.contextSummary !== undefined && <p>{active.contextSummary}</p>}
                    <button type="button" onClick={() => onPageChange("evidence")}>
                      근거에서 자세히
                    </button>
                  </section>
                )}

                <div className="rvw-nav">
                  <span><Keycap>←</Keycap> <Keycap>→</Keycap> 후보 이동</span>
                  <span><Keycap>Space</Keycap> 재생</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rvw-ev" key="evidence" ref={evidenceRef}>
              <div className="rvw-evhead">
                <h3 className="ttl">{active.title}{decisionBadge}</h3>
                {pageTabs}
              </div>

              <div className="rvw-evwork">
                <div className="rvw-evmain">
                  {/* 통합 타임라인: 프레임 · 대사 · 정점이 한 축 위에(§10.5) */}
                  <div className="rvw-tl">
                <div className="axis" />
                {active.frames.length === 0 ? (
                  // 프레임이 없어도 숨기지 않는다 — 회색 판으로 자리와 시각을 남긴다(§2).
                  <div className="rvw-tl-empty">이 구간의 장면 이미지는 준비되지 않았습니다</div>
                ) : (
                  active.frames.map((frame) => {
                    const raw = ratioOf(frame.atMs) * 100;
                    const left = `clamp(46px, ${raw}%, calc(100% - 46px))`;
                    const markId = `frame-${frame.id}`;
                    return (
                      <button
                        key={frame.id}
                        type="button"
                        className={`fr${selectedMarkId === markId ? " sel" : ""}`}
                        style={{ left }}
                        onClick={() => playFrom(frame.atMs, markId)}
                        aria-label={`${formatTime(frame.atMs)} 장면부터 재생`}
                      >
                        <span className="img">
                          {frame.imageUrl !== undefined
                            ? <img src={frame.imageUrl} alt="" />
                            : formatTime(frame.atMs)}
                        </span>
                      </button>
                    );
                  })
                )}
                {/* 정점 — 이 구간이 뽑힌 이유의 중심 지점 */}
                <button
                  type="button"
                  className="peak"
                  style={{ left: `${ratioOf(active.peakMs) * 100}%` }}
                  onClick={() => playFrom(active.peakMs, "peak")}
                  aria-label={`정점 ${formatTime(active.peakMs)}부터 재생`}
                />
                {active.cues.map((cue) => {
                  const markId = `cue-${cue.id}`;
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      className={`cue${selectedMarkId === markId ? " sel" : ""}`}
                      style={{ left: `${ratioOf(cue.atMs) * 100}%` }}
                      onClick={() => playFrom(cue.atMs, markId)}
                      aria-label={`${formatTime(cue.atMs)} 대사부터 재생`}
                    />
                  );
                })}
                <span className="tc" style={{ left: "0%" }}>{formatTime(active.startMs)}</span>
                <span className="tc" style={{ left: "100%" }}>{formatTime(active.endMs)}</span>
                  </div>

                  {/* 하단 2열: 확인한 대사 / 흐름·인물 (§6) */}
                  <div className="rvw-evcols">
                <div className="rvw-evcol">
                  <span className="rvw-sub">확인한 대사</span>
                  <div className="rvw-grp">
                    {active.cues.length === 0 ? (
                      <p className="rvw-note">이 구간에서 확인된 대사가 없습니다.</p>
                    ) : (
                      active.cues.map((cue) => {
                        const markId = `cue-${cue.id}`;
                        return (
                          <button
                            key={cue.id}
                            type="button"
                            className={`rvw-cue${selectedMarkId === markId ? " sel" : ""}`}
                            onClick={() => playFrom(cue.atMs, markId)}
                          >
                            <span className="tc">{formatTime(cue.atMs)}</span>
                            <span>
                              {cue.speaker !== undefined && <b>{cue.speaker} </b>}
                              {cue.text}
                              {cue.lowConfidenceNote !== undefined && (
                                <span className="rvw-conf">{cue.lowConfidenceNote}</span>
                              )}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rvw-evcol">
                  <div className="rvw-grp">
                    <span className="rvw-sub">연관 맥락</span>
                    {active.context.length === 0 ? (
                      <p className="rvw-note">연관된 다른 구간이 확인되지 않았습니다.</p>
                    ) : (
                      active.context.map((item) => {
                        const markId = `ctx-${item.id}`;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`rvw-ctx${selectedMarkId === markId ? " sel" : ""}`}
                            onClick={() => playFrom(item.atMs, markId)}
                          >
                            <span className="when">{item.label} · {formatTime(item.atMs)}</span>
                            <span className="tx">{item.text}</span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="rvw-grp">
                    <span className="rvw-sub">등장 인물</span>
                    <div className="rvw-people">
                      {active.people.length === 0 ? (
                        <p className="rvw-note">확인된 인물이 없습니다.</p>
                      ) : (
                        active.people.map((person, index) => (
                          <div className="rvw-person" key={person.name ?? `unknown-${index}`}>
                            <span className="pf">
                              {person.imageUrl !== undefined
                                ? <img src={person.imageUrl} alt="" />
                                : (person.name?.slice(0, 1) ?? "?")}
                            </span>
                            <span>
                              <span className={`nm${person.name === undefined ? " unknown" : ""}`}>
                                {person.name ?? "화면에 있으나 이름 미확인"}
                              </span>
                              <br />
                              <span className="rl">{person.role}</span>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                  </div>
                </div>

                <aside className="rvw-evplayer" aria-label="근거 영상 검토">
                  <div className="rvw-evplayer__head">
                    <span className="rvw-eyebrow">선택 지점 검토</span>
                    <strong>{formatTime(positionMs)}</strong>
                  </div>
                  {renderPlayer(true)}
                  <p className="rvw-now">
                    {selectedMarkId === null
                      ? "프레임·대사·맥락을 누르면 해당 시점으로 이동합니다."
                      : "선택한 근거 시점에 준비됐습니다. 재생 버튼을 눌러 확인하세요."}
                  </p>
                  <div className="rvw-evfoot">
                    <span className="m">
                      {formatTime(active.startMs)} – {formatTime(active.endMs)}
                      <small>클립 길이 {formatTime(durationMs)}</small>
                    </span>
                    <div className="acts">{decisionButtons}</div>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>

        {resetConfirmOpen && (
          <div className="rvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rvw-confirm-title">
            <div className="rvw-confirm__box">
              <strong id="rvw-confirm-title">이 후보를 처음 상태로 되돌릴까요?</strong>
              {/*
                어느 후보인지 이름을 댄다. 키를 눌러 연 창이라 화면에서 눈을 떼고
                있었을 수 있고, 그때 "이 후보" 만으로는 어느 것인지 확신하지 못한다.
              */}
              <p>
                <b>{active.title}</b> 의 사용·빼기 판단과 구간 조정이 지워지고, AI가
                처음 제안한 상태로 돌아갑니다. 되돌릴 수 없습니다.
              </p>
              {/*
                안전한 쪽은 **남는 상태**를 말한다. "취소" 는 이 화면에서 이미
                "사용 취소 · 빼기 취소" 로 판단을 되돌린다는 뜻이라, 판단을 지우는
                창에서는 반대편 버튼이 하는 일로 읽힌다.
              */}
              <div className="rvw-confirm__acts">
                <button type="button" onClick={onResetCancel}>
                  그대로 두기 <Keycap>Esc</Keycap>
                </button>
                <button type="button" className="danger" onClick={onResetConfirm}>
                  이 후보 초기화 <Keycap>↵</Keycap>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
