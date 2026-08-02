import { describe, expect, it } from "vitest";

import { BROADCAST_CONTEXT_SCHEMA_VERSION } from "../analysis/broadcastContextProtocol";
import { createBroadcastParticipantGrounding } from "../analysis/broadcastParticipantGrounding";
import {
  CHANNEL_PREANALYSIS_PARTICIPANT_PROVENANCE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_BUNDLE_SCHEMA_VERSION,
  CHANNEL_PREANALYSIS_REVIEW_CERTIFICATE_SCHEMA_VERSION,
  channelPreanalysisReviewBundleArtifactId,
  validateChannelPreanalysisReviewBundle,
  type ChannelPreanalysisReviewBundle,
} from "../analysis/channelPreanalysisReviewBundle";
import { AMORETTO_CHANNEL_PREANALYSIS_SOURCE } from "../analysis/channelPreanalysisSources";
import { createChannelPreanalysisVisualCoverageReceipt } from "../analysis/channelPreanalysisVisualCoverage";
import {
  currentCandidatePassBContext,
  currentCandidatePassBInsight,
  currentCandidatePassBReceipt,
} from "../testSupport/candidatePassBCurrentFixture";
import { projectPreparedReviewBundle } from "./preparedReviewProjection";

const VIDEO_ID = "KzAW3yow80Q";
const DURATION_MS = 120_000;
const REVISION = 4;
const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

