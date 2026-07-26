/**
 * 분석 진행 화면의 **단일 진행축** — 안 A(`ANALYSIS_SCREEN_SPEC_2026-07-26.md` §2.1·§2.2).
 *
 * 트랙 3행(반응 신호·대사 인식·채팅)을 대체한다. 막대 셋이 서로 다른 속도로
 * 움직이면 어느 것이 끝나야 끝인지 알 수 없고, 셋이 다 차도 후보 정리가 남아
 * 또 기다린다. 사용자가 이 화면에서 알고 싶은 것은 하나다 — 언제 검토를
 * 시작할 수 있나.
 *
 * 추정·패딩·단조 감소·문구 포맷은 `progressEstimate` 가 이미 한다. 이 모듈은
 * 그것을 **쓰는** 쪽이고, 여기서만 하는 일은 두 가지다.
 *
 * 1. 스테이지 여덟 개를 **시간 가중** 하나의 비율로 접는다.
 * 2. 범위로 나오는 추정을 화면에 쓸 **하나의 넉넉한 값**으로 고른다.
 *
 * 컴포넌트가 아니라 순수 모듈인 이유: 가중치와 단조성은 테스트로 고정할 값이지
 * 렌더 함수 안에서 매번 재발명할 것이 아니다.
 */
import {
  clampToMonotonic,
  estimateAnalysisDurationRangeMs,
  estimateRemainingMs,
  formatRemainingLabel,
  type RemainingEstimateBasis,
} from "./progressEstimate";
import { ANALYSIS_STAGES, type AnalysisStage } from "../domain/analysisRun";

export type StageWeightTable = Readonly<Record<AnalysisStage, number>>;

/**
 * 스테이지별 상대 소요 시간. **개수 비율이 아니라 예상 시간 비율**로 진행률을
 * 만들기 위한 표다.
 *
 * 개수로 나누면(1/8씩) 짧은 스테이지 셋을 지날 때 막대가 37%까지 확 뛰고,
 * 방송 전체를 훑는 `fastPass` 에서 몇 분 동안 한 칸도 움직이지 않는다. 사용자는
 * 그것을 "빠르다"로 읽지 않고 "멈췄다"로 읽는다.
 *
 * 단위는 없다. 서로의 비(比)만 의미가 있으며 `normalizeStageWeights` 가 합을
 * 1 로 맞춘다. 합이 100 이 되도록 적어 둔 것은 읽을 때 백분율로 보이라는 뜻일
 * 뿐, 코드가 100 을 가정하지는 않는다.
 */
export const STAGE_WEIGHTS: StageWeightTable = {
  /** 파일 메타데이터만 읽는다. 원본이 6시간이든 20분이든 거의 같은 시간. */
  preflight: 2,
  /** 기기 tier 측정. 짧고 원본 길이와 무관하다. */
  benchmark: 3,
  /**
   * 모델 내려받기·워밍업. 캐시가 있으면 순간이지만 첫 실행에서는 수십 초 —
   * 네트워크에 달렸으므로 상수 구간치고는 크게 잡는다.
   */
  prepareModels: 10,
  /**
   * Pass A. 방송 **전체**를 오디오·채팅·화면으로 훑는 유일한 구간이라 원본
   * 길이에 정비례한다. 6시간 원본에서 체감 대기의 절반 가까이가 여기다.
   */
  fastPass: 45,
  /** 이미 메모리에 있는 피크를 묶고 중복을 죽인다. 순수 계산이라 짧다. */
  seedClustering: 3,
  /**
   * Pass B. 상위 후보만 다시 읽는다 — 전사와 AI 호출이 들어가 후보 하나당
   * 비싸지만, 대상이 방송 전체가 아니라 후보 수십 개라 `fastPass` 보다는 작다.
   */
  deepPass: 27,
  /** 경계·설명·다양성 정렬. 후보 수에 비례하는 계산이고 I/O 가 없다. */
  boundary: 6,
  /** 순위 확정과 원자적 저장 커밋. 짧지만 0 은 아니다(디스크를 기다린다). */
  ranking: 4,
};

/**
 * 합이 1 인 표로 바꾼다.
 *
 * 가중치를 손으로 고칠 때 합을 100 에 맞추는 것은 사람의 일이 아니다 — 한 값만
 * 바꿔도 합이 어긋나고, 어긋난 합은 "다 끝났는데 막대가 97%" 로 조용히 나타난다.
 */
