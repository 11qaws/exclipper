import { describe, expect, it } from "vitest";
import {
  BROADCAST_TRANSCRIPT_CHECKPOINT_MIXED_REVISION_PREFIX,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
  BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
} from "./broadcastTranscriptQwen";
import {
  createBroadcastTranscriptProviderReceipt,
  createBroadcastTranscriptRouteSelection,
  type BroadcastTranscriptRouteManifest,
  type BroadcastTranscriptVerifiedResult,
} from "./broadcastTranscriptRouteManifest";
import {
  broadcastTranscriptProviderReceiptCheckpointModelRevision,
  createBroadcastTranscriptProviderReceiptCheckpoint,
  inspectBroadcastTranscriptProviderReceiptSettlement,
  parseBroadcastTranscriptProviderReceiptCheckpointJson,
  rebaseBroadcastTranscriptProviderReceiptCheckpointRoute,
  recordBroadcastTranscriptCaptionReceipt,
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "./broadcastTranscriptProviderReceiptCheckpoint";

async function paidRoute() {
  const manifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: "1.1.0",
    serviceVersion: 6,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 3,
    transportMode: "paid-direct",
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    effectiveFallback: {
      mode: "bounded",
      provider: "gemini",
      modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
    },
  };
  return createBroadcastTranscriptRouteSelection(manifest);
}

function result(
  sourceStartMs: number,
  sourceEndMs: number,
  receipt: ReturnType<typeof createBroadcastTranscriptProviderReceipt>,
): BroadcastTranscriptVerifiedResult {
  return {
    schemaVersion: "1.0.0",
    modelId: receipt.modelId,
    modelRevision: receipt.modelRevision,
    providerReceipt: receipt,
    sourceStartMs,
    sourceEndMs,
    textKo: "확인된 한국어 대사",
    detectedLanguage: "ko",
    emotion: null,
    billedSeconds: (sourceEndMs - sourceStartMs) / 1_000,
  };
}

