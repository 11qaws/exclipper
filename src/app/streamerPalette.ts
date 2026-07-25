/**
 * Per-streamer palettes for the review surface.
 *
 * Each theme has one identity hue. Everything else — the accent fill, the ink
 * used for coloured text, the tinted neutrals — is *derived* from that single
 * hue by fixed rules, so every theme carries the same tonal weight and a swap
 * reads as "a different skin of the same app" rather than an unrelated scheme.
 *
 * Legibility is solved, not guessed. Two colours at the same HSL lightness can
 * have very different real brightness — a green at L62 is far brighter than a
 * blue at L62 — so a fixed lightness makes white button labels legible on some
 * themes and unreadable on others. Instead the accent's lightness is *solved*
 * per hue so white label text always clears WCAG AA (≥4.5:1), and the coloured
 * ink used for text on light grounds is solved to an even safer 6.5:1. That is
 * what holds all themes at one perceptual weight: equal contrast, not equal L.
 *
 * The neutrals (surfaces, ink) are tinted toward the same hue at very low
 * saturation, the way a lavender ground tints toward violet.
 *
 * This module only produces token *values*. The surface consumes them through
 * `--rvw-*` custom properties, so a swap is one attribute flip on the root.
 */

export type StreamerId =
  | "default"
  | "amoretto"
  | "eureka"
  | "sena"
  | "torori"
  | "mangjing"
  | "violet"
  | "amber"
  | "hotpink"
  | "brick";

/** What a seed represents, so the picker can group them. */
export type PaletteKind = "base" | "streamer" | "extra";

export interface StreamerPaletteSeed {
  readonly id: StreamerId;
  readonly name: string;
  readonly kind: PaletteKind;
  /** Identity hue in degrees [0, 360), from the streamer's brand art. */
  readonly hue: number;
  /**
   * Chroma multiplier on the base saturation band. A brand that reads muted
   * (아모레또's brick brown-red, 세나's soft lavender) pulls this below 1; a
   * vivid one (망징이's blue) pushes it above.
   */
  readonly chroma?: number;
}

/**
 * Seeds.
 *
 * base    — the group (교환학생) tone; the app's default when no streamer is set.
 * streamer— one per streamer, hue read from their own brand art, not guessed.
 * extra   — a manual-pick shelf of colours worth keeping: the original violet
 *           default, the amber/gold that was 유레카's first read, the full
 *           hot pink (too strong for the base but worth having), and 아모레또's
 *           earlier brown-red brick. These are opt-in themes, so they are
 *           allowed to sit near a base/streamer hue — only base+streamer must
 *           never collide.
 *
 * Two identity relationships need care. The group (교환학생) brand is a hot
 * pink (hue 338, from the 1기 poster); at full intensity it overpowers the
 * screen, so the base is a softened rose (hue 350) — "the group pink, toned
 * down a touch" — and the full hot pink is kept on the extra shelf. 아모레또
 * belongs to that group and her own overlay is the same pink toned right down
 * to a dusty wine-mauve (hue ~344 at ~35% sat, from her "BAR AMORE" profile),
 * so base and 아모레또 share a hue and are held apart by a large chroma gap.
 * Separately, 토로리's sky (202) and 망징이's deeper blue (216) share a family
 * and are held apart by a smaller hue+chroma gap. Hues are read from brand art.
 */
export const STREAMER_PALETTE_SEEDS: readonly StreamerPaletteSeed[] = [
  { id: "default", name: "기본 · 교환학생", kind: "base", hue: 350, chroma: 1 }, // group rose, softened from the 1기 poster hot pink
  { id: "amoretto", name: "아모레또", kind: "streamer", hue: 344, chroma: 0.48 }, // dusty wine-mauve (BAR AMORE)
  { id: "eureka", name: "유레카", kind: "streamer", hue: 152, chroma: 0.95 }, // brand green-teal
  { id: "sena", name: "세나 아르벨", kind: "streamer", hue: 276, chroma: 0.5 }, // muted periwinkle-violet (beret)
  { id: "torori", name: "토로리 코코", kind: "streamer", hue: 202, chroma: 0.8 }, // soft sky blue
  { id: "mangjing", name: "망징이", kind: "streamer", hue: 216, chroma: 1.05 }, // deeper blue
  { id: "violet", name: "클래식 바이올렛", kind: "extra", hue: 249, chroma: 1 }, // preserved original default
  { id: "amber", name: "앰버 · 골드", kind: "extra", hue: 40, chroma: 1.05 }, // preserved gold
  { id: "hotpink", name: "핫핑크 · 교환학생", kind: "extra", hue: 338, chroma: 1.15 }, // full-intensity group pink (1기 poster)
  { id: "brick", name: "브라운 레드", kind: "extra", hue: 14, chroma: 0.72 }, // preserved earlier amoretto brick
];

