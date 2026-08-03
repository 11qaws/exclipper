/**
 * Worst-case verification harness (감사표 H1·H2·H3).
 *
 * The fixtures in main.tsx are comfortable: short sentences, four cues, Korean.
 * Real Pass B output can arrive at the pipeline's caps, and the surface has to
 * survive that at the *smallest* locked size, in English (which runs longer
 * than Korean for the same content), in both themes.
 *
 * Data goes through the real adapter — `buildReviewCandidates` on pipeline-
 * shaped input — so this exercises the mapping the app actually uses, not a
 * hand-made view model that could quietly disagree with it.
 *
 * Caps are imported rather than copied, so tightening the pipeline tightens
 * this check automatically.
 */
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH,
  MAX_CANDIDATE_PASS_B_PARTICIPANT_NAME_LENGTH,
  MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH,
} from "../../src/analysis/candidatePassBGemini";
import { buildReviewCandidates } from "../../src/app/reviewSurfaceModel";
import { ReviewSurface } from "../../src/app/ReviewSurface";
import "../../styles/exclipper-foundation.css";
import "../../styles/exclipper-app.css";
import "../../styles/review-surface.css";

/** Fills to exactly `length`, in a language whose words do not break politely. */
function fill(seed: string, length: number): string {
  let text = "";
  while (text.length < length) text += `${seed} `;
  return text.slice(0, length).trimEnd();
}

const KO_SEED =
  "첫 입을 베어 문 직후 큰 웃음과 감탄이 이어지고 옆자리 참가자들이 연달아 반응을 보태며 맛 평가보다 반응 자체가 중심이 되는 구간입니다";
const EN_SEED =
  "The reaction immediately after the first bite escalates into sustained laughter and the participants beside her keep adding to it, which makes the moment about the response rather than the tasting";

function buildCandidates(lang: "ko" | "en") {
  const seed = lang === "ko" ? KO_SEED : EN_SEED;
  const startMs = 1_920_000;
  const endMs = 1_968_000;
  return buildReviewCandidates({
    candidates: [{ id: "worst", startMs, endMs, peakMs: 1_944_000 }],
    insightById: {
      worst: {
        eventSummaryKo: fill(seed, MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH),
        reactionSummaryKo: fill(seed, MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH),
        whyGoodClipKo: fill(seed, MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH),
        identifiedParticipants: [
          {
            displayName: fill(
              lang === "ko" ? "아주긴이름의참가자" : "A Participant With A Very Long Name",
              MAX_CANDIDATE_PASS_B_PARTICIPANT_NAME_LENGTH,
            ),
            role: "streamer",
          },
          { displayName: "아모레또", role: "guest" },
          // 이름을 못 붙인 참가자도 화면에 남아야 한다.
          { displayName: "   ", role: "guest" },
        ],
      },
    } as never,
    contextById: {
      worst: {
        beforeContextKo: fill(seed, MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH),
        afterContextKo: fill(seed, MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH),
        topicContextKo: fill(seed, MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH),
        contextVerdictKo: fill(seed, MAX_CANDIDATE_PASS_B_INSIGHT_TEXT_LENGTH),
      },
    } as never,
    cuesById: {
      // 상한까지 찬 대사가 여러 줄. 실제 후보는 20~30줄까지 나온다.
      worst: Array.from({ length: 14 }, (_, index) => ({
        phase: "near-peak" as const,
        phaseLabel: "반응 시점 부근" as const,
        absoluteStartMs: startMs + index * 3_200,
        absoluteEndMs: startMs + index * 3_200 + 2_000,
        text: fill(seed, MAX_CANDIDATE_PASS_B_SEGMENT_TEXT_LENGTH),
      })),
    },
    framesById: {
      worst: [0, 12_000, 24_000, 44_000].map((timestampMs) => ({ timestampMs })),
    },
    decisionById: { worst: "used" },
    profileImageByName: { 아모레또: "/exclipper/streamers/amoretto.jpg" },
  });
}

function Case({
  label,
  lang,
  theme,
}: {
  readonly label: string;
  readonly lang: "ko" | "en";
  readonly theme: "light" | "dark";
}): React.ReactElement {
  const candidates = buildCandidates(lang);
  return (
    <section style={{ marginBottom: 28 }} data-theme={theme}>
      <p style={{ color: "#9aa2b8", font: "12px monospace", margin: "0 0 8px" }}>{label}</p>
      {/* 최소 크기 락(1000×600) 그대로. 여기서 안 깨지면 위는 모두 안전하다.
          `.rvw` 는 평소 뷰포트 높이를 따르므로, 여기서만 정확히 600px 로 못박는다. */}
      <div className="worst-lock" style={{ width: 1000, height: 600 }}>
        <ReviewSurface
          sourceTitle={
            lang === "ko"
              ? "교환학생 1기 · 음식 토크 풀버전 · 아주 긴 원본 제목이 헤더를 밀어내는지"
              : "Exchange Student S1 · Full Food Talk · A Very Long Source Title That Pushes The Header"
          }
          sourceDurationMs={8_114_000}
          candidates={candidates}
          activeIndex={0}
          page={lang === "ko" ? "evidence" : "summary"}
          streamerName="교환학생"
          onSelectIndex={() => undefined}
          onPageChange={() => undefined}
          onDecide={() => undefined}
          onTrim={() => undefined}
          onUndo={() => undefined}
          canUndo={false}
          onHelp={() => undefined}
          resetConfirmOpen={false}
          onResetConfirmOpen={() => undefined}
          onResetConfirm={() => undefined}
          onResetCancel={() => undefined}
        />
      </div>
    </section>
  );
}

function Harness(): React.ReactElement {
  return (
    <div style={{ padding: 24, background: "#1b1d24", minHeight: "100vh" }}>
      <style>{".worst-lock .rvw{height:600px;min-height:600px;max-height:600px}"}</style>
      <Case label="① 최대 데이터 · 한국어 · 근거 · 라이트 · 1000×600" lang="ko" theme="light" />
      <Case label="② 최대 데이터 · 영문 · 요약 · 라이트 · 1000×600" lang="en" theme="light" />
      <Case label="③ 최대 데이터 · 한국어 · 근거 · 다크 · 1000×600" lang="ko" theme="dark" />
    </div>
  );
}

const rootElement = document.getElementById("root")! as HTMLElement & {
  __exclipperWorstCaseRoot?: Root;
};
const root = rootElement.__exclipperWorstCaseRoot ?? createRoot(rootElement);
rootElement.__exclipperWorstCaseRoot = root;
root.render(
  <StrictMode><Harness /></StrictMode>,
);
