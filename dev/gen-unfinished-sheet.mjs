/**
 * Generates dev/unfinished-sheet.html — the "이어서 할 분석" sheet in every state
 * it actually reaches.
 *
 *   npx tsx dev/gen-unfinished-sheet.mjs
 *
 * Text comes from the real summariser and the stylesheet is linked rather than
 * copied, so the harness cannot show wording or spacing the app does not have.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";
import { ANALYSIS_STAGES } from "../src/domain/analysisRun.ts";
import { createAnalysisJob, transitionAnalysisJob } from "../src/domain/analysisJob.ts";
import { selectUnfinishedJobs, deleteConfirmationText } from "../src/app/unfinishedJobSummary.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIX_HOURS = 6 * 60 * 60 * 1000;

function drive(job, events) {
  return events.reduce((current, event) => {
    const outcome = transitionAnalysisJob(current, event);
    if (!outcome.accepted) throw new Error(`거부됨: ${event.type} → ${outcome.reason}`);
    return outcome.job;
  }, job);
}

function jobAt(jobId, stagesDone, tail = []) {
  const base = createAnalysisJob({
    jobId,
    identity: { scheme: "local-file-sampled-sha256-v1", key: jobId },
  });
  return drive(base, [
    { type: "START", runId: "run-1" },
    ...ANALYSIS_STAGES.slice(0, stagesDone).map((stage) => ({ type: "STAGE_COMMITTED", stage })),
    { type: "PAUSE" },
    ...tail,
  ]);
}

const SCENES = [
  {
    name: "둘 · 하나는 재연결 필요",
    inputs: [
      {
        job: jobAt("relay", 6, [
          { type: "RESUME", runId: "run-2" },
          { type: "SOURCE_LOST", availability: "needsPermission" },
        ]),
        title: "릴레이 방송",
        sourceDurationMs: SIX_HOURS,
      },
      { job: jobAt("pass", 5), title: "합격자 발표", sourceDurationMs: 4 * 60 * 60 * 1000 },
    ],
  },
  {
    name: "하나 · 이제 막 시작",
    inputs: [{ job: jobAt("fresh", 1), title: "저녁 합방", sourceDurationMs: SIX_HOURS }],
  },
  {
    name: "원본을 찾을 수 없음",
    inputs: [
      {
        job: jobAt("lost", 4, [
          { type: "RESUME", runId: "run-2" },
          { type: "SOURCE_LOST", availability: "missing" },
        ]),
        title: "옮겨진 파일",
        sourceDurationMs: SIX_HOURS,
      },
    ],
  },
  {
    name: "실패 후 · 긴 제목",
    inputs: [
      {
        job: jobAt("failed", 3, [
          { type: "RESUME", runId: "run-2" },
          { type: "FATAL", reasonCode: "worker_crashed" },
        ]),
        title: "교환학생 1기 ORIENT 합동 방송 다시보기 · 3부",
        sourceDurationMs: 9 * 60 * 60 * 1000,
      },
    ],
  },
];

function item(one, withMenu, withConfirm) {
  const confirm = deleteConfirmationText(one);
  return `<div class="ujs-item">
  <div class="ujs-times"><b>${one.title}</b><span>${one.percent}%</span></div>
  <div class="ujs-bar" role="progressbar" aria-valuenow="${one.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${one.percent}%"></i></div>
  <div class="ujs-times"><b>${one.remainingLabel}</b><span>(${one.fromScratchLabel})</span></div>
  ${one.blockedReason ? `<div class="ujs-why">${one.blockedReason}</div>` : ""}
  ${
    withConfirm
      ? `<div class="ujs-item" role="group">
    <div class="ujs-why">${confirm.title}</div>
    <div class="ujs-times"><span>${confirm.body}</span></div>
    <div class="ujs-acts"><button class="ujs-more">그만두기</button><button class="ujs-more">${confirm.confirmLabel}</button></div>
  </div>`
      : `<div class="ujs-acts">
    <button class="ujs-go">${one.actionLabel}</button>
    <button class="ujs-more" aria-expanded="${withMenu}">⋯</button>
  </div>`
  }
  ${withMenu && !withConfirm ? `<div class="ujs-acts"><button class="ujs-more">이 분석 지우기</button></div>` : ""}
</div>`;
}

function sheet(scene, mode, options = {}) {
  const rows = selectUnfinishedJobs(scene.inputs);
  const theme = buildAllStreamerPalettes().find((p) => p.id === "amoretto")[mode];
  const vars = [
    `--ex-bg:${theme.bg}`,
    `--ex-bg3:${theme.bg3}`,
    `--ex-ink:${theme.ink}`,
    `--ex-ink2:${theme.ink2}`,
    `--ex-ink3:${theme.ink3}`,
    `--ex-line2:${theme.line2}`,
    `--ex-accent:${theme.accent}`,
    `--uf-accent:${theme.accent}`,
    `--uf-accent-on:${theme.accentOn}`,
    `--ex-warn-ink:${mode === "light" ? "hsl(28 62% 32%)" : "hsl(34 80% 72%)"}`,
  ].join(";");
  return `<figure class="bay" style="background:${theme.bg2}">
  <figcaption>${scene.name}${options.menu ? " · ⋯ 열림" : ""}${options.confirm ? " · 삭제 확인" : ""}</figcaption>
  <aside class="ujs-sheet static" style="${vars}">
    <header class="ujs-head"><h2>이어서 할 분석 ${rows.length}개</h2><button class="ujs-close">✕</button></header>
    <div class="ujs-list">${rows
      .map((one, index) =>
        item(one, options.menu && index === 0, options.confirm && index === 0),
      )
      .join("\n")}</div>
  </aside>
</figure>`;
}

function chip(mode) {
  const theme = buildAllStreamerPalettes().find((p) => p.id === "amoretto")[mode];
  const vars = `--ex-bg:${theme.bg};--ex-ink:${theme.ink};--ex-line2:${theme.line2};--ex-accent:${theme.accent}`;
  return `<figure class="bay" style="background:${theme.bg2}">
  <figcaption>접은 뒤 남는 칩</figcaption>
  <button class="ujs-chip static" style="${vars}">이어서 할 분석 <span class="ujs-count">2</span></button>
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
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.65;max-width:82ch}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.bay{margin:0;padding:14px;border-radius:14px;display:flex;flex-direction:column;gap:9px}
.bay figcaption{font:10px "SFMono-Regular",monospace;color:#8b93a8;background:#191c24;
  padding:3px 8px;border-radius:5px;align-self:flex-start}
/* 하네스에서는 화면 구석에 고정하지 않고 나란히 놓는다 — 여러 상태를 한눈에 본다. */
.static{position:static;animation:none;box-shadow:0 8px 22px rgb(0 0 0 / .18)}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>이어서 할 분석 · 시트</title>
<link rel="stylesheet" href="../styles/forms/ui-forms.css">
<link rel="stylesheet" href="../styles/unfinished-jobs.css">
<style>${CSS}</style></head><body>
<h1>이어서 할 분석 — 사이드 시트</h1>
<p class="lead">문구는 <code>src/app/unfinishedJobSummary.ts</code> 가 만든 것을 그대로 쓰고, 스타일은 <code>styles/unfinished-jobs.css</code> 를 링크한다 — 이 페이지가 앱에 없는 문구나 간격을 보여 줄 수 없다.
<b>남은 시간은 항상 처음부터 걸리는 시간과 나란히</b> 있다. 그 대비가 이어서 할 유일한 이유이며, 떼어 놓으면 이유도 사라진다.
후보 개수는 어디에도 없다 — 최종 선별 전이라 못 지킬 약속이 된다.
삭제는 <code>⋯</code> 안에 있고, 확인창은 무엇을 잃는지 말한다.</p>
<div class="grid">
${SCENES.map((s) => sheet(s, "light")).join("\n")}
${sheet(SCENES[0], "light", { menu: true })}
${sheet(SCENES[0], "light", { confirm: true })}
${chip("light")}
</div>
<div class="grid" style="margin-top:18px">
${SCENES.map((s) => sheet(s, "dark")).join("\n")}
${sheet(SCENES[0], "dark", { confirm: true })}
${chip("dark")}
</div>
</body></html>
`;

writeFileSync(join(here, "unfinished-sheet.html"), html, "utf8");
console.log(`dev/unfinished-sheet.html 생성됨 · 상황 ${SCENES.length}종 × 라이트/다크`);
