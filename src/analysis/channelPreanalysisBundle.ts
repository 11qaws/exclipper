import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  MAX_BROADCAST_CONTEXT_CHAPTERS,
  MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS,
  MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
  MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH,
  MAX_SEMANTIC_CHAPTERS,
  type BroadcastContextChapterInput,
  type BroadcastContextResult,
} from "./broadcastContextProtocol";
import {
  AMORETTO_YOUTUBE_CHANNEL_ID,
  type ChannelPreanalysisCatalogVideo,
} from "./channelPreanalysisCatalog";
import {
  MAX_YOUTUBE_CAPTION_EVENTS,
  MAX_YOUTUBE_CAPTION_EVENT_TEXT_LENGTH,
  YOUTUBE_CAPTION_MODEL_REVISION,
  YOUTUBE_VIDEO_ID_PATTERN,
  type YouTubeCaptionTrackResult,
} from "./youtubeCaptionTrack";
import type { ContentDigestAdapter } from "../security/contentFingerprint";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "./aiModelRoutingPolicy";

export const CHANNEL_PREANALYSIS_BUNDLE_SCHEMA_VERSION = 1 as const;
export const CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES = 32 * 1024 * 1024;
export const CHANNEL_PREANALYSIS_TRANSCRIPT_MAX_TEXT_LENGTH = 8_000_000;
export const CHANNEL_PREANALYSIS_CONTEXT_RECEIPT_FIELD_MAX_LENGTH = 128;

export const CHANNEL_PREANALYSIS_BUNDLE_STATES = [
  "transcript-ready",
  "context-ready",
  "published",
] as const;

export type ChannelPreanalysisBundleState =
  (typeof CHANNEL_PREANALYSIS_BUNDLE_STATES)[number];

export interface ChannelPreanalysisBundleProvenance {
  readonly sourceKind: "youtube-korean-caption";
  readonly sourceUrl: string;
  readonly extractedAt: string;
  readonly extractorRevision: string;
}

export interface ChannelPreanalysisContextReceipt {
  readonly contractVersion: string;
  readonly routingRevision: typeof AI_BROADCAST_CONTEXT_ROUTING_REVISION;
  readonly modelId: string;
  readonly modelRevision: string;
}

/**
 * Scheduled whole-context analysis sees the public caption map only. It can
 * seed a local run, but it never satisfies local frame/audio verification.
 */
export interface ChannelPreanalysisContextProvenance {
  readonly generatedAt: string;
  readonly modelRoutingRevision: typeof AI_BROADCAST_CONTEXT_ROUTING_REVISION;
  readonly contextReceipt: ChannelPreanalysisContextReceipt;
  readonly evidenceScope: "youtube-caption-transcript-only";
  readonly localVisualVerificationRequired: true;
}

export interface ChannelPreanalysisBundle {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_BUNDLE_SCHEMA_VERSION;
  readonly channelId: typeof AMORETTO_YOUTUBE_CHANNEL_ID;
  readonly videoId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly publishedAt: string;
  readonly catalogRevision: number;
  readonly state: ChannelPreanalysisBundleState;
  readonly captionTrack: YouTubeCaptionTrackResult;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly broadcastContext: BroadcastContextResult | null;
  readonly contextProvenance: ChannelPreanalysisContextProvenance | null;
  readonly provenance: ChannelPreanalysisBundleProvenance;
  readonly transcriptDigest: string;
}

export interface CreateChannelPreanalysisBundleInput {
  readonly videoId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly publishedAt: string;
  readonly catalogRevision: number;
  readonly state: ChannelPreanalysisBundleState;
  readonly captionTrack: YouTubeCaptionTrackResult;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly broadcastContext?: BroadcastContextResult | null;
  readonly contextProvenance?: ChannelPreanalysisContextProvenance | null;
  readonly provenance: ChannelPreanalysisBundleProvenance;
}

export type ChannelPreanalysisBundleValidationErrorCode =
  | "INVALID_JSON"
  | "TOO_LARGE"
  | "INVALID_SCHEMA"
  | "INVALID_IDENTITY"
  | "INVALID_METADATA"
  | "INVALID_TRANSCRIPT"
  | "INVALID_CHAPTERS"
  | "INVALID_CONTEXT"
  | "INVALID_PROVENANCE"
  | "CRYPTO_UNAVAILABLE"
  | "DIGEST_FAILED"
  | "DIGEST_MISMATCH";

