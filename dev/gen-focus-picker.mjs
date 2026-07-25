/**
 * Generates dev/focus-picker.html — where the row's portraits, text and metrics
 * are set by looking at them.
 *
 *   npm run dev:focus   →  http://localhost:5178/
 *
 * Values guessed from a thumbnail are wrong, and every art update invalidates
 * them again, so the aiming belongs to whoever can see the picture. Served by
 * dev/focus-server.mjs the tool writes straight back into the source; opened as
 * a file it still previews, but cannot save.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";
import { streamerPortraitCrop, streamerProfileFileName, streamerSubtitle } from "../src/app/streamerProfiles.ts";
import { readRowMetrics, TEXT_SIZE_BASE } from "./formTokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** 행 치수는 ui-forms.css 가 갖고 있다. 여기서 따로 정하면 둘이 갈라진다. */
const M = readRowMetrics();

const SUBJECTS = buildAllStreamerPalettes()
  .filter((p) => streamerProfileFileName(p.name))
  .map((p) => {
    const { focus, zoom } = streamerPortraitCrop(p.name);
    const [x, y] = focus.split(/\s+/).map((v) => parseFloat(v));
    const t = p.light;
    return {
      id: p.id,
      name: p.name,
      subtitle: streamerSubtitle(p.name),
      file: streamerProfileFileName(p.name),
      x,
      y,
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
.lead{font-size:12.5px;color:#9aa2b8;margin:0 0 20px;line-height:1.7;max-width:78ch}
.lead b{color:#dfe4f0}
.lead code{font:11px "SFMono-Regular",monospace;background:#1d212b;padding:1px 5px;border-radius:4px}

/* 위에 붙어 따라오는 조작 줄. 카드를 어디까지 내려도 저장이 손에 닿아 있어야
   한다 — 고친 뒤 맨 위로 올라가야 저장할 수 있으면 저장을 미루게 된다. */
.bar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:repeat(3,auto) 1fr auto;
  gap:8px 16px;align-items:center;margin-bottom:16px;
  background:#181b23;border:1px solid #262b36;border-radius:12px;padding:12px 16px}
.knob{display:flex;align-items:center;gap:8px}
.knob label{font-size:11px;color:#9aa2b8;white-space:nowrap}
.knob input[type=range]{width:132px;accent-color:#6b8cff}
.knob output{font:11px "SFMono-Regular",monospace;color:#c7cdda;min-width:64px}
.bar .status{grid-column:1/-1;font-size:11.5px;color:#8b93a8;min-height:1em}
.bar .status.ok{color:#5fbf87}.bar .status.bad{color:#e0736b}
.bar .acts{display:flex;gap:8px;align-items:center}
.apply{border:0;background:#4a63d8;color:#fff;border-radius:8px;padding:8px 18px;
  font:700 12px "Pretendard";cursor:pointer}
.apply:hover{background:#5872e6}
.apply:disabled{opacity:.55;cursor:default}
kbd{font:10px "SFMono-Regular",monospace;background:#2a3040;border:1px solid #384054;
  border-radius:4px;padding:1px 5px;color:#c7cdda}
.ghost{border:1px solid #333947;background:#1f2430;color:#c7cdda;border-radius:7px;padding:6px 12px;
  font:600 11px "Pretendard";cursor:pointer}
.ghost:hover{background:#262c3a}

.cards{display:flex;flex-direction:column;gap:14px}
.card{display:grid;grid-template-columns:230px minmax(0,1fr);gap:16px;
  background:#191c24;border-radius:14px;padding:14px}

/* 왼쪽 — 조준. 그림이 바뀌어도 이 칸의 크기는 그대로다. 칸이 그림 따라 변하면
   조준점의 의미도 같이 흔들린다. */
.aim{position:relative;width:230px;height:230px;border-radius:10px;overflow:hidden;background:#0d0f14;
  cursor:crosshair;touch-action:none;user-select:none}
.aim img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
.aim.drop{outline:2px dashed #6b8cff;outline-offset:-4px}
.cross{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;pointer-events:none;
  border:2px solid #ff5a5a;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.55),inset 0 0 0 1px rgba(0,0,0,.55)}
.cross::before,.cross::after{content:"";position:absolute;background:#ff5a5a}
.cross::before{left:50%;top:-9px;width:2px;height:9px;margin-left:-1px}
.cross::after{top:50%;left:-9px;height:2px;width:9px;margin-top:-1px}
.under{margin-top:7px;display:flex;flex-direction:column;gap:5px;align-items:stretch}
.hint{font-size:11px;color:#7d8598;text-align:center}
.res{font:10px "SFMono-Regular",monospace;color:#7d8598;text-align:center}
.res.thin{color:#e0a76b}
.pick{width:100%}
.pick input{display:none}

/* 오른쪽 — 실제 행 미리보기. 폭까지 실제 값으로 그린다. */
.right{display:flex;flex-direction:column;gap:9px;min-width:0;overflow-x:auto}
.prev{position:relative;flex:none;width:var(--design-w);height:var(--row-h);border-radius:10px;
  overflow:hidden;display:flex;align-items:center;padding:0 0 0 19px;isolation:isolate;
  --flat:calc(100% - var(--bleed-w))}
.prev .rail{position:absolute;inset:0 auto 0 0;width:7px;z-index:3}
/* 그림 자체를 왼쪽에서 페이드시킨다 — 실제 행과 같은 마스크라야 여기서 본 것이
   그대로 나온다. */
.prev .bleed{position:absolute;inset:0 0 0 auto;width:var(--bleed-w);z-index:1;
  background-size:cover;background-repeat:no-repeat;
  -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 38%);
  mask-image:linear-gradient(90deg,transparent 0%,#000 38%)}
.prev .scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,
  color-mix(in srgb,var(--accent) 14%,var(--bg2)) 0%,
  color-mix(in srgb,var(--accent) 14%,var(--bg2)) calc(var(--flat) - 2%),
  color-mix(in srgb,var(--accent) 10%,transparent) calc(var(--flat) + 24%),
  transparent 100%)}
.prev .txt{position:relative;z-index:3;display:flex;flex-direction:column;gap:2px;min-width:0}
.prev .txt b{font-size:var(--title-px);font-weight:800;line-height:1.2;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.prev .txt span{font-size:var(--sub-px);font-weight:600;letter-spacing:.02em}

.fields{display:flex;gap:10px;flex-wrap:wrap}
.field{display:flex;align-items:center;gap:7px;min-width:0}
.field label{font-size:11px;color:#9aa2b8;white-space:nowrap}
.field input[type=text]{background:#11141b;border:1px solid #2a2f3c;border-radius:7px;
  padding:5px 9px;color:#e6e9f2;font:600 12px "Pretendard";min-width:0;width:15ch}
.field input[type=text]:focus{outline:2px solid #4a63d8;outline-offset:-1px}
.ctrl{display:flex;align-items:center;gap:11px}
.ctrl label{font-size:11px;color:#9aa2b8;white-space:nowrap}
.ctrl input[type=range]{flex:1;min-width:120px;accent-color:#6b8cff}
.val{font:11px "SFMono-Regular",monospace;color:#c7cdda;min-width:130px;text-align:right}

.out{margin-top:20px;background:#191c24;border-radius:14px;padding:14px}
.out header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.out h2{font-size:13px;margin:0}
.out .note{font-size:11px;color:#8b93a8}
.copy{margin-left:auto}
textarea{width:100%;height:200px;background:#0f1116;color:#cfd6e6;border:1px solid #2a2f3c;
  border-radius:9px;padding:12px;font:12px/1.6 "SFMono-Regular",monospace;resize:vertical}
`;

const SCRIPT = `
const SUBJECTS = ${JSON.stringify(SUBJECTS)};
const INITIAL = JSON.parse(JSON.stringify(SUBJECTS));
const BASE = ${JSON.stringify(TEXT_SIZE_BASE)};

const metrics = { rowHeight: ${M.rowHeight}, bleedWidth: ${M.bleedWidth},
  designWidth: ${M.designWidth}, titleSize: ${M.titleSize}, subSize: ${M.subSize} };
const INITIAL_METRICS = { ...metrics };

/**
 * 글자 크기는 %로 다루되 심는 값은 **정수 px** 이다.
 *
 * em 이나 소수 px 은 픽셀 격자에 걸치며 흐려지고, 한글은 획이 촘촘해 그 흐림이
 * 먼저 눈에 띈다. 슬라이더는 백분율을 주고, 여기서 반올림해 격자에 앉힌다.
 */
function textScale() {
  return Math.round((metrics.titleSize / BASE.titleSize) * 100);
}
function applyTextScale(percent) {
  metrics.titleSize = Math.round((BASE.titleSize * percent) / 100);
  metrics.subSize = Math.round((BASE.subSize * percent) / 100);
}

function css(name, value) {
  document.documentElement.style.setProperty(name, value);
}

function paintMetrics() {
  css("--row-h", metrics.rowHeight + "px");
  css("--bleed-w", metrics.bleedWidth + "%");
  css("--design-w", metrics.designWidth + "px");
  css("--title-px", metrics.titleSize + "px");
  css("--sub-px", metrics.subSize + "px");

  document.getElementById("rowh").value = String(metrics.rowHeight);
  document.getElementById("bleedw").value = String(metrics.bleedWidth);
  document.getElementById("deswn").value = String(metrics.designWidth);
  document.getElementById("texts").value = String(textScale());

  document.getElementById("rowh-o").textContent = metrics.rowHeight + "px";
  document.getElementById("bleedw-o").textContent = metrics.bleedWidth + "%";
  document.getElementById("deswn-o").textContent = metrics.designWidth + "px";
  // 실제 심기는 px 을 같이 보여 준다 — % 만 보면 소수로 들어가는지 알 수 없다.
  document.getElementById("texts-o").textContent =
    textScale() + "% · " + metrics.titleSize + "/" + metrics.subSize + "px";

  for (const s of SUBJECTS) paintResolution(s);
  emit();
}

/**
 * 그림이 행을 채우기에 충분한가.
 *
 * 행의 사진 칸은 CSS px 이고, 고해상도 화면은 그 두 배의 실제 픽셀을 그린다.
 * 원본이 그보다 작으면 늘려 그리므로 흐려진다 — 자를 때는 큰 원본에서 자르고,
 * 줄여 놓은 파일을 올리지 않는다.
 */
function paintResolution(s) {
  const node = document.querySelector("#card-" + s.id + " .res");
  const img = document.querySelector("#card-" + s.id + " .aim img");
  if (!img.naturalWidth) { node.textContent = ""; return; }
  const needW = Math.ceil((metrics.designWidth * metrics.bleedWidth / 100) * 2 * s.zoom);
  const needH = Math.ceil(metrics.rowHeight * 2 * s.zoom);
  const thin = img.naturalWidth < needW || img.naturalHeight < needH;
  node.textContent = img.naturalWidth + "x" + img.naturalHeight +
    (thin ? "  \\u2190 부족 (2x 기준 " + needW + "x" + needH + " 필요)" : "  충분");
  node.classList.toggle("thin", thin);
}

function focusOf(s) { return Math.round(s.x) + "% " + Math.round(s.y) + "%"; }

function paint(s) {
  const root = document.getElementById("card-" + s.id);
  const focus = focusOf(s);
  root.querySelector(".cross").style.left = s.x + "%";
  root.querySelector(".cross").style.top = s.y + "%";
  const bleed = root.querySelector(".bleed");
  bleed.style.backgroundPosition = focus;
  bleed.style.transform = "scale(" + s.zoom + ")";
  bleed.style.transformOrigin = focus;
  root.querySelector(".prev .txt b").textContent = s.name;
  root.querySelector(".prev .txt span").textContent = s.subtitle;
  root.querySelector(".val").textContent = focus + " · x" + s.zoom.toFixed(2);
  root.querySelector(".zoom").value = String(s.zoom);
  paintResolution(s);
  emit();
}

/** 서버 없이 열었을 때를 위한 출력. 붙여 넣을 수 있는 형태로만 낸다. */
function emit() {
  const crops = SUBJECTS.map((s) =>
    "  " + JSON.stringify(s.name) + ": { focus: " + JSON.stringify(focusOf(s)) +
    ", zoom: " + s.zoom + " },").join("\\n");
  const subs = SUBJECTS.map((s) =>
    "  " + JSON.stringify(s.name) + ": " + JSON.stringify(s.subtitle) + ",").join("\\n");
  document.getElementById("out").value =
    "// src/app/streamerProfiles.ts\\n" +
    "const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = {\\n" + crops + "\\n};\\n\\n" +
    "const SUBTITLE_BY_NAME: Readonly<Record<string, string>> = {\\n" + subs + "\\n};\\n\\n" +
    "/* styles/forms/ui-forms.css */\\n" +
    "  --uf-row-height: " + metrics.rowHeight + "px;\\n" +
    "  --uf-row-bleed: " + metrics.bleedWidth + "%;\\n" +
    "  --uf-row-design-width: " + metrics.designWidth + "px;\\n" +
    "  --uf-row-title-size: " + metrics.titleSize + "px;\\n" +
    "  --uf-row-sub-size: " + metrics.subSize + "px;";
}

function status(text, kind) {
  const node = document.querySelector(".status");
  node.textContent = text;
  node.className = "status" + (kind ? " " + kind : "");
}

async function applyToSource() {
  const button = document.querySelector(".apply");
  button.disabled = true;
  status("반영 중... 하네스도 다시 만든다");
  try {
    const response = await fetch("/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crops: SUBJECTS, ...metrics }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    status("반영됨 - streamerProfiles.ts / ui-forms.css / 하네스 3종", "ok");
  } catch (cause) {
    status("반영 실패 - " + cause.message + " (아래 코드를 복사해도 된다)", "bad");
  } finally {
    button.disabled = false;
  }
}

/** 새 그림을 올린다. 서버가 원본 그대로 저장하므로 해상도가 줄지 않는다. */
async function uploadImage(s, file) {
  status(s.name + " 그림 올리는 중...");
  try {
    const response = await fetch("/upload?id=" + encodeURIComponent(s.id), {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    const img = document.querySelector("#card-" + s.id + " .aim img");
    // 파일명이 같으면 브라우저가 옛 그림을 계속 쓴다.
    const url = "../public/streamers/" + result.fileName + "?v=" + Date.now();
    img.src = url;
    document.querySelector("#card-" + s.id + " .bleed").style.backgroundImage = "url('" + url + "')";
    status(s.name + " 그림 바꿈 - " + result.fileName + " (초점을 다시 확인한다)", "ok");
  } catch (cause) {
    status("그림 못 바꿈 - " + cause.message, "bad");
  }
}

for (const s of SUBJECTS) {
  const root = document.getElementById("card-" + s.id);
  const aim = root.querySelector(".aim");
  const img = aim.querySelector("img");

  /*
   * 칸은 고정 크기인데 그림은 비율이 제각각이라, contain 으로 그리면 위아래나
   * 좌우에 빈 띠가 생긴다. 칸 기준으로 좌표를 읽으면 그 띠만큼 어긋나므로,
   * 실제로 그려진 사각형을 계산해 그 안에서 비율을 잰다.
   */
  const drawnRect = () => {
    const box = aim.getBoundingClientRect();
    if (!img.naturalWidth) return box;
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2,
      width: w, height: h };
  };

  const setFromEvent = (event) => {
    const rect = drawnRect();
    s.x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    s.y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    paint(s);
  };

  // 누른 채 끌면 계속 따라온다 — 한 번 클릭으로 맞히기보다 훨씬 빠르다.
  aim.addEventListener("pointerdown", (event) => {
    aim.setPointerCapture(event.pointerId);
    setFromEvent(event);
  });
  aim.addEventListener("pointermove", (event) => {
    if (aim.hasPointerCapture(event.pointerId)) setFromEvent(event);
  });

  aim.addEventListener("dragover", (event) => { event.preventDefault(); aim.classList.add("drop"); });
  aim.addEventListener("dragleave", () => aim.classList.remove("drop"));
  aim.addEventListener("drop", (event) => {
    event.preventDefault();
    aim.classList.remove("drop");
    const file = event.dataTransfer.files[0];
    if (file) void uploadImage(s, file);
  });

  img.addEventListener("load", () => paintResolution(s));

  root.querySelector(".file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) void uploadImage(s, file);
    event.target.value = "";
  });

  root.querySelector(".zoom").addEventListener("input", (event) => {
    s.zoom = Number(event.target.value);
    paint(s);
  });
  root.querySelector(".name").addEventListener("input", (event) => {
    s.name = event.target.value;
    paint(s);
  });
  root.querySelector(".sub").addEventListener("input", (event) => {
    s.subtitle = event.target.value;
    paint(s);
  });
  root.querySelector(".revert").addEventListener("click", () => {
    const start = INITIAL.find((one) => one.id === s.id);
    Object.assign(s, { x: start.x, y: start.y, zoom: start.zoom,
      name: start.name, subtitle: start.subtitle });
    root.querySelector(".name").value = s.name;
    root.querySelector(".sub").value = s.subtitle;
    paint(s);
  });
}

for (const [id, key] of [["rowh","rowHeight"],["bleedw","bleedWidth"],["deswn","designWidth"]]) {
  document.getElementById(id).addEventListener("input", (event) => {
    metrics[key] = Number(event.target.value);
    paintMetrics();
  });
}
document.getElementById("texts").addEventListener("input", (event) => {
  applyTextScale(Number(event.target.value));
  paintMetrics();
});

document.querySelector(".apply").addEventListener("click", () => { void applyToSource(); });
document.querySelector(".revert-all").addEventListener("click", () => {
  Object.assign(metrics, INITIAL_METRICS);
  for (const s of SUBJECTS) {
    const start = INITIAL.find((one) => one.id === s.id);
    Object.assign(s, { x: start.x, y: start.y, zoom: start.zoom,
      name: start.name, subtitle: start.subtitle });
    const root = document.getElementById("card-" + s.id);
    root.querySelector(".name").value = s.name;
    root.querySelector(".sub").value = s.subtitle;
    paint(s);
  }
  paintMetrics();
  status("불러온 값으로 되돌림 - 아직 반영하지 않았다");
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
    const area = document.getElementById("out");
    area.focus(); area.select();
  }
  button.textContent = "복사됨";
  setTimeout(() => { button.textContent = "복사"; }, 1400);
});

paintMetrics();
for (const s of SUBJECTS) paint(s);

// 다 맞춰 놓고 저장하려는 순간에 알려 주면 늦다. 열자마자 말한다.
if (location.protocol === "file:") {
  document.querySelector(".apply").disabled = true;
  for (const node of document.querySelectorAll(".file, .pick")) node.disabled = true;
  status("파일로 열려 있어 소스에 쓸 수 없고 그림도 못 바꾼다 - npm run dev:focus 로 열거나 아래 코드를 복사한다.", "bad");
}
`;

function card(s) {
  return `<div class="card" id="card-${s.id}">
  <div>
    <div class="aim">
      <img src="../public/streamers/${s.file}" alt="">
      <div class="cross"></div>
    </div>
    <div class="under">
      <div class="hint">눈을 눌러 지정 · 끌면 따라옴</div>
      <div class="res"></div>
      <label class="ghost pick">그림 바꾸기 (또는 끌어다 놓기)
        <input class="file" type="file" accept="image/png,image/jpeg,image/webp">
      </label>
    </div>
  </div>
  <div class="right">
    <div class="prev" style="background:${s.bg2};--accent:${s.accent};--bg2:${s.bg2}">
      <div class="rail" style="background:linear-gradient(170deg, ${s.railStart}, ${s.railEnd})"></div>
      <div class="bleed" style="background-image:url('../public/streamers/${s.file}')"></div>
      <div class="scrim"></div>
      <div class="txt"><b style="color:${s.ink}"></b><span style="color:${s.ink2}"></span></div>
    </div>
    <div class="fields">
      <div class="field">
        <label>이름</label>
        <input class="name" type="text" value="${s.name}">
      </div>
      <div class="field">
        <label>설명</label>
        <input class="sub" type="text" value="${s.subtitle}">
      </div>
      <button class="ghost revert" type="button">이 항목 되돌리기</button>
    </div>
    <div class="ctrl">
      <label for="z-${s.id}">확대</label>
      <input class="zoom" id="z-${s.id}" type="range" min="1" max="3.5" step="0.05" value="${s.zoom}">
      <span class="val"></span>
    </div>
  </div>
</div>`;
}

function knob(id, label, min, max, step) {
  return `<div class="knob">
  <label for="${id}">${label}</label>
  <input id="${id}" type="range" min="${min}" max="${max}" step="${step}">
  <output id="${id}-o"></output>
</div>`;
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>행 만들기 · 초점 · 글자 · 치수</title><style>${CSS}</style></head><body>
<h1>사이드 리스팅 행 — 초점 · 그림 · 글자 · 치수</h1>
<p class="lead"><b>왼쪽 그림에서 눈을 누르면</b> 오른쪽 행이 바로 그 결과가 된다(끌면 따라옴). 그림은 <b>끌어다 놓거나</b> 아래 버튼으로 바꾼다 — 원본 그대로 저장하므로 해상도가 줄지 않는다.
초점은 행의 <b>가로세로 비율</b>에 걸려 있어서, 폭·높이를 먼저 정하고 맞추는 편이 빠르다. 미리보기는 항상 실제 치수로 그린다.
글자 크기는 %로 조절하되 <b>정수 px 로 반올림</b>해 심는다 — 소수 크기는 픽셀 격자에 걸치며 흐려지고, 한글은 그 흐림이 먼저 눈에 띈다.
다 되면 <b>Ctrl+S</b>. 실행은 <code>npm run dev:focus</code> → <code>http://localhost:5178/</code>.</p>

<div class="bar">
  ${knob("deswn", "행 폭", 260, 560, 4)}
  ${knob("rowh", "행 높이", 52, 120, 1)}
  ${knob("bleedw", "사진 폭", 25, 70, 1)}
  ${knob("texts", "글자 크기", 70, 170, 1)}
  <div class="acts">
    <button class="ghost revert-all" type="button">전부 되돌리기</button>
    <button class="apply" type="button">반영 <kbd>Ctrl+S</kbd></button>
  </div>
  <div class="status"></div>
</div>

<div class="cards">
${SUBJECTS.map(card).join("\n")}
</div>

<div class="out">
  <header>
    <h2>붙여 넣을 코드</h2>
    <span class="note">서버 없이 열었을 때만 필요하다</span>
    <button class="ghost copy" type="button">복사</button>
  </header>
  <textarea id="out" spellcheck="false"></textarea>
</div>

<script>${SCRIPT}</script>
</body></html>
`;

writeFileSync(join(here, "focus-picker.html"), html, "utf8");
console.log(
  `dev/focus-picker.html 생성됨 · 인물 ${SUBJECTS.length}명 · 행 ${M.designWidth}x${M.rowHeight}px · 글자 ${M.titleSize}/${M.subSize}px`,
);
