import type { ChatHighlightCandidate, ChatHighlightEvidence } from "./highlightSelector";

export type HighlightSignalKind = "audio" | "chat" | "visual";

export type AudioReactionEventKind =
  | "short-loudness-burst"
  | "sustained-vocal-reaction"
  | "dialogue-issue-signal";

/**
 * Privacy-safe subset of the local audio reaction detector's evidence.
 * Raw PCM, source text, arbitrary reason strings, and detector raw scores are
 * deliberately excluded from the fusion result.
 */
export interface AudioHighlightCandidateEvidence {
  readonly eventKind?: AudioReactionEventKind;
  readonly baselineRms?: number;
  readonly medianAbsoluteDeviation?: number;
  readonly robustLoudnessScore?: number;
  readonly rmsLiftRatio?: number;
  readonly peakLiftRatio?: number;
  readonly sustainedWindowCount?: number;
  readonly activeWindowCount?: number;
  readonly clickPenalty?: number;
  readonly backgroundPenalty?: number;
  readonly zeroCrossingRate?: number;
  readonly speechBandEnergyRatio?: number;
}

/** Minimal structural contract accepted from a local audio reaction detector. */
export interface AudioHighlightCandidate<
  TEvidence extends object = AudioHighlightCandidateEvidence,
> {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly reason?: string;
  readonly evidence: TEvidence;
}

/**
 * The minimum visual evidence contract used by the fusion layer.
 * A visual analyzer may expose additional fields without coupling this module to them.
 */
export interface VisualHighlightCandidateEvidence {
  readonly changeScore?: number;
  readonly robustScore?: number;
  readonly previousFrameMs?: number;
  readonly currentFrameMs?: number;
  readonly meanLumaDifference?: number;
  readonly changedPixelRatio?: number;
  readonly sceneChangeStrength?: number;
  readonly baselineSceneChangeStrength?: number;
  readonly medianAbsoluteDeviation?: number;
  readonly robustSceneScore?: number;
}

/**
 * Structural contract for visual analyzers. The generic evidence type lets a future
 * analyzer keep a richer evidence object while this module reads only safe numbers.
 */
export interface VisualHighlightCandidate<
  TEvidence extends object = VisualHighlightCandidateEvidence,
> {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly reason: string;
  readonly evidence: TEvidence;
}

export interface HighlightFusionOptions {
  readonly sourceDurationMs: number;
  /** Requested clip length. Values outside 30-60 seconds are clamped. */
  readonly candidateWindowMs?: number;
  /** The fusion layer always returns at most 12 candidates. */
  readonly maxCandidates?: number;
  /** Non-overlapping signals with closer peaks than this value can be paired. */
  readonly proximityMs?: number;
  /** Suppress a weaker window when this share of its shorter window overlaps. */
  readonly nmsOverlapThreshold?: number;
  /** Keep the reaction-first contract when no audio/chat anchor exists. */
  readonly allowUnanchoredVisualExploration?: boolean;
}

export interface NormalizedSignalEvidence {
  /** Percentile computed only against candidates of the same signal kind. */
  readonly rankPercentile: number;
  /** MAD-based score mapped to 0-1 only within the same signal kind. */
  readonly robustPercentile: number;
  /** Blend of the two within-signal values above. */
  readonly normalizedScore: number;
}

export interface UnifiedAudioEvidence
  extends NormalizedSignalEvidence,
    AudioHighlightCandidateEvidence {}

export interface UnifiedVisualEvidence extends NormalizedSignalEvidence {
  readonly changeScore?: number;
  readonly robustScore?: number;
  readonly previousFrameMs?: number;
  readonly currentFrameMs?: number;
  readonly meanLumaDifference?: number;
  readonly changedPixelRatio?: number;
  readonly sceneChangeStrength?: number;
  readonly baselineSceneChangeStrength?: number;
  readonly medianAbsoluteDeviation?: number;
  readonly robustSceneScore?: number;
}

export interface UnifiedChatEvidence extends NormalizedSignalEvidence, ChatHighlightEvidence {}

export interface UnifiedHighlightEvidence {
  readonly normalization: "within-signal-rank-and-mad";
  readonly audio?: UnifiedAudioEvidence;
  readonly visual?: UnifiedVisualEvidence;
  readonly chat?: UnifiedChatEvidence;
}

export interface UnifiedHighlightCandidate {
  readonly id: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  /** A comparable 0-1 score produced after within-signal normalization. */
  readonly score: number;
  readonly reason: string;
  readonly signalKinds: readonly HighlightSignalKind[];
  readonly evidence: UnifiedHighlightEvidence;
}

export interface ReactionHighlightFusionInput {
  readonly audioCandidates?: readonly AudioHighlightCandidate<object>[];
  readonly chatCandidates?: readonly ChatHighlightCandidate[];
  readonly visualCandidates?: readonly VisualHighlightCandidate<object>[];
}

interface PreparedCandidate<TCandidate> {
  readonly source: TCandidate;
  readonly sourceId: string;
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly rawScore: number;
  readonly sortKey: string;
}

interface RankedCandidate<TCandidate> extends PreparedCandidate<TCandidate> {
  readonly rankPercentile: number;
  readonly robustPercentile: number;
  readonly normalizedScore: number;
  readonly rankedIndex: number;
}

interface PairProposal {
  readonly visualIndex: number;
  readonly chatIndex: number;
  readonly overlapRatio: number;
  readonly peakDistanceMs: number;
  readonly fusedScore: number;
  readonly sortKey: string;
}

interface DraftCandidate {
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly score: number;
  readonly sourceKey: string;
  readonly signalKinds: readonly HighlightSignalKind[];
  readonly visual?: RankedCandidate<VisualHighlightCandidate<object>>;
  readonly chat?: RankedCandidate<ChatHighlightCandidate>;
}

