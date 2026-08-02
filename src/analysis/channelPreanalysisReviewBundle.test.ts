import { describe, expect, it } from "vitest";

import { BROADCAST_CONTEXT_SCHEMA_VERSION } from "./broadcastContextProtocol";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import { CANDIDATE_PASS_B_ROUTING_MODEL_REVISION } from "./candidatePassBWorkerProtocol";
import {
  AMORETTO_CHANNEL_PREANALYSIS_SOURCE,
} from "./channelPreanalysisSources";
import {
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM,
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
  CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION,
  channelPreanalysisVisualCoveragePlannedSampleCount,
  type ChannelPreanalysisVisualCoverageReceipt,
} from "./channelPreanalysisVisualCoverage";
import {
  CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
  channelPreanalysisReviewBundleArtifactId,
  createChannelPreanalysisReviewContentDigests,
  parseChannelPreanalysisReviewBundle,
  verifyChannelPreanalysisReviewBundleIntegrity,
  type ChannelPreanalysisReviewBundle,
} from "./channelPreanalysisReviewBundle";
import {
  currentCandidatePassBContext,
  currentCandidatePassBInsight,
  currentCandidatePassBReceipt,
} from "../testSupport/candidatePassBCurrentFixture";

const VIDEO_ID = "KzAW3yow80Q";
const DURATION_MS = 120_000;
const REVISION = 3;
const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

function visualCoverage(): ChannelPreanalysisVisualCoverageReceipt {
  const plannedSampleCount =
    channelPreanalysisVisualCoveragePlannedSampleCount(DURATION_MS);
  return {
    schemaVersion: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SCHEMA_VERSION,
    algorithm: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_ALGORITHM,
    status: "complete",
    sourceDurationMs: DURATION_MS,
    sampleIntervalMs: CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
    plannedSampleCount,
    analyzedSampleCount: plannedSampleCount,
    firstSampleTimestampMs: 0,
    lastSampleTimestampMs:
      (plannedSampleCount - 1) *
      CHANNEL_PREANALYSIS_VISUAL_COVERAGE_SAMPLE_INTERVAL_MS,
    coveredThroughMs: DURATION_MS,
    gaps: [],
    sourceFingerprintArtifactId:
      `youtube-storyboard-visual-fingerprint:${VIDEO_ID}:v1`,
    sourceFingerprintDigest: digest("f"),
    visualSeedCount: 1,
    visualSeedTimestampsMs: [60_000],
  };
}

