import { describe, expect, it } from "vitest";

import { AI_BROADCAST_CONTEXT_ROUTING_REVISION } from "./aiModelRoutingPolicy";
import { createBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  calculateCoverage,
  type BroadcastContextChapterInput,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "./broadcastContextProtocol";
import {
  createChannelPreanalysisContextSeed,
  validateChannelPreanalysisContextSeed,
} from "./channelPreanalysisContextSeed";

const scheduledDurationMs = 120_000;
const localDurationMs = 119_817;
const scheduledChapters: readonly BroadcastContextChapterInput[] = [
  {
    chapterId: "youtube-001",
    startMs: 0,
    endMs: 60_000,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: "유튜브 자막에서 첫 번째 음식 이야기를 확인했다.",
  },
  {
    chapterId: "youtube-002",
    startMs: 60_000,
    endMs: scheduledDurationMs,
    evidenceMode: "complete-transcript",
    evidenceCoverageRatio: 1,
    summaryKo: "유튜브 자막에서 두 번째 음식 이야기를 확인했다.",
  },
];
const localChapters: readonly BroadcastContextChapterInput[] = [
  {
    chapterId: "local-visual-001",
    startMs: 0,
    endMs: 40_000,
    evidenceMode: "sampled-audio-video",
    evidenceCoverageRatio: 0.9,
    summaryKo: "로컬 화면과 음성에서 도입부를 확인했다.",
  },
  {
    chapterId: "local-visual-002",
    startMs: 40_000,
    endMs: 80_000,
    evidenceMode: "sampled-audio-video",
    evidenceCoverageRatio: 0.95,
    summaryKo: "로컬 화면과 음성에서 첫 주제 전환을 확인했다.",
  },
  {
    chapterId: "local-visual-003",
    startMs: 80_000,
    endMs: localDurationMs,
    evidenceMode: "sampled-audio-video",
    evidenceCoverageRatio: 1,
    summaryKo: "로컬 화면과 음성에서 마무리 주제를 확인했다.",
  },
];

function deterministicFingerprint() {
  return (parts: readonly string[]): Promise<string> =>
    Promise.resolve(`test:${JSON.stringify(parts)}`);
}

function scheduledResult(): BroadcastContextResult {
  return {
    schemaVersion: BROADCAST_CONTEXT_SCHEMA_VERSION,
    broadcastSummaryKo:
      "음식 이름을 맞히며 취향과 경험을 길게 이야기한 방송이다.",
    hostStreamerProfile: {
      displayNameKo: null,
      profileSummaryKo:
        "주 진행자는 음식의 특징을 설명하고 정답과 오답에 차분히 반응한다.",
      evidenceKo: ["음식의 맛과 재료를 반복해서 비교한다."],
      uncertaintiesKo: ["자막만으로 추정한 설명이다."],
    },
    recurringThemesKo: ["음식 이름 맞히기", "개인 취향 토크"],
    annotations: [],
    semanticChaptersSupported: true,
    semanticChapters: [
      {
        semanticChapterId:
          "sc-youtube-001-youtube-001-story-progress",
        startChapterId: "youtube-001",
        endChapterId: "youtube-001",
        startMs: 0,
        endMs: 60_000,
        titleKo: "첫 음식 주제",
        summaryKo: "첫 번째 음식의 이름과 맛을 이야기한다.",
        kind: "story-progress",
        salience: "primary",
        relatedCandidateIds: [],
        uncertaintiesKo: [],
      },
    ],
    discoveredLeadsSupported: true,
    discoveredLeads: [
      {
        leadId: "lead-food-002",
        startChapterId: "youtube-002",
        endChapterId: "youtube-002",
        startMs: 60_000,
        endMs: scheduledDurationMs,
        category: "reaction",
        confidence: 0.83,
        eventSummaryKo: "두 번째 음식의 정체를 알아챈다.",
        whyThisMomentKo: "정답을 확인한 뒤 반응이 이어진다.",
        evidenceCueKo: "이게 그 음식이었구나.",
        uncertaintiesKo: [],
      },
    ],
    coverage: calculateCoverage(
      scheduledChapters,
      scheduledDurationMs,
    ),
  };
}

function localInput(
  chapters: readonly BroadcastContextChapterInput[] = localChapters,
  durationMs = localDurationMs,
): BroadcastContextRequestInput {
  return {
    sourceDurationMs: durationMs,
    chapters,
    candidates: [],
    castRosterId: null,
    participantGrounding: createBroadcastParticipantGrounding({
      sourceDurationMs: durationMs,
      castRosterId: null,
      chapters,
    }),
    outputLanguage: "ko",
  };
}

async function seed() {
  return createChannelPreanalysisContextSeed(
    {
      sourceDurationMs: scheduledDurationMs,
      chapters: scheduledChapters,
      castRosterId: null,
      outputLanguage: "ko",
      sourceIdentity: {
        videoId: "KzAW3yow80Q",
        transcriptDigest: `sha256:${"a".repeat(64)}`,
        artifactDigest: `sha256:${"b".repeat(64)}`,
      },
      provenance: {
        generatedAt: "2026-07-30T00:00:00.000Z",
        modelRoutingRevision: AI_BROADCAST_CONTEXT_ROUTING_REVISION,
        evidenceScope: "youtube-caption-transcript-only",
        localVisualVerificationRequired: true,
      },
      result: scheduledResult(),
    },
    deterministicFingerprint(),
  );
}

describe("channelPreanalysisContextSeed", () => {
  it("validates the exact scheduled request, then rebases it to different local chapters within the two-second duration fence", async () => {
    const prepared = await seed();
    const validated = await validateChannelPreanalysisContextSeed(
      prepared,
      localInput(),
      prepared.sourceIdentity,
      deterministicFingerprint(),
    );

    expect(validated).not.toBeNull();
    expect(validated?.semanticChapters[0]).toMatchObject({
      startChapterId: "local-visual-001",
      endChapterId: "local-visual-002",
      startMs: 0,
      endMs: 80_000,
    });
    expect(validated?.discoveredLeads[0]).toMatchObject({
      startChapterId: "local-visual-002",
      endChapterId: "local-visual-003",
      startMs: 40_000,
      endMs: localDurationMs,
    });
    expect(validated?.coverage).toEqual(
      calculateCoverage(localChapters, localDurationMs),
    );
    expect(
      validated?.hostStreamerProfile?.uncertaintiesKo,
    ).toContain(
      "YouTube 자막으로 사전 추정한 내용이며, 주 진행자 신원과 설명은 로컬 화면·목소리로 확인해야 합니다.",
    );
    expect(validated?.annotations).toEqual([]);
  });

  it("rejects a source outside the inclusive two-second duration fence", async () => {
    const prepared = await seed();
    await expect(
      validateChannelPreanalysisContextSeed(
        prepared,
        localInput(localChapters, scheduledDurationMs - 2_001),
        prepared.sourceIdentity,
        deterministicFingerprint(),
      ),
    ).resolves.toBeNull();
  });

  it("rejects result substitution after the seed fingerprint was issued", async () => {
    const original = await seed();
    const tampered = {
      ...original,
      result: {
        ...original.result,
        broadcastSummaryKo: "바뀐 방송 요약",
      },
    };

    await expect(
      validateChannelPreanalysisContextSeed(
        tampered,
        localInput(),
        tampered.sourceIdentity,
        deterministicFingerprint(),
      ),
    ).resolves.toBeNull();
  });

  it("rejects projection across a local evidence coverage gap", async () => {
    const prepared = await seed();
    const gapChapters: readonly BroadcastContextChapterInput[] = [
      {
        ...localChapters[0]!,
        endMs: 30_000,
      },
      {
        ...localChapters[1]!,
        startMs: 50_000,
        endMs: localDurationMs,
      },
    ];

    await expect(
      validateChannelPreanalysisContextSeed(
        prepared,
        localInput(gapChapters),
        prepared.sourceIdentity,
        deterministicFingerprint(),
      ),
    ).resolves.toBeNull();
  });

  it("rejects an untrusted source identity even when the payload fingerprint is recomputed", async () => {
    const original = await seed();
    const invalidIdentitySeed =
      await createChannelPreanalysisContextSeed(
        {
          ...original,
          sourceIdentity: {
            ...original.sourceIdentity,
            videoId: "bad",
          },
        },
        deterministicFingerprint(),
      );

    await expect(
      validateChannelPreanalysisContextSeed(
        invalidIdentitySeed,
        localInput(),
        invalidIdentitySeed.sourceIdentity,
        deterministicFingerprint(),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a well-formed seed when the App trust assertion names another video", async () => {
    const prepared = await seed();

    await expect(
      validateChannelPreanalysisContextSeed(
        prepared,
        localInput(),
        {
          ...prepared.sourceIdentity,
          videoId: "abcdefghijk",
        },
        deterministicFingerprint(),
      ),
    ).resolves.toBeNull();
  });
});