interface ReactionPairProposal {
  readonly audioIndex: number;
  readonly chatIndex: number;
  readonly overlapRatio: number;
  readonly peakDistanceMs: number;
  readonly fusedScore: number;
  readonly sortKey: string;
}

interface ReactionDraftCandidate {
  readonly peakMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly anchorStartMs: number;
  readonly anchorEndMs: number;
  readonly score: number;
  readonly sourceKey: string;
  readonly signalKinds: readonly HighlightSignalKind[];
  readonly audio?: RankedCandidate<AudioHighlightCandidate<object>>;
  readonly chat?: RankedCandidate<ChatHighlightCandidate>;
  readonly visual?: RankedCandidate<VisualHighlightCandidate<object>>;
  readonly exploration: boolean;
}

interface VisualContextProposal {
  readonly draftIndex: number;
  readonly visualIndex: number;
  readonly overlapRatio: number;
  readonly peakDistanceMs: number;
  readonly visualScore: number;
  readonly sortKey: string;
}

const DEFAULT_WINDOW_MS = 45_000;
const MIN_WINDOW_MS = 30_000;
const MAX_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESERVOIR = 96;
const MAX_RESERVOIR_CANDIDATES = 96;
const DEFAULT_PROXIMITY_MS = 10_000;
const DEFAULT_NMS_OVERLAP_THRESHOLD = 0.5;
const NORMALIZATION_RANK_WEIGHT = 0.65;
const NORMALIZATION_ROBUST_WEIGHT = 0.35;
const MULTI_SIGNAL_BONUS = 0.12;
const REACTION_MULTI_SIGNAL_BONUS = 0.16;
const VISUAL_CONTEXT_BONUS = 0.04;
const VISUAL_EXPLORATION_SCORE_CEILING = 0.32;
const MAX_VISUAL_EXPLORATION_CANDIDATES = 4;
const PRE_REACTION_WINDOW_SHARE = 0.625;

const AUDIO_EVENT_KINDS = new Set<AudioReactionEventKind>([
  "short-loudness-burst",
  "sustained-vocal-reaction",
  "dialogue-issue-signal",
]);

const AUDIO_NUMERIC_EVIDENCE_KEYS = [
  "baselineRms",
  "medianAbsoluteDeviation",
  "robustLoudnessScore",
  "rmsLiftRatio",
  "peakLiftRatio",
  "sustainedWindowCount",
  "activeWindowCount",
  "clickPenalty",
  "backgroundPenalty",
  "zeroCrossingRate",
  "speechBandEnergyRatio",
] as const satisfies readonly (keyof AudioHighlightCandidateEvidence)[];

export function fuseHighlightCandidates(
  visualCandidates: readonly VisualHighlightCandidate<object>[],
  options: HighlightFusionOptions,
): readonly UnifiedHighlightCandidate[];

export function fuseHighlightCandidates(
  visualCandidates: readonly VisualHighlightCandidate<object>[],
  chatCandidates: readonly ChatHighlightCandidate[] | undefined,
  options: HighlightFusionOptions,
): readonly UnifiedHighlightCandidate[];

/**
 * Combines visual and optional chat signals without comparing their raw score scales.
 * The returned list is score ordered, deterministic, privacy-safe, and ready for review UI.
 */
export function fuseHighlightCandidates(
  visualCandidates: readonly VisualHighlightCandidate<object>[],
  chatOrOptions: readonly ChatHighlightCandidate[] | HighlightFusionOptions | undefined,
  possibleOptions?: HighlightFusionOptions,
): readonly UnifiedHighlightCandidate[] {
  const chatCandidates = isChatCandidateArray(chatOrOptions) ? chatOrOptions : [];
  const options =
    possibleOptions ?? (isChatCandidateArray(chatOrOptions) ? undefined : chatOrOptions);
  if (options === undefined) {
    return [];
  }

  const durationMs = finiteNonNegativeInteger(options.sourceDurationMs);
  if (durationMs <= 0) {
    return [];
  }

  const maxCandidates = clamp(
    finiteIntegerOrDefault(options.maxCandidates, DEFAULT_MAX_RESERVOIR),
    0,
    MAX_RESERVOIR_CANDIDATES,
  );
  if (maxCandidates === 0) {
    return [];
  }

  const requestedWindowMs = finiteIntegerOrDefault(options.candidateWindowMs, DEFAULT_WINDOW_MS);
  const windowMs = Math.min(durationMs, clamp(requestedWindowMs, MIN_WINDOW_MS, MAX_WINDOW_MS));
  const proximityMs = Math.max(
    0,
    finiteIntegerOrDefault(options.proximityMs, DEFAULT_PROXIMITY_MS),
  );
  const nmsOverlapThreshold = clamp(
    finiteNumberOrDefault(options.nmsOverlapThreshold, DEFAULT_NMS_OVERLAP_THRESHOLD),
    0,
    1,
  );

  const rankedVisual = normalizeCandidates(
    prepareVisualCandidates(visualCandidates, durationMs),
  );
  const rankedChat = normalizeCandidates(prepareChatCandidates(chatCandidates, durationMs));
  if (rankedVisual.length === 0 && rankedChat.length === 0) {
    return [];
  }

  const drafts = [
    ...pairAndCreateDrafts(
      rankedVisual,
      rankedChat,
      durationMs,
      windowMs,
      proximityMs,
    ),
  ].sort(compareDrafts);

  const accepted: DraftCandidate[] = [];
  for (const draft of drafts) {
    if (accepted.length >= maxCandidates) {
      break;
    }
    if (
      accepted.some(
        (candidate) => overlapRatio(candidate, draft) >= nmsOverlapThreshold && rangesOverlap(candidate, draft),
      )
    ) {
      continue;
    }
    accepted.push(draft);
  }

  return accepted.map(createUnifiedCandidate);
}

