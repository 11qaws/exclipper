import {
  parseBroadcastContextProxyResult,
} from "./broadcastContextDeepseekClient";
import {
  calculateCoverage,
  createBroadcastContextRequest,
  isFinalBroadcastContextResult,
  type BroadcastContextChapterInput,
  type BroadcastContextDiscoveredLead,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
  type BroadcastContextSemanticChapter,
} from "./broadcastContextProtocol";
import type { CandidatePassBCastRosterId } from "./participantRoster";
import type { AnalysisLanguage } from "../domain/analysisLanguage";
import { createContentFingerprint } from "../security/contentFingerprint";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import { CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS } from "./channelPreanalysisCatalog";
import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "./aiModelRoutingPolicy";
import {
  channelPreanalysisSourceById,
  type ConfiguredChannelPreanalysisSource,
} from "./channelPreanalysisSources";

export const CHANNEL_PREANALYSIS_CONTEXT_SEED_SCHEMA_VERSION = "2.0.0";
export const CHANNEL_PREANALYSIS_CONTEXT_SEED_FINGERPRINT_DOMAIN =
  "exclipper.channel-preanalysis-context-seed.v2";

type ContextSeedFingerprint = typeof createContentFingerprint;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

function isCanonicalIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value
  );
}

export interface ChannelPreanalysisContextSeed {
  readonly schemaVersion: typeof CHANNEL_PREANALYSIS_CONTEXT_SEED_SCHEMA_VERSION;
  readonly sourceDurationMs: number;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly sourceIdentity: ChannelPreanalysisTrustedSourceIdentity;
  readonly provenance: {
    readonly generatedAt: string;
    readonly modelRoutingRevision: typeof AI_BROADCAST_CONTEXT_ROUTING_REVISION;
    readonly evidenceScope:
      | "youtube-caption-transcript-only"
      | "scheduled-asr-transcript-only";
    readonly localVisualVerificationRequired: true;
  };
  /**
   * This result was produced without editor-upload candidates. It is only a
   * reusable whole-broadcast map; a local candidate jury is still mandatory.
   */
  readonly result: BroadcastContextResult;
  /**
   * Binds every imported byte above. The channel bundle's artifact digest is
   * still the outer trust boundary; this inner fingerprint detects accidental
   * substitution between bundle validation and pipeline consumption.
   */
  readonly seedFingerprint: string;
}

/**
 * Identifies the catalog artifact that supplied the reusable context seed.
 * `sourceId` and `channelId` are routing provenance only: they must never be
 * treated as evidence that the channel owner appeared or spoke in the video.
 */
type ChannelPreanalysisConfiguredSourcePair<
  TSource extends ConfiguredChannelPreanalysisSource =
    ConfiguredChannelPreanalysisSource,
> = TSource extends ConfiguredChannelPreanalysisSource
  ? {
      readonly sourceId: TSource["sourceId"];
      readonly channelId: TSource["channelId"];
    }
  : never;

export type ChannelPreanalysisTrustedSourceIdentity =
  ChannelPreanalysisConfiguredSourcePair & {
  /**
   * Supplied only after the editor upload has passed the catalog's trusted
   * video-identity gate. It is persisted in the inner fingerprint/ledger.
   */
  readonly videoId: string;
  readonly transcriptDigest: string;
    readonly artifactDigest: string;
  };

export interface CreateChannelPreanalysisContextSeedInput {
  readonly sourceDurationMs: number;
  readonly chapters: readonly BroadcastContextChapterInput[];
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly sourceIdentity: ChannelPreanalysisContextSeed["sourceIdentity"];
  readonly provenance: ChannelPreanalysisContextSeed["provenance"];
  readonly result: BroadcastContextResult;
}

export function createChannelPreanalysisTrustedSourceIdentity(
  source: ConfiguredChannelPreanalysisSource,
  identity: Pick<
    ChannelPreanalysisTrustedSourceIdentity,
    "videoId" | "transcriptDigest" | "artifactDigest"
  >,
): ChannelPreanalysisTrustedSourceIdentity {
  const configuredSource = channelPreanalysisSourceById(source.sourceId);
  if (
    configuredSource === null ||
    configuredSource.channelId !== source.channelId
  ) {
    throw new TypeError("The channel preanalysis source pair is invalid.");
  }
  return {
    sourceId: configuredSource.sourceId,
    channelId: configuredSource.channelId,
    ...identity,
  } as ChannelPreanalysisTrustedSourceIdentity;
}