function bundleWithCandidate(): ChannelPreanalysisReviewBundle {
  const context = currentCandidatePassBContext();
  const receipt = currentCandidatePassBReceipt(context);
  const frames = receipt.dispatchIntent.mediaReceipt.frames.map((frame, index) => ({
    ...frame,
    dataBase64: btoa(`frame-${index}`),
  })) as unknown as ChannelPreanalysisReviewBundle["candidates"][number]["frames"];
  const participantGrounding = createBroadcastParticipantGrounding({
    sourceDurationMs: DURATION_MS,
    castRosterId: null,
    chapters: [],
  }, {
    visualIdentity: {
      receipt: { adapter: "visual-identity", revision: "test-visual-v1", status: "completed", inputCount: 0, processedCount: 0, unavailableReason: null },
      evidence: [],
    },
    voiceIdentity: {
      receipt: { adapter: "voice-identity", revision: "test-voice-v1", status: "completed", inputCount: 0, processedCount: 0, unavailableReason: null },
      evidence: [],
    },
  });

  return {
    schemaVersion: CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
    artifactId: channelPreanalysisReviewBundleArtifactId(VIDEO_ID, REVISION),
    artifactRevision: REVISION,
    createdAt: "2026-08-02T03:00:00.000Z",
    source: {
      sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
      channelId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.channelId,
      videoId: VIDEO_ID,
    },
    sourceDurationMs: DURATION_MS,
    transcriptDigest: digest("a"),
    broadcastContext: {
      schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
      broadcastSummaryKo: "방송 전체 흐름과 후보의 앞뒤 맥락을 모두 분석했습니다.",
      hostStreamerProfile: null,
      recurringThemesKo: [],
      annotations: [],
      semanticChaptersSupported: true,
      semanticChapters: [],
      discoveredLeadsSupported: true,
      discoveredLeads: [],
      coverage: {
        status: "complete",
        coveredMs: DURATION_MS,
        coverageRatio: 1,
        gaps: [],
        partialChapterIds: [],
      },
    },
    broadcastContextDigest: digest("b"),
    visualCoverage: visualCoverage(),
    participantGrounding,
    participantGroundingProvenance: {
      schemaVersion: CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
      checkpointDigest: digest("c"),
      generatedAt: "2026-08-02T02:59:00.000Z",
      pipelineRevision: "scheduled-review-v1",
    },
    candidates: [
      {
        candidateId: "candidate-1",
        sourceStartMs: 60_000,
        sourceEndMs: 105_000,
        context,
        evidence: {
          candidateId: "candidate-1",
          cues: [],
          overlay: {
            event: "목표를 달성했습니다.",
            why: "준비와 결과가 연결됩니다.",
            reviewHint: "화면과 반응을 확인하세요.",
            basisLabel: "AI 대사 단서 · 재생 확인 필요",
          },
          quality: {
            receivedChunkCount: 1,
            mappedChunkCount: 1,
            usableChunkCount: 1,
            discardedChunkCount: 0,
            meanConfidence: 0.9,
          },
          status: "grounded-transcript",
          fallbackReason: null,
        },
        insight: currentCandidatePassBInsight(),
        model: {
          id: receipt.settlement.providerModelId,
          revision: receipt.settlement.providerModelRevision,
        },
        verificationReceipt: receipt,
        frames,
        impactThumbnailFrameIndex: 2,
      },
    ],
    certificate: {
      schemaVersion: CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
      pipelineRevision: "scheduled-review-v1",
      outcome: "review-ready",
      sourceIdentityDigest: digest("d"),
      transcriptDigest: digest("a"),
      broadcastContextDigest: digest("b"),
      participantGroundingDigest: digest("c"),
      visualCoverageDigest: digest("f"),
      candidateSetDigest: digest("e"),
      finalCandidateIds: ["candidate-1"],
    },
  };
}

