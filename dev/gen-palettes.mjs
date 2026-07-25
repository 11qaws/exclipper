/**
 * Generates dev/streamer-palettes.html straight from the palette module, so the
 * harness can never drift from the real token formula again.
 *
 *   npx tsx dev/gen-palettes.mjs
 *
 * The card markup here is the preserved standalone review-card form (see
 * dev/review-card.html) — one card is a usable UI component on its own.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildAllStreamerPalettes,
  contrastBetween,
} from "../src/app/streamerPalette.ts";

const here = dirname(fileURLToPath(import.meta.url));

const IMG = {
  amoretto: "amoretto.jpg",
  eureka: "eureka.png",
  sena: "sena.png",
  torori: "torori.png",
  mangjing: "mangjing.png",
};

const HEAD = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>스트리머 팔레트 · 검토 카드</title><style>
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
body{margin:0;padding:24px;background:#1b1d24;font-family:"Pretendard",sans-serif;display:grid;grid-template-columns:auto auto;gap:6px 18px;justify-content:start;align-items:start}
.cap{grid-column:1/-1;color:#9aa2b8;font:11px "SFMono-Regular",monospace;margin-top:14px;display:flex;gap:10px;align-items:baseline}
.pair{display:contents}
.cap .kind{font-size:9px;padding:1px 6px;border-radius:999px;background:#2a2e3a;color:#c7cdda;letter-spacing:.04em}
.mini{width:440px;height:290px;border-radius:14px;overflow:hidden;display:grid;grid-template-columns:44px 1fr;background:var(--rvw-bg2);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.rail{background:linear-gradient(170deg,var(--rvw-accent),color-mix(in srgb,var(--rvw-accent) 70%,#000));display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 0}
.rail .who{width:30px;height:30px;border-radius:50%;overflow:hidden;background:var(--rvw-bg);color:var(--rvw-accent-ink);display:grid;place-items:center;font-weight:800;font-size:13px}
.rail .who img{width:100%;height:100%;object-fit:cover}
.rail .rb{width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,.20)}
.scr{padding:12px 14px;min-width:0;color:var(--rvw-ink)}
.hd{display:flex;justify-content:space-between;align-items:baseline}
.hd b{font-size:14px;font-weight:800;color:var(--rvw-ink)} .hd .chip{font-size:10px;color:var(--rvw-ink3)}
.row{display:flex;align-items:center;gap:6px;margin-top:10px}
.row h3{font-size:14px;font-weight:800;margin:0;color:var(--rvw-ink)}
.badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--rvw-accent) 16%,#fff);color:var(--rvw-accent-ink)}
.seg{margin-left:auto;font-size:11px;font-weight:700;color:var(--rvw-ink3);padding:2px 8px;border-radius:6px}
.seg.on{background:var(--rvw-bg);color:var(--rvw-accent-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.body{font-size:12px;color:var(--rvw-ink2);line-height:1.6;margin:8px 0}
.ctx{font-size:11px;color:var(--rvw-ink3);background:var(--rvw-bg3);border-radius:7px;padding:5px 8px;margin-top:4px}
.ctx.now{background:var(--rvw-accent-bg);color:var(--rvw-accent-ink);border:1px solid var(--rvw-accent-line)}
.ctx .lb{font-size:9px;font-weight:700;opacity:.75;display:block}
.inktest{margin:8px 0 0;font-size:12px;font-weight:600;line-height:1.5;color:var(--rvw-accent-ink)}
.acts{display:flex;gap:6px;margin-top:10px}
.acts button{flex:1;padding:7px;border:1px solid var(--rvw-line2);border-radius:8px;background:var(--rvw-bg);font:600 12px "Pretendard";color:var(--rvw-ink)}
.acts .use{background:var(--rvw-accent);border-color:var(--rvw-accent);color:var(--rvw-accent-on)}
</style></head><body>
`;

function vars(t) {
  return Object.entries(t)
    .map(([k, v]) => `--rvw-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}`)
    .join(";");
}

function card(p, mode) {
  const t = mode === "dark" ? p.dark : p.light;
  const who = IMG[p.id]
    ? `<img src="../public/streamers/${IMG[p.id]}" alt="">`
    : p.name.replace(/[^가-힣A-Za-z]/g, "")[0];
  return `<div class="mini" style="${vars(t)}">
  <div class="rail"><div class="who">${who}</div><div class="rb"></div><div class="rb"></div></div>
  <div class="scr">
    <div class="hd"><b>음식 토크 풀버전</b><span class="chip">후보 7/23 · 남음 16</span></div>
    <div class="row"><h3>두바이 초콜릿 첫 시식</h3><span class="badge">● 사용</span><span class="seg">요약</span><span class="seg on">근거</span></div>
    <p class="body">첫 입에서 큰 웃음과 감탄이 이어집니다.</p>
    <div class="ctx"><span class="lb">이전 연관</span> 기대 · "이게 그 유명한 거야?"</div>
    <div class="ctx now"><span class="lb">이 클립</span> 두바이 초콜릿 첫 시식</div>
    <p class="inktest">확인한 대사 · 32:24 · The reaction after the first bite — 이 색 글자가 읽히는가</p>
    <div class="acts"><button>빼기</button><button class="use">사용 취소</button></div>
  </div>
</div>`;
}

/** 라이트와 다크를 나란히. 같은 색이 두 바탕에서 어떻게 사는지가 판단 기준이다. */
function row(p) {
  const hue = /hsl\((\d+)/.exec(p.light.accent)[1];
  const lc = contrastBetween(p.light.accentOn, p.light.accent).toFixed(2);
  const dc = contrastBetween(p.dark.accentOn, p.dark.accent).toFixed(2);
  const di = contrastBetween(p.dark.accentInk, p.dark.bg).toFixed(2);
  return `<div class="cap"><span class="kind">${p.kind}</span> ${p.name} · hue ${hue} · 버튼글자 라이트 ${lc}:1 / 다크 ${dc}:1 · 다크 잉크 ${di}:1</div>
${card(p, "light")}
${card(p, "dark")}`;
}

const html =
  HEAD + buildAllStreamerPalettes().map(row).join("\n") + "\n</body></html>\n";
writeFileSync(join(here, "streamer-palettes.html"), html, "utf-8");
console.log("wrote dev/streamer-palettes.html");
for (const p of buildAllStreamerPalettes()) {
  console.log(
    `  ${p.name.padEnd(14)} light-on ${contrastBetween(p.light.accentOn, p.light.accent).toFixed(2)}:1  dark-on ${contrastBetween(p.dark.accentOn, p.dark.accent).toFixed(2)}:1  dark-ink ${contrastBetween(p.dark.accentInk, p.dark.bg).toFixed(2)}:1`,
  );
}