function reviewReadyBundle(): ChannelPreanalysisReviewBundle {
  const context = {
    ...currentCandidatePassBContext(),
    beforeContextKo: "여러 번 실패한 뒤 마지막 시도를 준비했습니다.",
    afterContextKo: "성공 과정을 설명하고 다음 주제로 넘어갔습니다.",
    topicContextKo: "마지막 시도와 조용한 성공",
    fastEvidenceKo: "반응 시점에서 화면과 대사가 함께 바뀌었습니다.",
    contextVerdictKo: "앞선 실패가 쌓인 뒤 성공한 장면입니다.",
    chatReactionKo: "채팅에서 성공을 축하했습니다.",
  };
  const receipt = currentCandidatePassBReceipt(context);
  const frames = receipt.dispatchIntent.mediaReceipt.frames.map((frame, index) => ({
    ...frame,
    dataBase64: Buffer.from(`frame-${String(index)}`).toString("base64"),
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
  const insight = {
    ...currentCandidatePassBInsight(),
    eventSummaryKo: "마지막 시도에서 목표를 달성하고 결과 화면을 확인했습니다.",
    reactionSummaryKo: "스트리머가 결과를 확인한 뒤 기뻐했습니다.",
    whyGoodClipKo: "앞선 실패와 성공의 보상이 한 구간 안에서 완결됩니다.",
    uncertaintiesKo: ["성공 직전의 짧은 발화 한 단어는 불명확합니다."],
    participantPresence: "identified" as const,
    participantSummaryKo: "화면 이름표로 아모레또를 확인했습니다.",
    identifiedParticipants: [
      {
        displayName: "아모레또",
        role: "streamer" as const,
        evidenceBasis: "on-screen-name" as const,
        evidenceKo: "대표 화면의 이름표에 아모레또라고 표시되었습니다.",
        confidence: 0.96,
        relativeTimestampMs: 25_000,
        observedFrameIndices: [2],
      },
    ],
  };

  return validateChannelPreanalysisReviewBundle({
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
      broadcastSummaryKo: "실패를 반복한 뒤 마지막 시도에서 목표를 달성한 방송입니다.",
      hostStreamerProfile: {
        displayNameKo: "아모레또",
        profileSummaryKo: "도전 과정을 차분히 설명하며 방송을 진행했습니다.",
        evidenceKo: ["화면 이름표와 발화에서 진행자를 확인했습니다."],
        uncertaintiesKo: [],
      },
      recurringThemesKo: ["반복 도전", "성공 확인"],
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
    visualCoverage: createChannelPreanalysisVisualCoverageReceipt({
      sourceDurationMs: DURATION_MS,
      videoId: VIDEO_ID,
      sourceFingerprintDigest: digest("f"),
      visualSeedTimestampsMs: [60_000],
    }),
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
          cues: [
            {
              phase: "near-peak",
              absoluteStartMs: 83_000,
              absoluteEndMs: 84_000,
              text: "됐다!",
              confidence: 0.94,
            },
          ],
          overlay: {
            event: "마지막 시도의 성공",
            why: "실패의 누적과 성공 반응이 연결됩니다.",
            reviewHint: "성공 화면과 반응을 함께 확인하세요.",
            basisLabel: "AI 대사 해석 · 재생 확인 필요",
          },
          quality: {
            receivedChunkCount: 1,
            mappedChunkCount: 1,
            usableChunkCount: 1,
            discardedChunkCount: 0,
            meanConfidence: 0.94,
          },
          status: "grounded-transcript",
          fallbackReason: null,
        },
        insight,
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
  });
}

describe("prepared review projection", () => {
  it("maps the validated candidate closure into the existing review surface model", () => {
    const bundle = reviewReadyBundle();
    const before = JSON.stringify(bundle);
    const result = projectPreparedReviewBundle(bundle);

    expect(result.outcome).toBe("review-ready");
    expect(result.display).toMatchObject({
      sourceId: AMORETTO_CHANNEL_PREANALYSIS_SOURCE.sourceId,
      videoId: VIDEO_ID,
      sourceDurationMs: DURATION_MS,
      streamerNameKo: "아모레또",
      broadcastSummaryKo: "실패를 반복한 뒤 마지막 시도에서 목표를 달성한 방송입니다.",
      pipelineRevision: "scheduled-review-v1",
    });
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate).toMatchObject({
      id: "candidate-1",
      title: "마지막 시도의 성공",
      startMs: 60_000,
      endMs: 105_000,
      peakMs: 85_000,
      decision: "pending",
      quote: "됐다!",
    });
    expect(candidate.why).toContain("목표를 달성");
    expect(candidate.why).toContain("성공의 보상");
    expect(candidate.cues).toEqual([
      { id: "candidate-1-cue-0", atMs: 83_000, text: "됐다!" },
    ]);
    expect(candidate.people).toEqual([{ name: "아모레또", role: "스트리머" }]);
    expect(candidate.frames.map(({ atMs }) => atMs)).toEqual([
      65_000,
      75_000,
      85_000,
      95_000,
    ]);
    expect(candidate.frames[2]?.imageUrl).toBe(
      `data:image/jpeg;base64,${Buffer.from("frame-2").toString("base64")}`,
    );
    expect(candidate.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "앞 맥락", atMs: 60_000 }),
        expect.objectContaining({ label: "뒤 맥락", atMs: 105_000 }),
        expect.objectContaining({ label: "채팅 반응", text: "채팅에서 성공을 축하했습니다." }),
        expect.objectContaining({
          label: "인물 근거 · 아모레또",
          atMs: 85_000,
          text: "대표 화면의 이름표에 아모레또라고 표시되었습니다.",
        }),
        expect.objectContaining({ label: "AI가 확인하지 못한 점" }),
      ]),
    );
    expect(JSON.stringify(bundle)).toBe(before);
    expect(projectPreparedReviewBundle(bundle)).toEqual(result);
  });

  it("preserves an explicit no-participant finding without creating a person", () => {
    const bundle = reviewReadyBundle();
    const candidate = bundle.candidates[0]!;
    const validated = validateChannelPreanalysisReviewBundle({
      ...bundle,
      candidates: [
        {
          ...candidate,
          insight: {
            ...candidate.insight,
            participantPresence: "none-present",
            participantSummaryKo: "네 화면에서 등장인물이 확인되지 않았습니다.",
            identifiedParticipants: [],
          },
        },
      ],
    });

    const projected = projectPreparedReviewBundle(validated);
    expect(projected.candidates[0]?.people).toEqual([]);
    expect(projected.candidates[0]?.context).toContainEqual(
      expect.objectContaining({
        label: "등장인물",
        text: "네 화면에서 등장인물이 확인되지 않았습니다.",
      }),
    );
  });

  it("returns a certified verified-empty result without fabricating a candidate", () => {
    const bundle = reviewReadyBundle();
    const empty = validateChannelPreanalysisReviewBundle({
      ...bundle,
      candidates: [],
      certificate: {
        ...bundle.certificate,
        outcome: "verified-empty",
        finalCandidateIds: [],
      },
    });

    const result = projectPreparedReviewBundle(empty);
    expect(result.outcome).toBe("verified-empty");
    expect(result.candidates).toEqual([]);
    expect(result.display.broadcastSummaryKo).toBe(
      bundle.broadcastContext.broadcastSummaryKo,
    );
  });
});
