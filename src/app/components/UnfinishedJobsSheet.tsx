import { useState } from "react";

import {
  deleteConfirmationText,
  type UnfinishedJobSummary,
} from "../unfinishedJobSummary";

/**
 * The "이어서 할 분석" side sheet.
 *
 * Presentational only: it owns no schedule of its own, binds no keys, and never
 * decides whether it should be visible — `unfinishedJobsVisibility` does that,
 * because "reopen only when the list changed" is a rule worth testing rather
 * than something to rediscover inside a component.
 *
 * It sits beside the first screen instead of over it. Choosing a new source
 * stays the main action; an interruption that blocks the main action to
 * announce leftover work has stopped being an announcement.
 */

interface UnfinishedJobsSheetProps {
  readonly summaries: readonly UnfinishedJobSummary[];
  readonly onResume: (jobId: string) => void;
  readonly onDelete: (jobId: string) => void;
  readonly onDismiss: () => void;
}

export function UnfinishedJobsSheet({
  summaries,
  onResume,
  onDelete,
  onDismiss,
}: UnfinishedJobsSheetProps) {
  // 어느 항목의 `⋯` 가 열려 있나. 한 번에 하나만 연다.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);

  if (summaries.length === 0) return null;

  return (
    <aside
      className="ujs-sheet"
      role="complementary"
      aria-labelledby="ujs-title"
    >
      <header className="ujs-head">
        <h2 id="ujs-title">이어서 할 분석 {summaries.length}개</h2>
        <button
          className="ujs-close"
          type="button"
          onClick={onDismiss}
          aria-label="목록 접기"
        >
          ✕
        </button>
      </header>

      <div className="ujs-list">
        {summaries.map((one) => {
          const confirming = confirmFor === one.jobId;
          return (
            <div className="ujs-item" key={one.jobId}>
              <div className="ujs-times">
                <b>{one.title}</b>
                <span>{one.percent}%</span>
              </div>

              <div
                className="ujs-bar"
                role="progressbar"
                aria-valuenow={one.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${one.title} 진행률`}
              >
                <i style={{ width: `${one.percent}%` }} />
              </div>

              {/*
                남은 시간은 **처음부터 걸리는 시간과 나란히** 둔다. 떼어 놓으면
                비교가 사라지고, 비교가 사라지면 이어서 할 이유도 사라진다.
              */}
              <div className="ujs-times">
                <b>{one.remainingLabel}</b>
                <span>({one.fromScratchLabel})</span>
              </div>

              {one.blockedReason !== null && (
                <div className="ujs-why">{one.blockedReason}</div>
              )}

              {confirming ? (
                <DeleteConfirm
                  summary={one}
                  onCancel={() => setConfirmFor(null)}
                  onConfirm={() => {
                    setConfirmFor(null);
                    setMenuFor(null);
                    onDelete(one.jobId);
                  }}
                />
              ) : (
                <div className="ujs-acts">
                  <button
                    className="ujs-go"
                    type="button"
                    onClick={() => onResume(one.jobId)}
                  >
                    {one.actionLabel}
                  </button>
                  <button
                    className="ujs-more"
                    type="button"
                    aria-expanded={menuFor === one.jobId}
                    aria-label={`${one.title} 다른 작업`}
                    onClick={() =>
                      setMenuFor(menuFor === one.jobId ? null : one.jobId)
                    }
                  >
                    ⋯
                  </button>
                </div>
              )}

              {/*
                삭제는 주 버튼 옆에 두지 않는다. 이미 지불한 유료 분석을 버리는
                일이라, 이어서 하려다 잘못 누를 자리에 있으면 안 된다.
              */}
              {menuFor === one.jobId && !confirming && (
                <div className="ujs-acts">
                  <button
                    className="ujs-more"
                    type="button"
                    onClick={() => setConfirmFor(one.jobId)}
                  >
                    이 분석 지우기
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function DeleteConfirm({
  summary,
  onCancel,
  onConfirm,
}: {
  readonly summary: UnfinishedJobSummary;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const text = deleteConfirmationText(summary);
  return (
    <div className="ujs-item" role="group" aria-label={text.title}>
      <div className="ujs-why">{text.title}</div>
      <div className="ujs-times">
        <span>{text.body}</span>
      </div>
      <div className="ujs-acts">
        {/*
          안전한 쪽은 **남는 상태**를 말한다. "그만두기" 는 이 앱에서 분석을
          그만둔다는 뜻이라, 분석을 지우는 창에서는 반대편 버튼이 하는 일로 읽힌다.
        */}
        <button className="ujs-more" type="button" onClick={onCancel}>
          그대로 두기
        </button>
        <button className="ujs-more" type="button" onClick={onConfirm}>
          {text.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** 시트를 접은 뒤에도 남는 들어가는 길. */
export function UnfinishedJobsChip({
  count,
  onOpen,
}: {
  readonly count: number;
  readonly onOpen: () => void;
}) {
  if (count === 0) return null;
  return (
    <button className="ujs-chip" type="button" onClick={onOpen}>
      이어서 할 분석
      <span className="ujs-count">{count}</span>
    </button>
  );
}