export class ChannelPreanalysisBundleValidationError extends Error {
  public readonly code: ChannelPreanalysisBundleValidationErrorCode;
  public readonly originalCause: unknown;

  public constructor(
    code: ChannelPreanalysisBundleValidationErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ChannelPreanalysisBundleValidationError";
    this.code = code;
    this.originalCause = options.cause;
  }
}

/**
 * YouTube reports a video's duration in whole seconds while caption timings are
 * in milliseconds, so the real media can run up to one second past the declared
 * duration and a final cue that reaches into that last partial second overhangs
 * by arithmetic rather than corruption. One 44ms overhang out of 6,085 events
 * was rejecting an entire broadcast on every scheduled retry. Absorb exactly
 * the error the truncation can produce and nothing beyond it: a caption track
 * belonging to a different, longer video overhangs by far more than this, so
 * the identity check the bound exists for still holds.
 */
const CAPTION_END_TRUNCATION_TOLERANCE_MS = 1_000;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const EXTRACTOR_REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CONTEXT_RECEIPT_FIELD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const IDENTIFIER_PATTERN = /^[^\p{Cc}\p{Cf}]{1,256}$/u;

export async function createChannelPreanalysisBundle(
  input: CreateChannelPreanalysisBundleInput,
  digestAdapter: ContentDigestAdapter | null =
    globalThis.crypto?.subtle ?? null,
): Promise<ChannelPreanalysisBundle> {
  const transcriptDigest = await createChannelPreanalysisTranscriptDigest(
    input.captionTrack,
    digestAdapter,
  );
  const bundle = validateChannelPreanalysisBundle({
    schemaVersion: CHANNEL_PREANALYSIS_BUNDLE_SCHEMA_VERSION,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId: input.videoId,
    title: input.title,
    durationMs: input.durationMs,
    publishedAt: input.publishedAt,
    catalogRevision: input.catalogRevision,
    state: input.state,
    captionTrack: input.captionTrack,
    chapters: input.chapters,
    broadcastContext: input.broadcastContext ?? null,
    contextProvenance: input.contextProvenance ?? null,
    provenance: input.provenance,
    transcriptDigest,
  });
  assertChannelPreanalysisBundleProducerSize(bundle);
  return bundle;
}

export function parseChannelPreanalysisBundle(
  input: string,
): ChannelPreanalysisBundle {
  if (typeof input !== "string") {
    throw validationError("INVALID_JSON", "Preanalysis bundle must be JSON text.");
  }
  if (new TextEncoder().encode(input).byteLength > CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES) {
    throw validationError("TOO_LARGE", "Preanalysis bundle exceeds its byte limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    throw new ChannelPreanalysisBundleValidationError(
      "INVALID_JSON",
      "Preanalysis bundle JSON is invalid.",
      { cause },
    );
  }
  return validateChannelPreanalysisBundle(parsed);
}