function seedFingerprintParts(
  seed: Omit<ChannelPreanalysisContextSeed, "seedFingerprint">,
): readonly string[] {
  return [
    CHANNEL_PREANALYSIS_CONTEXT_SEED_FINGERPRINT_DOMAIN,
    JSON.stringify({
      schemaVersion: seed.schemaVersion,
      sourceDurationMs: seed.sourceDurationMs,
      chapters: seed.chapters,
      castRosterId: seed.castRosterId,
      outputLanguage: seed.outputLanguage,
      sourceIdentity: seed.sourceIdentity,
      provenance: seed.provenance,
      result: seed.result,
    }),
  ];
}

function hasConfiguredSourcePair(
  identity: ChannelPreanalysisTrustedSourceIdentity,
): boolean {
  const configuredSource = channelPreanalysisSourceById(identity.sourceId);
  return (
    configuredSource !== null &&
    configuredSource.channelId === identity.channelId
  );
}

export async function createChannelPreanalysisContextSeed(
  input: CreateChannelPreanalysisContextSeedInput,
  fingerprint: ContextSeedFingerprint = createContentFingerprint,
): Promise<ChannelPreanalysisContextSeed> {
  if (!hasConfiguredSourcePair(input.sourceIdentity)) {
    throw new TypeError(
      "Channel preanalysis context seed source identity is not configured.",
    );
  }
  const unsignedSeed = {
    schemaVersion: CHANNEL_PREANALYSIS_CONTEXT_SEED_SCHEMA_VERSION,
    sourceDurationMs: input.sourceDurationMs,
    chapters: input.chapters,
    castRosterId: input.castRosterId,
    outputLanguage: input.outputLanguage,
    sourceIdentity: input.sourceIdentity,
    provenance: input.provenance,
    result: input.result,
  } as const;
  return {
    ...unsignedSeed,
    seedFingerprint: await fingerprint(seedFingerprintParts(unsignedSeed)),
  };
}

interface ProjectedChapterRange {
  readonly startChapterId: string;
  readonly endChapterId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly startIndex: number;
  readonly endIndex: number;
}

function projectedTimeMs(
  valueMs: number,
  sourceDurationMs: number,
  targetDurationMs: number,
): number {
  return Math.max(
    0,
    Math.min(
      targetDurationMs,
      Math.round((valueMs / sourceDurationMs) * targetDurationMs),
    ),
  );
}

function projectChapterRange(
  startMs: number,
  endMs: number,
  sourceDurationMs: number,
  currentInput: BroadcastContextRequestInput,
  minimumStartIndex = 0,
  stopAtCoverageGap = false,
): ProjectedChapterRange | null {
  const targetStartMs = projectedTimeMs(
    startMs,
    sourceDurationMs,
    currentInput.sourceDurationMs,
  );
  const targetEndMs = Math.min(
    currentInput.sourceDurationMs,
    Math.max(
      targetStartMs + 1,
      projectedTimeMs(
        endMs,
        sourceDurationMs,
        currentInput.sourceDurationMs,
      ),
    ),
  );
  if (targetStartMs >= targetEndMs) return null;
  const chapters = currentInput.chapters;
  const startIndex = chapters.findIndex(
    (chapter, index) =>
      index >= minimumStartIndex &&
      chapter.endMs > targetStartMs &&
      chapter.startMs < targetEndMs,
  );
  if (startIndex < 0) return null;

  let endIndex = startIndex;
  for (let index = startIndex + 1; index < chapters.length; index += 1) {
    const chapter = chapters[index]!;
    if (chapter.startMs >= targetEndMs) break;
    if (
      stopAtCoverageGap &&
      chapter.startMs > chapters[index - 1]!.endMs
    ) {
      return null;
    }
    endIndex = index;
  }
  const startChapter = chapters[startIndex]!;
  const endChapter = chapters[endIndex]!;
  if (
    startChapter.startMs > targetStartMs ||
    endChapter.endMs < targetEndMs
  ) {
    return null;
  }
  return {
    startChapterId: startChapter.chapterId,
    endChapterId: endChapter.chapterId,
    startMs: startChapter.startMs,
    endMs: endChapter.endMs,
    startIndex,
    endIndex,
  };
}

