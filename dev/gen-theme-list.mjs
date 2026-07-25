/**
 * Generates dev/theme-list.html straight from the palette module, so the harness
 * can never drift from the real tokens.
 *
 *   npx tsx dev/gen-theme-list.mjs
 *
 * Three arrangements of the same row, rendered side by side in light and dark,
 * so the choice is made by looking rather than by arguing. Every row prints the
 * measured contrast of its own text against its own composited background —
 * a translucent colour over a photo is exactly the case where the eye cannot
 * tell whether the text is still legible.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildAllStreamerPalettes,
  compositeOver,
  contrastOfRgb,
} from "../src/app/streamerPalette.ts";

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

function initial(name) {
  return name.replace(/^기본 · /, "").trim().charAt(0);
}

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

/**
 * 안 A — 사진이 오른쪽 끝에서 흘러나오고, 글자 쪽은 평평한 테마색이 덮는다.
 * 참고 이미지가 실제로 하는 일이다. 글자는 절대 사진 위에 놓이지 않는다.
 */
function rowA(p) {
  const file = IMG[p.id];
  return `<div class="row a${p.id === "amoretto" ? " on" : ""}">
  ${file ? `<div class="bleed" style="background-image:url('../public/streamers/${file}')"></div>` : ""}
  <div class="scrim"></div>
  <div class="txt"><b>${p.name}</b><span>${SUBTITLE[p.id]}</span></div>
  <div class="chip">${file ? `<img src="../public/streamers/${file}" alt="">` : initial(p.name)}</div>
</div>`;
}

/**
 * 안 B — 사진이 행 전체에 아주 옅게 깔리고, 그 위를 반투명 테마색이 덮는다.
 * 사진이 분위기로만 남는 대신, 글자 뒤 밝기가 사진 내용에 따라 흔들린다.
 */
function rowB(p) {
  const file = IMG[p.id];
  return `<div class="row b${p.id === "amoretto" ? " on" : ""}">
  ${file ? `<div class="wash" style="background-image:url('../public/streamers/${file}')"></div>` : ""}
  <div class="tint"></div>
  <div class="chip">${file ? `<img src="../public/streamers/${file}" alt="">` : initial(p.name)}</div>
  <div class="txt"><b>${p.name}</b><span>${SUBTITLE[p.id]}</span></div>
</div>`;
}

/**
 * 안 C — 왼쪽에 또렷한 원형 사진, 행은 평평한 반투명 테마색, 사진은 오른쪽에
 * 크게 흐려져 배경으로 한 번 더. 노출과 배경 두 역할을 분리한다.
 */
function rowC(p) {
  const file = IMG[p.id];
  return `<div class="row c${p.id === "amoretto" ? " on" : ""}">
  ${file ? `<div class="blur" style="background-image:url('../public/streamers/${file}')"></div>` : ""}
  <div class="tint"></div>
  <div class="chip">${file ? `<img src="../public/streamers/${file}" alt="">` : initial(p.name)}</div>
  <div class="txt"><b>${p.name}</b><span>${SUBTITLE[p.id]}</span></div>
  <div class="tickwrap"></div>
</div>`;
}

const VARIANTS = [
  { key: "a", title: "안 A · 사진이 오른쪽에서 흘러나옴", note: "참고 이미지 방식. 글자 쪽은 평평한 색", build: rowA },
  { key: "b", title: "안 B · 사진이 행 전체에 깔림", note: "분위기는 강하지만 글자 뒤 밝기가 사진에 좌우됨", build: rowB },
  { key: "c", title: "안 C · 또렷한 원형 + 흐린 배경", note: "노출과 배경을 분리", build: rowC },
];

