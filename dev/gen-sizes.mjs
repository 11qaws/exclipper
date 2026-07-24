/**
 * Generates dev/review-sizes.html — the same review screen at each size in the
 * locked size policy (spec §12), so the three panels can never drift apart.
 *
 *   npx tsx dev/gen-sizes.mjs
 *
 * Panels:
 *   1000×600  MIN  — the hard lock; never shrinks below this
 *   1280×720  MAX  — the confirmed upper bound (covers 720p)
 *   1440×860  참고 — kept as the evidence for WHY the bound is 1280
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "_sizes.css.txt"), "utf-8");

const SIZES = [
  { w: 1000, h: 600, tag: "MIN", note: "락 하한 — 이 이하로 절대 줄지 않는다" },
  { w: 1280, h: 720, tag: "MAX", note: "확정 상한 — 720p 대응, 넓은 화면에선 중앙 정렬" },
  { w: 1440, h: 860, tag: "참고", note: "상한을 1280으로 정한 근거 — 오른쪽 서술 아래가 빈다" },
];

/** One panel. Markup lives here once, so all sizes stay identical by construction. */
function panel({ w, h }) {
  return `<div class="rvw" style="width:${w}px;height:${h}px">
  <nav class="rvw-rail">
    <span class="who" title="스트리머 아이콘 자리">교</span>
    <button title="되돌리기 Z">↺<sub style="font-size:8px;margin-left:1px;opacity:.7">Z</sub></button><button title="도움말 ?">⌨</button>
    <span class="sp"></span>
    <button title="테마">☾</button>
  </nav>
  <div class="rvw-screen">
    <div class="rvw-head"><span><span class="ttl">음식 토크 풀버전</span><span class="len t-data">2:15:14</span></span>
      <span class="chip t-data">후보 <b>7/23</b> · 남음 <b>16</b> · 사용 <b>5</b></span></div>
    <div class="rvw-strip"><span class="r"></span>
      <i class="ok" style="left:9%"></i><i class="ok" style="left:13%"></i><i class="no" style="left:16%"></i>
      <i class="ok cur" style="left:22%"></i><i style="left:29%"></i><i class="no" style="left:41%"></i>
      <i style="left:57%"></i><i style="left:71%"></i><i style="left:86%"></i></div>
    <div class="rvw-stripmeta"><span style="color:var(--rvw-ink4)">사용 <b style="color:var(--rvw-ok)">●</b>  탈락 <b style="color:#c0392b">✕</b>  미검토 <b style="color:var(--rvw-ink4)">○</b></span><span class="t-data">00:28:19 / 2:15:14</span></div>
    <div class="rvw-body">
      <div class="rvw-sum">
        <div class="rvw-stagecol">
          <div class="rvw-player"><div class="rvw-poster">정점 프레임 · 28:41</div>
            <div class="rvw-pbar"><button class="rvw-play">▶</button><span class="pb"><span class="played"></span><span class="peak"></span></span><span class="tc">28:24 / 29:19</span></div></div>
          <div class="rvw-dock"><button>빼기 <span class="kc">R</span></button><button title="재생·일시정지">▶ <span class="kc">Space</span></button><button class="use">사용 취소 <span class="kc">A</span></button></div>
          <div class="rvw-trim"><span>앞 구간</span><button>[</button><button>]</button><span>끝 구간</span><button>⇧[</button><button>⇧]</button><span class="rvw-range">28:24 – 29:19</span><button class="rvw-reset" title="후보 전체 초기화 (Backspace)">⌫</button></div>
        </div>
        <div class="rvw-narr">
          <div class="rvw-claim">
            <div class="rvw-titlerow"><h3 class="t-title">두바이 초콜릿 첫 시식 <span class="rvw-stbadge use">● 사용</span></h3>
              <div class="rvw-tabs"><span class="qk kc">Q</span><button aria-selected="true">요약</button><button>근거</button></div></div>
            <p class="rvw-why t-body">첫 입에서 큰 웃음과 감탄이 이어집니다. 직전 대화의 기대가 첫 반응에서 터집니다.</p>
          </div>
          <div class="rvw-grps">
          <div class="rvw-grp"><span class="t-sub">확인한 대사</span>
            <blockquote class="rvw-quote">"아 이거… 이거 진짜네. 이건 좀 심각하게 맛있는데?"</blockquote></div>
          <div class="rvw-grp"><span class="t-sub">연관 맥락</span>
            <div class="rvw-flow">
              <div class="rvw-flseg"><span class="lb">이전 연관</span><span class="tx">기대 · "이게 그 유명한 거야?"</span></div>
              <div class="rvw-flcon"></div>
              <div class="rvw-flseg now"><span class="lb">이 클립</span><span class="tx">두바이 초콜릿 첫 시식 · 큰 웃음</span></div>
              <div class="rvw-flcon"></div>
              <div class="rvw-flseg"><span class="lb">이후 연관</span><span class="tx">가격 반응 · "이거 어디서 사?"</span></div>
            </div></div>
          </div>
          <div class="rvw-nav"><span><span class="kc">←</span> 이전</span><span>다음 <span class="kc">→</span></span></div>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

const html = `<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8">
<title>크기 정책 — MIN 1000 / MAX 1280 / 참고 1440</title><style>
@font-face{font-family:"Pretendard";font-weight:400;font-display:swap;src:url("../public/fonts/Pretendard-Regular.woff2") format("woff2")}
@font-face{font-family:"Pretendard";font-weight:500;font-display:swap;src:url("../public/fonts/Pretendard-Medium.woff2") format("woff2")}
@font-face{font-family:"Pretendard";font-weight:600;font-display:swap;src:url("../public/fonts/Pretendard-SemiBold.woff2") format("woff2")}
@font-face{font-family:"Pretendard";font-weight:700;font-display:swap;src:url("../public/fonts/Pretendard-Bold.woff2") format("woff2")}
@font-face{font-family:"Pretendard";font-weight:800;font-display:swap;src:url("../public/fonts/Pretendard-ExtraBold.woff2") format("woff2")}
</style><style>
${css}
.cap b{color:#e6e9f2;font-size:13px}
.cap .tag{display:inline-block;min-width:38px;padding:1px 7px;border-radius:999px;background:#2a2e3a;color:#c7cdda;font-size:10px;text-align:center;margin-right:8px}
.cap .tag.max{background:#3b2130;color:#ff9db4}
</style></head><body>
${SIZES.map((size) => `<div class="cap"><span class="tag${size.tag === "MAX" ? " max" : ""}">${size.tag}</span><b>${size.w}×${size.h}</b> · ${size.note}</div>
${panel(size)}`).join("\n")}
</body></html>
`;

writeFileSync(join(here, "review-sizes.html"), html, "utf-8");
console.log("wrote dev/review-sizes.html");
for (const size of SIZES) console.log(`  ${size.tag.padEnd(4)} ${size.w}×${size.h}`);
