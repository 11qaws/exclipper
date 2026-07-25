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

  it("keeps every theme equally legible (contrast-solved, not equal-lightness)", () => {
    // The real invariant is equal *contrast*, not equal L: a white button label
    // must clear AA (4.5:1) on every accent, and coloured ink must stay crisp
    // (≥6.5:1) on white, no matter how bright the hue reads.
    for (const p of buildAllStreamerPalettes()) {
      expect(contrastOnWhite(p.light.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOnWhite(p.light.accentInk)).toBeGreaterThanOrEqual(6.5);
    }
  });

  it("keeps the two blues distinct (torori sky vs mangjing deeper blue)", () => {
    const torori = STREAMER_PALETTE_SEEDS.find((s) => s.id === "torori")!;
    const mangjing = STREAMER_PALETTE_SEEDS.find((s) => s.id === "mangjing")!;
    // same family, so held apart by both a hue gap and a chroma gap
    expect(Math.abs(torori.hue - mangjing.hue)).toBeGreaterThanOrEqual(10);
    expect(
      Math.abs((torori.chroma ?? 1) - (mangjing.chroma ?? 1)),
    ).toBeGreaterThanOrEqual(0.15);
  });

  it("keeps button labels legible on the accent in both themes", () => {
    // Dark is where a streamer's colour can actually show, so the accent stays
    // bright there and the *label* changes instead. Darkening the accent to
    // pass this check would throw away the identity the palette carries.
    for (const p of buildAllStreamerPalettes()) {
      expect(contrastBetween(p.light.accentOn, p.light.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastBetween(p.dark.accentOn, p.dark.accent)).toBeGreaterThanOrEqual(4.5);
      // coloured text on the dark ground has to clear it too
      expect(contrastBetween(p.dark.accentInk, p.dark.bg)).toBeGreaterThanOrEqual(4.5);
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
        const distinguishable =
          hueDist >= 30 ||
          (hueDist >= 10 && chromaGap >= 0.2) ||
          chromaGap >= 0.45;
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