export function validateChannelPreanalysisBundle(
  value: unknown,
): ChannelPreanalysisBundle {
  const hasContextProvenance =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "contextProvenance");
  const bundle = recordWithKeys(
    value,
    [
      "schemaVersion",
      "channelId",
      "videoId",
      "title",
      "durationMs",
      "publishedAt",
      "catalogRevision",
      "state",
      "captionTrack",
      "chapters",
      "broadcastContext",
      ...(hasContextProvenance ? ["contextProvenance"] : []),
      "provenance",
      "transcriptDigest",
    ],
    "INVALID_SCHEMA",
    "Preanalysis bundle shape is invalid.",
  );
  if (
    bundle.schemaVersion !== CHANNEL_PREANALYSIS_BUNDLE_SCHEMA_VERSION ||
    bundle.channelId !== AMORETTO_YOUTUBE_CHANNEL_ID
  ) {
    throw validationError("INVALID_SCHEMA", "Preanalysis bundle schema or channel is invalid.");
  }
  if (!isVideoId(bundle.videoId) || !isBoundedText(bundle.title, 1_000)) {
    throw validationError("INVALID_IDENTITY", "Preanalysis video identity is invalid.");
  }
  const videoId = bundle.videoId;
  const durationMs = positiveSafeInteger(
    bundle.durationMs,
    MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS,
    "INVALID_METADATA",
  );
  const publishedAt = isoDate(bundle.publishedAt, "INVALID_METADATA");
  const catalogRevision = positiveSafeInteger(
    bundle.catalogRevision,
    Number.MAX_SAFE_INTEGER,
    "INVALID_METADATA",
  );
  if (
    typeof bundle.state !== "string" ||
    !(CHANNEL_PREANALYSIS_BUNDLE_STATES as readonly string[]).includes(bundle.state)
  ) {
    throw validationError("INVALID_METADATA", "Preanalysis bundle state is invalid.");
  }

  const captionTrack = validateCaptionTrack(bundle.captionTrack, videoId, durationMs);
  const chapters = validateChapters(bundle.chapters, durationMs);
  const broadcastContext =
    bundle.broadcastContext === null
      ? null
      : validateBroadcastContext(bundle.broadcastContext, durationMs, chapters);
  const contextProvenance =
    !hasContextProvenance || bundle.contextProvenance === null
      ? null
      : validateContextProvenance(bundle.contextProvenance);
  if (
    (bundle.state === "transcript-ready" &&
      (broadcastContext !== null || contextProvenance !== null)) ||
    (bundle.state !== "transcript-ready" &&
      (broadcastContext === null || contextProvenance === null))
  ) {
    throw validationError(
      "INVALID_CONTEXT",
      "Preanalysis bundle state and broadcast context are inconsistent.",
    );
  }
  const provenance = validateProvenance(bundle.provenance, videoId);
  if (typeof bundle.transcriptDigest !== "string" || !SHA256_PATTERN.test(bundle.transcriptDigest)) {
    throw validationError("INVALID_TRANSCRIPT", "Transcript digest is invalid.");
  }

  return {
    schemaVersion: CHANNEL_PREANALYSIS_BUNDLE_SCHEMA_VERSION,
    channelId: AMORETTO_YOUTUBE_CHANNEL_ID,
    videoId,
    title: bundle.title,
    durationMs,
    publishedAt,
    catalogRevision,
    state: bundle.state as ChannelPreanalysisBundleState,
    captionTrack,
    chapters,
    broadcastContext,
    contextProvenance,
    provenance,
    transcriptDigest: bundle.transcriptDigest,
  };
}

