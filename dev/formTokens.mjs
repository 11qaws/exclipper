/**
 * Reads the tunable numbers out of the stylesheet that owns them.
 *
 * The row height lives in styles/forms/ui-forms.css because that is the file
 * that actually draws the row. Harness generators read it from there rather
 * than declaring their own copy — a harness with its own number stops showing
 * what ships the moment one of the two is edited, and it will still look
 * confident about it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const UI_FORMS_CSS = join(here, "..", "styles", "forms", "ui-forms.css");

const ROW_HEIGHT_PATTERN = /(--uf-row-height:\s*)(\d+)(px;)/;

export function readRowHeight() {
  const match = ROW_HEIGHT_PATTERN.exec(readFileSync(UI_FORMS_CSS, "utf8"));
  if (match === null) {
    throw new Error("ui-forms.css 에서 --uf-row-height 를 찾지 못했다.");
  }
  return Number(match[2]);
}

export function writeRowHeight(pixels) {
  const rounded = Math.round(pixels);
  if (!Number.isFinite(rounded) || rounded < 40 || rounded > 200) {
    throw new Error(`행 높이가 범위를 벗어났다: ${pixels}`);
  }
  const source = readFileSync(UI_FORMS_CSS, "utf8");
  if (!ROW_HEIGHT_PATTERN.test(source)) {
    throw new Error("ui-forms.css 에서 --uf-row-height 를 찾지 못했다.");
  }
  writeFileSync(UI_FORMS_CSS, source.replace(ROW_HEIGHT_PATTERN, `$1${rounded}$3`), "utf8");
  return rounded;
}