describe("broadcastTranscriptProviderReceiptCheckpoint", () => {
  it("persists an exact provider receipt for every successful ASR cell", async () => {
    const route = await paidRoute();
    let checkpoint = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: "sha256:source",
      sourceDurationMs: 3_000,
      route,
      plannedCells: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
        { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000 },
        { chunkId: "asr-003", sourceStartMs: 2_000, sourceEndMs: 3_000 },
      ],
    });
    checkpoint = recordBroadcastTranscriptProviderReceipt(
      checkpoint,
      "asr-001",
      result(
        0,
        1_000,
        createBroadcastTranscriptProviderReceipt(
          route,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
          false,
        ),
      ),
    );
    checkpoint = recordBroadcastTranscriptProviderReceipt(
      checkpoint,
      "asr-002",
      result(
        1_000,
        2_000,
        createBroadcastTranscriptProviderReceipt(
          route,
          BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
          BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION,
          true,
        ),
      ),
    );

    const reopened = parseBroadcastTranscriptProviderReceiptCheckpointJson(
      serializeBroadcastTranscriptProviderReceiptCheckpoint(checkpoint),
    );
    expect(reopened).toEqual(checkpoint);
    expect(reopened?.receipts).toMatchObject([
      {
        chunkId: "asr-001",
        receipt: { provider: "qwen", fallbackUsed: false },
      },
      {
        chunkId: "asr-002",
        receipt: { provider: "gemini", fallbackUsed: true },
      },
    ]);
    expect(
      broadcastTranscriptProviderReceiptCheckpointModelRevision(checkpoint),
    ).toContain("broadcast-transcript-mixed-v2:");
    expect(
      parseBroadcastTranscriptProviderReceiptCheckpointJson(
        JSON.stringify({ ...checkpoint, schemaVersion: "1.0.0" }),
      ),
    ).toBeNull();
    const preCaptionShape = JSON.parse(
      JSON.stringify(checkpoint),
    ) as Record<string, unknown>;
    Reflect.deleteProperty(preCaptionShape, "captionReceipts");
    expect(
      parseBroadcastTranscriptProviderReceiptCheckpointJson(
        JSON.stringify(preCaptionShape),
      ),
    ).toBeNull();
  });

  it("requires every plan cell to settle as receipt, resolved evidence, or gap", async () => {
    const route = await paidRoute();
    let checkpoint = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: "sha256:source",
      sourceDurationMs: 3_000,
      route,
      plannedCells: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
        { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000 },
        { chunkId: "asr-003", sourceStartMs: 2_000, sourceEndMs: 3_000 },
      ],
    });
    checkpoint = recordBroadcastTranscriptProviderReceipt(
      checkpoint,
      "asr-001",
      result(
        0,
        1_000,
        createBroadcastTranscriptProviderReceipt(
          route,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
          false,
        ),
      ),
    );

    expect(
      inspectBroadcastTranscriptProviderReceiptSettlement({
        checkpoint,
        chapterRanges: [{ startMs: 0, endMs: 1_000 }],
        resolvedChunkIds: ["asr-002"],
        gapChunkIds: ["asr-003"],
      }),
    ).toMatchObject({
      plannedCellCount: 3,
      receiptCount: 1,
      resolvedCount: 1,
      gapCount: 1,
      isPlanSettled: false,
    });

    expect(() =>
      inspectBroadcastTranscriptProviderReceiptSettlement({
        checkpoint,
        chapterRanges: [{ startMs: 0, endMs: 1_000 }],
        resolvedChunkIds: [],
        gapChunkIds: ["asr-003"],
      }),
    ).toThrow("Every provider receipt plan cell");
  });

  it("settles exact caption cells beside ASR and binds the persisted chapter content", async () => {
    const route = await paidRoute();
    let checkpoint = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: "sha256:source",
      sourceDurationMs: 2_000,
      route,
      plannedCells: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
        { chunkId: "asr-002", sourceStartMs: 1_000, sourceEndMs: 2_000 },
      ],
    });
    const captionChapter = {
      startMs: 0,
      endMs: 1_000,
      summaryKo: "자막으로 확인한 첫 번째 구간",
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
    } as const;
    checkpoint = recordBroadcastTranscriptCaptionReceipt(
      checkpoint,
      "asr-001",
      {
        videoId: "abcdefghijk",
        languageCode: "ko",
        isAutoGenerated: true,
      },
      captionChapter,
    );
    checkpoint = recordBroadcastTranscriptProviderReceipt(
      checkpoint,
      "asr-002",
      result(
        1_000,
        2_000,
        createBroadcastTranscriptProviderReceipt(
          route,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
          BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
          false,
        ),
      ),
    );

    expect(
      inspectBroadcastTranscriptProviderReceiptSettlement({
        checkpoint,
        chapterRanges: [
          captionChapter,
          {
            startMs: 1_000,
            endMs: 2_000,
          },
        ],
        resolvedChunkIds: [],
        gapChunkIds: [],
      }),
    ).toMatchObject({
      plannedCellCount: 2,
      receiptCount: 2,
      providerReceiptCount: 1,
      captionReceiptCount: 1,
      isPlanSettled: true,
    });
    expect(
      broadcastTranscriptProviderReceiptCheckpointModelRevision(checkpoint),
    ).toBe(
      `${BROADCAST_TRANSCRIPT_CHECKPOINT_MIXED_REVISION_PREFIX}qwen-omni+youtube-caption`,
    );
    expect(() =>
      inspectBroadcastTranscriptProviderReceiptSettlement({
        checkpoint,
        chapterRanges: [
          {
            ...captionChapter,
            summaryKo: "나중에 바뀐 자막",
          },
          { startMs: 1_000, endMs: 2_000 },
        ],
        resolvedChunkIds: [],
        gapChunkIds: [],
      }),
    ).toThrow("caption receipt");
    expect(
      parseBroadcastTranscriptProviderReceiptCheckpointJson(
        serializeBroadcastTranscriptProviderReceiptCheckpoint(checkpoint),
      ),
    ).toEqual(checkpoint);
  });

  it("rejects mismatched ranges while preserving receipts from an earlier exact route", async () => {
    const route = await paidRoute();
    const checkpoint = createBroadcastTranscriptProviderReceiptCheckpoint({
      sourceFingerprint: "sha256:source",
      sourceDurationMs: 1_000,
      route,
      plannedCells: [
        { chunkId: "asr-001", sourceStartMs: 0, sourceEndMs: 1_000 },
      ],
    });
    const validReceipt = createBroadcastTranscriptProviderReceipt(
      route,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      false,
    );
    expect(() =>
      recordBroadcastTranscriptProviderReceipt(
        checkpoint,
        "asr-001",
        result(1, 1_000, validReceipt),
      ),
    ).toThrow("exact provider receipt cell");

    expect(
      parseBroadcastTranscriptProviderReceiptCheckpointJson(
        JSON.stringify({
          ...checkpoint,
          receipts: [
            {
              chunkId: "asr-001",
              sourceStartMs: 0,
              sourceEndMs: 1_000,
              receipt: {
                ...validReceipt,
                routeManifestFingerprint: `sha256:${"0".repeat(64)}`,
              },
            },
          ],
        }),
      ),
    ).toMatchObject({
      receipts: [
        {
          chunkId: "asr-001",
          receipt: {
            routeManifestFingerprint: `sha256:${"0".repeat(64)}`,
          },
        },
      ],
    });

    const rebased = rebaseBroadcastTranscriptProviderReceiptCheckpointRoute(
      {
        ...checkpoint,
        receipts: [
          {
            chunkId: "asr-001",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            receipt: validReceipt,
          },
        ],
      },
      await createBroadcastTranscriptRouteSelection({
        ...route.manifest,
        effectiveFallback: { mode: "disabled" },
      }),
    );
    expect(rebased.receipts).toEqual([
      {
        chunkId: "asr-001",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        receipt: validReceipt,
      },
    ]);
  });
});
