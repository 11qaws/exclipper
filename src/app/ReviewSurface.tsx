/**
 * ReviewSurface — the rebuilt review screen.
 *
 * Presentational by design: it takes a view model and emits intents. All
 * analysis types stay on the App side, so this file never has to track their
 * churn, and the screen can be rendered from fixtures in a harness.
 *
 * Two pages (요약 / 근거) turn in place, driven keyboard-first: the whole screen
 * is one instrument, closer to a game equipment panel than a form. Styling is
 * isolated in styles/review-surface.css under `.rvw-*`; colour comes from the
 * app's `--ex-accent*`, so the active streamer's palette applies automatically.
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
  readonly name: string;
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

export interface ReviewSurfaceProps {
  readonly sourceTitle: string;
  readonly sourceDurationMs: number;
  readonly candidates: readonly ReviewCandidate[];
  readonly activeIndex: number;
  readonly page: ReviewPage;
  /** 레일 상단 인물 아이콘. */
  readonly streamerName: string;
  readonly streamerImageUrl?: string;
  /** 재생용. 없으면 포스터 자리표시자만 보여준다. */
  readonly videoSrc?: string;
  readonly onSelectIndex: (index: number) => void;
  readonly onPageChange: (page: ReviewPage) => void;
  readonly onDecide: (id: string, decision: ReviewDecision) => void;
  /** 앞/끝 구간 조정. deltaMs 는 음수도 들어온다. */
  readonly onTrim: (id: string, edge: "start" | "end", deltaMs: number) => void;
  /**
   * 후보 전체 리셋 (명세 §11.1). 판단만이 아니라 **트림도 함께** AI 첫 제안으로
   * 되돌려야 한다 — 이 화면의 변경 수단이 그 둘뿐이라 일부만 지우면 "나머지는?"
   * 혼란이 생긴다. 파괴적이므로 이 컴포넌트가 확인창을 거친 뒤에만 호출한다.
   */
  readonly onResetAll: () => void;
  readonly onHelp?: () => void;
  /** 도움말 오버레이는 부모가 소유한다. Esc 체인에 끼우기 위해 상태만 받는다. */
  readonly helpOpen?: boolean;
  readonly onHelpClose?: () => void;
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

const TRIM_STEP_MS = 500;

