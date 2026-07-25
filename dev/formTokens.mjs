/**
 * Reads and writes the tunable numbers in the stylesheet that owns them.
 *
 * They live in styles/forms/ui-forms.css because that is the file that actually
 * draws the row. Harness generators read them from there rather than declaring
 * their own copies — a harness with its own number stops showing what ships the
 * moment one of the two is edited, and it will still look confident about it.
 *
 * dev/focus-server writes through here, so the tool and the generators agree on
 * where these values live.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const UI_FORMS_CSS = join(here, "..", "styles", "forms", "ui-forms.css");

/**
 * 툴이 고쳐 쓰는 토큰들. 범위는 **바꿔도 무너지지 않는 폭**이다 — 슬라이더가
 * 여기를 넘어가면 막과 사진의 관계가 깨지므로 서버가 먼저 거절한다.
 */
export const TUNABLE_TOKENS = {
  rowHeight: { name: "--uf-row-height", unit: "px", min: 52, max: 120 },
  bleedWidth: { name: "--uf-row-bleed", unit: "%", min: 25, max: 70 },
};

function patternFor(token) {
  return new RegExp(`(${token.name}:\\s*)(\\d+)(${token.unit};)`);
}

export function readToken(key) {
  const token = TUNABLE_TOKENS[key];
  const match = patternFor(token).exec(readFileSync(UI_FORMS_CSS, "utf8"));
  if (match === null) {
    throw new Error(`ui-forms.css 에서 ${token.name} 을 찾지 못했다.`);
  }
  return Number(match[2]);
}

export function writeToken(key, value) {
  const token = TUNABLE_TOKENS[key];
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded < token.min || rounded > token.max) {
    throw new Error(
      `${token.name} 이 범위를 벗어났다: ${value} (${token.min}–${token.max}${token.unit})`,
    );
  }
  const pattern = patternFor(token);
  const source = readFileSync(UI_FORMS_CSS, "utf8");
  if (!pattern.test(source)) {
    throw new Error(`ui-forms.css 에서 ${token.name} 을 찾지 못했다.`);
  }
  writeFileSync(UI_FORMS_CSS, source.replace(pattern, `$1${rounded}$3`), "utf8");
  return rounded;
}

/** 하네스 생성기가 쓰는 묶음 읽기. */
export function readRowMetrics() {
  return { rowHeight: readToken("rowHeight"), bleedWidth: readToken("bleedWidth") };
}

export function readRowHeight() {
  return readToken("rowHeight");
}