export function normalizeStageWeights(
  weights: StageWeightTable = STAGE_WEIGHTS,
): StageWeightTable {
  const safe = new Map(
    ANALYSIS_STAGES.map((stage) => [
      stage,
      Number.isFinite(weights[stage]) ? Math.max(0, weights[stage]) : 0,
    ]),
  );
  const total = [...safe.values()].reduce((sum, value) => sum + value, 0);
  // 합이 0 이면 나눗셈이 NaN 을 만들고 막대가 통째로 사라진다. 그럴 바에는
  // 균등 분배가 낫다 — 틀린 속도로라도 움직이는 편이 아무 정보도 없는 것보다 낫다.
  if (total <= 0) {
    const even = 1 / ANALYSIS_STAGES.length;
    return Object.fromEntries(
      ANALYSIS_STAGES.map((stage) => [stage, even] as const),
    ) as StageWeightTable;
  }
  return Object.fromEntries(
    ANALYSIS_STAGES.map(
      (stage) => [stage, (safe.get(stage) ?? 0) / total] as const,
    ),
  ) as StageWeightTable;
}

const NORMALIZED_STAGE_WEIGHTS = normalizeStageWeights();

/**
 * 지금 돌고 있는 스테이지. `analysisJob` 의 `nextStageToRun` 과 같은 규칙이지만
 * 그쪽은 저장된 `AnalysisJob` 레코드를 받는다. 진행축은 실행 중 이벤트로
 * 갱신되므로 작업 레코드가 없을 수 있어 스테이지만 받는다.
 */
function stageInProgress(
  lastCommittedStage: AnalysisStage | null,
): AnalysisStage | null {
  if (lastCommittedStage === null) return ANALYSIS_STAGES[0];
  const index = ANALYSIS_STAGES.indexOf(lastCommittedStage);
  if (index < 0) return ANALYSIS_STAGES[0];
  return ANALYSIS_STAGES[index + 1] ?? null;
}

