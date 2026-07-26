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
 * reason the layered states the keymap must reason about (page, player card,
 * reset confirmation) are owned by the container and passed in, not held here.
 *
 * Motion follows §7.4: the UI is not a separate layer floating over the
 * content, it is the same space in another state. The player card grows out of
 * the item that opened it, the evidence page unfolds from the summary in place,
 * and moving between candidates carries a direction.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  /** 왜 이 장면인가 — 한 문단. */
  readonly why: string;
  /** 대표 인용 한 줄(있을 때). */
  readonly quote?: string;
  readonly people: readonly ReviewPerson[];
  readonly cues: readonly ReviewCue[];
  readonly context: readonly ReviewContextItem[];
  readonly frames: readonly ReviewFrame[];
}

/** 카드가 자라날 출발점. 클릭한 요소의 화면 좌표(§7.4 연결감). */
export interface PlayerCardOrigin {
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
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
  readonly onSelectIndex: (index: number) => void;
  readonly onPageChange: (page: ReviewPage) => void;
  readonly onDecide: (id: string, decision: ReviewDecision) => void;
  readonly onTrim: (id: string, edge: "start" | "end", deltaMs: number) => void;
  readonly onUndo?: () => void;
  readonly canUndo?: boolean;
  readonly onHelp?: () => void;
  readonly onToggleTheme?: () => void;
  readonly themeLabel?: string;
  /** 슬라이드인 플레이어 카드 — 컨테이너가 소유(Esc 체인이 알아야 함). */
  readonly playerCardOpen: boolean;
  readonly onPlayerCardOpen: (origin: PlayerCardOrigin) => void;
  readonly onPlayerCardClose: () => void;
  /** 후보 전체 리셋 확인창 — 컨테이너가 소유. */
  readonly resetConfirmOpen: boolean;
  readonly onResetConfirmOpen: () => void;
  readonly onResetConfirm: () => void;
  readonly onResetCancel: () => void;
  /** 컨테이너가 키맵에 연결할 수 있도록, 항목 이동 함수를 넘겨준다. */
  readonly onItemFocusMover?: (move: (delta: 1 | -1) => void) => void;
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
  onSelectIndex,
  onPageChange,
  onDecide,
  onTrim,
  onUndo,
  canUndo = false,
  onHelp,
  onToggleTheme,
  themeLabel,
  playerCardOpen,
  onPlayerCardOpen,
  onPlayerCardClose,
  resetConfirmOpen,
  onResetConfirmOpen,
  onResetConfirm,
  onResetCancel,
  onItemFocusMover,
}: ReviewSurfaceProps): ReactElement {
  const active = candidates[activeIndex];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  /** 카드를 연 요소. 닫을 때 포커스를 여기로 돌려준다(§7.7). */
  const cardTriggerRef = useRef<HTMLElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(active?.startMs ?? 0);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [cardOrigin, setCardOrigin] = useState<PlayerCardOrigin | null>(null);

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
    setCardOrigin(null);
  }

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
    },
    [clampToClip],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      setPlaying((current) => !current);
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
  }, [active]);

  /**
   * 근거의 모든 표기는 재생 진입점이다(§7.5).
   *
   * 카드는 처음 연 요소에서 자라나고, **열려 있는 동안에는 움직이지 않는다**.
   * 다른 조각을 고르면 재생 위치만 바뀐다(§7.7) — 카드가 매번 새 자리로 뛰면
   * 어디를 보고 있었는지 놓치고, 자라나는 연출도 의미를 잃는다.
   */
  const playFrom = useCallback(
    (atMs: number, markId: string, element: HTMLElement | null) => {
      seek(atMs);
      setSelectedMarkId(markId);
      if (playerCardOpen || element === null) return;
      cardTriggerRef.current = element;
      const rect = element.getBoundingClientRect();
      const origin = {
        atMs,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      setCardOrigin(origin);
      onPlayerCardOpen(origin);
    },
    [onPlayerCardOpen, playerCardOpen, seek],
  );

  const closeCard = useCallback(() => {
    onPlayerCardClose();
    cardTriggerRef.current?.focus();
  }, [onPlayerCardClose]);

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

  /*
   * 카드가 열려 있는 동안 Tab 은 카드 안에서만 돈다 (§7.7 focus trap). 뒤의
   * 근거 목록은 살아 있지만 지금 조작 대상은 카드이므로, 포커스가 그 밖으로
   * 새면 무엇이 선택돼 있는지 알 수 없게 된다.
   */
  // 컨테이너의 키맵이 이 함수를 부를 수 있도록 올려 보낸다. 화면만이 자기
  // DOM 순서를 알고 있으므로, 이동 자체는 여기 두고 호출권만 넘긴다.
  useEffect(() => {
    onItemFocusMover?.(moveItemFocus);
  }, [moveItemFocus, onItemFocusMover]);

  const cardRef = useRef<HTMLElement | null>(null);
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Tab") return;
    const root = cardRef.current;
    if (root === null) return;
    const items = [...root.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

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

  /** 진행 바 드래그 seek. 트림 확인을 위해 경계 밖도 허용한다(§7.6). */
  const seekFromPointer = (clientX: number): void => {
    const bar = barRef.current;
    if (bar === null) return;
    const rect = bar.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    seek(active.startMs + ratio * durationMs, { allowOutside: true });
  };

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
                <div className="rvw-player">
                  {videoSrc !== undefined ? (
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      onTimeUpdate={(event) => {
                        const ms = event.currentTarget.currentTime * 1000;
                        setPositionMs(ms);
                        // 구간 끝에서 멈춘다 — 다음 장면으로 흘러가지 않게(§7.6).
                        if (ms >= active.endMs) {
                          event.currentTarget.pause();
                          setPlaying(false);
                        }
                      }}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  ) : (
                    <div className="rvw-poster">재생할 원본이 없습니다</div>
                  )}
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
                      {/* 정점·대사·프레임을 진행 바 위 마커로(§7.6) */}
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
                {/* 주장: 무엇인가 + 왜 뽑혔나. 한 질문의 답이라 늘 붙어 있다. */}
                <div className="rvw-claim">
                  <div className="rvw-titlerow">
                    <h3 className="ttl">
                      {active.title}
                      {decisionBadge}
                    </h3>
                    {pageTabs}
                  </div>
                  <p className="rvw-why">{active.why}</p>
                </div>

                {/* 근거: 실제로 뭐라 했나 + 혼자 서는가. 한 쌍으로 묶인다. */}
                <div className="rvw-grps">
                  {active.quote !== undefined && (
                    <div className="rvw-grp">
                      <span className="rvw-sub">확인한 대사</span>
                      <blockquote className="rvw-quote">{active.quote}</blockquote>
                    </div>
                  )}
                  {active.context.length > 0 && (
                    <div className="rvw-grp">
                      <span className="rvw-sub">연관 맥락</span>
                      <div className="rvw-flow">
                        {active.context.map((item) => (
                          <div key={item.id}>
                            <div className="rvw-flseg">
                              <span className="lb">{item.label}</span>
                              <span className="tx">{item.text}</span>
                            </div>
                            <div className="rvw-flcon" />
                          </div>
                        ))}
                        <div className="rvw-flseg now">
                          <span className="lb">이 클립</span>
                          <span className="tx">{active.title}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

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
                        onClick={(event) => playFrom(frame.atMs, markId, event.currentTarget)}
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
                  onClick={(event) => playFrom(active.peakMs, "peak", event.currentTarget)}
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
                      onClick={(event) => playFrom(cue.atMs, markId, event.currentTarget)}
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
                            onClick={(event) => playFrom(cue.atMs, markId, event.currentTarget)}
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
                            onClick={(event) => playFrom(item.atMs, markId, event.currentTarget)}
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

              <div className="rvw-evfoot">
                <span className="m">
                  {formatTime(active.startMs)} – {formatTime(active.endMs)} · {formatTime(durationMs)}
                </span>
                <div className="acts">{decisionButtons}</div>
              </div>
            </div>
          )}
        </div>

        {/* 카드는 고른 항목에서 자라난다 — 화면 구석에서 튀어나오지 않는다(§7.4). */}
        {playerCardOpen && cardOrigin !== null && (
          <aside
            className="rvw-pcard"
            aria-label="선택한 지점 미리보기"
            ref={cardRef}
            onKeyDown={onCardKeyDown}
            style={{
              "--rvw-card-x": `${cardOrigin.x}px`,
              "--rvw-card-y": `${cardOrigin.y}px`,
            } as CSSProperties}
          >
            <div className="scr">
              {videoSrc !== undefined ? <video src={videoSrc} controls={false} /> : "원본 없음"}
            </div>
            <div className="bar">
              <button className="rvw-play" type="button" onClick={togglePlay} aria-label={playing ? "일시정지" : "재생"}>
                {playing ? "❚❚" : "▶"}
              </button>
              <span className="tc">{formatTime(positionMs)}</span>
              <span className="pb"><span style={{ width: `${playedRatio * 100}%` }} /></span>
              <button className="x" type="button" onClick={closeCard} aria-label="미리보기 닫기">
                닫기 <Keycap>Esc</Keycap>
              </button>
            </div>
          </aside>
        )}

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
