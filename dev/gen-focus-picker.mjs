/**
 * Generates dev/focus-picker.html — the tool for aiming each portrait at its eyes.
 *
 *   npx tsx dev/gen-focus-picker.mjs
 *
 * Served by dev/focus-server.mjs (npm run dev:focus), the tool writes straight
 * back into the source — a value that has to be pasted is a value that gets
 * pasted wrong. Opened from file:// it still works, minus the writing.
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
import { readRowMetrics } from "./formTokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const IMG = {
  amoretto: "amoretto.jpg",
  eureka: "eureka.png",
  sena: "sena.png",
  torori: "torori.png",
  mangjing: "mangjing.png",
};

const palettes = buildAllStreamerPalettes().filter((p) => IMG[p.id]);

/** 행 치수는 ui-forms.css 가 갖고 있다. 여기서 따로 정하면 둘이 갈라진다. */
const { rowHeight: ROW_HEIGHT, bleedWidth: BLEED_WIDTH } = readRowMetrics();

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

/* 위에 붙어 따라오는 조작 줄. 카드를 어디까지 내려도 적용이 손에 닿아 있어야
   한다 — 값을 고친 뒤 맨 위로 올라가야 저장할 수 있으면 저장을 미루게 된다. */
.bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;margin-bottom:16px;
  background:#181b23;border:1px solid #262b36;border-radius:12px;padding:11px 14px}
