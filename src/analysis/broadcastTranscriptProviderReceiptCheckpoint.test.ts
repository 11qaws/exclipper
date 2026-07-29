import { describe, expect, it } from "vitest";
import {
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
  recordBroadcastTranscriptProviderReceipt,
  serializeBroadcastTranscriptProviderReceiptCheckpoint,
} from "./broadcastTranscriptProviderReceiptCheckpoint";

async function paidRoute() {
  const manifest: BroadcastTranscriptRouteManifest = {
    schemaVersion: "1.0.0",
    serviceVersion: 5,
    routingPolicyVersion: "1.11.0",
    providerConfigurationVersion: "1.3.0",
    transportVersion: 2,
    transportMode: "paid-direct",
    maximumChunkDurationMs: 90_000,
    primaryMediaType: "audio/wav",
    provider: "qwen",
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
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
    ).toContain("broadcast-transcript-mixed-v1:");
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

  it("rejects receipt ranges or route fingerprints that do not match the plan", async () => {
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
    ).toBeNull();
  });
});
