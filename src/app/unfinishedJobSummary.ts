import { ANALYSIS_STAGES } from "../domain/analysisRun";
import {
  COMPLETED_JOB_STATUSES,
  remainingStageCount,
  type AnalysisJob,
  type SourceAvailability,
} from "../domain/analysisJob";
import {
  estimateAnalysisDurationRangeMs,
  formatRemainingLabel,
} from "./progressEstimate";

/**
 * What the "이어서 할 분석" slide-in says about one unfinished job.
 *
 * A list does not make anyone resume anything — the wording does. Three
 * decisions carry that, and each is a rule the screen cannot break:
 *
 * The remaining time is shown **against the full time**. "약 4분" alone means
 * nothing; "약 4분 (처음부터 25분)" is the reason to come back, and it is the
 * only thing on the row that argues for finishing rather than restarting.
 *
 * The primary button is the thing that actually unblocks the job. When the file
 * is gone, that is reconnecting — routing through an explanation and asking for
 * a second click loses people at the first one.
 *
 * **The candidate count is never shown.** An unfinished job has not been through
 * final selection, so any number here is a promise the result may not keep.
 * The percentage is safe because it always reaches 100.
 */

export type ResumeActionKind = "reconnect" | "resume" | "restart" | "retry";

export interface UnfinishedJobSummary {
  readonly jobId: string;
  readonly title: string;
  /** 0–100. 확정된 스테이지 기준이라 반드시 100 에 도달한다. */
  readonly percent: number;
  /** "약 4분" — 이어서 하면 남는 시간. */
  readonly remainingLabel: string;
  /** "처음부터 25분" — 대비가 없으면 남은 시간이 큰지 작은지 알 수 없다. */
  readonly fromScratchLabel: string;
  readonly action: ResumeActionKind;
  readonly actionLabel: string;
  /** 왜 멈춰 있는지. 없으면 그냥 멈춘 것이다. */
  readonly blockedReason: string | null;
}

export interface UnfinishedJobInput {
  readonly job: AnalysisJob;
  readonly title: string;
  readonly sourceDurationMs: number;
  /**
   * 확정된 스테이지를 건너뛰고 이어서 돌 수 있는가.
   *
   * **지금은 없다.** 파이프라인이 `fastPass` 하나만 스테이지로 확정하고 나머지
   * 작업은 스테이지 기계 밖에서 돌기 때문에, 건너뛸 스테이지가 없다.
   *
   * 그래서 기본값이 `false` 다. 이어서 할 수 없는데 "이어서 약 6분" 이라고 하면
   * 사용자는 6분을 기다리다 25분을 쓰게 되고, 그 한 번으로 이 화면의 모든 시간
   * 표시를 믿지 않게 된다. 목록을 보여 주는 것 자체는 그래도 낫다 — 지금은
   * 중단된 분석이 아무 흔적 없이 사라진다.
   */
  readonly resumeSupported?: boolean;
}

/** 확정된 스테이지 비율. 실행 중 진행분은 넣지 않는다 — 확정된 것만 셈한다. */
export function committedPercent(job: AnalysisJob): number {
  const remaining = remainingStageCount(job);
  const done = ANALYSIS_STAGES.length - remaining;
  return Math.round((done / ANALYSIS_STAGES.length) * 100);
}

function actionFor(
  job: AnalysisJob,
  resumeSupported: boolean,
): { kind: ResumeActionKind; label: string } {
  // 이어서 돌 수 없으면 그렇게 말한다. 버튼이 "이어서" 라고 하고 처음부터 도는
  // 것은 한 번으로 이 화면의 모든 시간 표시를 못 믿게 만든다.
  if (job.source !== "connected") {
    return {
      kind: "reconnect",
      label: resumeSupported ? "연결하고 이어서" : "연결하고 다시 분석",
    };
  }
  if (job.status === "failed") return { kind: "retry", label: "다시 시도" };
  return resumeSupported
    ? { kind: "resume", label: "이어서 하기" }
    : { kind: "restart", label: "처음부터 다시 분석" };
}

/**
 * 멈춘 이유. **원본이 없다는 것과 권한이 끊긴 것은 다르다** — 하나는 파일을 찾아야
 * 하고 하나는 클릭 한 번이면 된다. 같은 문구로 묶으면 사용자가 필요 없는 탐색을
 * 하게 된다.
 */
function blockedReasonFor(source: SourceAvailability): string | null {
  switch (source) {
    case "needsPermission":
      return "원본 접근 권한이 만료됐습니다";
    case "missing":
      return "원본을 찾을 수 없습니다";
    case "connected":
      return null;
  }
}

export function summarizeUnfinishedJob(input: UnfinishedJobInput): UnfinishedJobSummary {
  const { job, title, sourceDurationMs } = input;
  const resumeSupported = input.resumeSupported ?? false;
  const percent = committedPercent(job);
  const full = estimateAnalysisDurationRangeMs(sourceDurationMs);
  // 넉넉한 쪽을 쓴다. 예상보다 빨리 끝나는 것은 기분이 좋지만, 늦어지는 것은
  // 화면이 거짓말한 것이 된다.
  const fullMs = full.highMs;
  // 이어서 돌 수 없으면 남는 시간은 전체 시간이다. 확정된 만큼을 빼면 하지 않을
  // 절약을 약속하게 된다.
  const remainingMs = resumeSupported ? Math.round(fullMs * (1 - percent / 100)) : fullMs;
  const action = actionFor(job, resumeSupported);

  return {
    jobId: job.jobId,
    title,
    percent,
    remainingLabel: formatRemainingLabel({ basis: "static", remainingMs }),
    // 이어서 돌 수 없으면 두 값이 같다. 같은 숫자를 괄호로 한 번 더 보여 주는 것은
    // 대비가 아니라 소음이다.
    fromScratchLabel: resumeSupported
      ? `처음부터 ${formatRemainingLabel({ basis: "static", remainingMs: fullMs })}`
      : "",
    action: action.kind,
    actionLabel: action.label,
    blockedReason: blockedReasonFor(job.source),
  };
}

/** 슬라이드인에 실을 것. 끝난 것과 버린 것은 여기 오지 않는다. */
export function selectUnfinishedJobs(
  inputs: readonly UnfinishedJobInput[],
): readonly UnfinishedJobSummary[] {
  return inputs
    .filter(
      ({ job }) =>
        !COMPLETED_JOB_STATUSES.has(job.status) && job.status !== "abandoned",
    )
    // 많이 진행된 것이 위로. 돌아올 이유가 가장 큰 것이 먼저 보여야 한다.
    .sort((a, b) => committedPercent(b.job) - committedPercent(a.job))
    .map(summarizeUnfinishedJob);
}

/**
 * 삭제 확인창의 문구.
 *
 * 삭제는 **이미 지불한 유료 분석을 버리는 것**이다. "정말 삭제할까요?" 로는 무엇을
 * 잃는지 알 수 없으므로, 진행률과 다시 드는 비용을 구체적으로 말한다.
 */
export function deleteConfirmationText(summary: UnfinishedJobSummary): {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
} {
  return {
    title: "이 분석을 지울까요?",
    body:
      `지금까지 분석한 ${summary.percent}% 가 사라지고, 다시 하려면 처음부터입니다. ` +
      "후보 정리(유료 분석)도 다시 해야 합니다.",
    // 대상을 붙인다. 두 버튼이 나란히 있으면 모양이 비슷해서, 되돌릴 수 없는
    // 쪽에만 마찰을 한 번 더 건다.
    confirmLabel: "분석 지우기",
  };
}
