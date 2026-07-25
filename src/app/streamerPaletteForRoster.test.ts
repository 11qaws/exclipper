import { describe, expect, it } from "vitest";

import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  EUREKA_CHANNEL_CAST_ROSTER_ID,
  LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  MANGJING_CHANNEL_CAST_ROSTER_ID,
  SENA_ARBEL_CHANNEL_CAST_ROSTER_ID,
  TORORI_COCO_CHANNEL_CAST_ROSTER_ID,
} from "../analysis/participantRoster";
import {
  activeAccentCssVars,
  paletteIdForCastRosterId,
} from "./streamerPaletteForRoster";

describe("streamer palette for roster", () => {
  it("maps a group / unknown source to the base palette", () => {
    expect(paletteIdForCastRosterId(null)).toBe("default");
    expect(paletteIdForCastRosterId(DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID)).toBe(
      "default",
    );
    expect(paletteIdForCastRosterId(LEGACY_CANDIDATE_PASS_B_CAST_ROSTER_ID)).toBe(
      "default",
    );
  });

  it("maps each personal channel to that streamer's palette", () => {
    expect(paletteIdForCastRosterId(AMORETTO_CHANNEL_CAST_ROSTER_ID)).toBe("amoretto");
    expect(paletteIdForCastRosterId(EUREKA_CHANNEL_CAST_ROSTER_ID)).toBe("eureka");
    expect(paletteIdForCastRosterId(SENA_ARBEL_CHANNEL_CAST_ROSTER_ID)).toBe("sena");
    expect(paletteIdForCastRosterId(TORORI_COCO_CHANNEL_CAST_ROSTER_ID)).toBe("torori");
    expect(paletteIdForCastRosterId(MANGJING_CHANNEL_CAST_ROSTER_ID)).toBe("mangjing");
  });

  it("emits the global accent tokens, theme-aware", () => {
    const light = activeAccentCssVars(EUREKA_CHANNEL_CAST_ROSTER_ID, "light");
    const dark = activeAccentCssVars(EUREKA_CHANNEL_CAST_ROSTER_ID, "dark");
    for (const vars of [light, dark]) {
      expect(Object.keys(vars).sort()).toEqual([
        "--ex-accent",
        "--ex-accent-bg",
        "--ex-accent-ink",
        "--ex-accent-line",
        // 채운 accent 위의 글자색. 다크에서 accent 를 죽이지 않고 대비를 맞춘다.
        "--ex-accent-on",
        // 레일 그라데이션 끝 색 — solid 는 어두워지고 pale 은 밝아진다.
        "--ex-rail-end",
      ]);
      expect((vars["--ex-accent"] ?? "").startsWith("hsl(152")).toBe(true); // eureka green
    }
    // light and dark are different renderings of the same hue
    expect(light["--ex-accent"]).not.toBe(dark["--ex-accent"]);
  });

  it("falls back to the base soft rose for a null source", () => {
    const vars = activeAccentCssVars(null, "light");
    expect(vars["--ex-accent"]).toBe("hsl(350 72% 53%)");
  });
});
