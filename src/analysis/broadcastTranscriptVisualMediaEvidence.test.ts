import { describe, expect, it } from "vitest";

import { createVerifiedNoSpeechRunReceiptForTest } from "../testSupport/broadcastSpeechActivityTestReceipt";
import {
  createBroadcastTranscriptResolvedEvidenceCheckpoint,
  recordBroadcastTranscriptResolvedEvidence,
} from "./broadcastTranscriptResolvedEvidence";
import {
  BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualInspectionPlan,
  createBroadcastTranscriptVisualPreparedFrameReceipt,
  createBroadcastTranscriptVisualProviderBatchQueue,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualProviderTask,
} from "./broadcastTranscriptVisualInspectionQueue";
import {
  BroadcastTranscriptVisualMediaEvidenceError,
  createBroadcastTranscriptVisualMediaContentFingerprint,
  verifyBroadcastTranscriptVisualHydratedMediaEvidence,
  type BroadcastTranscriptVisualHydratedMediaEvidence,
} from "./broadcastTranscriptVisualMediaEvidence";

const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const ENCODER = new TextEncoder();
const FRAME_BYTES = [
  ENCODER.encode("frame-a"),
  ENCODER.encode("frame-b"),
  ENCODER.encode("frame-c"),
  ENCODER.encode("frame-d"),
] as const;
const AUDIO_BYTES = ENCODER.encode("exact no-speech audio");

function plan(reason: "no-speech" | "no-audio") {
  let evidence = createBroadcastTranscriptResolvedEvidenceCheckpoint({
    sourceFingerprint: SOURCE_FINGERPRINT,
    sourceDurationMs: 30_000,
    transcriptInputSignature: "transcript-plan-v1",
    modelRevision: "qwen-asr-v1",
    plannedCells: [
      { chunkId: "asr-a", sourceStartMs: 0, sourceEndMs: 30_000 },
    ],
  });
  evidence =
    reason === "no-audio"
      ? recordBroadcastTranscriptResolvedEvidence(
          evidence,
          "asr-a",
          "no-audio",
          null,
        )
      : recordBroadcastTranscriptResolvedEvidence(
          evidence,
          "asr-a",
          "no-speech",
          createVerifiedNoSpeechRunReceiptForTest(30_000, 0, 30_000),
        );
  return createBroadcastTranscriptVisualInspectionPlan(evidence);
}

async function preparedReceipt(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
): Promise<BroadcastTranscriptVisualPreparedFrameReceipt> {
  const frameContentFingerprints = (await Promise.all(
    FRAME_BYTES.map((bytes) =>
      createBroadcastTranscriptVisualMediaContentFingerprint(bytes),
    ),
  )) as unknown as BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];
  return createBroadcastTranscriptVisualPreparedFrameReceipt({
    plan: currentPlan,
    cellId: "visual:asr-a",
    frameContentFingerprints,
    audioEvidence:
      currentPlan.cells[0]?.transcriptAbstentionReason === "no-audio"
        ? null
        : {
            sourceStartMs: 0,
            sourceEndMs: 30_000,
            codec: "audio/wav;codecs=pcm_s16le",
            extractionRevision:
              BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
            contentFingerprint:
              await createBroadcastTranscriptVisualMediaContentFingerprint(
                AUDIO_BYTES,
              ),
          },
  });
}

function providerTask(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
): BroadcastTranscriptVisualProviderTask {
  return createBroadcastTranscriptVisualProviderBatchQueue({
    plan: currentPlan,
    framePreparationQueue:
      createBroadcastTranscriptVisualFramePreparationQueue(currentPlan),
    preparedFrameReceipts: [receipt],
    maximumBatchSize: 1,
  }).batches[0]!.tasks[0]!;
}

function hydrated(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
): BroadcastTranscriptVisualHydratedMediaEvidence {
  return {
    planFingerprint: currentPlan.planFingerprint,
    sourceFingerprint: currentPlan.sourceFence.sourceFingerprint,
    cellId: receipt.cellId,
    sourceStartMs: receipt.sourceStartMs,
    sourceEndMs: receipt.sourceEndMs,
    frames: receipt.frameTimestampsMs.map((timestampMs, index) => ({
      timestampMs,
      contentType: "image/jpeg",
      bytes: FRAME_BYTES[index]!,
    })) as unknown as BroadcastTranscriptVisualHydratedMediaEvidence["frames"],
    audio:
      receipt.audioEvidence === null
        ? null
        : {
            sourceStartMs: receipt.audioEvidence.sourceStartMs,
            sourceEndMs: receipt.audioEvidence.sourceEndMs,
            codec: receipt.audioEvidence.codec,
            extractionRevision: receipt.audioEvidence.extractionRevision,
            bytes: AUDIO_BYTES,
          },
  };
}