export function ReviewSurface({
  sourceTitle,
  sourceDurationMs,
  candidates,
  activeIndex,
  page,
  streamerName,
  streamerImageUrl,
  videoSrc,
  onSelectIndex,
  onPageChange,
  onDecide,
  onTrim,
  onResetAll,
  onHelp,
  helpOpen = false,
  onHelpClose,
}: ReviewSurfaceProps): ReactElement {
  const active = candidates[activeIndex];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(active?.startMs ?? 0);
  /** 근거 페이지에서 조각을 고르면 뜨는 슬라이드인 플레이어. */
  const [cardOpen, setCardOpen] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  /** 전체 리셋은 파괴적이라 확인을 거친다 (명세 §11.1). */
  const [confirmingReset, setConfirmingReset] = useState(false);
  /**
   * 되돌리기(`Z`)는 "방금 판단 1개"만 되돌린다. 판단은 전부 `decide()`를 지나므로
   * 여기 쌓인 직전 값 하나를 되돌리면 정확히 그 의미가 된다.
   */
  const undoRef = useRef<{ id: string; previous: ReviewDecision }[]>([]);

  const decide = useCallback(
    (id: string, next: ReviewDecision) => {
      const previous = candidates.find((c) => c.id === id)?.decision ?? "pending";
      undoRef.current.push({ id, previous });
      onDecide(id, next);
    },
    [candidates, onDecide],
  );

  const undoLastDecision = useCallback(() => {
    const last = undoRef.current.pop();
    if (last !== undefined) onDecide(last.id, last.previous);
  }, [onDecide]);

  const confirmReset = useCallback(() => {
    undoRef.current = [];
    setConfirmingReset(false);
    onResetAll();
  }, [onResetAll]);

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
   * position from the previous clip must never look like this one's.
   *
   * This is done while rendering rather than in an effect. React re-runs this
   * component immediately with the corrected state and never commits the stale
   * frame, so the surface cannot flash the previous clip's position; an effect
   * would paint once with the old values and then cascade a second render.
   */
  const [syncedCandidateId, setSyncedCandidateId] = useState(active?.id);
  if (active?.id !== syncedCandidateId) {
    setSyncedCandidateId(active?.id);
    setPositionMs(active?.startMs ?? 0);
    setPlaying(false);
    setCardOpen(false);
    setSelectedCueId(null);
    setConfirmingReset(false);
  }

  const seek = useCallback((ms: number) => {
    setPositionMs(ms);
    const video = videoRef.current;
    if (video !== null) video.currentTime = ms / 1000;
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      setPlaying((current) => !current);
      return;
    }
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const step = useCallback(
    (delta: number) => {
      const next = activeIndex + delta;
      if (next >= 0 && next < candidates.length) onSelectIndex(next);
    },
    [activeIndex, candidates.length, onSelectIndex],
  );

  /*
   * Keymap — 명세 §11 그대로.
   *
   * Letter keys are matched on `event.code`, not `event.key`, so the physical
   * key works no matter what the IME is doing (한글 입력 중에도 `KeyA`는 A 자리).
   * Nothing binds Alt+Arrow: in Chromium that is browser Back and would leave
   * the page. Typing into an input disables the whole map.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const id = active?.id;

      // 확인창이 열려 있는 동안은 확인/취소만 받는다. 여는 키(Backspace)와
      // 확정 키(Enter)가 달라 연타로 실수할 수 없다 (§11.1).
      if (confirmingReset) {
        if (event.code === "Enter" || event.code === "NumpadEnter") {
          event.preventDefault();
          confirmReset();
        } else if (event.code === "Escape") {
          event.preventDefault();
          setConfirmingReset(false);
        }
        return;
      }

      switch (event.code) {
        case "KeyQ":
          event.preventDefault();
          onPageChange(page === "summary" ? "evidence" : "summary");
          return;
        case "Space":
          event.preventDefault();
          togglePlay();
          return;
        case "ArrowRight":
          event.preventDefault();
          step(1);
          return;
        case "ArrowLeft":
          event.preventDefault();
          step(-1);
          return;
        case "KeyA": // 사용 (토글: 사용 ↔ 미검토)
          if (id !== undefined) {
            event.preventDefault();
            decide(id, active?.decision === "used" ? "pending" : "used");
          }
          return;
        case "KeyR": // 빼기 (토글: 탈락 ↔ 미검토)
          if (id !== undefined) {
            event.preventDefault();
            decide(id, active?.decision === "dropped" ? "pending" : "dropped");
          }
          return;
        case "KeyZ": // 되돌리기 — 방금 판단 1개
          event.preventDefault();
          undoLastDecision();
          return;
        case "Backspace": // 후보 전체 리셋 — 확인창을 연다
          event.preventDefault();
          setConfirmingReset(true);
          return;
        case "BracketLeft":
          if (id !== undefined) {
            event.preventDefault();
            onTrim(id, event.shiftKey ? "end" : "start", -TRIM_STEP_MS);
          }
          return;
        case "BracketRight":
          if (id !== undefined) {
            event.preventDefault();
            onTrim(id, event.shiftKey ? "end" : "start", TRIM_STEP_MS);
          }
          return;
        case "Slash": // `/` 또는 `?` — 도움말
          event.preventDefault();
          onHelp?.();
          return;
        case "Escape": {
          // Esc = 한 방향 "취소" 체인. 항상 한 겹만 벗긴다 (§11.2).
          event.preventDefault();
          if (cardOpen) {
            setCardOpen(false); // 1. 재생 카드 취소
          } else if (page === "evidence") {
            onPageChange("summary"); // 2. 근거 취소
          } else if (helpOpen) {
            onHelpClose?.(); // 3. 도움말 취소
          } else {
            (document.activeElement as HTMLElement | null)?.blur(); // 4. 포커스 취소
          }
          return;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active?.decision,
    active?.id,
    cardOpen,
    confirmReset,
    confirmingReset,
    decide,
    helpOpen,
    onHelp,
    onHelpClose,
    onPageChange,
    onTrim,
    page,
    step,
    togglePlay,
    undoLastDecision,
  ]);

  if (active === undefined) {
    return (
      <div className="rvw" ref={rootRef}>
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

  return (
    <div className="rvw" ref={rootRef}>
      <nav className="rvw-rail" aria-label="검토 도구">
        <span className="who" title={streamerName}>
          {streamerImageUrl !== undefined
            ? <img src={streamerImageUrl} alt="" />
            : streamerName.slice(0, 1)}
        </span>
        <button
          type="button"
          onClick={undoLastDecision}
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

        {/* 후보 위치 스트립: 방송 전체에서 어디를 보고 있는지 + 각 후보의 상태 */}
        <div className="rvw-strip" aria-hidden="true">
          <div className="r" />
          {candidates.map((candidate, index) => {
            const left = `${(candidate.peakMs / Math.max(1, sourceDurationMs)) * 100}%`;
            const state = candidate.decision === "used"
              ? "ok"
              : candidate.decision === "dropped" ? "no" : "";
            return (
              <i
                key={candidate.id}
                className={`${state}${index === activeIndex ? " cur" : ""}`.trim()}
                style={{ left }}
              />
            );
          })}
        </div>
        <div className="rvw-stripmeta">
          <span>0:00</span>
          <span>{formatTime(sourceDurationMs)}</span>
        </div>

        <div className="rvw-body">
          {page === "summary" ? (
            <div className="rvw-sum" key="summary">
              <div className="rvw-stagecol">
                <div className="rvw-player">
                  {videoSrc !== undefined ? (
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      onTimeUpdate={(event) =>
                        setPositionMs(event.currentTarget.currentTime * 1000)}
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
                    <span className="pb">
                      <span className="played" style={{ width: `${playedRatio * 100}%` }} />
                    </span>
                    <span className="tc">{formatTime(active.endMs)}</span>
                  </div>
                </div>

                <div className="rvw-dock">
                  <button
                    type="button"
                    onClick={() => decide(active.id, active.decision === "dropped" ? "pending" : "dropped")}
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
                    onClick={() => decide(active.id, active.decision === "used" ? "pending" : "used")}
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
                  <span className="rvw-range">{formatTime(active.startMs)} – {formatTime(active.endMs)}</span>
                  {/* 리셋은 파괴적이라 자주 쓰는 트림 옆이 아니라 판단 영역 구석에 둔다 (§11.1). */}
                  <button
                    type="button"
                    className="rvw-reset"
                    onClick={() => setConfirmingReset(true)}
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
                      {active.decision !== "pending" && (
                        <span className={`rvw-stbadge ${active.decision === "used" ? "use" : "no"}`}>
                          ● {active.decision === "used" ? "사용" : "뺌"}
                        </span>
                      )}
                    </h3>
                    <div className="rvw-tabs" role="tablist" aria-label="요약과 근거">
                      <Keycap>Q</Keycap>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={true}
                        onClick={() => onPageChange("summary")}
                      >
                        요약
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={false}
                        onClick={() => onPageChange("evidence")}
                      >
                        근거
                      </button>
                    </div>
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
                  <span>
                    <Keycap>←</Keycap> <Keycap>→</Keycap> 후보 이동
                  </span>
                  <span>
                    <Keycap>Space</Keycap> 재생
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rvw-ev" key="evidence">
              <div className="rvw-evhead">
                <h3 className="ttl">{active.title}</h3>
                <div className="rvw-tabs" role="tablist" aria-label="요약과 근거">
                  <Keycap>Q</Keycap>
                  <button type="button" role="tab" aria-selected={false} onClick={() => onPageChange("summary")}>
                    요약
                  </button>
                  <button type="button" role="tab" aria-selected={true} onClick={() => onPageChange("evidence")}>
                    근거
                  </button>
                </div>
              </div>

              {/* 통합 타임라인: 프레임 · 대사 위치 · 정점이 한 축 위에 */}
              <div className="rvw-tl">
                <div className="axis" />
                {active.frames.map((frame) => {
                  // Clamp so the first/last thumbnail never hangs off the axis.
                  const raw = ((frame.atMs - active.startMs) / durationMs) * 100;
                  const left = `clamp(46px, ${raw}%, calc(100% - 46px))`;
                  return (
                    <button
                      key={frame.id}
                      type="button"
                      className="fr"
                      style={{ left }}
                      onClick={() => { seek(frame.atMs); setCardOpen(true); }}
                      aria-label={`${formatTime(frame.atMs)} 장면 보기`}
                    >
                      <span className="img">
                        {frame.imageUrl !== undefined ? <img src={frame.imageUrl} alt="" /> : "장면"}
                      </span>
                    </button>
                  );
                })}
                {active.cues.map((cue) => {
                  const left = `${((cue.atMs - active.startMs) / durationMs) * 100}%`;
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      className="cue"
                      style={{ left }}
                      onClick={() => { seek(cue.atMs); setSelectedCueId(cue.id); setCardOpen(true); }}
                      aria-label={`${formatTime(cue.atMs)} 대사 재생`}
                    />
                  );
                })}
                <span className="tc" style={{ left: "0%" }}>{formatTime(active.startMs)}</span>
                <span className="tc" style={{ left: "100%" }}>{formatTime(active.endMs)}</span>
              </div>

              <div className="rvw-evcols">
                <div className="rvw-evcol">
                  <span className="rvw-sub">확인한 대사</span>
                  <div className="rvw-grp">
                    {active.cues.length === 0 ? (
                      <p className="rvw-note">이 구간에서 확인된 대사가 없습니다.</p>
                    ) : (
                      active.cues.map((cue) => (
                        <button
                          key={cue.id}
                          type="button"
                          className={`rvw-cue${cue.id === selectedCueId ? " sel" : ""}`}
                          onClick={() => { seek(cue.atMs); setSelectedCueId(cue.id); setCardOpen(true); }}
                        >
                          <span className="tc">{formatTime(cue.atMs)}</span>
                          <span>
                            {cue.speaker !== undefined && <b>{cue.speaker} </b>}
                            {cue.text}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="rvw-evcol">
                  <span className="rvw-sub">연관된 맥락</span>
                  <div className="rvw-grp">
                    {active.context.length === 0 ? (
                      <p className="rvw-note">연관된 다른 구간이 확인되지 않았습니다.</p>
                    ) : (
                      active.context.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="rvw-ctx"
                          onClick={() => { seek(item.atMs); setCardOpen(true); }}
                        >
                          <span className="when">{item.label} · {formatTime(item.atMs)}</span>
                          <span className="tx">{item.text}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="rvw-evcol">
                  <span className="rvw-sub">등장 인물</span>
                  <div className="rvw-people">
                    {active.people.length === 0 ? (
                      <p className="rvw-note">확인된 인물이 없습니다.</p>
                    ) : (
                      active.people.map((person) => (
                        <div className="rvw-person" key={person.name}>
                          <span className="pf">
                            {person.imageUrl !== undefined
                              ? <img src={person.imageUrl} alt="" />
                              : person.name.slice(0, 1)}
                          </span>
                          <span>
                            <span className="nm">{person.name}</span>
                            <br />
                            <span className="rl">{person.role}</span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rvw-evfoot">
                <span className="m">
                  {formatTime(active.startMs)} – {formatTime(active.endMs)} · {formatTime(durationMs)}
                </span>
                <div className="acts">
                  <button
                    type="button"
                    onClick={() => decide(active.id, active.decision === "dropped" ? "pending" : "dropped")}
                  >
                    {active.decision === "dropped" ? "빼기 취소" : "빼기"}
                    <Keycap>R</Keycap>
                  </button>
                  <button
                    className="use"
                    type="button"
                    onClick={() => decide(active.id, active.decision === "used" ? "pending" : "used")}
                  >
                    {active.decision === "used" ? "사용 취소" : "사용"}
                    <Keycap>A</Keycap>
                  </button>
                </div>
              </div>

              {cardOpen && (
                <aside className="rvw-pcard" aria-label="선택한 지점 미리보기">
                  <div className="scr">
                    {videoSrc !== undefined ? (
                      <video ref={videoRef} src={videoSrc} controls={false} />
                    ) : (
                      "원본 없음"
                    )}
                  </div>
                  <div className="bar">
                    <button className="rvw-play" type="button" onClick={togglePlay} aria-label={playing ? "일시정지" : "재생"}>
                      {playing ? "❚❚" : "▶"}
                    </button>
                    <span className="tc">{formatTime(positionMs)}</span>
                    <span className="pb">
                      <span style={{ width: `${playedRatio * 100}%` }} />
                    </span>
                    <button className="x" type="button" onClick={() => setCardOpen(false)} aria-label="미리보기 닫기">
                      닫기 <Keycap>Esc</Keycap>
                    </button>
                  </div>
                </aside>
              )}
            </div>
          )}
        </div>

        {/*
          후보 전체 리셋 확인 (§11.1). 트림과 판단을 한꺼번에 되돌리는 파괴적
          동작이라 확인을 거친다. 여는 키(Backspace)와 확정 키(Enter)가 달라
          연타로 실수할 수 없다.
        */}
        {confirmingReset && (
          <div className="rvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rvw-confirm-title">
            <div className="rvw-confirm__box">
              <strong id="rvw-confirm-title">후보 전체를 처음 상태로 되돌릴까요?</strong>
              <p>
                지금까지의 사용·빼기 판단과 구간 조정이 모두 지워지고, AI가 처음 제안한
                상태로 돌아갑니다. 되돌릴 수 없습니다.
              </p>
              <div className="rvw-confirm__acts">
                <button type="button" onClick={() => setConfirmingReset(false)}>
                  취소 <Keycap>Esc</Keycap>
                </button>
                <button type="button" className="danger" onClick={confirmReset}>
                  초기화 <Keycap>↵</Keycap>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
