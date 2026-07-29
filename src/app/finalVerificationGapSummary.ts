import type { CandidateFinalVerificationGap } from "../analysis/candidateFinalVerification";

export interface FinalVerificationGapCount {
  readonly gap: CandidateFinalVerificationGap;
  readonly label: string;
  readonly detail: string;
  readonly count: number;
}

/**
 * What each verification gate means for the editor.
 *
 * The gate already records exactly where every candidate stopped. Collapsing
 * that into one "nothing passed verification" sentence hides whether the
 * pipeline broke or the AI genuinely judged the moments unusable — two facts
 * with completely different next steps.
 */
const GAP_PRESENTATION: Readonly<
  Record<CandidateFinalVerificationGap, { readonly label: string; readonly detail: string }>
> = {
  "context-excluded": {
    label: "전체 맥락 검토에서 제외됨",
    detail:
      "방송 전체 흐름을 확인한 결과 독립된 클립 사건이 아니거나 음악·대기·마무리 구간으로 판단했어요.",
  },
  "context-missing": {
    label: "방송 맥락이 준비되지 않음",
    detail: "전체 흐름과 앞뒤 맥락을 후보에 연결하지 못했어요. 맥락 분석이 끝나지 않았을 수 있어요.",
  },
  "detail-result-missing": {
    label: "화면·오디오 상세 분석 미완료",
    detail: "후보의 대표 화면과 오디오를 AI가 아직 해석하지 않았어요.",
  },
  "verification-receipt-missing": {
    label: "검증 기록 없음",
    detail: "상세 분석은 있었지만 근거가 모두 확인됐다는 기록이 남지 않았어요.",
  },
  "evidence-incomplete": {
    label: "근거 묶음이 불완전함",
    detail: "대표 화면 4장·대표 썸네일·오디오·맥락 중 일부가 빠졌어요.",
  },
  "context-insufficient": {
    label: "맥락 판정 보강 필요",
    detail:
      "AI가 방송 전체 흐름과 후보 장면의 관계를 충분히 확인하지 못했어요. 이 후보는 다시 분석해야 합니다.",
  },
  "detail-uncertain": {
    label: "세부 판정 보강 필요",
    detail:
      "화면·오디오 검토는 끝났지만 AI가 추천 또는 제외를 확정하지 못했어요. 이 후보는 다시 분석해야 합니다.",
  },
  "program-material-unclear": {
    label: "방송 소재 판정 보강 필요",
    detail:
      "일상 진행인지 사건인지 확정하지 못했어요. 추가 맥락으로 다시 판정해야 합니다.",
  },
  "detail-verdict-incoherent": {
    label: "AI 판정 조합 불일치",
    detail:
      "추천 여부, 맥락 일치 여부, 방송 소재 판정이 서로 모순돼요. 같은 후보를 다시 분석해야 합니다.",
  },
  "program-material-excluded": {
    label: "음악·오프닝·일상 진행으로 판정",
    detail: "방송 사건이 아니라 음악, 대기 화면, 평범한 진행으로 판단했어요.",
  },
  "context-conflict": {
    label: "전체 흐름과 맞지 않음",
    detail: "화면·오디오에서 읽은 내용이 방송 전체 흐름과 어긋나 보류했어요.",
  },
  "detail-not-recommended": {
    label: "AI가 클립으로 추천하지 않음",
    detail: "근거는 모두 확인했지만 클립으로 쓸 만하다고 보지 않았어요.",
  },
};

/** Gate order, so the summary reads as the pipeline the editor just watched. */
const GAP_ORDER: readonly CandidateFinalVerificationGap[] = [
  "context-missing",
  "detail-result-missing",
  "verification-receipt-missing",
  "evidence-incomplete",
  "context-insufficient",
  "detail-uncertain",
  "program-material-unclear",
  "detail-verdict-incoherent",
  "context-excluded",
  "program-material-excluded",
  "context-conflict",
  "detail-not-recommended",
];

export function summarizeFinalVerificationGaps(
  gapByCandidateId: Readonly<Record<string, CandidateFinalVerificationGap>>,
): readonly FinalVerificationGapCount[] {
  const counts = new Map<CandidateFinalVerificationGap, number>();
  for (const gap of Object.values(gapByCandidateId)) {
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  return GAP_ORDER.flatMap((gap) => {
    const count = counts.get(gap) ?? 0;
    if (count === 0) {
      return [];
    }
    return [{ gap, count, ...GAP_PRESENTATION[gap] }];
  });
}

/**
 * A gap is "pipeline" when the candidate never reached a judgement, and
 * "judgement" when the AI looked at complete evidence and declined.
 */
export function isPipelineGap(gap: CandidateFinalVerificationGap): boolean {
  return (
    gap === "context-missing" ||
    gap === "detail-result-missing" ||
    gap === "verification-receipt-missing" ||
    gap === "evidence-incomplete" ||
    gap === "context-insufficient" ||
    gap === "detail-uncertain" ||
    gap === "program-material-unclear" ||
    gap === "detail-verdict-incoherent"
  );
}
