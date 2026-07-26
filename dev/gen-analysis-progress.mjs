/**
 * Generates dev/analysis-progress.html — the single-axis progress panel in the
 * states it actually reaches.
 *
 *   npx tsx dev/gen-analysis-progress.mjs
 *
 * Ratios and labels come from the real `analysisProgressAxis`, and the
 * stylesheet is linked rather than copied, so the harness cannot show a bar
 * position or a sentence the app does not produce.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";
import {
  computeProgressAxis,
  formatSingleRemaining,
} from "../src/app/analysisProgressAxis.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIX_HOURS = 6 * 60 * 60 * 1000;

const SCENES = [
  {
    name: "막 시작 · 셀 수 없음",
    lastCommittedStage: null,
    currentStageRatio: null,
    elapsedMs: 4_000,
    activity: "준비 중 · 원본을 읽는 중",
    tracks: [
      { id: "signal", label: "반응 신호", ratio: null, status: "대기" },
      { id: "voice", label: "대사 인식", ratio: null, status: "대기" },
      { id: "chat", label: "채팅", ratio: null, status: "대기" },
    ],
  },
  {
    name: "훑는 중 · 62%",
    lastCommittedStage: "prepareModels",
    currentStageRatio: 0.55,
    elapsedMs: 9 * 60_000,
    activity: "대사 인식 중 · 표본 34/60",
    tracks: [
      { id: "signal", label: "반응 신호", ratio: 0.68, status: "4:12 / 6:12" },
      { id: "voice", label: "대사 인식", ratio: 0.56, status: "표본 34/60" },
      { id: "chat", label: "채팅", ratio: 1, status: "8,241줄" },
    ],
  },
  {
    name: "정밀 분석 중 · 셀 수 없음",
    lastCommittedStage: "seedClustering",
    currentStageRatio: null,
    elapsedMs: 21 * 60_000,
    activity: "후보 정리 중",
    tracks: [
      { id: "signal", label: "반응 신호", ratio: 1, status: "6:12 / 6:12" },
      { id: "voice", label: "대사 인식", ratio: 1, status: "표본 60/60" },
      { id: "chat", label: "채팅", ratio: 1, status: "8,241줄" },
    ],
  },
  {
    name: "다 끝남",
    lastCommittedStage: "ranking",
    currentStageRatio: null,
    elapsedMs: 34 * 60_000,
    activity: "정리 완료",
    tracks: [
      { id: "signal", label: "반응 신호", ratio: 1, status: "6:12 / 6:12" },
      { id: "voice", label: "대사 인식", ratio: 1, status: "표본 60/60" },
      { id: "chat", label: "채팅", ratio: 1, status: "8,241줄" },
    ],
  },
];

function panel(scene, mode, open) {
  const t = buildAllStreamerPalettes().find((p) => p.id === "amoretto")[mode];
  const axis = computeProgressAxis({
    lastCommittedStage: scene.lastCommittedStage,
    currentStageRatio: scene.currentStageRatio,
    previousRatio: null,
  });
  const remaining = formatSingleRemaining({
    sourceDurationMs: SIX_HOURS,
    elapsedMs: scene.elapsedMs,
    ratio: axis.indeterminate ? null : axis.ratio,
    previousRemainingMs: null,
  });
  const percent = Math.round(axis.ratio * 100);
  const vars = [
    `--ex-bg:${t.bg}`,
    `--ex-bg3:${t.bg3}`,
    `--ex-ink:${t.ink}`,
    `--ex-ink2:${t.ink2}`,
    `--ex-line2:${t.line2}`,
    `--ex-accent:${t.accent}`,
  ].join(";");

  const tracks = scene.tracks
    .map(
      (track) => `<li class="apx-track" data-done="${track.ratio === 1}">
      <span class="apx-track-label">${track.label}</span>
      <span class="apx-track-bar" data-unknown="${track.ratio === null}"><i style="width:${Math.round((track.ratio ?? 0) * 100)}%"></i></span>
      <span class="apx-track-status">${track.status}</span>
    </li>`,
    )
    .join("\n");

  return `<figure class="bay" style="background:${t.bg2}">
  <figcaption>${scene.name}${open ? " · 자세히 펼침" : ""}</figcaption>
  <section class="apx" style="${vars}" data-indeterminate="${axis.indeterminate}">
    <header class="apx-head">
      <h2 class="apx-title">릴레이 방송</h2>
      <span class="apx-duration">6시간 12분</span>
    </header>
    <div class="apx-bar" role="progressbar"><i style="width:${percent}%"></i></div>
    <p class="apx-remaining"><b>${remaining.label}</b>${axis.indeterminate ? "" : `<span class="apx-percent">${percent}%</span>`}</p>
    <p class="apx-activity">${scene.activity}</p>
    <div class="apx-detail">
      <button class="apx-disclose" aria-expanded="${open}"><span class="apx-caret">▾</span>자세히</button>
      ${open ? `<ul class="apx-tracks">${tracks}</ul>` : ""}
    </div>
    <footer class="apx-foot">
      <span class="apx-keep">여기까지 분석한 내용은 남습니다</span>
      <button class="apx-stop">안전하게 멈추기</button>
    </footer>
  </section>
  <div class="meas">ratio ${axis.ratio.toFixed(4)} · indeterminate ${axis.indeterminate} · basis ${remaining.basis}</div>
</figure>`;
}

const CSS = `
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:700;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:#12141a;font-family:"Pretendard",sans-serif;color:#e6e9f2}
h1{font-size:15px;margin:0 0 4px}
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.65;max-width:84ch}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.bay{margin:0;padding:14px;border-radius:14px;display:flex;flex-direction:column;gap:9px;width:520px}
.bay figcaption{font:10px "SFMono-Regular",monospace;color:#8b93a8;background:#191c24;
  padding:3px 8px;border-radius:5px;align-self:flex-start}
.meas{font:10px "SFMono-Regular",monospace;color:#7d8598}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>분석 진행 · 단일 축</title>
<link rel="stylesheet" href="../styles/analysis-progress.css">
<style>${CSS}</style></head><body>
<h1>분석 진행 화면 — 단일 진행축</h1>
<p class="lead">막대 하나로 접은 이유: 막대 셋이 서로 다른 속도로 움직이면 <b>어느 것이 끝나야 끝인지</b> 알 수 없고, 셋이 다 차도 후보 정리가 남아 또 기다린다.
이 화면이 답해야 하는 질문은 하나다 — <b>언제 검토를 시작할 수 있나</b>.
트랙 3행은 지우지 않고 <code>자세히</code> 뒤에 닫아 뒀다. 단일 축은 "언제 끝나나", 3행은 "어디서 막혔나" 에 답한다.
<b>셀 수 없는 구간은 지어낸 숫자 대신 줄무늬</b>다 — 상수 진행률은 정확히 "멈춘 막대" 처럼 보인다.
아래 숫자는 <code>analysisProgressAxis</code> 가 실제로 낸 값이다.</p>
<div class="grid">
${SCENES.map((s) => panel(s, "light", false)).join("\n")}
${panel(SCENES[1], "light", true)}
</div>
<div class="grid" style="margin-top:18px">
${SCENES.map((s) => panel(s, "dark", false)).join("\n")}
${panel(SCENES[1], "dark", true)}
</div>
</body></html>
`;

writeFileSync(join(here, "analysis-progress.html"), html, "utf8");
console.log(`dev/analysis-progress.html 생성됨 · 상황 ${SCENES.length}종 × 라이트/다크`);