function projectSemanticChapters(
  chapters: readonly BroadcastContextSemanticChapter[],
  sourceDurationMs: number,
  currentInput: BroadcastContextRequestInput,
): readonly BroadcastContextSemanticChapter[] | null {
  let minimumStartIndex = 0;
  const projected: BroadcastContextSemanticChapter[] = [];
  for (const chapter of chapters) {
    const range = projectChapterRange(
      chapter.startMs,
      chapter.endMs,
      sourceDurationMs,
      currentInput,
      minimumStartIndex,
      true,
    );
    if (range === null) return null;
    minimumStartIndex = range.endIndex + 1;
    projected.push({
      ...chapter,
      semanticChapterId:
        `sc-${range.startChapterId}-${range.endChapterId}-${chapter.kind}`,
      startChapterId: range.startChapterId,
      endChapterId: range.endChapterId,
      startMs: range.startMs,
      endMs: range.endMs,
      relatedCandidateIds: [],
    });
  }
  return projected;
}

function projectDiscoveredLeads(
  leads: readonly BroadcastContextDiscoveredLead[],
  sourceDurationMs: number,
  currentInput: BroadcastContextRequestInput,
): readonly BroadcastContextDiscoveredLead[] | null {
  const projected: BroadcastContextDiscoveredLead[] = [];
  for (const lead of leads) {
    const range = projectChapterRange(
      lead.startMs,
      lead.endMs,
      sourceDurationMs,
      currentInput,
      0,
      true,
    );
    if (range === null) return null;
    projected.push({
      ...lead,
      startChapterId: range.startChapterId,
      endChapterId: range.endChapterId,
      startMs: range.startMs,
      endMs: range.endMs,
    });
  }
  return projected;
}

function hostHypothesisUncertainty(outputLanguage: AnalysisLanguage): string {
  return outputLanguage === "en"
    ? "Precomputed from YouTube captions; confirm the host identity and description against the local frames and voices."
    : "YouTube 자막으로 사전 추정한 내용이며, 주 진행자 신원과 설명은 로컬 화면·목소리로 확인해야 합니다.";
}

function withHostHypothesisUncertainty(
  result: BroadcastContextResult,
  outputLanguage: AnalysisLanguage,
  keepDisplayName: boolean,
): BroadcastContextResult {
  if (result.hostStreamerProfile === null) return result;
  const requiredUncertainty = hostHypothesisUncertainty(outputLanguage);
  const uncertainties = [
    ...result.hostStreamerProfile.uncertaintiesKo.filter(
      (value) => value !== requiredUncertainty,
    ).slice(0, 4),
    requiredUncertainty,
  ];
  return {
    ...result,
    hostStreamerProfile: {
      ...result.hostStreamerProfile,
      displayNameKo: keepDisplayName
        ? result.hostStreamerProfile.displayNameKo
        : null,
      uncertaintiesKo: uncertainties,
    },
  };
}

/**
 * Validates the result against its exact scheduled YouTube-caption request,
 * then projects its global map onto the current local chapter timeline. Local
 * VAD/ASR/visual chapters are expected to differ from scheduled chapters, so
 * the cross-source fence is trusted video identity + compatible duration +
 * exact roster/language/routing. Candidate judgments are never imported.
 *
 * Any malformed, stale, or substituted seed returns `null`. The caller can
 * then execute the ordinary local overview/discovery path.
 */
