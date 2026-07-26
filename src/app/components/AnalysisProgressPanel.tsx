import { useState } from "react";

import type { ProgressAxis } from "../analysisProgressAxis";

/**
 * The analysis progress panel — one axis (`ANALYSIS_SCREEN_SPEC_2026-07-26.md`).
 *
 * It replaces three racing bars with one, because three bars answer a question
 * nobody asked. Whichever finishes last decides when the wait ends, and which
 * one that is changes every run, so three readings never add up to "when can I
 * start reviewing" — which is the only thing this screen is for.
 *
 * The three tracks are kept, closed, behind 자세히. The single axis answers
 * "when will it finish"; the tracks answer "where is it stuck". Those are
 * different questions, and only the first one is asked every time.
 *
 * Presentational only. The ratio comes from `analysisProgressAxis`, the wording
 * from `statusMessages` — neither is recomputed here.
 */

export interface ProgressTrack {
  readonly id: string;
  readonly label: string;
  /** 0–1, or null when this track cannot be counted yet. */
  readonly ratio: number | null;
  readonly status: string;
}

interface AnalysisProgressPanelProps {
  readonly sourceTitle: string;
  readonly sourceDurationLabel: string;
  readonly axis: ProgressAxis;
  /** "약 9분 남음" — 이미 만들어진 한 줄. 여기서 다시 포맷하지 않는다. */
  readonly remainingLabel: string;
  /** "대사 인식 중 · 표본 34/60" — 지금 하는 일 한 줄. */
  readonly currentActivity: string;
  readonly tracks: readonly ProgressTrack[];
  readonly onStop: () => void;
}

export function AnalysisProgressPanel({
  sourceTitle,
  sourceDurationLabel,
  axis,
  remainingLabel,
  currentActivity,
  tracks,
  onStop,
}: AnalysisProgressPanelProps) {
  /*
   * 펼침 상태는 화면이 살아 있는 동안 유지한다. 진행률은 초 단위로 갱신되므로,
   * 갱신마다 닫히면 진단하려고 열어 둘 수가 없다.
   */
  const [detailOpen, setDetailOpen] = useState(false);
  const percent = Math.round(axis.ratio * 100);

  return (
    <section
      className="apx"
      aria-label="분석 진행 상황"
      data-indeterminate={axis.indeterminate}
    >
      <header className="apx-head">
        <h2 className="apx-title">{sourceTitle}</h2>
        <span className="apx-duration">{sourceDurationLabel}</span>
      </header>

      {/*
        `aria-valuenow` 는 셀 수 없을 때 **비운다**. 값을 채우면 스크린리더가
        진행률을 읽어 주는데, 그 숫자는 우리가 모르는 값이다.
      */}
      <div
        className="apx-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={axis.indeterminate ? undefined : percent}
        aria-valuetext={axis.indeterminate ? "진행 중" : `${percent}%`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>

      <p className="apx-remaining">
        <b>{remainingLabel}</b>
        {!axis.indeterminate && <span className="apx-percent">{percent}%</span>}
      </p>

      <p className="apx-activity">{currentActivity}</p>

      <div className="apx-detail">
        <button
          className="apx-disclose"
          type="button"
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen(!detailOpen)}
        >
          <span className="apx-caret" aria-hidden="true">
            ▾
          </span>
          자세히
        </button>

        {detailOpen && (
          <ul className="apx-tracks">
            {tracks.map((track) => (
              <li className="apx-track" key={track.id} data-done={track.ratio === 1}>
                <span className="apx-track-label">{track.label}</span>
                <span className="apx-track-bar" data-unknown={track.ratio === null}>
                  <i style={{ width: `${Math.round((track.ratio ?? 0) * 100)}%` }} />
                </span>
                <span className="apx-track-status">{track.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        멈추는 것이 잃는 것이 아님을 여기서 말한다. 확인창까지 가서야 알게 되면
        그 전에 이미 "멈추면 날아간다" 고 판단하고 탭을 켜 둔 채 기다린다.
      */}
      <footer className="apx-foot">
        <span className="apx-keep">여기까지 분석한 내용은 남습니다</span>
        <button className="apx-stop" type="button" onClick={onStop}>
          안전하게 멈추기
        </button>
      </footer>
    </section>
  );
}
