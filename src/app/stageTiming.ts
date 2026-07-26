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
  /** 스테이지 안쪽 구간들. 무거운 스테이지의 정체를 가른다. */
  readonly spans: readonly { readonly label: string; readonly elapsedMs: number }[];
}

export class StageTimer {
  private readonly startedAtMsByStage = new Map<AnalysisStage, number>();
  private readonly elapsedMsByStage = new Map<AnalysisStage, number>();
  /**
   * 스테이지 **안쪽**의 구간들.
   *
   * 스테이지 경계만 재면 "어느 구간이 무거운가" 는 알아도 "그 안에서 무엇이
   * 무거운가" 는 모른다. 실제로 그 차이가 결론을 뒤집었다 — `broadcastContext`
   * 37% 를 보고 "자막 조달로 없앤다" 고 판단했는데, 그 실행은 **이미 자막을
   * 쓰고 있었다.** 남은 37% 가 자막 받기인지 그 뒤의 맥락 AI 호출인지에 따라
   * 고칠 곳이 완전히 다르다.
   */
  private readonly spanMsByLabel = new Map<string, number>();
  private lastMarkMs: number | null = null;

  public constructor(private readonly sourceDurationMs: number) {}

  /**
   * 스테이지 안의 한 구간. 같은 이름이 여러 번 오면 **합산**한다 — 후보마다
   * 도는 호출처럼 반복되는 것은 한 번의 시간이 아니라 총합이 궁금하다.
   */
  public addSpan(label: string, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    this.spanMsByLabel.set(label, (this.spanMsByLabel.get(label) ?? 0) + elapsedMs);
  }

  /** 구간 하나를 재는 손잡이. 끝날 때 부르면 그 사이 시간이 더해진다. */
  public startSpan(label: string, nowMs: number): (endMs: number) => void {
    return (endMs: number) => this.addSpan(label, endMs - nowMs);
  }

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

    const spans = [...this.spanMsByLabel.entries()]
      .map(([label, elapsedMs]) => ({ label, elapsedMs }))
      // 무거운 것부터. 표를 훑을 때 먼저 봐야 하는 것이 위에 있어야 한다.
      .sort((a, b) => b.elapsedMs - a.elapsedMs);

    return {
      timings,
      totalMs,
      sourceDurationMs: this.sourceDurationMs,
      measuredWeights,
      spans,
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
  const spanRows = report.spans.map((span) => {
    const seconds = (span.elapsedMs / 1000).toFixed(1);
    const share =
      report.totalMs > 0 ? Math.round((span.elapsedMs / report.totalMs) * 100) : 0;
    return `  ${span.label.padEnd(28)} ${seconds.padStart(8)}s  ${String(share).padStart(3)}%`;
  });

  return [
    `스테이지 실측 · 원본 ${(report.sourceDurationMs / 3_600_000).toFixed(2)}시간 · 합계 ${(report.totalMs / 60_000).toFixed(1)}분`,
    ...rows,
    `  실측 가중치: ${JSON.stringify(report.measuredWeights)}`,
    // 스테이지 안쪽은 잰 것이 있을 때만 낸다. 빈 제목만 있는 절은 무언가
    // 빠진 것처럼 보인다.
    ...(spanRows.length > 0 ? ["", "스테이지 안쪽 구간", ...spanRows] : []),
  ].join("\n");
}
