import { ANALYSIS_STAGES, type AnalysisStage } from "../domain/analysisRun";

/**
 * How long each stage actually took.
 *
 * The stage weights that drive the progress bar are estimates. Optimising
 * against estimates digs in the wrong place, and the estimate that is wrong is
 * exactly the one nobody questions — it looks reasonable and it is written down.
 *
 * Now that the seven stages commit, the elapsed time between commits is the
 * measurement. Nothing extra has to be instrumented: the commit points are
 * already the boundaries.
 *
 * Durations are recorded **per run**, keyed by nothing persistent. This is a
 * measuring tool, not a feature — it exists to correct STAGE_WEIGHTS and to
 * tell which bottleneck is worth attacking, and it should stay small enough to
 * delete once those answers are in.
 */

export interface StageTiming {
  readonly stage: AnalysisStage;
  readonly elapsedMs: number;
  /** 원본 길이 대비. 원본 길이에 정비례하는 구간을 가려낸다. */
  readonly ratioOfSourceDuration: number;
}

export interface StageTimingReport {
  readonly timings: readonly StageTiming[];
  readonly totalMs: number;
  readonly sourceDurationMs: number;
  /** 실측에서 나온 가중치. `STAGE_WEIGHTS` 와 나란히 놓고 비교한다. */
  readonly measuredWeights: Readonly<Partial<Record<AnalysisStage, number>>>;
}

export class StageTimer {
  private readonly startedAtMsByStage = new Map<AnalysisStage, number>();
  private readonly elapsedMsByStage = new Map<AnalysisStage, number>();
  private lastMarkMs: number | null = null;

  public constructor(private readonly sourceDurationMs: number) {}

  /**
   * 스테이지가 확정된 순간. 이전 표시 이후 흐른 시간이 그 스테이지의 소요다.
   *
   * 시작을 따로 표시하지 않는 이유: 스테이지 사이에는 빈틈이 없다. 하나가 끝나면
   * 다음이 시작하므로 경계 하나로 충분하고, 시작·끝을 둘 다 표시하면 그 둘이
   * 어긋날 자리가 생긴다.
   */
  public mark(stage: AnalysisStage, nowMs: number): void {
    const from = this.lastMarkMs ?? nowMs;
    this.elapsedMsByStage.set(stage, Math.max(0, nowMs - from));
    this.startedAtMsByStage.set(stage, from);
    this.lastMarkMs = nowMs;
  }

  /** 실행이 시작된 순간. 첫 스테이지의 기준점이 된다. */
  public begin(nowMs: number): void {
    this.lastMarkMs = nowMs;
  }

  public report(): StageTimingReport {
    const timings: StageTiming[] = [];
    let totalMs = 0;
    for (const stage of ANALYSIS_STAGES) {
      const elapsedMs = this.elapsedMsByStage.get(stage);
      if (elapsedMs === undefined) continue;
      totalMs += elapsedMs;
      timings.push({
        stage,
        elapsedMs,
        ratioOfSourceDuration:
          this.sourceDurationMs > 0 ? elapsedMs / this.sourceDurationMs : 0,
      });
    }

    // 합이 0 이면 비율을 낼 수 없다. 빈 표를 주는 편이 0 으로 나눈 값을 주는
    // 것보다 낫다 — 후자는 그럴듯한 숫자로 보인다.
    const measuredWeights: Partial<Record<AnalysisStage, number>> = {};
    if (totalMs > 0) {
      for (const timing of timings) {
        measuredWeights[timing.stage] = Math.round((timing.elapsedMs / totalMs) * 100);
      }
    }

    return {
      timings,
      totalMs,
      sourceDurationMs: this.sourceDurationMs,
      measuredWeights,
    };
  }
}

/**
 * 콘솔에 붙여 넣을 수 있는 표.
 *
 * 실측값을 화면에 띄우지 않는다 — 편집자가 판단할 것이 없는 정보다. 개발자가
 * 콘솔에서 읽고 `STAGE_WEIGHTS` 를 고치는 데 쓴다.
 */
export function formatStageTimingReport(report: StageTimingReport): string {
  if (report.timings.length === 0) {
    return "스테이지 실측 없음";
  }
  const rows = report.timings.map((timing) => {
    const seconds = (timing.elapsedMs / 1000).toFixed(1);
    const share = report.measuredWeights[timing.stage] ?? 0;
    // 원본 길이 대비 배수. 1 을 넘으면 원본보다 오래 걸린다는 뜻이다.
    const perHour =
      report.sourceDurationMs > 0
        ? (timing.elapsedMs / (report.sourceDurationMs / 3_600_000) / 60_000).toFixed(1)
        : "-";
    return `  ${timing.stage.padEnd(18)} ${seconds.padStart(8)}s  ${String(share).padStart(3)}%  ${perHour.padStart(6)}분/방송1시간`;
  });
  return [
    `스테이지 실측 · 원본 ${(report.sourceDurationMs / 3_600_000).toFixed(2)}시간 · 합계 ${(report.totalMs / 60_000).toFixed(1)}분`,
    ...rows,
    `  실측 가중치: ${JSON.stringify(report.measuredWeights)}`,
  ].join("\n");
}