async function hashBase64(value: string): Promise<`sha256:${string}`> {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const digestBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return `sha256:${Array.from(digestBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function integrityBundle(): Promise<ChannelPreanalysisReviewBundle> {
  const bundle = bundleWithCandidate();
  const candidate = bundle.candidates[0]!;
  const frameDigests = await Promise.all(
    candidate.frames.map(({ dataBase64 }) => hashBase64(dataBase64)),
  );
  const frames = candidate.frames.map((frame, index) => ({
    ...frame,
    contentDigest: frameDigests[index]!,
  })) as unknown as typeof candidate.frames;
  const receipt = {
    ...candidate.verificationReceipt,
    dispatchIntent: {
      ...candidate.verificationReceipt.dispatchIntent,
      mediaReceipt: {
        ...candidate.verificationReceipt.dispatchIntent.mediaReceipt,
        frames: candidate.verificationReceipt.dispatchIntent.mediaReceipt.frames.map(
          (frame, index) => ({ ...frame, contentDigest: frameDigests[index]! }),
        ) as unknown as typeof candidate.verificationReceipt.dispatchIntent.mediaReceipt.frames,
      },
    },
  };
  const candidates = [{ ...candidate, frames, verificationReceipt: receipt }];
  const draft = { ...bundle, candidates } as ChannelPreanalysisReviewBundle;
  const digests = await createChannelPreanalysisReviewContentDigests(draft);
  return {
    ...draft,
    broadcastContextDigest: digests.broadcastContextDigest,
    participantGroundingProvenance: {
      ...draft.participantGroundingProvenance,
      checkpointDigest: digests.participantGroundingDigest,
    },
    certificate: {
      ...draft.certificate,
      sourceIdentityDigest: digests.sourceIdentityDigest,
      broadcastContextDigest: digests.broadcastContextDigest,
      participantGroundingDigest: digests.participantGroundingDigest,
      visualCoverageDigest: digests.visualCoverageDigest,
      candidateSetDigest: digests.candidateSetDigest,
    },
  };
}

describe("channelPreanalysisReviewBundle", () => {
  it("parses one immutable review-ready candidate closure", () => {
    const bundle = bundleWithCandidate();
    expect(parseChannelPreanalysisReviewBundle(JSON.stringify(bundle))).toEqual(bundle);
    expect(bundle.candidates[0]!.verificationReceipt.routingModelRevision).toBe(
      CANDIDATE_PASS_B_ROUTING_MODEL_REVISION,
    );
  });

  it("accepts a certified verified-empty result", () => {
    const bundle = bundleWithCandidate();
    const empty = {
      ...bundle,
      candidates: [],
      certificate: {
        ...bundle.certificate,
        outcome: "verified-empty",
        finalCandidateIds: [],
      },
    };
    expect(parseChannelPreanalysisReviewBundle(JSON.stringify(empty)).certificate.outcome).toBe(
      "verified-empty",
    );
  });

  it("rejects roster or transcript-only participant grounding as review-ready", () => {
    const bundle = bundleWithCandidate();
    const participantGrounding = createBroadcastParticipantGrounding({
      sourceDurationMs: DURATION_MS,
      castRosterId: null,
      chapters: [],
    });
    expect(() =>
      parseChannelPreanalysisReviewBundle(
        JSON.stringify({ ...bundle, participantGrounding }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GROUNDING" }));
  });

  it("rejects candidate closure, thumbnail, and digest drift", () => {
    const bundle = bundleWithCandidate();
    const cases = [
      {
        ...bundle,
        certificate: { ...bundle.certificate, finalCandidateIds: [] },
      },
      {
        ...bundle,
        candidates: [
          { ...bundle.candidates[0], impactThumbnailFrameIndex: 0 },
        ],
      },
      {
        ...bundle,
        visualCoverage: {
          ...bundle.visualCoverage,
          analyzedSampleCount: bundle.visualCoverage.analyzedSampleCount - 1,
        },
      },
      { ...bundle, transcriptDigest: "sha256:not-a-digest" },
    ];
    for (const invalid of cases) {
      expect(() => parseChannelPreanalysisReviewBundle(JSON.stringify(invalid))).toThrow();
    }
  });

  it("rejects embedded raw media bytes", () => {
    const bundle = bundleWithCandidate();
    expect(() =>
      parseChannelPreanalysisReviewBundle(
        JSON.stringify({ ...bundle, rawAudio: "UklGRg==" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "RAW_MEDIA_FORBIDDEN" }));
  });

  it("cryptographically verifies semantic payloads and all four JPEGs", async () => {
    const bundle = integrityBundle();
    await expect(bundle).resolves.toBeDefined();
    const parsed = parseChannelPreanalysisReviewBundle(
      JSON.stringify(await bundle),
    );
    await expect(verifyChannelPreanalysisReviewBundleIntegrity(parsed)).resolves.toBeUndefined();
  });

  it("rejects one-byte JPEG and broadcast-context mutations", async () => {
    const bundle = await integrityBundle();
    const frameMutationDraft = {
      ...bundle,
      candidates: [
        {
          ...bundle.candidates[0]!,
          frames: bundle.candidates[0]!.frames.map((frame, index) =>
            index === 0 ? { ...frame, dataBase64: btoa("frame-X") } : frame,
          ),
        },
      ],
    };
    const frameMutationDigests = await createChannelPreanalysisReviewContentDigests(
      frameMutationDraft as unknown as ChannelPreanalysisReviewBundle,
    );
    const frameMutation = {
      ...frameMutationDraft,
      certificate: {
        ...frameMutationDraft.certificate,
        candidateSetDigest: frameMutationDigests.candidateSetDigest,
      },
    };
    const contextMutation = {
      ...bundle,
      broadcastContext: {
        ...bundle.broadcastContext,
        broadcastSummaryKo: `${bundle.broadcastContext.broadcastSummaryKo} 변조`,
      },
    };
    await expect(
      verifyChannelPreanalysisReviewBundleIntegrity(
        parseChannelPreanalysisReviewBundle(JSON.stringify(frameMutation)),
      ),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    await expect(
      verifyChannelPreanalysisReviewBundleIntegrity(
        parseChannelPreanalysisReviewBundle(JSON.stringify(contextMutation)),
      ),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
  });
});
