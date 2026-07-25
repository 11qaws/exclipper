/**
 * Generates dev/forms.html — the living catalogue for styles/forms/ui-forms.css.
 *
 *   npx tsx dev/gen-forms.mjs
 *
 * The page links the real stylesheet rather than copying it, so the catalogue
 * cannot show something the library does not do. Themes come from the palette
 * module for the same reason.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";
import { streamerPortraitCrop } from "../src/app/streamerProfiles.ts";
import { readRowMetrics } from "./formTokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const IMG = {
  amoretto: "amoretto.jpg",
  eureka: "eureka.png",
  sena: "sena.png",
  torori: "torori.png",
  mangjing: "mangjing.png",
};

const SUBTITLE = {
  default: "교환학생 · 기본",
  amoretto: "스트리머",
  eureka: "스트리머",
  sena: "스트리머",
  torori: "스트리머",
  mangjing: "스트리머",
  violet: "기본 색상",
  amber: "기본 색상",
  hotpink: "기본 색상",
  brick: "기본 색상",
};

const TINT = { light: "14%", dark: "22%" };

const palettes = buildAllStreamerPalettes();

/** 카탈로그 머리말에 실제 값을 적는다 — 문서가 코드와 갈라지지 않게. */
const METRICS = readRowMetrics();
const byId = Object.fromEntries(palettes.map((p) => [p.id, p]));

/** 호스트가 이어 주는 토큰. 라이브러리는 이 여섯 개만 알면 된다. */
function tokens(theme, mode) {
  return [
    `--uf-accent:${theme.accent}`,
    `--uf-accent-on:${theme.accentOn}`,
    `--uf-ink:${theme.ink}`,
    `--uf-ink2:${theme.ink2}`,
    `--uf-surface:${theme.bg}`,
    `--uf-surface2:${theme.bg2}`,
    `--uf-line:${theme.line2}`,
    `--uf-row-rail-start:${theme.railStart}`,
    `--uf-row-rail-end:${theme.railEnd}`,
    `--uf-row-tint:${TINT[mode]}`,
  ].join(";");
}

function row(p, selected) {
  const file = IMG[p.id];
  // 초점과 확대는 그림마다 다르다 — 눈이 남아야 누구인지 알아본다.
  const { focus, zoom } = streamerPortraitCrop(p.name);
  const bleed = file
    ? `<span class="uf-row__bleed" style="background-image:url('../public/streamers/${file}');--uf-row-focus:${focus};--uf-row-zoom:${zoom}"></span>`
    : "";
  return `<button class="uf-row" aria-pressed="${selected ? "true" : "false"}">
  <span class="uf-row__rail"></span>
  ${bleed}
  <span class="uf-row__scrim"></span>
  <span class="uf-row__text"><b>${p.name}</b><span>${SUBTITLE[p.id]}</span></span>
</button>`;
}

function demo(mode) {
  const t = (id) => byId[id][mode];
  const panelStyle = `background:${t("default").bg};color:${t("default").ink}`;

  const notches = ["default", "eureka", "torori", "brick"]
    .map((id) => {
      const theme = t(id);
      return `<div class="bay" style="${tokens(theme, mode)}">
  <span class="uf-notch">지도</span>
  <span class="uf-notch uf-notch--ribbon">14:00 – 14:30</span>
  <span class="uf-notch uf-notch--outline">활동</span>
  <span class="uf-notch uf-notch--quiet">보관됨</span>
  <span class="uf-notch uf-notch--start">1일차</span>
</div>`;
    })
    .join("\n");

  const splits = [
    ["default", "1일차", "금요일 · 7월 24일", ""],
    ["amoretto", "분석 중", "3단계 / 8단계 · 약 4분 남음", " uf-split--accent"],
    ["sena", "세나 아르벨", "스트리머", ""],
    [
      "mangjing",
      "긴 설명",
      "줄이 넘어가도 가르는 선이 내용 높이를 그대로 따라가는지 확인하는 문장이다.",
      "",
    ],
  ]
    .map(
      ([id, title, desc, mod]) =>
        `<p class="uf-split${mod}" style="${tokens(t(id), mode)}">
  <b class="uf-split__title">${title}</b>
  <span class="uf-split__desc">${desc}</span>
</p>`,
    )
    .join("\n");

  const rows = palettes
    .map((p) => `<div style="${tokens(p[mode], mode)}">${row(p, p.id === "amoretto")}</div>`)
    .join("\n");

  return `<section class="panel" style="${panelStyle}">
<h2>${mode === "light" ? "라이트" : "다크"}</h2>

<h3>uf-notch <em>양쪽 끝이 접힌 텍스트 카드</em></h3>
<div class="stack">${notches}</div>

<h3>uf-split <em>제목 │ 설명</em></h3>
<div class="stack narrow">${splits}</div>

<h3>uf-split <em>좁은 자리(컨테이너 22em 이하) — 세로로 쌓임</em></h3>
<div class="squeeze">${splits}</div>

<h3>uf-row <em>사이드 리스팅</em></h3>
<div class="list">${rows}</div>
</section>`;
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>ui-forms · 공용 폼 목록</title>
<link rel="stylesheet" href="../styles/forms/ui-forms.css">
<style>
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:#101219;font-family:"Pretendard",sans-serif;color:#e6e9f2;font-size:15px}
h1{font-size:16px;margin:0 0 4px}
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.65;max-width:80ch}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.panel{border-radius:14px;padding:16px}
.panel h2{font-size:12px;margin:0 0 14px;opacity:.6;letter-spacing:.08em}
.panel h3{font-size:12px;margin:20px 0 8px;font-weight:800;display:flex;gap:8px;align-items:baseline}
.panel h3:first-of-type{margin-top:0}
.panel h3 em{font-style:normal;font-size:11px;font-weight:600;opacity:.6}
.stack{display:flex;flex-direction:column;gap:10px}
.bay{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.narrow{gap:14px}
.squeeze{width:20em;display:flex;flex-direction:column;gap:14px;container-type:inline-size}
.list{display:flex;flex-direction:column;gap:6px}
</style></head><body>
<h1>ui-forms — 공용 폼 목록</h1>
<p class="lead">실물은 <code>styles/forms/ui-forms.css</code> 를 <b>그대로 링크</b>해서 그린다 — 이 페이지가 라이브러리에 없는 것을 보여 줄 수 없다.
색은 팔레트 모듈에서 온다. 호스트가 이어 주는 토큰은 <code>--uf-accent</code> · <code>--uf-accent-on</code> · <code>--uf-ink</code> · <code>--uf-ink2</code> · <code>--uf-surface</code> · <code>--uf-surface2</code> · <code>--uf-line</code> 일곱 개뿐이고,
아무것도 안 이어 줘도 기본값으로 그려진다. 세로로 쌓이는 예시는 부모에 <code>container-type: inline-size</code> 가 켜져 있다.<br>
현재 행 치수: 높이 <b>${METRICS.rowHeight}px</b> · 사진 폭 <b>${METRICS.bleedWidth}%</b> — <code>dev/focus-picker</code> 에서 조절한다.</p>
<div class="grid">
${demo("light")}
${demo("dark")}
</div>
</body></html>
`;

writeFileSync(join(here, "forms.html"), html, "utf8");
console.log("dev/forms.html 생성됨 · 폼 3종 × 라이트/다크");
