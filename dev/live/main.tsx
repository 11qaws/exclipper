/** Live harness: mounts the real ReviewSurface against fixtures. */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  ReviewSurface,
  type ReviewCandidate,
  type ReviewDecision,
  type ReviewPage,
} from "../../src/app/ReviewSurface";
import "../../styles/exclipper-foundation.css";
import "../../styles/retto-highlight.css";
import "../../styles/exclipper-app.css";
import "../../styles/exclipper-surface.css";
import "../../styles/review-surface.css";

function frameFixture(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 70% 28%)"/><stop offset="1" stop-color="hsl(${hue + 38} 80% 68%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="470" cy="150" r="92" fill="rgba(255,255,255,.22)"/><rect x="48" y="56" width="300" height="188" rx="24" fill="rgba(15,18,30,.48)"/><text x="76" y="138" fill="white" font-family="sans-serif" font-size="42" font-weight="700">${label}</text><text x="76" y="188" fill="rgba(255,255,255,.8)" font-family="sans-serif" font-size="22">640 x 360</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const BASE: ReviewCandidate[] = [
  {
    id: "c1",
    title: "두바이 초콜릿 첫 시식",
    startMs: 1_920_000,
    endMs: 1_968_000,
    peakMs: 1_944_000,
    decision: "used",
    event: "두바이 초콜릿을 처음 맛본 직후 예상보다 강한 식감에 모두가 동시에 주목합니다.",
    reaction: "아모레또가 크게 웃으며 바삭한 소리에 놀라고, 옆자리 참가자들이 연달아 맛보겠다고 끼어듭니다.",
    clipReason: "첫 시식부터 집단 반응까지 48초 안에 완결되어 별도 설명 없이도 재미가 전달됩니다.",
    contextTopic: "해외 간식 시식",
    contextSummary: "택배를 열며 쌓인 기대가 첫 시식의 반전으로 이어지는 방송 중반의 핵심 장면입니다.",
    quote: "이거 진짜 유명한 거 맞아? 왜 이렇게 바삭해",
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
      { id: "f1", atMs: 1_924_000, imageUrl: frameFixture("FRAME 1", 342) },
      { id: "f2", atMs: 1_940_000, imageUrl: frameFixture("FRAME 2", 22) },
      { id: "f3", atMs: 1_952_000, imageUrl: frameFixture("FRAME 3", 182) },
      { id: "f4", atMs: 1_964_000, imageUrl: frameFixture("FRAME 4", 232) },
    ],
  },
  {
    id: "c2",
    title: "합격자 발표 직전 정적",
    startMs: 2_400_000,
    endMs: 2_436_000,
    peakMs: 2_418_000,
    decision: "pending",
    event: "합격자 발표 직전 모두가 말을 멈추고 결과 화면을 기다립니다.",
    reaction: "짧은 정적 뒤 결과를 확인한 스트리머가 안도하며 환호합니다.",
    clipReason: "조용한 긴장과 즉각적인 해소가 한 구간 안에서 대비됩니다.",
    contextTopic: "합격자 발표",
    contextSummary: "방송 전반에 걸친 도전 결과가 공개되는 결말 구간입니다.",
    quote: "자 그럼 발표하겠습니다",
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
    event: "사건 설명이 길어질 때 레이아웃을 확인하는 검증용 후보입니다.",
    reaction: "스트리머 반응 정보가 아직 준비되지 않았습니다.",
    clipReason: "빈 근거와 긴 제목에서도 화면이 무너지지 않는지 확인합니다.",
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
  const [resetOpen, setResetOpen] = useState(false);
  // 실제 앱처럼 키맵이 항목 이동을 호출하도록 연결한다 (↑↓ / J K).
  const moverRef = useRef<((delta: 1 | -1) => void) | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const map: Record<string, 1 | -1> = { ArrowDown: 1, KeyJ: 1, ArrowUp: -1, KeyK: -1 };
      const delta = map[event.code];
      if (delta === undefined) return;
      const target = event.target as HTMLElement | null;
      if (target !== null && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      moverRef.current?.(delta);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
    <div className="rh-app">
      <div className="ex-device">
        <div className="ex-device-screen">
          <nav className="ex-rail" aria-label="App workflow">
            <span className="ex-rail-brand" aria-hidden="true">E</span>
            <ol className="ex-rail-steps">
              {[1, 2, 3, 4].map((step) => <li className="ex-rail-step" key={step}>{step}</li>)}
            </ol>
          </nav>
          <div className="ex-screen">
            <header><div className="rh-header-inner"><strong>ExClipper</strong></div></header>
            <main className="rh-shell">
              <div className="ex-shell-content">
                <section className="rh-panel rh-review-workspace">
                  <div className="rh-results-header">
                    <div><p className="rh-eyebrow">AI analysis complete</p><h3>Final review candidates</h3></div>
                  </div>
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
        resetConfirmOpen={resetOpen}
        onResetConfirmOpen={() => setResetOpen(true)}
        onResetConfirm={() => { setResetOpen(false); setCandidates(BASE); }}
        onResetCancel={() => setResetOpen(false)}
                    onItemFocusMover={(move) => { moverRef.current = move; }}
                  />
                  <section className="rh-export-panel" aria-label="Export regression fixture">
                    <div className="rh-export-heading"><h3>Approved clips</h3></div>
                    <div className="rh-export-actions">
                      <button className="btn btn-primary rh-export-main-action" type="button">
                        Download approved clips
                      </button>
                    </div>
                  </section>
                </section>
              </div>
            </main>
          </div>
        </div>
      </div>
      {helpOpen && (
        <p style={{ color: "#9aa2b8", font: "12px monospace", marginTop: 12 }}>
          도움말 열림 (Esc 로 닫힘) — 실제 오버레이는 부모가 소유합니다.
        </p>
      )}
    </div>
  );
}

const rootElement = document.getElementById("root")! as HTMLElement & {
  __exclipperReviewRoot?: Root;
};
const root = rootElement.__exclipperReviewRoot ?? createRoot(rootElement);
rootElement.__exclipperReviewRoot = root;
root.render(
  <StrictMode><Harness /></StrictMode>,
);
