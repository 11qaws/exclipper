import { describe, expect, it } from "vitest";

import {
  completeBroadcastParticipantPreContext,
  orchestrateBroadcastParticipantPreContext,
  prepareBroadcastParticipantPreContext,
  type PrepareBroadcastParticipantPreContextInput,
} from "./broadcastParticipantPreContextOrchestration";
import {
  BroadcastParticipantGroundingPlanContractError,
  createBroadcastParticipantGroundingTerminalReceipt,
  projectBroadcastParticipantVoiceRecognition,
} from "./broadcastParticipantGroundingPlan";
import {
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
  candidatePassBCastReferences,
  type CandidatePassBParticipantId,
} from "./participantRoster";
import {
  PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
  type ParticipantVoiceEnrollmentAsset,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";

const SOURCE_DURATION_MS = 120_000;
const VISUAL_REFERENCE_MANIFEST_HASH = `sha256:${"b".repeat(64)}`;
const roster = candidatePassBCastReferences(
  DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
);

function baseInput(
  patch: Partial<PrepareBroadcastParticipantPreContextInput> = {},
): PrepareBroadcastParticipantPreContextInput {
  const mentionedParticipant = roster[1]!;
  return {
    sourceContentFingerprint:
      "local-file:v2|2026-07-17 음식 토크.mp4|476MB|arbitrary-format",
    sourceDurationMs: SOURCE_DURATION_MS,
    transcriptSeal: "transcript:event-boost:pre-context:sealed",
    castRosterId: DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
    dialogueChapters: [
      {
        chapterId: "chapter-1",
        startMs: 0,
        endMs: 60_000,
        summaryKo: `${mentionedParticipant.displayName} 이름을 대화에서 언급했다.`,
      },
      {
        chapterId: "chapter-2",
        startMs: 60_000,
        endMs: SOURCE_DURATION_MS,
        summaryKo: "이름을 언급하지 않은 일반 대화 구간이다.",
      },
    ],
    transcriptModelRevision: "qwen3-asr-pre-context-test-v1",
    ...patch,
  };
}

function enrollmentAsset(
  participantId: CandidatePassBParticipantId,
  ordinal: number,
  verified = true,
): ParticipantVoiceEnrollmentAsset {
  return {
    participantId,
    assetId: `voice:${participantId}:${ordinal}`,
    source: {
      sourceId: `chzzk-video:test:${participantId}`,
      startMs: ordinal * 10_000,
      endMs: ordinal * 10_000 + 8_000,
    },
    contentSha256: `sha256:${ordinal.toString(16).padStart(64, "0")}`,
    provenance: {
      sourceType: "creator-published",
      sourceLocator: "https://chzzk.naver.com/video/test",
      note: "검증용 단독 발화",
    },
    consent: {
      status: verified ? "not-required" : "unknown",
      basis: "테스트 근거",
    },
    language: "ko",
    speechActivity: "speech",
    containsOverlappingSpeech: !verified,
    containsMusic: !verified,
    humanVerification: verified
      ? {
          status: "verified",
          verifierId: "reviewer:test",
          verifiedAt: "2026-07-29T00:00:00.000Z",
          note: "단독 발화를 확인함",
        }
      : {
          status: "pending",
          verifierId: null,
          verifiedAt: null,
          note: "검토 대기",
        },
    embeddingModelRevision: "speaker-embedding:test-v1",
    assetRevision: "asset-v1",
  };
}

function enrollmentManifest(
  participantIds: readonly CandidatePassBParticipantId[],
  verified = true,
): ParticipantVoiceEnrollmentManifest {
  return {
    schemaVersion: PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
    manifestRevision: verified
      ? "voice-manifest-verified-v1"
      : "voice-manifest-pending-v1",
    assets: participantIds.map((participantId, ordinal) =>
      enrollmentAsset(participantId, ordinal + 1, verified),
    ),
  };
}

function enabledAdapter(
  prepared: Awaited<ReturnType<typeof prepareBroadcastParticipantPreContext>>,
  adapterName: "visual-identity" | "voice-identity",
) {
  const adapter = prepared.plan.adapters.find(
    ({ adapter }) => adapter === adapterName,
  );
  if (adapter === undefined || adapter.availability !== "enabled") {
    throw new Error(`Expected enabled ${adapterName}.`);
  }
  return adapter;
}

describe("broadcast participant pre-context orchestration", () => {
  it("hashes an arbitrary source identity, auto-seals transcript names, and explicitly marks missing media unavailable", async () => {
    const prepared = await prepareBroadcastParticipantPreContext(baseInput());

    expect(prepared.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(prepared.sourceFingerprint).not.toContain("음식");
    expect(prepared.expectedSourceFence).not.toBe(prepared.plan.sourceFence);
    expect(prepared.expectedSourceFence).toEqual(prepared.plan.sourceFence);
    expect(prepared.transcriptTerminalReceipts).toEqual([
      expect.objectContaining({
        adapter: "transcript-names",
        outcome: "identified",
        participantIds: [roster[1]!.participantId],
        confidence: 1,
      }),
      expect.objectContaining({
        adapter: "transcript-names",
        outcome: "none",
        participantIds: [],
        confidence: null,
      }),
    ]);
    expect(prepared.plan.adapters[1]).toMatchObject({
      adapter: "visual-identity",
      availability: "unavailable",
      unavailableReason: "no-verified-reference-manifest",
      cells: [],
    });
    expect(prepared.plan.adapters[2]).toMatchObject({
      adapter: "voice-identity",
      availability: "unavailable",
      unavailableReason: "no-verified-reference-manifest",
      cells: [],
    });

    const completed = completeBroadcastParticipantPreContext(prepared);
    expect(completed.planFingerprint).toBe(prepared.plan.planFingerprint);
    expect(completed.sealedPlan.status).toBe("sealed");
    expect(completed.grounding.evidence).toContainEqual(
      expect.objectContaining({
        kind: "transcript-name-mention",
        participantId: roster[1]!.participantId,
        chapterId: "chapter-1",
      }),
    );
    expect(completed.grounding.adapterReceipts.slice(1)).toEqual([
      expect.objectContaining({
        adapter: "visual-identity",
        status: "unavailable",
      }),
      expect.objectContaining({
        adapter: "voice-identity",
        status: "unavailable",
      }),
    ]);
  });

  it("seals zero dialogue chapters through one no-dialogue cell without inventing a person", async () => {
    const prepared = await prepareBroadcastParticipantPreContext(
      baseInput({ dialogueChapters: [] }),
    );

    expect(prepared.plan.adapters[0].cells).toHaveLength(1);
    expect(prepared.plan.adapters[0].cells[0]).toMatchObject({
      sourceStartMs: 0,
      sourceEndMs: SOURCE_DURATION_MS,
      sourceUnitId: "pre-context.no-dialogue",
    });
    expect(prepared.transcriptTerminalReceipts).toEqual([
      expect.objectContaining({
        outcome: "none",
        participantIds: [],
        confidence: null,
      }),
    ]);

    const completed = completeBroadcastParticipantPreContext(prepared);
    expect(
      completed.grounding.evidence.filter(
        ({ kind }) => kind === "transcript-name-mention",
      ),
    ).toEqual([]);
    expect(completed.grounding.participants.every(
      ({ mentionedChapterCount }) => mentionedChapterCount === 0,
    )).toBe(true);
    expect(completed.sealedPlan.terminalCells).toHaveLength(1);
  });

  it("refuses to seal an enabled visual runtime until every real cell receipt is supplied", async () => {
    const prepared = await prepareBroadcastParticipantPreContext(
      baseInput({
        visualReferenceManifest: {
          manifestHash: VISUAL_REFERENCE_MANIFEST_HASH,
          participantIds: roster.map(({ participantId }) => participantId),
        },
        visualRuntime: {
          adapterRevision: "visual-grounding-test-v1",
          modelRevision: "visual-closed-set-test-v1",
          cells: [
            {
              sourceStartMs: 10_000,
              sourceEndMs: 20_000,
              sourceUnitId: "visual-probe-1",
              frameTimestampsMs: [11_000, 13_000, 16_000, 19_000],
            },
          ],
        },
      }),
    );
    const visual = enabledAdapter(prepared, "visual-identity");

    expect(() => completeBroadcastParticipantPreContext(prepared)).toThrowError(
      BroadcastParticipantGroundingPlanContractError,
    );

    const visualReceipt = createBroadcastParticipantGroundingTerminalReceipt({
      plan: prepared.plan,
      adapter: "visual-identity",
      cellId: visual.cells[0]!.cellId,
      operationId: "pre-context.visual.test.1",
      attemptOrdinal: 0,
      outcome: "identified",
      participantIds: [roster[0]!.participantId],
      confidence: 0.94,
    });
    const completed = completeBroadcastParticipantPreContext(prepared, {
      visualTerminalReceipts: [visualReceipt],
    });
    expect(completed.grounding.evidence).toContainEqual(
      expect.objectContaining({
        kind: "visual-reference-match",
        participantId: roster[0]!.participantId,
      }),
    );
  });

  it("keeps a verified voice manifest fenced but unavailable without a runtime", async () => {
    const voiceParticipantIds = roster
      .slice(0, 2)
      .map(({ participantId }) => participantId);
    const prepared = await prepareBroadcastParticipantPreContext(
      baseInput({
        voiceEnrollmentManifest: enrollmentManifest(voiceParticipantIds),
      }),
    );

    expect(prepared.plan.adapters[2]).toMatchObject({
      adapter: "voice-identity",
      availability: "unavailable",
      unavailableReason: "unsupported-runtime",
      coveredParticipantIds: voiceParticipantIds,
      cells: [],
    });
    expect(prepared.plan.adapters[2].referenceManifestHash).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(() => completeBroadcastParticipantPreContext(prepared)).not.toThrow();
  });

  it("requires a terminal policy-projected voice receipt and can replay it through the one-call helper", async () => {
    const voiceParticipantIds = roster
      .slice(0, 2)
      .map(({ participantId }) => participantId);
    const input = baseInput({
      voiceEnrollmentManifest: enrollmentManifest(voiceParticipantIds),
      voiceRuntime: {
        adapterRevision: "voice-grounding-test-v1",
        segmentationModelRevision: "speech-segmentation-test-v1",
        recognitionPolicy: {
          policyRevision: "voice-open-set-test-v1",
          absoluteMatchThresholds: voiceParticipantIds.map(
            (participantId) => ({
              participantId,
              minimumNormalizedSimilarity: 0.8,
            }),
          ),
          minimumTop1Top2Margin: 0.08,
        },
        cells: [
          {
            sourceStartMs: 30_000,
            sourceEndMs: 40_000,
            sourceUnitId: "voice-turn-1",
          },
        ],
      },
    });
    const prepared = await prepareBroadcastParticipantPreContext(input);
    const voice = enabledAdapter(prepared, "voice-identity");

    expect(() => completeBroadcastParticipantPreContext(prepared)).toThrowError(
      BroadcastParticipantGroundingPlanContractError,
    );

    const projection = projectBroadcastParticipantVoiceRecognition({
      plan: prepared.plan,
      cellId: voice.cells[0]!.cellId,
      adapterFenceKey: voice.adapterFenceKey,
      modelRevision: voice.modelRevision,
      speechActivity: "speech",
      scores: [
        {
          participantId: voiceParticipantIds[0]!,
          normalizedSimilarity: 0.94,
        },
        {
          participantId: voiceParticipantIds[1]!,
          normalizedSimilarity: 0.61,
        },
      ],
    });
    const voiceReceipt = createBroadcastParticipantGroundingTerminalReceipt({
      plan: prepared.plan,
      adapter: "voice-identity",
      cellId: voice.cells[0]!.cellId,
      operationId: "pre-context.voice.test.1",
      attemptOrdinal: 0,
      outcome: projection.outcome,
      participantIds:
        projection.outcome === "identified" ? [projection.participantId] : [],
      confidence: projection.confidence,
      voiceRecognition: projection,
    });
    const completed = await orchestrateBroadcastParticipantPreContext({
      ...input,
      voiceTerminalReceipts: [voiceReceipt],
    });

    expect(completed.planFingerprint).toBe(prepared.planFingerprint);
    expect(completed.grounding.evidence).toContainEqual(
      expect.objectContaining({
        kind: "voice-reference-match",
        participantId: voiceParticipantIds[0],
      }),
    );
  });

  it("rejects unbounded dialogue maps before any plan can be sealed", async () => {
    const chapters = Array.from({ length: 145 }, (_, index) => ({
      chapterId: `chapter-${index + 1}`,
      startMs: index * 100,
      endMs: index * 100 + 100,
      summaryKo: `대화 ${index + 1}`,
    }));

    await expect(
      prepareBroadcastParticipantPreContext(
        baseInput({
          sourceDurationMs: 20_000,
          dialogueChapters: chapters,
        }),
      ),
    ).rejects.toThrow("at most 144");
  });
});
