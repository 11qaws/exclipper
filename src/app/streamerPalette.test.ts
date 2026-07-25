import { describe, expect, it } from "vitest";

import {
  STREAMER_PALETTE_SEEDS,
  buildAllStreamerPalettes,
  buildStreamerPalette,
  contrastBetween,
  contrastOnWhite,
} from "./streamerPalette";

describe("streamer palette", () => {
  it("produces one palette per seed with both themes", () => {
    const palettes = buildAllStreamerPalettes();
    expect(palettes).toHaveLength(STREAMER_PALETTE_SEEDS.length);
    for (const p of palettes) {
      expect(p.light.accent.startsWith("hsl(")).toBe(true);
      expect(p.dark.accent.startsWith("hsl(")).toBe(true);
    }
  });

  it("carries the seed hue into the accent (identity is preserved)", () => {
    const p = buildStreamerPalette({
      id: "amoretto",
      name: "아모레또",
      kind: "streamer",
      hue: 350,
    });
    expect(p.light.accent).toMatch(/^hsl\(350 /);
    expect(p.light.ink.includes("350")).toBe(true); // neutrals tinted with the hue
  });

  it("keeps coloured text crisp on the light ground", () => {
    // The ink is what carries the hue as *text*, so it stays solved against the
    // page regardless of how light the fill is. (The fill itself is no longer
    // required to suit white text — see the accentOn test: a pale identity
    // keeps its lightness and takes a dark label instead.)
    for (const p of buildAllStreamerPalettes()) {
      expect(contrastOnWhite(p.light.accentInk)).toBeGreaterThanOrEqual(6.5);
    }
  });

  it("keeps the two blues distinct (torori pale ice vs mangjing deep blue)", () => {
    const torori = STREAMER_PALETTE_SEEDS.find((s) => s.id === "torori")!;
    const mangjing = STREAMER_PALETTE_SEEDS.find((s) => s.id === "mangjing")!;
    // These two sit close on the wheel, so what separates them is tone and
    // chroma, not hue: one is a washed-out ice blue, the other a saturated
    // deep blue. That reads as further apart than an 8° hue gap suggests.
    expect(torori.tone).toBe("pale");
    expect(mangjing.tone ?? "solid").toBe("solid");
    // What actually separates them on screen is lightness: one sits up in the
    // ice band, the other down where white text fits. Both keep real chroma —
    // draining it is what turned the ice blue grey.
    const lightnessOf = (id: string): number => {
      const p = buildAllStreamerPalettes().find((x) => x.id === id)!;
      return Number(/hsl\(\d+ \d+% (\d+)%\)/.exec(p.light.accent)![1]);
    };
    expect(lightnessOf("torori") - lightnessOf("mangjing")).toBeGreaterThanOrEqual(20);
    const satOf = (id: string): number => {
      const p = buildAllStreamerPalettes().find((x) => x.id === id)!;
      return Number(/hsl\(\d+ (\d+)%/.exec(p.light.accent)![1]);
    };
    expect(satOf("torori")).toBeGreaterThanOrEqual(65); // clear sky, not washed out
  });

  it("keeps every pale theme well above every solid one in lightness", () => {
    // Tone is what separates a pale identity from a solid one at the same hue,
    // and tone is only readable if the lightness bands do not overlap.
    const lightnessOf = (p: { readonly light: { readonly accent: string } }): number =>
      Number(/hsl\(\d+ \d+% (\d+)%\)/.exec(p.light.accent)![1]);
    const built = buildAllStreamerPalettes();
    const paleIds = new Set(
      STREAMER_PALETTE_SEEDS.filter((s) => s.tone === "pale").map((s) => s.id),
    );
    const pales = built.filter((p) => paleIds.has(p.id));
    const solids = built.filter((p) => !paleIds.has(p.id));
    expect(pales.length).toBeGreaterThan(0);
    for (const pale of pales) {
      for (const solid of solids) {
        expect(lightnessOf(pale) - lightnessOf(solid)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("keeps button labels legible on the accent in both themes", () => {
    // Dark is where a streamer's colour can actually show, so the accent stays
    // bright there and the *label* changes instead. Darkening the accent to
    // pass this check would throw away the identity the palette carries.
    for (const p of buildAllStreamerPalettes()) {
      expect(contrastBetween(p.light.accentOn, p.light.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastBetween(p.dark.accentOn, p.dark.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps dark coloured text readable rather than glowing", () => {
    // On a dark ground a saturated colour at high lightness reads as a light
    // source, not as letters — bright but illegible, like a neon sign. Passing
    // 4.5:1 is not enough to avoid it, so the ink is held to a saturation
    // ceiling and a higher contrast target.
    for (const p of buildAllStreamerPalettes()) {
      const m = /hsl\(\d+ (\d+)% \d+%\)/.exec(p.dark.accentInk);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(52);
      expect(contrastBetween(p.dark.accentInk, p.dark.bg)).toBeGreaterThanOrEqual(7);
    }
  });

  it("keeps the dark accent bright enough to still read as the streamer's colour", () => {
    for (const p of buildAllStreamerPalettes()) {
      const m = /hsl\(\d+ (\d+)% (\d+)%\)/.exec(p.dark.accent);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(35); // saturated, not greyed
      expect(Number(m![2])).toBeGreaterThanOrEqual(60); // bright on a dark ground
    }
  });

  it("keeps every auto-assigned theme (base + streamer) distinguishable", () => {
    // Only base + streamer themes are auto-assigned, so those must never be
    // mistaken for each other. The `extra` shelf is a manual pick list and is
    // deliberately allowed to hold near-variants (soft rose beside the group
    // hot pink, brown-red beside 아모레또's mauve), so it is exempt.
    // Three ways for a required pair to be safe:
    //   · a wide hue gap (most pairs), or
    //   · adjacent hue but a moderate chroma gap (the two blues), or
    //   · the *same* hue but a big chroma gap — a vivid hot pink vs a greyed
    //     mauve read as clearly different even at one hue (group vs 아모레또).
    const seeds = STREAMER_PALETTE_SEEDS.filter((s) => s.kind !== "extra");
    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        const a = seeds[i];
        const b = seeds[j];
        if (a === undefined || b === undefined) continue;
        const raw = Math.abs(a.hue - b.hue);
        const hueDist = Math.min(raw, 360 - raw);
        const chromaGap = Math.abs((a.chroma ?? 1) - (b.chroma ?? 1));
        const toneDiffers = (a.tone ?? "solid") !== (b.tone ?? "solid");
        const distinguishable =
          hueDist >= 30 ||
          (hueDist >= 10 && chromaGap >= 0.2) ||
          chromaGap >= 0.45 ||
          // 밝은 얼음빛과 진한 색은 같은 색상이어도 한눈에 갈린다 — 명도대가
          // 통째로 다르기 때문이다. 그 명도 간격은 아래 테스트가 지킨다.
          toneDiffers;
        expect(distinguishable, `${a.id} vs ${b.id}`).toBe(true);
      }
    }
  });

  it("tints neutrals toward the hue but keeps them near-grey (low saturation)", () => {
    const p = buildStreamerPalette({
      id: "torori",
      name: "토로리",
      kind: "streamer",
      hue: 218,
    });
    // bg2 should carry the hue but at low saturation (a whisper, not a wash)
    const m = /hsl\(\d+ (\d+)%/.exec(p.light.bg2);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(30);
  });
});