export async function createChannelPreanalysisTranscriptDigest(
  track: YouTubeCaptionTrackResult,
  digestAdapter: ContentDigestAdapter | null =
    globalThis.crypto?.subtle ?? null,
): Promise<string> {
  if (digestAdapter === null) {
    throw validationError("CRYPTO_UNAVAILABLE", "SHA-256 is unavailable.");
  }
  const canonical = JSON.stringify([
    "channel-preanalysis-transcript-v1",
    track.videoId,
    track.languageCode,
    track.isAutoGenerated,
    track.events.map((event) => [event.startMs, event.durationMs, event.text]),
  ]);
  let digest: ArrayBuffer;
  try {
    digest = await digestAdapter.digest("SHA-256", new TextEncoder().encode(canonical));
  } catch (cause) {
    throw new ChannelPreanalysisBundleValidationError(
      "DIGEST_FAILED",
      "Transcript SHA-256 calculation failed.",
      { cause },
    );
  }
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function verifyChannelPreanalysisTranscriptDigest(
  bundle: ChannelPreanalysisBundle,
  digestAdapter: ContentDigestAdapter | null =
    globalThis.crypto?.subtle ?? null,
): Promise<void> {
  const actual = await createChannelPreanalysisTranscriptDigest(
    bundle.captionTrack,
    digestAdapter,
  );
  if (actual !== bundle.transcriptDigest) {
    throw validationError("DIGEST_MISMATCH", "Transcript digest does not match the bundle.");
  }
}

export function assertChannelPreanalysisBundleMatchesCatalogVideo(
  bundle: ChannelPreanalysisBundle,
  video: ChannelPreanalysisCatalogVideo,
  manifestRevision: number,
): void {
  if (
    bundle.videoId !== video.videoId ||
    bundle.title !== video.title ||
    bundle.durationMs !== video.durationMs ||
    bundle.publishedAt !== video.publishedAt ||
    bundle.state !== video.state ||
    bundle.catalogRevision > manifestRevision
  ) {
    throw validationError(
      "INVALID_IDENTITY",
      "Preanalysis bundle does not match the selected catalog revision.",
    );
  }
}

function validateCaptionTrack(
  value: unknown,
  videoId: string,
  sourceDurationMs: number,
): YouTubeCaptionTrackResult {
  const track = recordWithKeys(
    value,
    ["videoId", "languageCode", "isAutoGenerated", "events"],
    "INVALID_TRANSCRIPT",
    "Caption track shape is invalid.",
  );
  if (
    track.videoId !== videoId ||
    typeof track.languageCode !== "string" ||
    !/^ko(?:-[A-Za-z0-9]{1,16})?$/u.test(track.languageCode) ||
    typeof track.isAutoGenerated !== "boolean" ||
    !Array.isArray(track.events) ||
    track.events.length < 1 ||
    track.events.length > MAX_YOUTUBE_CAPTION_EVENTS
  ) {
    throw validationError("INVALID_TRANSCRIPT", "Caption track metadata is invalid.");
  }

  let previousStartMs = -1;
  let totalTextLength = 0;
  const events = track.events.map((rawEvent) => {
    const event = recordWithKeys(
      rawEvent,
      ["startMs", "durationMs", "text"],
      "INVALID_TRANSCRIPT",
      "Caption event shape is invalid.",
    );
    if (
      !Number.isSafeInteger(event.startMs) ||
      (event.startMs as number) < previousStartMs ||
      (event.startMs as number) > sourceDurationMs ||
      !Number.isSafeInteger(event.durationMs) ||
      (event.durationMs as number) < 0 ||
      (event.durationMs as number) > MAX_BROADCAST_CONTEXT_SOURCE_DURATION_MS ||
      (event.startMs as number) + (event.durationMs as number) >
        sourceDurationMs + CAPTION_END_TRUNCATION_TOLERANCE_MS ||
      !isBoundedText(event.text, MAX_YOUTUBE_CAPTION_EVENT_TEXT_LENGTH)
    ) {
      throw validationError("INVALID_TRANSCRIPT", "Caption event is invalid.");
    }
    previousStartMs = event.startMs as number;
    totalTextLength += Array.from(event.text).length;
    if (totalTextLength > CHANNEL_PREANALYSIS_TRANSCRIPT_MAX_TEXT_LENGTH) {
      throw validationError("INVALID_TRANSCRIPT", "Caption transcript text is too large.");
    }
    return {
      startMs: event.startMs as number,
      // Absorbing the truncation must not hand a timeline that runs past the
      // declared duration to everything downstream. Clamp instead, which is
      // idempotent: a clamped event re-validates unchanged on readback.
      durationMs: Math.min(
        event.durationMs as number,
        sourceDurationMs - (event.startMs as number),
      ),
      text: event.text,
    };
  });

  return {
    videoId,
    languageCode: track.languageCode,
    isAutoGenerated: track.isAutoGenerated,
    events,
  };
}

function validateChapters(
  value: unknown,
  sourceDurationMs: number,
): readonly BroadcastContextChapterInput[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_BROADCAST_CONTEXT_CHAPTERS
  ) {
    throw validationError("INVALID_CHAPTERS", "Chapter count is invalid.");
  }
  const ids = new Set<string>();
  let expectedStartMs = 0;
  const chapters = value.map((rawChapter) => {
    const chapter = recordWithKeys(
      rawChapter,
      [
        "chapterId",
        "startMs",
        "endMs",
        "evidenceMode",
        "evidenceCoverageRatio",
        "summaryKo",
      ],
      "INVALID_CHAPTERS",
      "Chapter shape is invalid.",
    );
    if (
      typeof chapter.chapterId !== "string" ||
      !IDENTIFIER_PATTERN.test(chapter.chapterId) ||
      chapter.chapterId.trim() !== chapter.chapterId ||
      ids.has(chapter.chapterId) ||
      chapter.startMs !== expectedStartMs ||
      !Number.isSafeInteger(chapter.endMs) ||
      (chapter.endMs as number) <= expectedStartMs ||
      (chapter.endMs as number) > sourceDurationMs ||
      ![
        "complete-transcript",
        "sampled-audio-video",
        "candidate-context-only",
      ].includes(chapter.evidenceMode as string) ||
      typeof chapter.evidenceCoverageRatio !== "number" ||
      !Number.isFinite(chapter.evidenceCoverageRatio) ||
      chapter.evidenceCoverageRatio < 0 ||
      chapter.evidenceCoverageRatio > 1 ||
      !isBoundedText(chapter.summaryKo, MAX_BROADCAST_CONTEXT_SUMMARY_LENGTH)
    ) {
      throw validationError("INVALID_CHAPTERS", "Chapters must be contiguous and bounded.");
    }
    ids.add(chapter.chapterId);
    expectedStartMs = chapter.endMs as number;
    return {
      chapterId: chapter.chapterId,
      startMs: chapter.startMs,
      endMs: chapter.endMs as number,
      evidenceMode: chapter.evidenceMode as BroadcastContextChapterInput["evidenceMode"],
      evidenceCoverageRatio: chapter.evidenceCoverageRatio,
      summaryKo: chapter.summaryKo,
    };
  });
  if (expectedStartMs !== sourceDurationMs) {
    throw validationError("INVALID_CHAPTERS", "Chapters must cover the complete source.");
  }
  return chapters;
}