/**
 * Reaction-first fusion for streamer clips.
 *
 * Audio and chat candidates are the only reaction anchors. Visual candidates
 * can strengthen a nearby anchor and explain its context, but cannot create a
 * normal reaction candidate on their own. When no anchor exists at all, at
 * most two score-capped visual exploration candidates are returned so the UI
 * can offer a clearly limited fallback instead of pretending a reaction was
 * detected.
 */
export function fuseReactionHighlightCandidates(
  input: ReactionHighlightFusionInput,
  options: HighlightFusionOptions,
): readonly UnifiedHighlightCandidate[] {
  const durationMs = finiteNonNegativeInteger(options.sourceDurationMs);
  if (durationMs <= 0) {
    return [];
  }

  const maxCandidates = clamp(
    finiteIntegerOrDefault(options.maxCandidates, DEFAULT_MAX_RESERVOIR),
    0,
    MAX_RESERVOIR_CANDIDATES,
  );
  if (maxCandidates === 0) {
    return [];
  }

  const requestedWindowMs = finiteIntegerOrDefault(options.candidateWindowMs, DEFAULT_WINDOW_MS);
  const windowMs = Math.min(durationMs, clamp(requestedWindowMs, MIN_WINDOW_MS, MAX_WINDOW_MS));
  const proximityMs = Math.max(
    0,
    finiteIntegerOrDefault(options.proximityMs, DEFAULT_PROXIMITY_MS),
  );
  const nmsOverlapThreshold = clamp(
    finiteNumberOrDefault(options.nmsOverlapThreshold, DEFAULT_NMS_OVERLAP_THRESHOLD),
    0,
    1,
  );

  const rankedAudio = normalizeCandidates(
    prepareAudioCandidates(input.audioCandidates ?? [], durationMs),
  );
  const rankedChat = normalizeCandidates(
    prepareChatCandidates(input.chatCandidates ?? [], durationMs),
  );
  const rankedVisual = normalizeCandidates(
    prepareVisualCandidates(input.visualCandidates ?? [], durationMs),
  );

  let drafts: readonly ReactionDraftCandidate[];
  if (
    rankedAudio.length === 0 &&
    rankedChat.length === 0 &&
    options.allowUnanchoredVisualExploration !== false
  ) {
    drafts = createVisualExplorationDrafts(rankedVisual, durationMs, windowMs);
  } else if (rankedAudio.length === 0 && rankedChat.length === 0) {
    drafts = [];
  } else {
    const anchors = createReactionAnchorDrafts(
      rankedAudio,
      rankedChat,
      durationMs,
      windowMs,
      proximityMs,
    );
    drafts = attachVisualContext(anchors, rankedVisual, proximityMs).filter(
      (draft) => !isUnconfirmedMusicLikeDialogue(draft),
    );
  }

  const accepted: ReactionDraftCandidate[] = [];
  for (const draft of [...drafts].sort(compareReactionDrafts)) {
    if (
      accepted.length >=
      Math.min(
        maxCandidates,
        draft.exploration ? MAX_VISUAL_EXPLORATION_CANDIDATES : MAX_RESERVOIR_CANDIDATES,
      )
    ) {
      break;
    }
    if (
      accepted.some(
        (candidate) =>
          overlapRatio(candidate, draft) >= nmsOverlapThreshold && rangesOverlap(candidate, draft),
      )
    ) {
      continue;
    }
    accepted.push(draft);
  }

  return accepted.map(createReactionUnifiedCandidate);
}

function prepareAudioCandidates(
  candidates: readonly AudioHighlightCandidate<object>[],
  durationMs: number,
): readonly PreparedCandidate<AudioHighlightCandidate<object>>[] {
  const prepared: PreparedCandidate<AudioHighlightCandidate<object>>[] = [];
  for (const candidate of candidates) {
    const timeline = sanitizeTimelineCandidate(candidate, durationMs);
    if (timeline === null) {
      continue;
    }
    const sortKey = [
      candidate.id,
      timeline.peakMs,
      timeline.startMs,
      timeline.endMs,
    ].join("\u0000");
    prepared.push({ source: candidate, sourceId: candidate.id, sortKey, ...timeline });
  }
  return prepared.sort(comparePreparedCandidates);
}

function prepareVisualCandidates(
  candidates: readonly VisualHighlightCandidate<object>[],
  durationMs: number,
): readonly PreparedCandidate<VisualHighlightCandidate<object>>[] {
  const prepared: PreparedCandidate<VisualHighlightCandidate<object>>[] = [];
  for (const candidate of candidates) {
    const timeline = sanitizeTimelineCandidate(candidate, durationMs);
    if (timeline === null) {
      continue;
    }
    const sortKey = [
      candidate.id,
      timeline.peakMs,
      timeline.startMs,
      timeline.endMs,
    ].join("\u0000");
    prepared.push({ source: candidate, sourceId: candidate.id, sortKey, ...timeline });
  }
  return prepared.sort(comparePreparedCandidates);
}

function prepareChatCandidates(
  candidates: readonly ChatHighlightCandidate[],
  durationMs: number,
): readonly PreparedCandidate<ChatHighlightCandidate>[] {
  const prepared: PreparedCandidate<ChatHighlightCandidate>[] = [];
  for (const candidate of candidates) {
    const timeline = sanitizeTimelineCandidate(candidate, durationMs);
    if (timeline === null) {
      continue;
    }
    const sortKey = [
      candidate.id,
      timeline.peakMs,
      timeline.startMs,
      timeline.endMs,
    ].join("\u0000");
    prepared.push({ source: candidate, sourceId: candidate.id, sortKey, ...timeline });
  }
  return prepared.sort(comparePreparedCandidates);
}

