/**
 * Generates dev/theme-list.html straight from the palette module, so the harness
 * can never drift from the real tokens.
 *
 *   npx tsx dev/gen-theme-list.mjs
 *
 * Two arrangements of the same row, rendered light and dark, plus a focus tuning
 * strip. Every row prints the measured contrast of its own text against its own
 * composited background — a translucent colour over a photo is exactly the case
 * where the eye cannot tell whether the text is still legible.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildAllStreamerPalettes,
  compositeOver,
  contrastOfRgb,
} from "../src/app/streamerPalette.ts";
import { streamerPortraitCrop } from "../src/app/streamerProfiles.ts";

const here = dirname(fileURLToPath(import.meta.url));

const IMG = {
  amoretto: "amoretto.jpg",
  eureka: "eureka.png",
  sena: "sena.png",
  torori: "torori.png",
  mangjing: "mangjing.png",
};

/** 각 테마가 무엇인지 한 줄. 이름 아래 작은 글씨로 들어간다. */
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

/** 반투명 테마색의 알파. 라이트는 옅게, 다크는 조금 더 실어야 색이 보인다. */
const TINT = { light: 0.14, dark: 0.22 };

const palettes = buildAllStreamerPalettes();

/**
 * 글자가 실제로 놓이는 색을 계산한다. 사진 쪽이 아니라 **글자가 있는 쪽**의
 * 배경이다 — 사진 위에는 글자를 두지 않는 것이 이 설계의 전제다.
 */
function textContrast(theme, mode) {
  const composited = compositeOver(theme.accent, TINT[mode], theme.bg2);
  return {
    name: contrastOfRgb(composited, theme.ink),
    sub: contrastOfRgb(composited, theme.ink2),
  };
}

function badge(value, floor) {
  const ok = value >= floor;
  return `<i class="${ok ? "ok" : "no"}">${value.toFixed(2)}</i>`;
}

function bleed(p, extraClass = "") {
  const file = IMG[p.id];
  if (!file) return "";
  const { focus, zoom } = streamerPortraitCrop(p.name);
  // 초점 하나가 background-position 과 transform-origin 을 둘 다 정한다 —
  // 어긋나면 당길수록 눈이 밖으로 밀려난다.
  return `<div class="bleed ${extraClass}" style="background-image:url('../public/streamers/${file}');--focus:${focus};--zoom:${zoom}"></div>`;
}

/**
 * 안 A — 사진이 오른쪽 끝에서 흘러나오고, 글자 쪽은 평평한 테마색이 덮는다.
 * 원형 아이콘은 뺐다: 같은 얼굴을 한 행에 두 번 보여 줄 이유가 없고, 원형이
 * 글자 앞을 차지하면 이름이 쓸 자리가 줄어든다.
 */
function rowA(p) {
  return `<div class="row a${p.id === "amoretto" ? " on" : ""}">
  <div class="rail"></div>
  ${bleed(p)}
  <div class="scrim"></div>
  <div class="txt"><b>${p.name}</b><span>${SUBTITLE[p.id]}</span></div>
</div>`;
}

const VARIANTS = [
  {
    title: "확정 형태 · 사진이 오른쪽에서 흘러나옴",
    note: "왼쪽 색 띠 + 평평한 글자 배경 — 대비가 계산으로 보장됨 (최저 5.82)",
    build: rowA,
  },
];

function themeVars(theme, mode) {
  return [
    `--accent:${theme.accent}`,
    `--ink:${theme.ink}`,
    `--ink2:${theme.ink2}`,
    `--bg2:${theme.bg2}`,
    `--bg3:${theme.bg3}`,
    `--rail-start:${theme.railStart}`,
    `--rail-end:${theme.railEnd}`,
    `--tint:${TINT[mode]}`,
  ].join(";");
}

function panel(variant, mode) {
  const rows = palettes
    .map((p) => {
      const theme = p[mode];
      const c = textContrast(theme, mode);
      return `<div class="slot" style="${themeVars(theme, mode)}">
${variant.build(p)}
<div class="meas">이름 ${badge(c.name, 4.5)} · 설명 ${badge(c.sub, 4.5)}</div>
</div>`;
    })
    .join("\n");
  const t = palettes[0][mode];
  return `<section class="panel" style="--pbg:${t.bg};--pink:${t.ink}">
<header><b>${variant.title}</b><span>${mode === "light" ? "라이트" : "다크"} · ${variant.note}</span></header>
<div class="list">${rows}</div>
</section>`;
}

/**
 * 초점 조정용. 원본과 행 비율로 자른 결과를 나란히 놓고, 행의 세로 가운데에
 * 가로선을 그어 눈이 그 근처에 오는지 보이게 한다. 값이 안 맞으면 여기서 먼저
 * 티가 난다.
 */
function focusStrip() {
  const cards = palettes
    .filter((p) => IMG[p.id])
    .map((p) => {
      const { focus, zoom } = streamerPortraitCrop(p.name);
      // 확대를 여기서도 그대로 적용해야 한다. 안 하면 이 칸이 행과 다른 그림을
      // 보여 주면서 맞다고 말하게 된다.
      return `<div class="fcard" style="${themeVars(p.light, "light")}">
  <div class="fsrc" style="background-image:url('../public/streamers/${IMG[p.id]}')"></div>
  <div class="fcrop">
    <div class="fimg" style="background-image:url('../public/streamers/${IMG[p.id]}');--focus:${focus};--zoom:${zoom}"></div>
    <div class="feye"></div>
  </div>
  <div class="fname">${p.name}</div>
  <div class="fval">${focus} · ×${zoom}</div>
</div>`;
    })
    .join("\n");
  return `<section class="fpanel">
<header><b>초점 조정 — 눈이 남았는가</b><span>왼쪽 원본 · 오른쪽은 행과 같은 비율로 자른 결과 · 빨간 가로선이 행의 세로 가운데</span></header>
<div class="fgrid">${cards}</div>
</section>`;
}