/** 확정된 스테이지들이 차지하는 비율. 여기까지는 추정이 아니라 사실이다. */
function committedFraction(lastCommittedStage: AnalysisStage | null): number {
  if (lastCommittedStage === null) return 0;
  const index = ANALYSIS_STAGES.indexOf(lastCommittedStage);
  if (index < 0) return 0;
  // 마지막 스테이지가 확정됐으면 정확히 1 이다. 정규화된 값을 여덟 번 더하면
  // 0.9999999999999999 가 나올 수 있고, 그러면 다 끝난 막대가 끝까지 차지 않는다.
  if (index === ANALYSIS_STAGES.length - 1) return 1;
  return ANALYSIS_STAGES.slice(0, index + 1).reduce(
    (sum, stage) => sum + NORMALIZED_STAGE_WEIGHTS[stage],
    0,
  );
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 0~1 사이의 유한한 값만 통과시킨다. 그 밖은 "모른다"(null)로 취급한다. */
function finiteUnit(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return clampUnit(value);
}

export interface ProgressAxisInput {
  /** 마지막으로 **확정된** 스테이지. 아직 없으면 null. */
  readonly lastCommittedStage: AnalysisStage | null;
  /**
   * 현재 스테이지의 내부 진행 비율(0~1). 셀 수 있는 단위가 없어 알 수 없으면
   * null 을 넘긴다 — 여기에 그럴듯한 상수를 채우지 않는다.
   */
  readonly currentStageRatio: number | null;
  /** 직전에 화면에 보여 준 비율. 단조 증가를 유지하는 데 쓴다. */
  readonly previousRatio: number | null;
}

export interface ProgressAxis {
  readonly ratio: number;
  /**
   * 현재 스테이지의 진행을 셀 수 없다는 표시. 막대는 이때 숫자 대신
   * 줄무늬 흐름으로 그린다. `ratio` 는 그대로 유효하지만(확정된 만큼) 그 위로는
   * 아무것도 더하지 않은 값이다.
   */
  readonly indeterminate: boolean;
}

/**
 * 스테이지 여덟 개를 화면에 그릴 비율 하나로 접는다.
 *
 * 두 가지를 지킨다.
 *
 * - **되돌아가지 않는다.** 늦게 도착한 이벤트나 재개 직후의 낮은 값 때문에
 *   막대가 뒤로 가면, 사용자는 진행이 취소됐다고 읽는다. 단조성은
 *   `clampToMonotonic` 이 이미 하는 일이라 그것을 쓴다.
 * - **모르는 구간에 숫자를 지어내지 않는다.** 상수 진행률(0.76 등)은 정확히
 *   "멈춘 막대"처럼 보인다. 모르면 `indeterminate` 로 말한다.
 */
export function computeProgressAxis(input: ProgressAxisInput): ProgressAxis {
  const committed = committedFraction(input.lastCommittedStage);
  const currentStage = stageInProgress(input.lastCommittedStage);
  const stageRatio = finiteUnit(input.currentStageRatio);
  // 남은 스테이지가 없으면 모를 것도 없다. 다 끝난 막대에 줄무늬를 흘리면
  // 끝난 일이 아직 도는 것처럼 보인다.
  const indeterminate = currentStage !== null && stageRatio === null;
  const bounded = clampUnit(
    currentStage === null || stageRatio === null
      ? committed
      : committed + NORMALIZED_STAGE_WEIGHTS[currentStage] * stageRatio,
  );

  // `clampToMonotonic` 은 **감소만 하는** 값(남은 시간)을 위해 만들어졌다.
  // 진행률은 반대로 증가만 하므로 여분(1 - ratio)에 적용한다 — 같은 규칙의
  // 뒤집힌 면이라 별도의 단조 로직을 새로 만들 이유가 없다.
  const previous = finiteUnit(input.previousRatio);
  const remainingNow = 1 - bounded;
  const heldRemaining = clampToMonotonic(
    previous === null ? null : 1 - previous,
    remainingNow,
  );
  // 붙잡은 쪽이 어느 값이었는지로 되돌린다. 1 - (1 - x) 왕복은 0.47 을
  // 0.46999999999999997 로 만들고, 그 미세한 하락이 이 축의 유일한 약속을 깬다.
  const ratio =
    heldRemaining === remainingNow ? bounded : (previous ?? bounded);

  return { ratio, indeterminate };
}

export interface SingleRemainingInput {
  readonly sourceDurationMs: number;
  readonly elapsedMs: number;
  /** 진행축의 비율. `indeterminate` 구간에서는 null 을 넘긴다. */
  readonly ratio: number | null;
  /** 직전에 보여 준 남은 시간. 단조 감소를 유지하는 데 쓴다. */
  readonly previousRemainingMs: number | null;
}

export interface SingleRemaining {
  /** 화면에 그대로 쓰는 한 줄. `약` 접두는 `formatRemainingLabel` 이 붙인다. */
  readonly label: string;
  /**
   * 다음 호출의 `previousRemainingMs` 로 되먹일 값. 라벨은 분 단위로 반올림돼
   * 있어 그것을 다시 넣으면 단조 감소가 분 경계에서 어긋난다.
   */
  readonly remainingMs: number;
  readonly basis: RemainingEstimateBasis;
}

/**
 * 남은 시간을 **하나의 값**으로 만든다. 범위(`9~14분`)는 읽는 순간 사용자에게
 * 계산을 시킨다.
 *
 * 아직 실측할 진행이 없을 때는 계획 범위의 **넉넉한 쪽**(`highMs`)을 총 소요로
 * 잡는다. 빨리 끝나면 기분이 좋지만 늦어지면 화면이 거짓말한 것이 되고, 편집자는
 * 느린 기기와 멈춘 실행을 구분하지 못한다.
 *
 * `highMs` 에 `progressEstimate` 의 패딩을 다시 곱하지는 않는다. 그 패딩은 범위의
 * **중앙값**을 넉넉하게 만들려고 있는 것이라, 이미 상단인 값에 또 얹으면 안전
 * 여유가 두 번 쌓여 첫 화면이 계획보다 50% 긴 시간을 약속하게 된다. 실측 추정
 * (`measured`)은 중앙 추정이므로 그쪽의 패딩은 그대로 둔다.
 */
export function formatSingleRemaining(
  input: SingleRemainingInput,
): SingleRemaining {
  const estimate = estimateRemainingMs({
    sourceDurationMs: input.sourceDurationMs,
    elapsedMs: input.elapsedMs,
    ratio: input.ratio,
  });
  const generousMs =
    estimate.basis === "measured"
      ? estimate.remainingMs
      : Math.max(
          0,
          estimateAnalysisDurationRangeMs(input.sourceDurationMs).highMs -
            Math.max(0, input.elapsedMs),
        );
  const remainingMs = clampToMonotonic(input.previousRemainingMs, generousMs);
  return {
    label: formatRemainingLabel({ basis: estimate.basis, remainingMs }),
    remainingMs,
    basis: estimate.basis,
  };
}