function sanitizeTimelineCandidate(
  candidate: Pick<VisualHighlightCandidate<object>, "id" | "peakMs" | "startMs" | "endMs" | "score">,
  durationMs: number,
): Omit<PreparedCandidate<never>, "source" | "sourceId" | "sortKey"> | null {
  if (
    candidate.id.length === 0 ||
    !Number.isFinite(candidate.peakMs) ||
    !Number.isFinite(candidate.startMs) ||
    !Number.isFinite(candidate.endMs) ||
    !Number.isFinite(candidate.score)
  ) {
    return null;
  }

  const startMs = clamp(Math.round(candidate.startMs), 0, durationMs);
  const endMs = clamp(Math.round(candidate.endMs), 0, durationMs);
  if (endMs <= startMs) {
    return null;
  }

  return {
    peakMs: clamp(Math.round(candidate.peakMs), 0, durationMs),
    startMs,
    endMs,
    rawScore: candidate.score,
  };
}

function normalizeCandidates<TCandidate>(
  candidates: readonly PreparedCandidate<TCandidate>[],
): readonly RankedCandidate<TCandidate>[] {
  if (candidates.length === 0) {
    return [];
  }

  const rawScores = candidates.map((candidate) => candidate.rawScore);
  const center = median(rawScores);
  const mad = median(rawScores.map((score) => Math.abs(score - center)));
  let numberStrictlyHigher = 0;
  let cursor = 0;
  const ranked: RankedCandidate<TCandidate>[] = [];

  while (cursor < candidates.length) {
    const first = candidates[cursor];
    if (first === undefined) {
      break;
    }
    let groupEnd = cursor + 1;
    while (groupEnd < candidates.length && candidates[groupEnd]?.rawScore === first.rawScore) {
      groupEnd += 1;
    }

    const rankPercentile =
      candidates.length === 1 ? 1 : 1 - numberStrictlyHigher / (candidates.length - 1);
    for (let index = cursor; index < groupEnd; index += 1) {
      const candidate = candidates[index];
      if (candidate === undefined) {
        continue;
      }
      const robustPercentile = robustPercentileFor(candidate.rawScore, center, mad);
      const normalizedScore =
        rankPercentile * NORMALIZATION_RANK_WEIGHT +
        robustPercentile * NORMALIZATION_ROBUST_WEIGHT;
      ranked.push({
        ...candidate,
        rankPercentile,
        robustPercentile,
        normalizedScore,
        rankedIndex: index,
      });
    }

    numberStrictlyHigher += groupEnd - cursor;
    cursor = groupEnd;
  }

  return ranked;
}

function pairAndCreateDrafts(
  visualCandidates: readonly RankedCandidate<VisualHighlightCandidate<object>>[],
  chatCandidates: readonly RankedCandidate<ChatHighlightCandidate>[],
  durationMs: number,
  windowMs: number,
  proximityMs: number,
): readonly DraftCandidate[] {
  const pairProposals: PairProposal[] = [];
  for (const visual of visualCandidates) {
    for (const chat of chatCandidates) {
      const peakDistanceMs = Math.abs(visual.peakMs - chat.peakMs);
      const candidateOverlapRatio = overlapRatio(visual, chat);
      if (candidateOverlapRatio <= 0 && peakDistanceMs > proximityMs) {
        continue;
      }
      pairProposals.push({
        visualIndex: visual.rankedIndex,
        chatIndex: chat.rankedIndex,
        overlapRatio: candidateOverlapRatio,
        peakDistanceMs,
        fusedScore: fusedPairScore(visual.normalizedScore, chat.normalizedScore),
        sortKey: `${visual.sortKey}\u0001${chat.sortKey}`,
      });
    }
  }
  pairProposals.sort(comparePairProposals);

  const usedVisualIndexes = new Set<number>();
  const usedChatIndexes = new Set<number>();
  const drafts: DraftCandidate[] = [];
  for (const pair of pairProposals) {
    if (usedVisualIndexes.has(pair.visualIndex) || usedChatIndexes.has(pair.chatIndex)) {
      continue;
    }
    const visual = visualCandidates[pair.visualIndex];
    const chat = chatCandidates[pair.chatIndex];
    if (visual === undefined || chat === undefined) {
      continue;
    }
    usedVisualIndexes.add(pair.visualIndex);
    usedChatIndexes.add(pair.chatIndex);
    const peakMs = weightedPeakMs(visual, chat, durationMs);
    const window = fixedWindow(peakMs, durationMs, windowMs);
    drafts.push({
      peakMs,
      ...window,
      score: pair.fusedScore,
      sourceKey: pair.sortKey,
      signalKinds: ["visual", "chat"],
      visual,
      chat,
    });
  }

  for (const visual of visualCandidates) {
    if (usedVisualIndexes.has(visual.rankedIndex)) {
      continue;
    }
    const window = fixedWindow(visual.peakMs, durationMs, windowMs);
    drafts.push({
      peakMs: visual.peakMs,
      ...window,
      score: visual.normalizedScore,
      sourceKey: visual.sortKey,
      signalKinds: ["visual"],
      visual,
    });
  }

  for (const chat of chatCandidates) {
    if (usedChatIndexes.has(chat.rankedIndex)) {
      continue;
    }
    const window = fixedWindow(chat.peakMs, durationMs, windowMs);
    drafts.push({
      peakMs: chat.peakMs,
      ...window,
      score: chat.normalizedScore,
      sourceKey: chat.sortKey,
      signalKinds: ["chat"],
      chat,
    });
  }

  return drafts;
}