function validateBroadcastContext(
  value: unknown,
  sourceDurationMs: number,
  chapters: readonly BroadcastContextChapterInput[],
): BroadcastContextResult {
  const context = recordWithKeys(
    value,
    [
      "schemaVersion",
      "broadcastSummaryKo",
      "hostStreamerProfile",
      "recurringThemesKo",
      "annotations",
      "semanticChaptersSupported",
      "semanticChapters",
      "discoveredLeadsSupported",
      "discoveredLeads",
      "coverage",
    ],
    "INVALID_CONTEXT",
    "Broadcast context shape is invalid.",
  );
  if (
    context.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION ||
    !isBoundedText(context.broadcastSummaryKo, 24_000) ||
    !isTextArray(context.recurringThemesKo, 64, 1_000) ||
    !Array.isArray(context.annotations) ||
    context.annotations.length > 32 ||
    typeof context.semanticChaptersSupported !== "boolean" ||
    !Array.isArray(context.semanticChapters) ||
    context.semanticChapters.length > MAX_SEMANTIC_CHAPTERS ||
    typeof context.discoveredLeadsSupported !== "boolean" ||
    !Array.isArray(context.discoveredLeads) ||
    context.discoveredLeads.length > MAX_BROADCAST_CONTEXT_DISCOVERED_LEADS
  ) {
    throw validationError("INVALID_CONTEXT", "Broadcast context metadata is invalid.");
  }
  validateHostProfile(context.hostStreamerProfile);
  for (const annotation of context.annotations) validateAnnotation(annotation);
  const chapterIds = new Set(chapters.map(({ chapterId }) => chapterId));
  for (const semanticChapter of context.semanticChapters) {
    validateSemanticChapter(semanticChapter, sourceDurationMs, chapterIds);
  }
  for (const lead of context.discoveredLeads) {
    validateDiscoveredLead(lead, sourceDurationMs, chapterIds);
  }
  validateCoverage(context.coverage, sourceDurationMs, chapterIds);
  return context as unknown as BroadcastContextResult;
}

function validateHostProfile(value: unknown): void {
  if (value === null) return;
  const profile = recordWithKeys(
    value,
    ["displayNameKo", "profileSummaryKo", "evidenceKo", "uncertaintiesKo"],
    "INVALID_CONTEXT",
    "Host streamer profile is invalid.",
  );
  if (
    (profile.displayNameKo !== null && !isBoundedText(profile.displayNameKo, 256)) ||
    !isBoundedText(profile.profileSummaryKo, 6_000) ||
    !isTextArray(profile.evidenceKo, 64, 2_000) ||
    !isTextArray(profile.uncertaintiesKo, 64, 2_000)
  ) {
    throw validationError("INVALID_CONTEXT", "Host streamer profile is invalid.");
  }
}