function panel(variant, mode) {
  const rows = palettes
    .map((p) => {
      const theme = p[mode];
      const vars = [
        `--accent:${theme.accent}`,
        `--ink:${theme.ink}`,
        `--ink2:${theme.ink2}`,
        `--bg2:${theme.bg2}`,
        `--bg3:${theme.bg3}`,
        `--line:${theme.line2}`,
        `--tint:${TINT[mode]}`,
      ].join(";");
      const c = textContrast(theme, mode);
      return `<div class="slot" style="${vars}">
${variant.build(p)}
<div class="meas">이름 ${badge(c.name, 4.5)} · 설명 ${badge(c.sub, 4.5)}</div>
</div>`;
    })
    .join("\n");
  const t = palettes[0][mode];
  return `<section class="panel ${mode}" style="--pbg:${t.bg};--pink:${t.ink};--pline:${t.line2}">
<header><b>${variant.title}</b><span>${mode === "light" ? "라이트" : "다크"} · ${variant.note}</span></header>
<div class="list">${rows}</div>
</section>`;
}

const CSS = `
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:#12141a;font-family:"Pretendard",sans-serif;color:#e6e9f2}
h1{font-size:15px;margin:0 0 4px}
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.6;max-width:76ch}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
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
.row{position:relative;height:56px;border-radius:10px;overflow:hidden;display:flex;align-items:center;isolation:isolate;cursor:pointer}
.row .txt{position:relative;z-index:3;display:flex;flex-direction:column;gap:1px;min-width:0}
.row .txt b{font-size:13px;font-weight:800;color:var(--ink);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 설명은 ink2 다. ink3 는 평평한 배경 기준으로 잡힌 색이라 틴트를 얹으면
   라이트 전 테마에서 4.5:1 아래로 떨어진다(실측 3.21~4.12). */
.row .txt span{font-size:10px;font-weight:600;color:var(--ink2);letter-spacing:.02em}
.row .chip{position:relative;z-index:3;width:34px;height:34px;border-radius:50%;overflow:hidden;flex:none;background:var(--bg3);display:grid;place-items:center;font-weight:800;font-size:14px;color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)}
.row .chip img{width:100%;height:100%;object-fit:cover}
.row.on{box-shadow:inset 0 0 0 2px var(--accent)}

/* 안 A */
.row.a{padding:0 0 0 14px}
.row.a .bleed{position:absolute;inset:0 0 0 auto;width:52%;z-index:1;background-size:cover;background-position:center 22%}
.row.a .scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 0%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 46%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*70%),transparent) 72%,
  transparent 100%)}
.row.a .chip{margin-left:auto;margin-right:12px;box-shadow:0 2px 8px rgba(0,0,0,.28)}

/* 안 B */
.row.b{padding:0 12px;gap:10px}
.row.b .wash{position:absolute;inset:0;z-index:1;background-size:cover;background-position:center 20%;opacity:.5}
.row.b .tint{position:absolute;inset:0;z-index:2;background:color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2));opacity:.88}

/* 안 C */
.row.c{padding:0 12px;gap:10px}
.row.c .blur{position:absolute;inset:0 0 0 auto;width:60%;z-index:1;background-size:cover;background-position:center 20%;filter:blur(9px);opacity:.42;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 55%);mask-image:linear-gradient(90deg,transparent,#000 55%)}
.row.c .tint{position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 0%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*100%),var(--bg2)) 55%,
  color-mix(in srgb,var(--accent) calc(var(--tint)*80%),transparent) 100%)}
.row.c .tickwrap{margin-left:auto}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>테마 사이드 리스팅 · 안 비교</title><style>${CSS}</style></head><body>
<h1>슬라이드인 테마 목록 — 사이드 리스팅 3안</h1>
<p class="lead">요소: 이름 표기 · 대표 이미지 노출 · 반투명 테마색 · 반투명 배경 대표 이미지.
행마다 아래에 <b>실측 대비</b>를 적었다 — 글자가 놓이는 쪽 배경(테마색을 <code>bg2</code> 위에 반투명으로 합성한 색)에 대한 값이며,
초록은 4.5:1 이상이다. 사진 위에는 글자를 두지 않는 것이 세 안 공통 전제다.
선택된 상태는 아모레또 행에만 표시했다.</p>
<div class="grid">
${VARIANTS.map((v) => panel(v, "light")).join("\n")}
${VARIANTS.map((v) => panel(v, "dark")).join("\n")}
</div>
</body></html>
`;

writeFileSync(join(here, "theme-list.html"), html, "utf8");
console.log("dev/theme-list.html 생성됨 · 테마 " + palettes.length + "종 × 3안 × 라이트/다크");