function createReactionAnchorDrafts(
  audioCandidates: readonly RankedCandidate<AudioHighlightCandidate<object>>[],
  chatCandidates: readonly RankedCandidate<ChatHighlightCandidate>[],
  durationMs: number,
  windowMs: number,
  proximityMs: number,
): readonly ReactionDraftCandidate[] {
  const pairProposals: ReactionPairProposal[] = [];
  for (const audio of audioCandidates) {
    for (const chat of chatCandidates) {
      const peakDistanceMs = Math.abs(audio.peakMs - chat.peakMs);
      const candidateOverlapRatio = overlapRatio(audio, chat);
      if (candidateOverlapRatio <= 0 && peakDistanceMs > proximityMs) {
        continue;
      }
      pairProposals.push({
        audioIndex: audio.rankedIndex,
        chatIndex: chat.rankedIndex,
        overlapRatio: candidateOverlapRatio,
        peakDistanceMs,
        fusedScore: fusedReactionPairScore(audio.normalizedScore, chat.normalizedScore),
        sortKey: `${audio.sortKey}\u0001${chat.sortKey}`,
      });
    }
  }
  pairProposals.sort(compareReactionPairProposals);

  const usedAudioIndexes = new Set<number>();
  const usedChatIndexes = new Set<number>();
  const drafts: ReactionDraftCandidate[] = [];
  for (const pair of pairProposals) {
    if (usedAudioIndexes.has(pair.audioIndex) || usedChatIndexes.has(pair.chatIndex)) {
      continue;
    }
    const audio = audioCandidates[pair.audioIndex];
    const chat = chatCandidates[pair.chatIndex];
    if (audio === undefined || chat === undefined) {
      continue;
    }
    usedAudioIndexes.add(pair.audioIndex);
    usedChatIndexes.add(pair.chatIndex);
    const peakMs = audio.peakMs;
    const window = reactionWindow(peakMs, durationMs, windowMs);
    drafts.push({
      peakMs,
      ...window,
      anchorStartMs: Math.min(audio.startMs, chat.startMs),
      anchorEndMs: Math.max(audio.endMs, chat.endMs),
      score: pair.fusedScore,
      sourceKey: pair.sortKey,
      signalKinds: ["audio", "chat"],
      audio,
      chat,
      exploration: false,
    });
  }

  for (const audio of audioCandidates) {
    if (usedAudioIndexes.has(audio.rankedIndex)) {
      continue;
    }
    const window = reactionWindow(audio.peakMs, durationMs, windowMs);
    drafts.push({
      peakMs: audio.peakMs,
      ...window,
      anchorStartMs: audio.startMs,
      anchorEndMs: audio.endMs,
      score: audio.normalizedScore,
      sourceKey: audio.sortKey,
      signalKinds: ["audio"],
      audio,
      exploration: false,
    });
  }

  // Keep unused, strong chat bursts as standalone reaction anchors. A chat
  // spike can be the only available signal for a spoken joke or visual gag;
  // dropping it whenever audio exists made those clips disappear. The normal
  // score ordering, overlap suppression, and twelve-candidate cap still prevent
  // a noisy chat import from expanding the result without bound.
  for (const chat of chatCandidates) {
    if (usedChatIndexes.has(chat.rankedIndex)) {
      continue;
    }
    const window = reactionWindow(chat.peakMs, durationMs, windowMs);
    drafts.push({
      peakMs: chat.peakMs,
      ...window,
      anchorStartMs: chat.startMs,
      anchorEndMs: chat.endMs,
      score: chat.normalizedScore,
      sourceKey: chat.sortKey,
      signalKinds: ["chat"],
      chat,
      exploration: false,
    });
  }

  return drafts;
}

/**
 * The local dialogue lead is intentionally permissive so quiet speech can be
 * reviewed. A long, low-loudness, high-band-only lead with no chat or visual
 * corroboration is much more likely to be an opening/bed song transition than
 * a streamer reaction. Keep it out of the O-marked candidate list while the
 * raw audio point remains available to the score rail for manual inspection.
 */
function isUnconfirmedMusicLikeDialogue(draft: ReactionDraftCandidate): boolean {
  if (draft.audio === undefined || draft.chat !== undefined || draft.visual !== undefined) {
    return false;
  }
  const evidence = draft.audio.source.evidence;
  if (readAudioEventKind(evidence) !== "dialogue-issue-signal") {
    return false;
  }
  const activeWindowCount = readFiniteEvidenceNumber(evidence, "activeWindowCount") ?? 0;
  const sustainedWindowCount = readFiniteEvidenceNumber(evidence, "sustainedWindowCount") ?? 0;
  const speechBandEnergyRatio =
    readFiniteEvidenceNumber(evidence, "speechBandEnergyRatio") ?? 0;
  const rmsLiftRatio = readFiniteEvidenceNumber(evidence, "rmsLiftRatio") ?? Number.POSITIVE_INFINITY;
  const robustLoudnessScore =
    readFiniteEvidenceNumber(evidence, "robustLoudnessScore") ?? Number.POSITIVE_INFINITY;
  const clickPenalty = readFiniteEvidenceNumber(evidence, "clickPenalty") ?? Number.POSITIVE_INFINITY;
  const backgroundPenalty = readFiniteEvidenceNumber(evidence, "backgroundPenalty") ?? Number.POSITIVE_INFINITY;
  const sustainedBand = activeWindowCount >= 3 && sustainedWindowCount >= 3;
  const quietBandApex = activeWindowCount >= 1 && sustainedWindowCount >= 1;
  return (
    (sustainedBand || quietBandApex) &&
    speechBandEnergyRatio >= 0.55 &&
    speechBandEnergyRatio <= 0.78 &&
    rmsLiftRatio <= 1.2 &&
    robustLoudnessScore <= 0.5 &&
    clickPenalty <= 0.45 &&
    backgroundPenalty <= 0.35
  );
}

