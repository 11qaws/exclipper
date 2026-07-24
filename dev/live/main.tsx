/** Live harness: mounts the real ReviewSurface against fixtures. */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ReviewSurface,
  type ReviewCandidate,
  type ReviewDecision,
  type ReviewPage,
} from "../../src/app/ReviewSurface";
import "../../styles/exclipper-foundation.css";
import "../../styles/exclipper-app.css";
import "../../styles/review-surface.css";

const BASE: ReviewCandidate[] = [
  {
    id: "c1",
    title: "두바이 초콜릿 첫 시식",
    startMs: 1_920_000,
    endMs: 1_968_000,
    peakMs: 1_944_000,
    decision: "used",
    why: "첫 입을 베어 문 직후 큰 웃음과 감탄이 이어지고, 옆자리 참가자들이 연달아 반응을 보탭니다. 맛 평가보다 반응 자체가 중심이 되는 구간입니다.",
    quote: "\"이거 진짜 유명한 거 맞아? 왜 이렇게 바삭해\"",
    people: [
      { name: "세라 교수님", role: "진행자" },
      { name: "아모레또", role: "게스트" },
      { name: "유레카", role: "게스트" },
    ],
    cues: [
      { id: "q1", atMs: 1_926_000, text: "이게 그 유명한 두바이 초콜릿이구나", speaker: "세라 교수님" },
      { id: "q2", atMs: 1_938_000, text: "어 잠깐만 이거 소리부터 다른데", speaker: "아모레또" },
      { id: "q3", atMs: 1_944_000, text: "이거 진짜 유명한 거 맞아? 왜 이렇게 바삭해", speaker: "아모레또" },
      { id: "q4", atMs: 1_957_000, text: "나도 나도 하나만", speaker: "유레카" },
    ],
    context: [
      { id: "x1", label: "앞선 기대", text: "택배 상자를 열며 무엇이 들었는지 추측하던 대화", atMs: 1_880_000 },
      { id: "x2", label: "이어지는 반응", text: "다른 참가자들이 차례로 맛을 보며 비교하는 흐름", atMs: 1_990_000 },
    ],
    frames: [
      { id: "f1", atMs: 1_924_000 },
      { id: "f2", atMs: 1_940_000 },
      { id: "f3", atMs: 1_952_000 },
      { id: "f4", atMs: 1_964_000 },
    ],
  },
  {
    id: "c2",
    title: "합격자 발표 직전 정적",
    startMs: 2_400_000,
    endMs: 2_436_000,
    peakMs: 2_418_000,
    decision: "pending",
    why: "발표를 앞두고 모두가 말을 멈추는 짧은 정적이 있고, 이어서 환호가 터집니다.",
    people: [{ name: "세라 교수님", role: "진행자" }],
    cues: [{ id: "q5", atMs: 2_412_000, text: "자 그럼 발표하겠습니다", speaker: "세라 교수님" }],
    context: [],
    frames: [{ id: "f5", atMs: 2_410_000 }, { id: "f6", atMs: 2_424_000 }],
  },
  {
    id: "c3",
    title: "긴 제목 검증용 · 아주 길게 이어지는 한국어 제목이 두 줄로 넘어가는 경우를 확인",
    startMs: 3_000_000,
    endMs: 3_030_000,
    peakMs: 3_015_000,
    decision: "dropped",
    why: "빈 데이터 검증용 후보입니다.",
    people: [],
    cues: [],
    context: [],
    frames: [],
  },
];

function Harness(): React.ReactElement {
  const [candidates, setCandidates] = useState(BASE);
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState<ReviewPage>(
    globalThis.location?.hash === "#evidence" ? "evidence" : "summary",
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // 검증용: #reset 이면 실제 Backspace 키 경로를 그대로 태워 확인창을 띄운다.
  // (하네스 전용 prop 을 만들지 않고 진짜 키맵을 검증하기 위해)
  useEffect(() => {
    if (globalThis.location?.hash !== "#reset") return;
    const timer = window.setTimeout(() => {
      setResetOpen(true);
    }, 200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ padding: 24, background: "#1b1d24", minHeight: "100vh" }}>
      <ReviewSurface
        sourceTitle="교환학생 1기 · 음식 토크 풀버전"
        sourceDurationMs={8_114_000}
        candidates={candidates}
        activeIndex={index}
        page={page}
        streamerName="교환학생"
        onSelectIndex={(next) => { setIndex(next); setPage("summary"); }}
        onPageChange={setPage}
        onDecide={(id, decision: ReviewDecision) =>
          setCandidates((list) =>
            list.map((c) => (c.id === id ? { ...c, decision } : c)))}
        onTrim={(id, edge, delta) =>
          setCandidates((list) =>
            list.map((c) =>
              c.id === id
                ? edge === "start"
                  ? { ...c, startMs: c.startMs + delta }
                  : { ...c, endMs: c.endMs + delta }
                : c))}
        onUndo={() => undefined}
        canUndo={false}
        onHelp={() => setHelpOpen(true)}
        playerCardOpen={cardOpen}
        onPlayerCardOpen={() => setCardOpen(true)}
        onPlayerCardClose={() => setCardOpen(false)}
        resetConfirmOpen={resetOpen}
        onResetConfirmOpen={() => setResetOpen(true)}
        onResetConfirm={() => { setResetOpen(false); setCandidates(BASE); }}
        onResetCancel={() => setResetOpen(false)}
      />
      {helpOpen && (
        <p style={{ color: "#9aa2b8", font: "12px monospace", marginTop: 12 }}>
          도움말 열림 (Esc 로 닫힘) — 실제 오버레이는 부모가 소유합니다.
        </p>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Harness /></StrictMode>,
);