function validateAnnotation(value: unknown): void {
  const annotation = recordWithKeys(
    value,
    [
      "candidateId",
      "category",
      "clipDecision",
      "confidence",
      "rejectionReasons",
      "contextSummaryKo",
      "whyThisMomentKo",
      "relatedCandidateIds",
      "uncertaintiesKo",
    ],
    "INVALID_CONTEXT",
    "Candidate annotation is invalid.",
  );
  if (
    !isIdentifier(annotation.candidateId) ||
    ![
      "reaction",
      "quiet-achievement",
      "setup-and-payoff",
      "running-gag",
      "context-dependent",
      "apology-accountability",
      "music-or-intermission",
      "not-clip-worthy",
      "uncertain",
    ].includes(annotation.category as string) ||
    !["select", "review", "reject"].includes(annotation.clipDecision as string) ||
    !isConfidence(annotation.confidence) ||
    !isEnumArray(annotation.rejectionReasons, [
      "music-or-song",
      "opening-ending-or-break",
      "no-distinct-event",
      "reaction-without-context",
      "insufficient-context",
      "duplicate-episode",
      "uncertain-evidence",
    ]) ||
    !isBoundedText(annotation.contextSummaryKo, 6_000) ||
    !isBoundedText(annotation.whyThisMomentKo, 6_000) ||
    !isIdentifierArray(annotation.relatedCandidateIds, 32) ||
    !isTextArray(annotation.uncertaintiesKo, 64, 2_000)
  ) {
    throw validationError("INVALID_CONTEXT", "Candidate annotation is invalid.");
  }
}

function validateSemanticChapter(
  value: unknown,
  sourceDurationMs: number,
  chapterIds: ReadonlySet<string>,
): void {
  const chapter = recordWithKeys(
    value,
    [
      "semanticChapterId",
      "startChapterId",
      "endChapterId",
      "startMs",
      "endMs",
      "titleKo",
      "summaryKo",
      "kind",
      "salience",
      "relatedCandidateIds",
      "uncertaintiesKo",
    ],
    "INVALID_CONTEXT",
    "Semantic chapter is invalid.",
  );
  if (
    !isIdentifier(chapter.semanticChapterId) ||
    !chapterIds.has(chapter.startChapterId as string) ||
    !chapterIds.has(chapter.endChapterId as string) ||
    !isRange(chapter.startMs, chapter.endMs, sourceDurationMs) ||
    !isBoundedText(chapter.titleKo, 1_000) ||
    !isBoundedText(chapter.summaryKo, 8_000) ||
    ![
      "main-event",
      "story-progress",
      "setup-and-payoff",
      "running-gag",
      "quiet-achievement",
      "reaction",
      "context-shift",
      "other",
    ].includes(chapter.kind as string) ||
    !["primary", "secondary"].includes(chapter.salience as string) ||
    !isIdentifierArray(chapter.relatedCandidateIds, 32) ||
    !isTextArray(chapter.uncertaintiesKo, 64, 2_000)
  ) {
    throw validationError("INVALID_CONTEXT", "Semantic chapter is invalid.");
  }
}

function validateDiscoveredLead(
  value: unknown,
  sourceDurationMs: number,
  chapterIds: ReadonlySet<string>,
): void {
  const lead = recordWithKeys(
    value,
    [
      "leadId",
      "startChapterId",
      "endChapterId",
      "startMs",
      "endMs",
      "category",
      "confidence",
      "eventSummaryKo",
      "whyThisMomentKo",
      "evidenceCueKo",
      "uncertaintiesKo",
    ],
    "INVALID_CONTEXT",
    "Discovered lead is invalid.",
  );
  if (
    !isIdentifier(lead.leadId) ||
    !chapterIds.has(lead.startChapterId as string) ||
    !chapterIds.has(lead.endChapterId as string) ||
    !isRange(lead.startMs, lead.endMs, sourceDurationMs) ||
    ![
      "reaction",
      "quiet-achievement",
      "setup-and-payoff",
      "running-gag",
      "context-dependent",
      "apology-accountability",
    ].includes(lead.category as string) ||
    !isConfidence(lead.confidence) ||
    !isBoundedText(lead.eventSummaryKo, 6_000) ||
    !isBoundedText(lead.whyThisMomentKo, 6_000) ||
    !isBoundedText(lead.evidenceCueKo, 6_000) ||
    !isTextArray(lead.uncertaintiesKo, 64, 2_000)
  ) {
    throw validationError("INVALID_CONTEXT", "Discovered lead is invalid.");
  }
}