function attachVisualContext(
  drafts: readonly ReactionDraftCandidate[],
  visualCandidates: readonly RankedCandidate<VisualHighlightCandidate<object>>[],
  proximityMs: number,
): readonly ReactionDraftCandidate[] {
  if (drafts.length === 0 || visualCandidates.length === 0) {
    return drafts;
  }

  const proposals: VisualContextProposal[] = [];
  for (const [draftIndex, draft] of drafts.entries()) {
    const anchorRange = { startMs: draft.anchorStartMs, endMs: draft.anchorEndMs };
    for (const visual of visualCandidates) {
      const peakDistanceMs = Math.abs(draft.peakMs - visual.peakMs);
      const candidateOverlapRatio = overlapRatio(anchorRange, visual);
      if (candidateOverlapRatio <= 0 && peakDistanceMs > proximityMs) {
        continue;
      }
      proposals.push({
        draftIndex,
        visualIndex: visual.rankedIndex,
        overlapRatio: candidateOverlapRatio,
        peakDistanceMs,
        visualScore: visual.normalizedScore,
        sortKey: `${draft.sourceKey}\u0001${visual.sortKey}`,
      });
    }
  }
  proposals.sort(compareVisualContextProposals);

  const attachedDraftIndexes = new Set<number>();
  const usedVisualIndexes = new Set<number>();
  const result = [...drafts];
  for (const proposal of proposals) {
    if (
      attachedDraftIndexes.has(proposal.draftIndex) ||
      usedVisualIndexes.has(proposal.visualIndex)
    ) {
      continue;
    }
    const draft = result[proposal.draftIndex];
    const visual = visualCandidates[proposal.visualIndex];
    if (draft === undefined || visual === undefined) {
      continue;
    }
    attachedDraftIndexes.add(proposal.draftIndex);
    usedVisualIndexes.add(proposal.visualIndex);
    result[proposal.draftIndex] = {
      ...draft,
      score: clamp(
        draft.score + VISUAL_CONTEXT_BONUS * visual.normalizedScore,
        0,
        1,
      ),
      sourceKey: proposal.sortKey,
      signalKinds: canonicalSignalKinds([...draft.signalKinds, "visual"]),
      visual,
    };
  }
  return result;
}

function createVisualExplorationDrafts(
  visualCandidates: readonly RankedCandidate<VisualHighlightCandidate<object>>[],
  durationMs: number,
  windowMs: number,
): readonly ReactionDraftCandidate[] {
  return visualCandidates.map((visual) => {
    const window = fixedWindow(visual.peakMs, durationMs, windowMs);
    return {
      peakMs: visual.peakMs,
      ...window,
      anchorStartMs: visual.startMs,
      anchorEndMs: visual.endMs,
      score: Math.min(
        VISUAL_EXPLORATION_SCORE_CEILING,
        visual.normalizedScore * VISUAL_EXPLORATION_SCORE_CEILING,
      ),
      sourceKey: visual.sortKey,
      signalKinds: ["visual"] as const,
      visual,
      exploration: true,
    };
  });
}

function reactionWindow(
  peakMs: number,
  durationMs: number,
  windowMs: number,
): { readonly startMs: number; readonly endMs: number } {
  const latestStartMs = Math.max(0, durationMs - windowMs);
  const startMs = clamp(
    Math.round(peakMs - windowMs * PRE_REACTION_WINDOW_SHARE),
    0,
    latestStartMs,
  );
  return { startMs, endMs: startMs + windowMs };
}

function fixedWindow(
  peakMs: number,
  durationMs: number,
  windowMs: number,
): { readonly startMs: number; readonly endMs: number } {
  const latestStartMs = Math.max(0, durationMs - windowMs);
  const startMs = clamp(Math.round(peakMs - windowMs / 2), 0, latestStartMs);
  return { startMs, endMs: startMs + windowMs };
}

function weightedPeakMs(
  visual: RankedCandidate<VisualHighlightCandidate<object>>,
  chat: RankedCandidate<ChatHighlightCandidate>,
  durationMs: number,
): number {
  const visualWeight = Math.max(0.01, visual.normalizedScore);
  const chatWeight = Math.max(0.01, chat.normalizedScore);
  return clamp(
    Math.round(
      (visual.peakMs * visualWeight + chat.peakMs * chatWeight) /
        (visualWeight + chatWeight),
    ),
    0,
    durationMs,
  );
}

function createUnifiedCandidate(draft: DraftCandidate): UnifiedHighlightCandidate {
  const visualEvidence =
    draft.visual === undefined ? undefined : createVisualEvidence(draft.visual);
  const chatEvidence = draft.chat === undefined ? undefined : createChatEvidence(draft.chat);
  const identity = [
    draft.signalKinds.join("+"),
    draft.sourceKey,
    draft.peakMs,
    draft.startMs,
    draft.endMs,
  ].join("|");

  return {
    id: `highlight-${draft.signalKinds.join("-")}-${stableHash(identity)}`,
    peakMs: draft.peakMs,
    startMs: draft.startMs,
    endMs: draft.endMs,
    score: round(draft.score, 6),
    reason: highlightReasonForSignalKinds(draft.signalKinds),
    signalKinds: draft.signalKinds,
    evidence: {
      normalization: "within-signal-rank-and-mad",
      ...(visualEvidence === undefined ? {} : { visual: visualEvidence }),
      ...(chatEvidence === undefined ? {} : { chat: chatEvidence }),
    },
  };
}

function createReactionUnifiedCandidate(
  draft: ReactionDraftCandidate,
): UnifiedHighlightCandidate {
  const audioEvidence =
    draft.audio === undefined ? undefined : createAudioEvidence(draft.audio);
  const visualEvidence =
    draft.visual === undefined ? undefined : createVisualEvidence(draft.visual);
  const chatEvidence = draft.chat === undefined ? undefined : createChatEvidence(draft.chat);
  const identity = [
    draft.signalKinds.join("+"),
    draft.sourceKey,
    draft.peakMs,
    draft.startMs,
    draft.endMs,
    draft.exploration ? "exploration" : "reaction",
  ].join("|");

  return {
    id: `highlight-${draft.signalKinds.join("-")}-${stableHash(identity)}`,
    peakMs: draft.peakMs,
    startMs: draft.startMs,
    endMs: draft.endMs,
    score: round(draft.score, 6),
    reason: draft.exploration
      ? "방송 오디오·채팅 반응을 확인한 결과가 아니라, 화면 변화만으로 넓게 남긴 탐색 후보예요. 직접 보고 판단해 주세요."
      : reactionReasonForSignalKinds(draft.signalKinds),
    signalKinds: draft.signalKinds,
    evidence: {
      normalization: "within-signal-rank-and-mad",
      ...(audioEvidence === undefined ? {} : { audio: audioEvidence }),
      ...(chatEvidence === undefined ? {} : { chat: chatEvidence }),
      ...(visualEvidence === undefined ? {} : { visual: visualEvidence }),
    },
  };
}