async function verify(
  currentPlan: BroadcastTranscriptVisualInspectionPlan,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
  evidence: BroadcastTranscriptVisualHydratedMediaEvidence,
) {
  return verifyBroadcastTranscriptVisualHydratedMediaEvidence({
    plan: currentPlan,
    task: providerTask(currentPlan, receipt),
    preparedReceipt: receipt,
    hydrated: evidence,
    fingerprint: ({ bytes }) =>
      createBroadcastTranscriptVisualMediaContentFingerprint(bytes),
  });
}

describe("broadcast transcript visual media evidence", () => {
  it("accepts exact four-frame plus no-speech audio hydration and copies verified bytes", async () => {
    const currentPlan = plan("no-speech");
    const receipt = await preparedReceipt(currentPlan);
    const evidence = hydrated(currentPlan, receipt);
    const verified = await verify(currentPlan, receipt, evidence);

    expect(verified).toMatchObject({
      verified: true,
      cellId: "visual:asr-a",
      sourceStartMs: 0,
      sourceEndMs: 30_000,
    });
    expect(verified.frames).toHaveLength(4);
    expect(verified.audio).not.toBeNull();
    expect(verified.frames[0].bytes).not.toBe(evidence.frames[0].bytes);
    expect(verified.audio?.bytes).not.toBe(evidence.audio?.bytes);
  });

  it("rejects tampered frame or audio bytes", async () => {
    const currentPlan = plan("no-speech");
    const receipt = await preparedReceipt(currentPlan);
    const evidence = hydrated(currentPlan, receipt);

    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        frames: evidence.frames.map((frame, index) => ({
          ...frame,
          bytes: index === 2 ? ENCODER.encode("tampered") : frame.bytes,
        })) as unknown as BroadcastTranscriptVisualHydratedMediaEvidence["frames"],
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_FINGERPRINT_MISMATCH",
    });
    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        audio:
          evidence.audio === null
            ? null
            : { ...evidence.audio, bytes: ENCODER.encode("tampered") },
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_FINGERPRINT_MISMATCH",
    });
  });

  it("rejects a missing representative frame", async () => {
    const currentPlan = plan("no-speech");
    const receipt = await preparedReceipt(currentPlan);
    const evidence = hydrated(currentPlan, receipt);

    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        frames: evidence.frames.slice(
          0,
          3,
        ) as unknown as BroadcastTranscriptVisualHydratedMediaEvidence["frames"],
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "MISSING_FRAME",
      }),
    );
  });

  it("rejects wrong source range and audio extraction revision", async () => {
    const currentPlan = plan("no-speech");
    const receipt = await preparedReceipt(currentPlan);
    const evidence = hydrated(currentPlan, receipt);

    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        sourceStartMs: 1,
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_FENCE_MISMATCH",
    });
    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        audio:
          evidence.audio === null
            ? null
            : {
                ...evidence.audio,
                extractionRevision: "stale-audio-extractor",
              },
      }),
    ).rejects.toMatchObject({
      code: "EXTRACTION_REVISION_MISMATCH",
    });
  });

  it("accepts explicit no-audio null and rejects invented audio bytes", async () => {
    const currentPlan = plan("no-audio");
    const receipt = await preparedReceipt(currentPlan);
    const evidence = hydrated(currentPlan, receipt);

    await expect(verify(currentPlan, receipt, evidence)).resolves.toMatchObject({
      verified: true,
      audio: null,
    });
    await expect(
      verify(currentPlan, receipt, {
        ...evidence,
        audio: {
          sourceStartMs: 0,
          sourceEndMs: 30_000,
          codec: "audio/wav;codecs=pcm_s16le",
          extractionRevision:
            BROADCAST_TRANSCRIPT_VISUAL_AUDIO_EXTRACTION_REVISION,
          bytes: AUDIO_BYTES,
        },
      }),
    ).rejects.toBeInstanceOf(
      BroadcastTranscriptVisualMediaEvidenceError,
    );
  });
});