function validateCoverage(
  value: unknown,
  sourceDurationMs: number,
  chapterIds: ReadonlySet<string>,
): void {
  const coverage = recordWithKeys(
    value,
    ["status", "coveredMs", "coverageRatio", "gaps", "partialChapterIds"],
    "INVALID_CONTEXT",
    "Broadcast coverage is invalid.",
  );
  if (
    !["complete", "partial"].includes(coverage.status as string) ||
    !Number.isSafeInteger(coverage.coveredMs) ||
    (coverage.coveredMs as number) < 0 ||
    (coverage.coveredMs as number) > sourceDurationMs ||
    !isConfidence(coverage.coverageRatio) ||
    !Array.isArray(coverage.gaps) ||
    coverage.gaps.length > MAX_BROADCAST_CONTEXT_CHAPTERS ||
    !Array.isArray(coverage.partialChapterIds) ||
    coverage.partialChapterIds.some(
      (chapterId) => typeof chapterId !== "string" || !chapterIds.has(chapterId),
    )
  ) {
    throw validationError("INVALID_CONTEXT", "Broadcast coverage is invalid.");
  }
  for (const gapValue of coverage.gaps) {
    const gap = recordWithKeys(
      gapValue,
      ["startMs", "endMs"],
      "INVALID_CONTEXT",
      "Broadcast coverage gap is invalid.",
    );
    if (!isRange(gap.startMs, gap.endMs, sourceDurationMs)) {
      throw validationError("INVALID_CONTEXT", "Broadcast coverage gap is invalid.");
    }
  }
}

function validateContextProvenance(
  value: unknown,
): ChannelPreanalysisContextProvenance {
  const provenance = recordWithKeys(
    value,
    [
      "generatedAt",
      "modelRoutingRevision",
      "contextReceipt",
      "evidenceScope",
      "localVisualVerificationRequired",
    ],
    "INVALID_CONTEXT",
    "Broadcast context provenance is invalid.",
  );
  if (
    provenance.modelRoutingRevision !==
      AI_BROADCAST_CONTEXT_ROUTING_REVISION ||
    provenance.evidenceScope !== "youtube-caption-transcript-only" ||
    provenance.localVisualVerificationRequired !== true
  ) {
    throw validationError(
      "INVALID_CONTEXT",
      "Broadcast context provenance is invalid.",
    );
  }
  const contextReceipt = validateContextReceipt(provenance.contextReceipt);
  if (contextReceipt.routingRevision !== provenance.modelRoutingRevision) {
    throw validationError(
      "INVALID_CONTEXT",
      "Broadcast context receipt and provenance routing revisions differ.",
    );
  }
  return {
    generatedAt: isoDate(provenance.generatedAt, "INVALID_CONTEXT"),
    modelRoutingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    contextReceipt,
    evidenceScope: "youtube-caption-transcript-only",
    localVisualVerificationRequired: true,
  };
}

function validateContextReceipt(
  value: unknown,
): ChannelPreanalysisContextReceipt {
  const receipt = recordWithKeys(
    value,
    [
      "contractVersion",
      "routingRevision",
      "modelId",
      "modelRevision",
    ],
    "INVALID_CONTEXT",
    "Broadcast context receipt is invalid.",
  );
  if (
    !isContextReceiptField(receipt.contractVersion) ||
    receipt.routingRevision !==
      AI_BROADCAST_CONTEXT_ROUTING_REVISION ||
    !isContextReceiptField(receipt.modelId) ||
    !isContextReceiptField(receipt.modelRevision)
  ) {
    throw validationError(
      "INVALID_CONTEXT",
      "Broadcast context receipt is invalid.",
    );
  }
  return {
    contractVersion: receipt.contractVersion,
    routingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
    modelId: receipt.modelId,
    modelRevision: receipt.modelRevision,
  };
}