function createAudioEvidence(
  candidate: RankedCandidate<AudioHighlightCandidate<object>>,
): UnifiedAudioEvidence {
  const sourceEvidence = candidate.source.evidence;
  const eventKind = readAudioEventKind(sourceEvidence);
  const numericEvidence = Object.fromEntries(
    AUDIO_NUMERIC_EVIDENCE_KEYS.flatMap((key) => {
      const value = readFiniteEvidenceNumber(sourceEvidence, key);
      return value === undefined ? [] : [[key, value] as const];
    }),
  ) as Partial<Record<(typeof AUDIO_NUMERIC_EVIDENCE_KEYS)[number], number>>;

  return {
    ...normalizedEvidence(candidate),
    ...(eventKind === undefined ? {} : { eventKind }),
    ...numericEvidence,
  };
}

function createVisualEvidence(
  candidate: RankedCandidate<VisualHighlightCandidate<object>>,
): UnifiedVisualEvidence {
  const changeScore = readFiniteEvidenceNumber(candidate.source.evidence, "changeScore");
  const robustScore = readFiniteEvidenceNumber(candidate.source.evidence, "robustScore");
  const previousFrameMs = readFiniteEvidenceNumber(candidate.source.evidence, "previousFrameMs");
  const currentFrameMs = readFiniteEvidenceNumber(candidate.source.evidence, "currentFrameMs");
  const meanLumaDifference = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "meanLumaDifference",
  );
  const changedPixelRatio = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "changedPixelRatio",
  );
  const sceneChangeStrength = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "sceneChangeStrength",
  );
  const baselineSceneChangeStrength = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "baselineSceneChangeStrength",
  );
  const medianAbsoluteDeviation = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "medianAbsoluteDeviation",
  );
  const robustSceneScore = readFiniteEvidenceNumber(
    candidate.source.evidence,
    "robustSceneScore",
  );
  return {
    ...normalizedEvidence(candidate),
    ...(changeScore === undefined ? {} : { changeScore }),
    ...(robustScore === undefined ? {} : { robustScore }),
    ...(previousFrameMs === undefined ? {} : { previousFrameMs }),
    ...(currentFrameMs === undefined ? {} : { currentFrameMs }),
    ...(meanLumaDifference === undefined ? {} : { meanLumaDifference }),
    ...(changedPixelRatio === undefined ? {} : { changedPixelRatio }),
    ...(sceneChangeStrength === undefined ? {} : { sceneChangeStrength }),
    ...(baselineSceneChangeStrength === undefined ? {} : { baselineSceneChangeStrength }),
    ...(medianAbsoluteDeviation === undefined ? {} : { medianAbsoluteDeviation }),
    ...(robustSceneScore === undefined ? {} : { robustSceneScore }),
  };
}

function createChatEvidence(
  candidate: RankedCandidate<ChatHighlightCandidate>,
): UnifiedChatEvidence {
  const evidence = candidate.source.evidence;
  return {
    ...normalizedEvidence(candidate),
    bucketStartMs: finiteNumberOrDefault(evidence.bucketStartMs, 0),
    bucketEndMs: finiteNumberOrDefault(evidence.bucketEndMs, 0),
    messageCount: finiteNumberOrDefault(evidence.messageCount, 0),
    uniqueAuthorCount: finiteNumberOrDefault(evidence.uniqueAuthorCount, 0),
    reactionMessageCount: finiteNumberOrDefault(evidence.reactionMessageCount, 0),
    baselineMessageCount: finiteNumberOrDefault(evidence.baselineMessageCount, 0),
    baselineUniqueAuthorCount: finiteNumberOrDefault(evidence.baselineUniqueAuthorCount, 0),
    burstRatio: finiteNumberOrDefault(evidence.burstRatio, 0),
    robustBurstScore: finiteNumberOrDefault(evidence.robustBurstScore, 0),
    repetitionRatio: finiteNumberOrDefault(evidence.repetitionRatio, 0),
    singleAuthorRatio: finiteNumberOrDefault(evidence.singleAuthorRatio, 0),
    spamPenalty: finiteNumberOrDefault(evidence.spamPenalty, 0),
  };
}

function normalizedEvidence(
  candidate: Pick<
    RankedCandidate<unknown>,
    "rankPercentile" | "robustPercentile" | "normalizedScore"
  >,
): NormalizedSignalEvidence {
  return {
    rankPercentile: round(candidate.rankPercentile, 6),
    robustPercentile: round(candidate.robustPercentile, 6),
    normalizedScore: round(candidate.normalizedScore, 6),
  };
}

export function highlightReasonForSignalKinds(
  signalKinds: readonly HighlightSignalKind[],
): string {
  if (signalKinds.includes("audio")) {
    return reactionReasonForSignalKinds(signalKinds);
  }
  if (signalKinds.includes("visual") && signalKinds.includes("chat")) {
    return "장면 변화와 채팅 반응 신호가 같은 구간에 함께 나타나 우선 확인할 후보로 골랐어요.";
  }
  if (signalKinds.includes("visual")) {
    return "화면 변화가 두드러진 구간이라 먼저 확인할 후보로 골랐어요.";
  }
  return "채팅 반응 신호가 집중된 구간이라 먼저 확인할 후보로 골랐어요.";
}