export interface ThemeTokens {
  readonly accent: string;
  readonly accentInk: string;
  readonly accentBg: string;
  readonly accentLine: string;
  readonly bg: string;
  readonly bg2: string;
  readonly bg3: string;
  readonly line: string;
  readonly line2: string;
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly ink4: string;
  /**
   * 채운 accent 위에 얹는 글자색.
   *
   * 다크에서 대비를 맞추려고 accent 를 어둡게 죽이면 스트리머 색이 사라진다.
   * 그래서 accent 는 선명하게 두고 **글자색을 바꾼다** — 라이트에선 흰 글자,
   * 다크에선 그 색조의 짙은 잉크. 색은 살고 대비는 확보된다.
   */
  readonly accentOn: string;
}

export interface StreamerPalette {
  readonly id: StreamerId;
  readonly name: string;
  readonly kind: PaletteKind;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.round(Math.max(0, Math.min(100, s)));
  const lit = Math.round(Math.max(0, Math.min(100, l)));
  return `hsl(${Math.round(hue)} ${sat}% ${lit}%)`;
}

/* --- WCAG contrast solving, so legibility is computed rather than eyeballed. --- */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((((h % 360) + 360) % 360)) / 360;
  const sat = Math.max(0, Math.min(1, s / 100));
  const lit = Math.max(0, Math.min(1, l / 100));
  if (sat === 0) return [lit, lit, lit];
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  const conv = (t: number): number => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return [conv(hue + 1 / 3), conv(hue), conv(hue - 1 / 3)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between white (#fff) and an HSL colour. */
function contrastWithWhite(h: number, s: number, l: number): number {
  const lum = relativeLuminance(hslToRgb(h, s, l));
  return 1.05 / (lum + 0.05);
}

/**
 * The lightest L in [loL, hiL] whose colour still clears `target` contrast
 * against white. Scanning from bright downward returns the most vivid legible
 * tone rather than an over-darkened one.
 */
function solveLightness(
  h: number,
  s: number,
  target: number,
  hiL = 62,
  loL = 18,
): number {
  for (let l = Math.round(hiL); l >= loL; l -= 1) {
    if (contrastWithWhite(h, s, l) >= target) return l;
  }
  return loL;
}

function parseHsl(value: string): [number, number, number] | null {
  const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(value);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Contrast of an `hsl(H S% L%)` string against white — exported for tests. */
export function contrastOnWhite(hslString: string): number {
  const parsed = parseHsl(hslString);
  if (parsed === null) return 0;
  return contrastWithWhite(parsed[0], parsed[1], parsed[2]);
}

/** Contrast ratio between any two `hsl(...)` strings — exported for tests. */
export function contrastBetween(a: string, b: string): number {
  const left = parseHsl(a);
  const right = parseHsl(b);
  if (left === null || right === null) return 0;
  const lumA = relativeLuminance(hslToRgb(left[0], left[1], left[2]));
  const lumB = relativeLuminance(hslToRgb(right[0], right[1], right[2]));
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The label colour to put on a filled accent.
 *
 * White first, because that is the familiar look on a saturated button. When
 * the accent is light — which is exactly what a dark theme wants, so the
 * streamer's colour still reads — white fails, so a deep ink of the same hue is
 * solved instead. Darkening the accent itself would pass the check by throwing
 * away the identity the palette exists to carry.
 */
function solveAccentOn(h: number, s: number, accentL: number): string {
  const white = hsl(h, 0, 100);
  const accent = hsl(h, s, accentL);
  if (contrastBetween(white, accent) >= 4.5) return white;
  for (let l = 30; l >= 6; l -= 1) {
    if (contrastBetween(hsl(h, Math.min(60, s), l), accent) >= 4.5) {
      return hsl(h, Math.min(60, s), l);
    }
  }
  return hsl(h, 40, 8);
}

/**
 * Build one theme's tokens. The accent fill and the ink are contrast-solved so
 * every theme is equally legible; the neutrals carry a whisper of the hue
 * (≤30% sat) so surfaces feel tinted, never grey, never loud.
 */
export function buildStreamerPalette(seed: StreamerPaletteSeed): StreamerPalette {
  const h = seed.hue;
  const c = seed.chroma ?? 1;
  const accentSat = Math.round(72 * c);

  // Fill under white labels: AA (4.5). Coloured text/ink on light grounds: a
  // safer 6.5 so small text and marks stay crisp. Ink is never lighter than
  // the fill.
  const accentL = solveLightness(h, accentSat, 4.5);
  const inkL = solveLightness(h, accentSat, 6.5, accentL);

  const light: ThemeTokens = {
    accent: hsl(h, accentSat, accentL),
    accentOn: solveAccentOn(h, accentSat, accentL),
    accentInk: hsl(h, accentSat, inkL),
    accentBg: hsl(h, Math.min(60, accentSat), 94),
    accentLine: hsl(h, Math.min(55, accentSat), 84),
    bg: hsl(h, 0, 100),
    bg2: hsl(h, 22, 97),
    bg3: hsl(h, 20, 93),
    line: hsl(h, 18, 90),
    line2: hsl(h, 20, 80),
    ink: hsl(h, 30, 13),
    ink2: hsl(h, 20, 32),
    ink3: hsl(h, 14, 48),
    ink4: hsl(h, 12, 64),
  };

  /*
   * Dark keeps the accent bright and saturated. A dark ground is where a
   * streamer's colour can actually show, so the fix for contrast is the label
   * on top — not a duller accent. The coloured ink is then solved upward until
   * it clears the dark surface, since on this ground the danger is text that is
   * too dark rather than too light.
   */
  const darkSat = Math.min(100, accentSat + 8);
  const darkBg = hsl(h, 30, 14);

  /*
   * Coloured text on the dark ground has a failure mode that contrast alone
   * does not catch: a saturated colour at high lightness glows instead of
   * reading. The eye takes it for a light source and the letterforms go soft —
   * bright, but not legible, like a neon sign.
   *
   * So the ink is capped in saturation and then solved for a higher target
   * (7:1) than the 4.5 floor used for fills. The cap only bites where the hue
   * was over-saturated to begin with — 핫핑크 91→52, 망징이 84→52 — while
   * already-muted identities (아모레또 43, 세나 44) keep their chroma and gain
   * their legibility from lightness instead. One rule, distributed by need.
   */
  const darkInkSat = Math.min(darkSat, 52);
  let darkInkL = 80;
  for (let l = 55; l <= 96; l += 1) {
    if (contrastBetween(hsl(h, darkInkSat, l), darkBg) >= 7) {
      darkInkL = l;
      break;
    }
  }

  const dark: ThemeTokens = {
    accent: hsl(h, darkSat, 74),
    accentOn: solveAccentOn(h, darkSat, 74),
    accentInk: hsl(h, darkInkSat, darkInkL),
    accentBg: hsl(h, 42, 21),
    accentLine: hsl(h, 40, 35),
    bg: darkBg,
    bg2: hsl(h, 34, 9),
    bg3: hsl(h, 28, 20),
    line: hsl(h, 26, 24),
    line2: hsl(h, 26, 34),
    ink: hsl(h, 24, 93),
    ink2: hsl(h, 18, 84),
    ink3: hsl(h, 14, 66),
    ink4: hsl(h, 12, 46),
  };

  return { id: seed.id, name: seed.name, kind: seed.kind, light, dark };
}

export function buildAllStreamerPalettes(): readonly StreamerPalette[] {
  return STREAMER_PALETTE_SEEDS.map(buildStreamerPalette);
}

/**
 * The four global accent tokens the app is painted with (`--ex-accent*`, see
 * styles/exclipper-app.css), mapped from a theme's tokens. Accent only — the
 * neutral surfaces stay on the app's own scale, so a streamer swap recolours
 * buttons/links/active states without repainting every surface.
 */
export function accentCssVars(theme: ThemeTokens): Record<string, string> {
  return {
    "--ex-accent": theme.accent,
    "--ex-accent-on": theme.accentOn,
    "--ex-accent-ink": theme.accentInk,
    "--ex-accent-bg": theme.accentBg,
    "--ex-accent-line": theme.accentLine,
  };
}
