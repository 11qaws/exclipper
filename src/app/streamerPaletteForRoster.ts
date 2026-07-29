/**
 * Bridges the analysis-side cast roster to the app-side palette registry.
 *
 * The app already resolves which streamer a source belongs to
 * (`candidatePassBCastRosterIdForSourceName` → a cast roster id). This maps that
 * id to a palette so the review UI can prefer the relevant streamer's colour,
 * falling back to the group base (soft rose) when the source is a group
 * broadcast or unknown.
 */
import {
  AMORETTO_CHANNEL_CAST_ROSTER_ID,
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  EUREKA_CHANNEL_CAST_ROSTER_ID,
  MANGJING_CHANNEL_CAST_ROSTER_ID,
  SENA_ARBEL_CHANNEL_CAST_ROSTER_ID,
  TORORI_COCO_CHANNEL_CAST_ROSTER_ID,
  type CandidatePassBCastRosterId,
} from "../analysis/participantRoster";
import {
  accentCssVars,
  buildStreamerPalette,
  STREAMER_PALETTE_SEEDS,
  type StreamerId,
} from "./streamerPalette";

/** Group/unknown → base; each personal channel → that streamer's palette. */
const ROSTER_TO_PALETTE: Record<CandidatePassBCastRosterId, StreamerId> = {
  [DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID]: "default",
  [AMORETTO_CHANNEL_CAST_ROSTER_ID]: "amoretto",
  [EUREKA_CHANNEL_CAST_ROSTER_ID]: "eureka",
  [SENA_ARBEL_CHANNEL_CAST_ROSTER_ID]: "sena",
  [TORORI_COCO_CHANNEL_CAST_ROSTER_ID]: "torori",
  [MANGJING_CHANNEL_CAST_ROSTER_ID]: "mangjing",
};

export function paletteIdForCastRosterId(
  rosterId: CandidatePassBCastRosterId | null,
): StreamerId {
  if (rosterId === null) return "default";
  return ROSTER_TO_PALETTE[rosterId] ?? "default";
}

const PALETTE_BY_ID = new Map(
  STREAMER_PALETTE_SEEDS.map((seed) => [seed.id, buildStreamerPalette(seed)]),
);

const BASE_PALETTE = buildStreamerPalette(
  STREAMER_PALETTE_SEEDS.find((seed) => seed.id === "default") ?? {
    id: "default",
    name: "기본 · 교환학생",
    kind: "base",
    hue: 350,
    chroma: 1,
  },
);

/**
 * The `--ex-accent*` values for the palette that should be active for a given
 * source, in the current app theme. The app writes these onto the document
 * root so the global accent follows the streamer.
 */
export function activeAccentCssVars(
  rosterId: CandidatePassBCastRosterId | null,
  theme: "light" | "dark",
): Record<string, string> {
  const id = paletteIdForCastRosterId(rosterId);
  const palette = PALETTE_BY_ID.get(id) ?? BASE_PALETTE;
  return accentCssVars(theme === "dark" ? palette.dark : palette.light);
}