function validateProvenance(
  value: unknown,
  videoId: string,
): ChannelPreanalysisBundleProvenance {
  const provenance = recordWithKeys(
    value,
    ["sourceKind", "sourceUrl", "extractedAt", "extractorRevision"],
    "INVALID_PROVENANCE",
    "Preanalysis provenance is invalid.",
  );
  if (
    provenance.sourceKind !== "youtube-korean-caption" ||
    provenance.sourceUrl !== `https://www.youtube.com/watch?v=${videoId}` ||
    typeof provenance.extractorRevision !== "string" ||
    !EXTRACTOR_REVISION_PATTERN.test(provenance.extractorRevision)
  ) {
    throw validationError("INVALID_PROVENANCE", "Preanalysis provenance is invalid.");
  }
  return {
    sourceKind: "youtube-korean-caption",
    sourceUrl: provenance.sourceUrl,
    extractedAt: isoDate(provenance.extractedAt, "INVALID_PROVENANCE"),
    extractorRevision: provenance.extractorRevision,
  };
}

export function createDefaultChannelPreanalysisProvenance(
  videoId: string,
  extractedAt: string,
): ChannelPreanalysisBundleProvenance {
  if (!isVideoId(videoId)) {
    throw validationError("INVALID_PROVENANCE", "YouTube video ID is invalid.");
  }
  return validateProvenance(
    {
      sourceKind: "youtube-korean-caption",
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      extractedAt,
      extractorRevision: YOUTUBE_CAPTION_MODEL_REVISION,
    },
    videoId,
  );
}

function recordWithKeys(
  value: unknown,
  keys: readonly string[],
  code: ChannelPreanalysisBundleValidationErrorCode,
  message: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(code, message);
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw validationError(code, message);
  }
  return record;
}

function positiveSafeInteger(
  value: unknown,
  maximum: number,
  code: ChannelPreanalysisBundleValidationErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw validationError(code, "A positive bounded integer is required.");
  }
  return value as number;
}

function isoDate(
  value: unknown,
  code: ChannelPreanalysisBundleValidationErrorCode,
): string {
  if (
    typeof value !== "string" ||
    !ISO_DATE_TIME_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw validationError(code, "An ISO date-time is required.");
  }
  return value;
}

function isVideoId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

function isContextReceiptField(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length <=
      CHANNEL_PREANALYSIS_CONTEXT_RECEIPT_FIELD_MAX_LENGTH &&
    CONTEXT_RECEIPT_FIELD_PATTERN.test(value)
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isIdentifierArray(value: unknown, maximum: number): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

function isTextArray(
  value: unknown,
  maximumItems: number,
  maximumTextLength: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => isBoundedText(item, maximumTextLength))
  );
}

function isEnumArray(value: unknown, allowed: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length <= allowed.length &&
    value.every((item) => typeof item === "string" && allowed.includes(item)) &&
    new Set(value).size === value.length
  );
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const length = Array.from(value).length;
  return (
    length > 0 &&
    length <= maximumLength &&
    !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\r\t]/gu, ""))
  );
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isRange(startMs: unknown, endMs: unknown, sourceDurationMs: number): boolean {
  return (
    Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    (startMs as number) >= 0 &&
    (endMs as number) > (startMs as number) &&
    (endMs as number) <= sourceDurationMs
  );
}

function validationError(
  code: ChannelPreanalysisBundleValidationErrorCode,
  message: string,
): ChannelPreanalysisBundleValidationError {
  return new ChannelPreanalysisBundleValidationError(code, message);
}

function assertChannelPreanalysisBundleProducerSize(
  bundle: ChannelPreanalysisBundle,
): void {
  const serialized = JSON.stringify(bundle, null, 2);
  if (
    new TextEncoder().encode(serialized).byteLength >
    CHANNEL_PREANALYSIS_BUNDLE_MAX_BYTES
  ) {
    throw validationError(
      "TOO_LARGE",
      "Preanalysis bundle exceeds its byte limit.",
    );
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