export async function validateChannelPreanalysisContextSeed(
  seed: ChannelPreanalysisContextSeed,
  currentInput: BroadcastContextRequestInput,
  trustedSourceIdentity: ChannelPreanalysisTrustedSourceIdentity | null,
  fingerprint: ContextSeedFingerprint = createContentFingerprint,
): Promise<BroadcastContextResult | null> {
  try {
    if (
      seed.schemaVersion !==
        CHANNEL_PREANALYSIS_CONTEXT_SEED_SCHEMA_VERSION ||
      !hasConfiguredSourcePair(seed.sourceIdentity) ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(seed.sourceIdentity.videoId) ||
      !SHA256_DIGEST_PATTERN.test(
        seed.sourceIdentity.transcriptDigest,
      ) ||
      !SHA256_DIGEST_PATTERN.test(seed.sourceIdentity.artifactDigest) ||
      !isCanonicalIsoDate(seed.provenance.generatedAt) ||
      seed.provenance.modelRoutingRevision !==
        AI_BROADCAST_CONTEXT_ROUTING_REVISION ||
      ![
        "youtube-caption-transcript-only",
        "scheduled-asr-transcript-only",
      ].includes(seed.provenance.evidenceScope) ||
      seed.provenance.localVisualVerificationRequired !== true
    ) {
      return null;
    }
    if (
      trustedSourceIdentity === null ||
      !hasConfiguredSourcePair(trustedSourceIdentity) ||
      trustedSourceIdentity.sourceId !== seed.sourceIdentity.sourceId ||
      trustedSourceIdentity.channelId !== seed.sourceIdentity.channelId ||
      trustedSourceIdentity.videoId !== seed.sourceIdentity.videoId ||
      trustedSourceIdentity.transcriptDigest !==
        seed.sourceIdentity.transcriptDigest ||
      trustedSourceIdentity.artifactDigest !==
        seed.sourceIdentity.artifactDigest
    ) {
      return null;
    }
    const canonicalCurrent = createBroadcastContextRequest(currentInput);
    if (
      Math.abs(
        seed.sourceDurationMs - canonicalCurrent.sourceDurationMs,
      ) > CHANNEL_PREANALYSIS_TITLE_DURATION_TOLERANCE_MS ||
      seed.castRosterId !== canonicalCurrent.castRosterId ||
      seed.outputLanguage !== canonicalCurrent.outputLanguage ||
      seed.result.annotations.length !== 0
    ) {
      return null;
    }

    const expectedFingerprint = await fingerprint(
      seedFingerprintParts({
        schemaVersion: seed.schemaVersion,
        sourceDurationMs: seed.sourceDurationMs,
        chapters: seed.chapters,
        castRosterId: seed.castRosterId,
        outputLanguage: seed.outputLanguage,
        sourceIdentity: seed.sourceIdentity,
        provenance: seed.provenance,
        result: seed.result,
      }),
    );
    if (seed.seedFingerprint !== expectedFingerprint) return null;

    const scheduledGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: seed.sourceDurationMs,
      castRosterId: seed.castRosterId,
      chapters: seed.chapters,
    });
    const scheduledInput: BroadcastContextRequestInput = {
      sourceDurationMs: seed.sourceDurationMs,
      chapters: seed.chapters,
      candidates: [],
      castRosterId: seed.castRosterId,
      participantGrounding: scheduledGrounding,
      outputLanguage: seed.outputLanguage,
    };
    const exactScheduledResult = parseBroadcastContextProxyResult(
      seed.result,
      scheduledInput,
    );
    if (
      exactScheduledResult === null ||
      !isFinalBroadcastContextResult(exactScheduledResult)
    ) {
      return null;
    }

    const currentCandidateFreeInput: BroadcastContextRequestInput = {
      sourceDurationMs: canonicalCurrent.sourceDurationMs,
      chapters: canonicalCurrent.chapters,
      candidates: [],
      castRosterId: canonicalCurrent.castRosterId,
      participantGrounding: canonicalCurrent.participantGrounding,
      outputLanguage: canonicalCurrent.outputLanguage,
    };
    const projectedSemanticChapters = projectSemanticChapters(
      exactScheduledResult.semanticChapters,
      seed.sourceDurationMs,
      currentCandidateFreeInput,
    );
    const projectedDiscoveredLeads = projectDiscoveredLeads(
      exactScheduledResult.discoveredLeads,
      seed.sourceDurationMs,
      currentCandidateFreeInput,
    );
    if (
      projectedSemanticChapters === null ||
      projectedDiscoveredLeads === null
    ) {
      return null;
    }
    const projectedGlobalResult: BroadcastContextResult = {
      ...exactScheduledResult,
      annotations: [],
      semanticChapters: projectedSemanticChapters,
      discoveredLeads: projectedDiscoveredLeads,
      coverage: calculateCoverage(
        currentCandidateFreeInput.chapters,
        currentCandidateFreeInput.sourceDurationMs,
      ),
    };

    const hostCandidates =
      projectedGlobalResult.hostStreamerProfile === null
        ? [projectedGlobalResult]
        : [
            withHostHypothesisUncertainty(
              projectedGlobalResult,
              canonicalCurrent.outputLanguage,
              true,
            ),
            withHostHypothesisUncertainty(
              projectedGlobalResult,
              canonicalCurrent.outputLanguage,
              false,
            ),
            { ...projectedGlobalResult, hostStreamerProfile: null },
          ];
    for (const hostCandidate of hostCandidates) {
      const parsed = parseBroadcastContextProxyResult(
        hostCandidate,
        currentCandidateFreeInput,
      );
      if (parsed !== null && isFinalBroadcastContextResult(parsed)) {
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}
