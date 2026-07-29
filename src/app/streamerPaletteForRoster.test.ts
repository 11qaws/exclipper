import { describe, expect, it } from "vitest";

import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  EUREKA_CHANNEL_CAST_ROSTER_ID,
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
        // 레일 그라데이션 — 어느 테마든 아래가 더 무겁다.
        "--ex-rail-end",
        "--ex-rail-start",
      ]);
      expect((vars["--ex-accent"] ?? "").startsWith("hsl(152")).toBe(true); // eureka green
    }
    // light and dark are different renderings of the same hue
    expect(light["--ex-accent"]).not.toBe(dark["--ex-accent"]);
  });

  it("falls back to the base soft rose for a null source", () => {
    const vars = activeAccentCssVars(null, "light");
    // 정제 밴드 적용값. 밴드가 바뀌면 여기도 함께 바뀌어야 한다.
    expect(vars["--ex-accent"]).toBe("hsl(350 54% 64%)");
  });
});