.bar label{font-size:11px;color:#9aa2b8;white-space:nowrap}
.bar input[type=range]{width:200px;accent-color:#6b8cff}
.bar .hv{font:11px "SFMono-Regular",monospace;color:#c7cdda;min-width:46px}
.bar .status{margin-left:auto;font-size:11.5px;color:#8b93a8;min-height:1em}
.bar .status.ok{color:#5fbf87}.bar .status.bad{color:#e0736b}
.bar .apply{border:0;background:#4a63d8;color:#fff;border-radius:8px;padding:8px 18px;
  font:700 12px "Pretendard";cursor:pointer}
.bar .apply:hover{background:#5872e6}
.bar .apply:disabled{opacity:.55;cursor:default}
.bar kbd{font:10px "SFMono-Regular",monospace;background:#2a3040;border:1px solid #384054;
  border-radius:4px;padding:1px 5px;color:#c7cdda}

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
.prev{position:relative;height:var(--row-h);border-radius:10px;overflow:hidden;display:flex;align-items:center;
  padding:0 0 0 19px;isolation:isolate;transition:height 120ms ease-out;--flat:calc(100% - var(--bleed-w))}
.prev .rail{position:absolute;inset:0 auto 0 0;width:7px;z-index:3}
/* 그림 자체를 왼쪽에서 페이드시킨다 — 실제 행과 같은 마스크라야 여기서 본 것이
   그대로 나온다. */
.prev .bleed{position:absolute;inset:0 0 0 auto;width:var(--bleed-w);z-index:1;background-size:cover;background-repeat:no-repeat;
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 38%);mask-image:linear-gradient(90deg,transparent 0%,#000 38%)}
.prev .scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,
  color-mix(in srgb,var(--accent) 14%,var(--bg2)) 0%,
  color-mix(in srgb,var(--accent) 14%,var(--bg2)) calc(var(--flat) - 2%),
  color-mix(in srgb,var(--accent) 10%,transparent) calc(var(--flat) + 24%),
  transparent 100%)}
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
let rowHeight = ${ROW_HEIGHT};
let bleedWidth = ${BLEED_WIDTH};
const INITIAL_HEIGHT = rowHeight;
const INITIAL_BLEED = bleedWidth;

function setRowHeight(px) {
  rowHeight = px;
  document.documentElement.style.setProperty("--row-h", px + "px");
  document.querySelector(".hv").textContent = px + "px";
  document.getElementById("rowh").value = String(px);
}

/**
 * 사진 폭을 바꾸면 글자 뒤의 평평한 구간도 같이 움직인다. 막을 그대로 두면
 * 글자 뒤가 사진으로 바뀌면서 대비 보장이 조용히 무너진다.
 */
function setBleedWidth(percent) {
  bleedWidth = percent;
  document.documentElement.style.setProperty("--bleed-w", percent + "%");
  document.querySelector(".bv").textContent = percent + "%";
  document.getElementById("bleedw").value = String(percent);
}

function status(text, kind) {
  const node = document.querySelector(".status");
  node.textContent = text;
  node.className = "status" + (kind ? " " + kind : "");
}

/**
 * 소스에 바로 쓴다. 붙여 넣어야 하는 값은 잘못 붙거나 아예 안 붙는다.
 *
 * file:// 로 열면 서버가 없으므로 실패한다 — 그때는 아래 코드 상자를 쓰라고
 * 알려 주는 것이 맞다. 조용히 성공한 척하면 고친 값이 사라진다.
 */
async function applyToSource() {
  const button = document.querySelector(".apply");
  button.disabled = true;
  status("반영 중… 하네스도 다시 만든다");
  try {
    const response = await fetch("/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crops: SUBJECTS, rowHeight, bleedWidth }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    status("반영됨 · streamerProfiles.ts · ui-forms.css · 하네스 3종", "ok");
  } catch (cause) {
    status("반영 실패 — npm run dev:focus 로 열었는지 확인. 아래 코드를 복사해도 된다.", "bad");
    console.error(cause);
  } finally {
    button.disabled = false;
  }
}

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

setRowHeight(rowHeight);
setBleedWidth(bleedWidth);

// 다 맞춰 놓고 저장하려는 순간에 알려 주면 늦다. 열자마자 말한다.
if (location.protocol === "file:") {
  document.querySelector(".apply").disabled = true;
  status("파일로 열려 있어 소스에 쓸 수 없다 — npm run dev:focus 로 열거나, 아래 코드를 복사한다.", "bad");
}

document.getElementById("rowh").addEventListener("input", (event) => {
  setRowHeight(Number(event.target.value));
});
document.getElementById("bleedw").addEventListener("input", (event) => {
  setBleedWidth(Number(event.target.value));
});

document.querySelector(".apply").addEventListener("click", () => { void applyToSource(); });

document.querySelector(".bar .revert").addEventListener("click", () => {
  for (const s of SUBJECTS) {
    const start = INITIAL.find((one) => one.id === s.id);
    s.x = start.x; s.y = start.y; s.zoom = start.zoom;
    paint(s, document.getElementById("card-" + s.id));
  }
  setRowHeight(INITIAL_HEIGHT);
  setBleedWidth(INITIAL_BLEED);
  status("불러온 값으로 되돌림 — 아직 반영하지 않았다");
});

// 저장의 보편적 키. 브라우저의 페이지 저장을 막고 우리 저장으로 바꾼다.
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void applyToSource();
  }
});

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
    <div class="prev" style="background:${s.bg2};--accent:${s.accent};--bg2:${s.bg2}">
      <div class="rail" style="background:linear-gradient(170deg, ${s.railStart}, ${s.railEnd})"></div>
      <div class="bleed" style="background-image:url('../public/streamers/${s.file}')"></div>
      <div class="scrim"></div>
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
다 맞췄으면 <b>Ctrl+S</b> — 소스에 바로 쓰고 하네스까지 다시 만든다(<code>npm run dev:focus</code> 로 열었을 때).
지금 값이 미리 들어가 있으므로 <b>고칠 것만</b> 건드리면 된다. 아래 코드 상자는 서버 없이 열었을 때를 위한 것이다.</p>

<div class="bar">
  <label for="rowh">행 높이</label>
  <input id="rowh" type="range" min="52" max="120" step="1" value="${ROW_HEIGHT}">
  <span class="hv"></span>
  <label for="bleedw">사진 폭</label>
  <input id="bleedw" type="range" min="25" max="70" step="1" value="${BLEED_WIDTH}">
  <span class="bv"></span>
  <button class="reset revert" type="button">전부 되돌리기</button>
  <span class="status"></span>
  <button class="apply" type="button">반영 <kbd>Ctrl+S</kbd></button>
</div>

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
