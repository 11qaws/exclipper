/**
 * Generates dev/focus-picker.html — the tool for aiming each portrait at its eyes.
 *
 *   npx tsx dev/gen-focus-picker.mjs
 *
 * Guessing these values from a thumbnail does not work, and every art update
 * invalidates them again. So the aiming is done by the person who can see the
 * picture: click the eyes, drag the zoom, copy the generated block into
 * src/app/streamerProfiles.ts. Current values are pre-loaded, so the tool always
 * starts from what is shipped rather than from nothing.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";
import { streamerPortraitCrop } from "../src/app/streamerProfiles.ts";

const here = dirname(fileURLToPath(import.meta.url));

const IMG = {
  amoretto: "amoretto.jpg",
  eureka: "eureka.png",
  sena: "sena.png",
  torori: "torori.png",
  mangjing: "mangjing.png",
};

const palettes = buildAllStreamerPalettes().filter((p) => IMG[p.id]);

const SUBJECTS = palettes.map((p) => {
  const { focus, zoom } = streamerPortraitCrop(p.name);
  const [fx, fy] = focus.split(/\s+/).map((v) => parseFloat(v));
  const t = p.light;
  return {
    id: p.id,
    name: p.name,
    file: IMG[p.id],
    x: fx,
    y: fy,
    zoom,
    accent: t.accent,
    ink: t.ink,
    ink2: t.ink2,
    bg2: t.bg2,
    railStart: t.railStart,
    railEnd: t.railEnd,
  };
});

const CSS = `
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:#12141a;font-family:"Pretendard",sans-serif;color:#e6e9f2}
h1{font-size:16px;margin:0 0 6px}
.lead{font-size:12.5px;color:#9aa2b8;margin:0 0 20px;line-height:1.7;max-width:74ch}
.lead b{color:#dfe4f0}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}

.cards{display:flex;flex-direction:column;gap:14px}
.card{display:grid;grid-template-columns:230px 1fr;gap:16px;background:#191c24;border-radius:14px;padding:14px}

/* 왼쪽 — 원본에 조준점 */
.aim{position:relative;width:230px;height:230px;border-radius:10px;overflow:hidden;background:#0d0f14;
  cursor:crosshair;touch-action:none;user-select:none}