const CSS = `
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:#12141a;font-family:"Pretendard",sans-serif;color:#e6e9f2}
h1{font-size:15px;margin:0 0 4px}
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.6;max-width:80ch}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:18px;max-width:920px}
.panel{background:var(--pbg);border-radius:14px;padding:12px;min-width:0}
.panel header{display:flex;flex-direction:column;gap:2px;margin-bottom:10px;padding:0 2px}
.panel header b{font-size:12px;color:var(--pink)}
.panel header span{font-size:10px;color:#8b93a8}
.list{display:flex;flex-direction:column;gap:6px}
.slot{display:flex;flex-direction:column;gap:2px}
.meas{font:9px "SFMono-Regular",monospace;color:#7d8598;padding-left:4px}
.meas i{font-style:normal;font-weight:700}
.meas .ok{color:#5fbf87}.meas .no{color:#e0736b}

/* 공통 행 */
.row{position:relative;height:74px;border-radius:10px;overflow:hidden;display:flex;align-items:center;isolation:isolate;cursor:pointer}
/* 왼쪽 색 띠 — 카드 폼의 레일과 같은 그라디언트를 짧게. 사진이 없는 테마에서는
   이것이 유일한 정체성이라 항상 그린다. */
.row .rail{position:absolute;inset:0 auto 0 0;width:7px;z-index:3;background:linear-gradient(170deg,var(--rail-start),var(--rail-end))}
.row .txt{position:relative;z-index:3;display:flex;flex-direction:column;gap:1px;min-width:0}
.row .txt b{font-size:13px;font-weight:800;color:var(--ink);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 설명은 ink2 다. ink3 는 평평한 배경 기준으로 잡힌 색이라 틴트를 얹으면
   라이트 전 테마에서 4.5:1 아래로 떨어진다(실측 3.21~4.12). */
.row .txt span{font-size:10px;font-weight:600;color:var(--ink2);letter-spacing:.02em}
.row .bleed{background-size:cover;background-repeat:no-repeat;
  background-position:var(--focus,50% 50%);transform:scale(var(--zoom,1));transform-origin:var(--focus,50% 50%)}
.row.on{box-shadow:inset 0 0 0 2px var(--accent)}

.row.a{padding:0 0 0 19px}
.row.a .bleed{position:absolute;inset:0 0 0 auto;width:52%;z-index:1}
.row.a .scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 0%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 46%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*70%),transparent) 72%,
  transparent 100%)}

/* 초점 조정 */
.fpanel{background:#191c24;border-radius:14px;padding:14px}
.fpanel header{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}
.fpanel header b{font-size:12px}
.fpanel header span{font-size:10px;color:#8b93a8}
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.fcard{display:grid;grid-template-columns:74px 1fr;grid-template-rows:auto auto;gap:4px 10px;align-items:start}
.fsrc{grid-row:1/3;width:74px;height:74px;border-radius:8px;background-size:cover;background-position:center;background-color:#0d0f14}
.fcrop{position:relative;height:74px;border-radius:8px;overflow:hidden;background:#0d0f14}
.fimg{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat;
  background-position:var(--focus,50% 50%);transform:scale(var(--zoom,1));transform-origin:var(--focus,50% 50%)}
.feye{position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(255,80,80,.85);z-index:2}
.fname{font-size:11px;font-weight:700;align-self:end}
.fval{font:10px "SFMono-Regular",monospace;color:#8b93a8;grid-column:2}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>테마 사이드 리스팅</title><style>${CSS}</style></head><body>
<h1>슬라이드인 테마 목록 — 사이드 리스팅</h1>
<p class="lead">왼쪽 색 띠는 <b>카드 폼의 레일과 같은 그라디언트</b>다 — 같은 정체성을 두 화면에서 다른 모양으로 보여 주면 같은 것인지 알아보지 못하므로 폭만 줄였다.
사진이 없는 테마에서는 이 띠가 유일한 정체성이라 항상 그린다.
초점과 확대는 그림마다 다르다(<code>src/app/streamerProfiles.ts</code> 의 <code>PORTRAIT_CROP_BY_NAME</code>).
<b>값을 맞추는 것은 <code>dev/focus-picker.html</code> 에서 한다</b> — 눈을 눌러 지정하고 코드를 복사해 붙인다.
아래 <b>초점 조정</b> 칸의 빨간 가로선은 행의 세로 가운데이며, 지금 값이 어떤지 확인하는 용도다.</p>
<div class="grid">
${VARIANTS.map((v) => panel(v, "light")).join("\n")}
${VARIANTS.map((v) => panel(v, "dark")).join("\n")}
</div>
${focusStrip()}
</body></html>
`;

writeFileSync(join(here, "theme-list.html"), html, "utf8");
console.log("dev/theme-list.html 생성됨 · 테마 " + palettes.length + "종 × 라이트/다크 + 초점 조정");