function reactionReasonForSignalKinds(
  signalKinds: readonly HighlightSignalKind[],
): string {
  const hasAudio = signalKinds.includes("audio");
  const hasChat = signalKinds.includes("chat");
  const hasVisual = signalKinds.includes("visual");
  if (hasAudio && hasChat && hasVisual) {
    return "혼합 방송 오디오 반응 신호와 채팅 반응 신호가 함께 커진 구간이에요. 가까운 화면 변화는 사건 맥락을 보강하는 근거로만 사용했어요.";
  }
  if (hasAudio && hasChat) {
    return "혼합 방송 오디오 반응 신호와 채팅 반응 신호가 같은 구간에 함께 나타나 우선 확인할 후보로 골랐어요.";
  }
  if (hasAudio && hasVisual) {
    return "혼합 방송 오디오 반응 신호가 두드러졌고 가까운 화면 변화가 맥락 근거로 함께 잡힌 구간이에요.";
  }
  if (hasAudio) {
    return "평소보다 두드러진 혼합 방송 오디오 반응 신호가 잡혀, 소리의 주체를 확인할 후보로 골랐어요.";
  }
  if (hasChat && hasVisual) {
    return "채팅 반응 신호가 집중됐고 가까운 화면 변화가 맥락 근거로 함께 잡힌 구간이에요.";
  }
  if (hasChat) {
    return "채팅 반응 신호가 집중된 구간이라 실제 화면 사건과 방송 반응을 확인할 후보로 골랐어요.";
  }
  return "방송 오디오·채팅 반응을 확인한 결과가 아니라 화면 변화만으로 남긴 탐색 후보예요.";
}

function comparePreparedCandidates<TCandidate>(
  left: PreparedCandidate<TCandidate>,
  right: PreparedCandidate<TCandidate>,
): number {
  return (
    right.rawScore - left.rawScore ||
    left.peakMs - right.peakMs ||
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.sortKey.localeCompare(right.sortKey)
  );
}

function comparePairProposals(left: PairProposal, right: PairProposal): number {
  return (
    right.overlapRatio - left.overlapRatio ||
    left.peakDistanceMs - right.peakDistanceMs ||
    right.fusedScore - left.fusedScore ||
    left.sortKey.localeCompare(right.sortKey)
  );
}

function compareReactionPairProposals(
  left: ReactionPairProposal,
  right: ReactionPairProposal,
): number {
  return (
    right.overlapRatio - left.overlapRatio ||
    left.peakDistanceMs - right.peakDistanceMs ||
    right.fusedScore - left.fusedScore ||
    left.sortKey.localeCompare(right.sortKey)
  );
}

function compareVisualContextProposals(
  left: VisualContextProposal,
  right: VisualContextProposal,
): number {
  return (
    right.overlapRatio - left.overlapRatio ||
    left.peakDistanceMs - right.peakDistanceMs ||
    right.visualScore - left.visualScore ||
    left.sortKey.localeCompare(right.sortKey)
  );
}

function compareDrafts(left: DraftCandidate, right: DraftCandidate): number {
  return (
    right.score - left.score ||
    right.signalKinds.length - left.signalKinds.length ||
    left.peakMs - right.peakMs ||
    left.startMs - right.startMs ||
    left.sourceKey.localeCompare(right.sourceKey)
  );
}

function compareReactionDrafts(
  left: ReactionDraftCandidate,
  right: ReactionDraftCandidate,
): number {
  const leftConsensus = left.audio !== undefined && left.chat !== undefined ? 1 : 0;
  const rightConsensus = right.audio !== undefined && right.chat !== undefined ? 1 : 0;
  return (
    rightConsensus - leftConsensus ||
    right.score - left.score ||
    right.signalKinds.length - left.signalKinds.length ||
    left.peakMs - right.peakMs ||
    left.startMs - right.startMs ||
    left.sourceKey.localeCompare(right.sourceKey)
  );
}

function fusedPairScore(visualScore: number, chatScore: number): number {
  return clamp((visualScore + chatScore) / 2 + MULTI_SIGNAL_BONUS, 0, 1);
}

function fusedReactionPairScore(audioScore: number, chatScore: number): number {
  return clamp((audioScore + chatScore) / 2 + REACTION_MULTI_SIGNAL_BONUS, 0, 1);
}

function robustPercentileFor(score: number, center: number, mad: number): number {
  if (mad <= Number.EPSILON) {
    return 0.5;
  }
  const robustZ = (score - center) / (1.4826 * mad);
  return 0.5 + Math.tanh(clamp(robustZ, -6, 6) / 3) / 2;
}

function overlapRatio(
  left: Pick<PreparedCandidate<unknown>, "startMs" | "endMs">,
  right: Pick<PreparedCandidate<unknown>, "startMs" | "endMs">,
): number {
  const overlapMs = Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
  const shorterDurationMs = Math.min(left.endMs - left.startMs, right.endMs - right.startMs);
  return shorterDurationMs <= 0 ? 0 : overlapMs / shorterDurationMs;
}

function rangesOverlap(
  left: Pick<PreparedCandidate<unknown>, "startMs" | "endMs">,
  right: Pick<PreparedCandidate<unknown>, "startMs" | "endMs">,
): boolean {
  return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
}

function readFiniteEvidenceNumber(evidence: object, key: string): number | undefined {
  const value = Reflect.get(evidence, key) as unknown;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readAudioEventKind(evidence: object): AudioReactionEventKind | undefined {
  const value = Reflect.get(evidence, "eventKind") as unknown;
  return typeof value === "string" && AUDIO_EVENT_KINDS.has(value as AudioReactionEventKind)
    ? (value as AudioReactionEventKind)
    : undefined;
}

function canonicalSignalKinds(
  signalKinds: readonly HighlightSignalKind[],
): readonly HighlightSignalKind[] {
  const present = new Set(signalKinds);
  return (["audio", "chat", "visual"] as const).filter((signalKind) =>
    present.has(signalKind),
  );
}

function isChatCandidateArray(
  value: readonly ChatHighlightCandidate[] | HighlightFusionOptions | undefined,
): value is readonly ChatHighlightCandidate[] {
  return Array.isArray(value);
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function finiteNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function finiteIntegerOrDefault(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.round(value);
}

function finiteNumberOrDefault(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