.aim img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
.aim .cross{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;pointer-events:none;
  border:2px solid #ff5a5a;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.55),inset 0 0 0 1px rgba(0,0,0,.55)}
.aim .cross::before,.aim .cross::after{content:"";position:absolute;background:#ff5a5a}
.aim .cross::before{left:50%;top:-9px;width:2px;height:9px;margin-left:-1px}
.aim .cross::after{top:50%;left:-9px;height:2px;width:9px;margin-top:-1px}
.hint{margin-top:6px;font-size:11px;color:#7d8598;text-align:center}

/* 오른쪽 — 실제 행 미리보기 */
.right{display:flex;flex-direction:column;gap:10px;min-width:0}
.who{font-size:13px;font-weight:800}
.prev{position:relative;height:74px;border-radius:10px;overflow:hidden;display:flex;align-items:center;
  padding:0 0 0 18px;isolation:isolate}
.prev .rail{position:absolute;inset:0 auto 0 0;width:7px;z-index:3}
.prev .bleed{position:absolute;inset:0 0 0 auto;width:52%;z-index:1;background-size:cover;background-repeat:no-repeat}
.prev .scrim{position:absolute;inset:0;z-index:2}
.prev .txt{position:relative;z-index:3;display:flex;flex-direction:column;gap:2px}
.prev .txt b{font-size:14px;font-weight:800;line-height:1.2}
.prev .txt span{font-size:11px;font-weight:600;letter-spacing:.02em}

.ctrl{display:flex;align-items:center;gap:12px}
.ctrl label{font-size:11px;color:#9aa2b8;white-space:nowrap}
.ctrl input[type=range]{flex:1;accent-color:#6b8cff}
.val{font:11px "SFMono-Regular",monospace;color:#c7cdda;min-width:120px;text-align:right}
.reset{border:1px solid #333947;background:#1f2430;color:#c7cdda;border-radius:7px;padding:4px 10px;
  font:600 11px "Pretendard";cursor:pointer}
.reset:hover{background:#262c3a}

/* 출력 */
.out{margin-top:20px;background:#191c24;border-radius:14px;padding:14px}
.out header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.out h2{font-size:13px;margin:0}
.out .note{font-size:11px;color:#8b93a8}
.copy{margin-left:auto;border:0;background:#4a63d8;color:#fff;border-radius:8px;padding:7px 16px;
  font:700 12px "Pretendard";cursor:pointer}
.copy:hover{background:#5872e6}
.copy.done{background:#3f9c6a}
textarea{width:100%;height:220px;background:#0f1116;color:#cfd6e6;border:1px solid #2a2f3c;border-radius:9px;
  padding:12px;font:12px/1.6 "SFMono-Regular",monospace;resize:vertical}
`;

const SCRIPT = `
const SUBJECTS = ${JSON.stringify(SUBJECTS)};
const INITIAL = JSON.parse(JSON.stringify(SUBJECTS));

function focusOf(s) { return s.x.toFixed(0) + "% " + s.y.toFixed(0) + "%"; }

function paint(s, root) {
  const focus = focusOf(s);
  root.querySelector(".cross").style.left = s.x + "%";
  root.querySelector(".cross").style.top = s.y + "%";
  const bleed = root.querySelector(".bleed");
  bleed.style.backgroundPosition = focus;
  bleed.style.transform = "scale(" + s.zoom + ")";
  bleed.style.transformOrigin = focus;
  root.querySelector(".val").textContent = focus + " · x" + s.zoom.toFixed(2);
  root.querySelector("input[type=range]").value = String(s.zoom);
  emit();
}

/**
 * 붙여 넣을 수 있는 형태로만 낸다. 값만 나열하면 어디에 넣는지 다시 찾아야 하고,
 * 그 사이에 주석이 사라진다.
 */
function emit() {
  const lines = SUBJECTS.map((s) => {
    const key = /^[A-Za-z_$][\\w$]*$/.test(s.name) ? s.name : JSON.stringify(s.name);
    return "  " + key + ": { focus: \\"" + focusOf(s) + "\\", zoom: " + s.zoom + " },";
  });
  document.getElementById("out").value =
    "const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = {\\n" +
    lines.join("\\n") +
    "\\n};";
}

for (const s of SUBJECTS) {
  const root = document.getElementById("card-" + s.id);
  const aim = root.querySelector(".aim");

  const setFromEvent = (event) => {
    const box = aim.getBoundingClientRect();
    s.x = Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100));
    s.y = Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100));
    paint(s, root);
  };

  // 누른 채 끌면 계속 따라온다 — 한 번 클릭으로 맞히기보다 훨씬 빠르다.
  aim.addEventListener("pointerdown", (event) => {
    aim.setPointerCapture(event.pointerId);
    setFromEvent(event);
  });
  aim.addEventListener("pointermove", (event) => {
    if (aim.hasPointerCapture(event.pointerId)) setFromEvent(event);
  });

  root.querySelector("input[type=range]").addEventListener("input", (event) => {
    s.zoom = Number(event.target.value);
    paint(s, root);
  });

  root.querySelector(".reset").addEventListener("click", () => {
    const start = INITIAL.find((one) => one.id === s.id);
    s.x = start.x; s.y = start.y; s.zoom = start.zoom;
    paint(s, root);
  });

  paint(s, root);
}

document.querySelector(".copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(document.getElementById("out").value);
  } catch {
    // file:// 에서는 클립보드가 막힐 수 있다. 그때는 선택해 주는 것이 최선이다.
    const area = document.getElementById("out");
    area.focus(); area.select();
  }
  button.textContent = "복사됨";
  button.classList.add("done");
  setTimeout(() => { button.textContent = "복사"; button.classList.remove("done"); }, 1400);
});
`;

function card(s) {
  const scrim = `linear-gradient(90deg,
    color-mix(in srgb, ${s.accent} 14%, ${s.bg2}) 0%,
    color-mix(in srgb, ${s.accent} 14%, ${s.bg2}) 46%,
    color-mix(in srgb, ${s.accent} 10%, transparent) 72%,
    transparent 100%)`;
  return `<div class="card" id="card-${s.id}">
  <div>
    <div class="aim">
      <img src="../public/streamers/${s.file}" alt="">
      <div class="cross"></div>
    </div>
    <div class="hint">눈을 눌러서 지정 · 끌면 따라옴</div>
  </div>
  <div class="right">
    <div class="who">${s.name}</div>
    <div class="prev" style="background:${s.bg2}">
      <div class="rail" style="background:linear-gradient(170deg, ${s.railStart}, ${s.railEnd})"></div>
      <div class="bleed" style="background-image:url('../public/streamers/${s.file}')"></div>
      <div class="scrim" style="background:${scrim}"></div>
      <div class="txt"><b style="color:${s.ink}">${s.name}</b><span style="color:${s.ink2}">스트리머</span></div>
    </div>
    <div class="ctrl">
      <label for="z-${s.id}">확대</label>
      <input id="z-${s.id}" type="range" min="1" max="2.6" step="0.05" value="${s.zoom}">
      <span class="val"></span>
      <button class="reset" type="button">되돌리기</button>
    </div>
  </div>
</div>`;
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>초상 초점 맞추기</title><style>${CSS}</style></head><body>
<h1>초상 초점 맞추기</h1>
<p class="lead">그림이 바뀔 때마다 다시 맞춰야 하는 값이다. <b>왼쪽 그림에서 눈을 누르면</b> 오른쪽 행이 바로 그 결과로 바뀐다 — 눌러서 끌면 계속 따라온다.
얼굴이 작게 나오는 그림은 <b>확대</b>를 올린다. 확대는 지정한 초점을 중심으로 커지므로, 눈을 먼저 맞추고 당기는 편이 빠르다.
다 맞췄으면 아래 <b>복사</b> 를 눌러 <code>src/app/streamerProfiles.ts</code> 의 <code>PORTRAIT_CROP_BY_NAME</code> 을 통째로 바꾼다.
지금 값이 미리 들어가 있으므로 <b>고칠 것만</b> 건드리면 된다.</p>

<div class="cards">
${SUBJECTS.map(card).join("\n")}
</div>

<div class="out">
  <header>
    <h2>붙여 넣을 코드</h2>
    <span class="note">src/app/streamerProfiles.ts · 위 블록을 통째로 교체</span>
    <button class="copy" type="button">복사</button>
  </header>
  <textarea id="out" spellcheck="false"></textarea>
</div>

<script>${SCRIPT}</script>
</body></html>
`;

writeFileSync(join(here, "focus-picker.html"), html, "utf8");
console.log("dev/focus-picker.html 생성됨 · 인물 " + SUBJECTS.length + "명");
