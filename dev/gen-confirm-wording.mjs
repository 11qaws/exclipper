/**
 * Generates dev/confirm-wording.html — candidate button wording for the two
 * confirmations, rendered side by side.
 *
 *   npx tsx dev/gen-confirm-wording.mjs
 *
 * "취소" is the wrong word in both of these dialogs, and for a reason specific
 * to this app rather than a general style preference: 취소 already means
 * "undo a decision" here (사용 취소 · 빼기 취소), and 그만두기 already means
 * "stop the analysis". In a dialog about deleting an analysis or discarding
 * decisions, each of those reads as the thing the *other* button does.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildAllStreamerPalettes } from "../src/app/streamerPalette.ts";

const here = dirname(fileURLToPath(import.meta.url));

const DIALOGS = [
  {
    id: "delete",
    where: "이어서 할 분석 · ⋯ → 지우기",
    title: "이 분석을 지울까요?",
    body: "지금까지 분석한 75% 가 사라지고, 다시 하려면 처음부터입니다. 후보 정리(유료 분석)도 다시 해야 합니다.",
    pairs: [
      {
        label: "지금",
        safe: "그만두기",
        danger: "지우기",
        note: "이 앱에서 '그만두기' 는 분석을 그만둔다는 뜻으로도 읽힌다",
        verdict: "bad",
      },
      {
        label: "확정",
        safe: "그대로 두기",
        danger: "분석 지우기",
        note: "남는 상태를 말한다 · 지우는 쪽은 대상을 붙여 무겁게",
        verdict: "pick",
      },
      {
        label: "안 2",
        safe: "지우지 않기",
        danger: "지우기",
        note: "가장 명확하지만 부정문이라 한 박자 늦게 읽힌다",
        verdict: "ok",
      },
      {
        label: "안 3",
        safe: "돌아가기",
        danger: "지우기",
        note: "결과가 아니라 이동을 말한다 — 무엇이 남는지는 여전히 모른다",
        verdict: "ok",
      },
    ],
  },
  {
    id: "reset",
    where: "검토 화면 · Backspace",
    title: "이 후보를 처음 상태로 되돌릴까요?",
    body: "<b>릴레이 · 08:24</b> 의 사용·빼기 판단과 구간 조정이 지워지고, AI가 처음 제안한 상태로 돌아갑니다. 되돌릴 수 없습니다.",
    pairs: [
      {
        label: "지금",
        safe: "취소",
        danger: "초기화",
        note: "'취소' 는 이 화면에서 이미 '사용 취소 · 빼기 취소' 다 — 반대 버튼이 하는 일",
        verdict: "bad",
      },
      {
        label: "확정",
        safe: "그대로 두기",
        danger: "이 후보 초기화",
        note: "확정됨 · 삭제 확인창과 같은 짝 — 같은 종류의 결정은 같은 말로",
        verdict: "pick",
      },
      {
        label: "안 2",
        safe: "판단 유지",
        danger: "초기화",
        note: "지키는 대상을 말한다 · 다만 두 버튼의 무게가 비슷해 보인다",
        verdict: "ok",
      },
    ],
  },
];

function pair(dialog, one, keys) {
  return `<div class="opt ${one.verdict}">
  <div class="tag">${one.label}</div>
  <div class="box">
    <strong>${dialog.title}</strong>
    <p>${dialog.body}</p>
    <div class="acts">
      <button type="button">${one.safe}${keys ? ' <kbd>Esc</kbd>' : ""}</button>
      <button type="button" class="danger">${one.danger}${keys ? ' <kbd>↵</kbd>' : ""}</button>
    </div>
  </div>
  <div class="note">${one.note}</div>
</div>`;
}

function panel(dialog, mode) {
  const t = buildAllStreamerPalettes().find((p) => p.id === "amoretto")[mode];
  const vars = [
    `--bg:${t.bg}`,
    `--bg2:${t.bg2}`,
    `--bg3:${t.bg3}`,
    `--ink:${t.ink}`,
    `--ink2:${t.ink2}`,
    `--line:${t.line2}`,
    `--accent:${t.accent}`,
    `--on:${t.accentOn}`,
  ].join(";");
  return `<section class="panel" style="${vars}">
  <header><b>${dialog.where}</b><span>${mode === "light" ? "라이트" : "다크"}</span></header>
  <div class="opts">${dialog.pairs.map((one) => pair(dialog, one, dialog.id === "reset")).join("\n")}</div>
</section>`;
}

const CSS = `
@font-face{font-family:"Pretendard";font-weight:400;src:url("../public/fonts/Pretendard-Regular.woff2")}
@font-face{font-family:"Pretendard";font-weight:600;src:url("../public/fonts/Pretendard-SemiBold.woff2")}
@font-face{font-family:"Pretendard";font-weight:800;src:url("../public/fonts/Pretendard-ExtraBold.woff2")}
*{box-sizing:border-box}
body{margin:0;padding:22px;background:#12141a;font-family:"Pretendard",sans-serif;color:#e6e9f2}
h1{font-size:15px;margin:0 0 4px}
.lead{font-size:12px;color:#98a0b5;margin:0 0 18px;line-height:1.7;max-width:84ch}
.lead b{color:#dfe4f0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:16px;align-items:start}
.panel{background:var(--bg2);border-radius:14px;padding:14px}
.panel header{display:flex;gap:10px;align-items:baseline;margin-bottom:12px}
.panel header b{font-size:12px;color:var(--ink)}
.panel header span{font-size:10px;color:#8b93a8}
.opts{display:flex;flex-direction:column;gap:12px}
.opt{display:flex;flex-direction:column;gap:5px}
.tag{align-self:flex-start;font:10px "SFMono-Regular",monospace;padding:2px 7px;border-radius:5px;
  background:#2a2f3c;color:#c7cdda}
.opt.pick .tag{background:#2c6b4a;color:#d6f5e4}
.opt.bad .tag{background:#6b2f2c;color:#f7dedc}
.box{background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:13px 14px}
.box strong{display:block;font-size:13.5px;font-weight:800;color:var(--ink);margin-bottom:6px}
.box p{margin:0 0 11px;font-size:12px;line-height:1.6;color:var(--ink2)}
.acts{display:flex;gap:8px;justify-content:flex-end}
.acts button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;
  padding:8px 14px;font:700 12.5px "Pretendard";cursor:pointer;display:flex;align-items:center;gap:6px}
.acts .danger{border-color:transparent;background:var(--accent);color:var(--on)}
.acts kbd{font:10px "SFMono-Regular",monospace;background:rgb(0 0 0 / .12);border-radius:4px;padding:1px 4px}
.note{font-size:11px;color:#8b93a8;padding-left:2px;line-height:1.5}
.opt.pick .note{color:#7fcfa4}
.opt.bad .note{color:#e0908a}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>확인창 버튼 문구 비교</title><style>${CSS}</style></head><body>
<h1>확인창 버튼 문구 — 무엇을 취소하는가</h1>
<p class="lead">"취소" 는 <b>무엇을 취소하는지 말하지 않는다.</b> 보통은 관습으로 넘어가지만 이 앱에서는 넘어갈 수 없다 —
<b>취소</b> 는 이미 "사용 취소 · 빼기 취소" 로 <b>판단을 되돌린다</b>는 뜻이고, <b>그만두기</b> 는 <b>분석을 그만둔다</b>는 뜻이다.
판단을 지우는 창과 분석을 지우는 창에서, 그 두 낱말은 각각 <b>반대편 버튼이 하는 일</b>로 읽힌다.
안전한 쪽은 <b>남는 상태</b>를 말하고, 지우는 쪽은 <b>대상</b>을 붙인다. 같은 종류의 결정은 두 화면에서 같은 말을 쓴다.</p>
<div class="grid">
${DIALOGS.map((d) => panel(d, "light")).join("\n")}
${DIALOGS.map((d) => panel(d, "dark")).join("\n")}
</div>
</body></html>
`;

writeFileSync(join(here, "confirm-wording.html"), html, "utf8");
console.log(`dev/confirm-wording.html 생성됨 · 확인창 ${DIALOGS.length}종 × 라이트/다크`);
