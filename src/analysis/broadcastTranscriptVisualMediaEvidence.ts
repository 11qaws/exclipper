import {
  BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT,
  createBroadcastTranscriptVisualFramePreparationQueue,
  createBroadcastTranscriptVisualProviderBatchQueue,
  type BroadcastTranscriptVisualInspectionPlan,
  type BroadcastTranscriptVisualPreparedAudioEvidence,
  type BroadcastTranscriptVisualPreparedFrameReceipt,
  type BroadcastTranscriptVisualProviderTask,
} from "./broadcastTranscriptVisualInspectionQueue";

export const BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE =
  "image/jpeg" as const;

export type BroadcastTranscriptVisualPreparedFrameFingerprints =
  BroadcastTranscriptVisualPreparedFrameReceipt["frameContentFingerprints"];

export interface BroadcastTranscriptVisualPreparedMediaEvidence {
  readonly frameContentFingerprints: BroadcastTranscriptVisualPreparedFrameFingerprints;
  readonly audioEvidence: BroadcastTranscriptVisualPreparedAudioEvidence | null;
}

export interface BroadcastTranscriptVisualHydratedFrame {
  readonly timestampMs: number;
  readonly contentType:
    typeof BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE;
  readonly bytes: Uint8Array;
}

export type BroadcastTranscriptVisualHydratedFrames = readonly [
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
  BroadcastTranscriptVisualHydratedFrame,
];

export interface BroadcastTranscriptVisualHydratedAudio {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly codec: string;
  readonly extractionRevision: string;
  readonly bytes: Uint8Array;
}

export interface BroadcastTranscriptVisualHydratedMediaEvidence {
  readonly planFingerprint: string;
  readonly sourceFingerprint: string;
  readonly cellId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly frames: BroadcastTranscriptVisualHydratedFrames;
  readonly audio: BroadcastTranscriptVisualHydratedAudio | null;
}

export interface BroadcastTranscriptVisualVerifiedMediaEvidence
  extends BroadcastTranscriptVisualHydratedMediaEvidence {
  /**
   * The verifier copies every byte before hashing it. Provider adapters
   * receive these copies, so a decoder cannot mutate already-verified input.
   */
  readonly verified: true;
}

export interface BroadcastTranscriptVisualMediaFingerprintRequest {
  readonly cellId: string;
  readonly kind: "frame" | "audio";
  readonly timestampMs: number | null;
  readonly bytes: Uint8Array;
}

export type BroadcastTranscriptVisualMediaFingerprinter = (
  request: BroadcastTranscriptVisualMediaFingerprintRequest,
) => string | Promise<string>;

export type BroadcastTranscriptVisualMediaEvidenceErrorCode =
  | "INVALID_PREPARED_RECEIPT"
  | "SOURCE_FENCE_MISMATCH"
  | "MISSING_FRAME"
  | "MALFORMED_FRAME"
  | "AUDIO_EVIDENCE_MISMATCH"
  | "EXTRACTION_REVISION_MISMATCH"
  | "CONTENT_FINGERPRINT_MISMATCH";

export class BroadcastTranscriptVisualMediaEvidenceError extends Error {
  public readonly name = "BroadcastTranscriptVisualMediaEvidenceError";

  public constructor(
    public readonly code: BroadcastTranscriptVisualMediaEvidenceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface BroadcastTranscriptVisualMediaDigestAdapter {
  digest(
    algorithm: "SHA-256",
    data: Uint8Array<ArrayBuffer>,
  ): Promise<ArrayBuffer>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copiedBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) return null;
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createBroadcastTranscriptVisualMediaContentFingerprint(
  bytes: Uint8Array,
  adapter: BroadcastTranscriptVisualMediaDigestAdapter | null = globalThis
    .crypto?.subtle ?? null,
): Promise<string> {
  const immutableBytes = copiedBytes(bytes);
  if (immutableBytes === null) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "CONTENT_FINGERPRINT_MISMATCH",
      "Visual inspection media bytes must be non-empty before fingerprinting.",
    );
  }
  if (adapter === null) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "CONTENT_FINGERPRINT_MISMATCH",
      "SHA-256 is unavailable, so exact visual inspection media cannot be verified.",
    );
  }
  const digest = await adapter.digest("SHA-256", immutableBytes);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function assertPreparedReceipt(
  plan: BroadcastTranscriptVisualInspectionPlan,
  task: BroadcastTranscriptVisualProviderTask,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
): void {
  try {
    const frameQueue =
      createBroadcastTranscriptVisualFramePreparationQueue(plan);
    const providerQueue = createBroadcastTranscriptVisualProviderBatchQueue({
      plan,
      framePreparationQueue: frameQueue,
      preparedFrameReceipts: [receipt],
      maximumBatchSize: 1,
    });
    const preparedTask = providerQueue.batches[0]?.tasks[0];
    if (
      preparedTask === undefined ||
      preparedTask.cellId !== task.cellId ||
      JSON.stringify(preparedTask) !== JSON.stringify(task)
    ) {
      throw new TypeError("Prepared provider task mismatch.");
    }
  } catch (error) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "INVALID_PREPARED_RECEIPT",
      error instanceof Error
        ? error.message
        : "The prepared media receipt is invalid.",
    );
  }
}

function copiedAndCheckedFrames(
  hydrated: BroadcastTranscriptVisualHydratedMediaEvidence,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
): BroadcastTranscriptVisualHydratedFrames {
  if (
    !Array.isArray(hydrated.frames) ||
    hydrated.frames.length !== BROADCAST_TRANSCRIPT_VISUAL_FRAME_COUNT
  ) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "MISSING_FRAME",
      "Provider dispatch requires all four hydrated representative frames.",
    );
  }
  const frames = hydrated.frames.map((frame, index) => {
    if (
      !isRecord(frame) ||
      !exactKeys(frame, ["timestampMs", "contentType", "bytes"]) ||
      frame.timestampMs !== receipt.frameTimestampsMs[index] ||
      frame.contentType !==
        BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE
    ) {
      throw new BroadcastTranscriptVisualMediaEvidenceError(
        "MALFORMED_FRAME",
        "A hydrated frame does not match its durable timestamp and JPEG contract.",
      );
    }
    const bytes = copiedBytes(frame.bytes);
    if (bytes === null) {
      throw new BroadcastTranscriptVisualMediaEvidenceError(
        "MALFORMED_FRAME",
        "A hydrated frame must contain non-empty bytes.",
      );
    }
    return {
      timestampMs: frame.timestampMs,
      contentType: BROADCAST_TRANSCRIPT_VISUAL_FRAME_CONTENT_TYPE,
      bytes,
    };
  });
  return frames as unknown as BroadcastTranscriptVisualHydratedFrames;
}

function copiedAndCheckedAudio(
  hydrated: BroadcastTranscriptVisualHydratedMediaEvidence,
  receipt: BroadcastTranscriptVisualPreparedFrameReceipt,
): BroadcastTranscriptVisualHydratedAudio | null {
  if (receipt.audioEvidence === null) {
    if (hydrated.audio !== null) {
      throw new BroadcastTranscriptVisualMediaEvidenceError(
        "AUDIO_EVIDENCE_MISMATCH",
        "A no-audio cell cannot hydrate or dispatch audio bytes.",
      );
    }
    return null;
  }
  if (
    !isRecord(hydrated.audio) ||
    !exactKeys(hydrated.audio, [
      "sourceStartMs",
      "sourceEndMs",
      "codec",
      "extractionRevision",
      "bytes",
    ]) ||
    hydrated.audio.sourceStartMs !== receipt.audioEvidence.sourceStartMs ||
    hydrated.audio.sourceEndMs !== receipt.audioEvidence.sourceEndMs ||
    hydrated.audio.codec !== receipt.audioEvidence.codec
  ) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "AUDIO_EVIDENCE_MISMATCH",
      "Hydrated audio does not match the durable codec and exact source range.",
    );
  }
  if (
    hydrated.audio.extractionRevision !==
    receipt.audioEvidence.extractionRevision
  ) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "EXTRACTION_REVISION_MISMATCH",
      "Hydrated audio was produced by a different extraction revision.",
    );
  }
  const bytes = copiedBytes(hydrated.audio.bytes);
  if (bytes === null) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "AUDIO_EVIDENCE_MISMATCH",
      "A no-speech cell must hydrate non-empty exact-range audio bytes.",
    );
  }
  return {
    sourceStartMs: hydrated.audio.sourceStartMs,
    sourceEndMs: hydrated.audio.sourceEndMs,
    codec: hydrated.audio.codec,
    extractionRevision: hydrated.audio.extractionRevision,
    bytes,
  };
}

/**
 * Rehydrates volatile media and proves it is byte-for-byte identical to the
 * durable prepared receipt. This function must complete before an operation ID
 * is allocated or a provider dispatch is durably armed.
 */
export async function verifyBroadcastTranscriptVisualHydratedMediaEvidence(
  input: {
    readonly plan: BroadcastTranscriptVisualInspectionPlan;
    readonly task: BroadcastTranscriptVisualProviderTask;
    readonly preparedReceipt: BroadcastTranscriptVisualPreparedFrameReceipt;
    readonly hydrated: BroadcastTranscriptVisualHydratedMediaEvidence;
    readonly fingerprint: BroadcastTranscriptVisualMediaFingerprinter;
  },
): Promise<BroadcastTranscriptVisualVerifiedMediaEvidence> {
  assertPreparedReceipt(input.plan, input.task, input.preparedReceipt);
  const { hydrated, preparedReceipt } = input;
  if (
    !isRecord(hydrated) ||
    !exactKeys(hydrated, [
      "planFingerprint",
      "sourceFingerprint",
      "cellId",
      "sourceStartMs",
      "sourceEndMs",
      "frames",
      "audio",
    ]) ||
    hydrated.planFingerprint !== input.plan.planFingerprint ||
    hydrated.sourceFingerprint !== input.plan.sourceFence.sourceFingerprint ||
    hydrated.cellId !== input.task.cellId ||
    hydrated.sourceStartMs !== input.task.sourceStartMs ||
    hydrated.sourceEndMs !== input.task.sourceEndMs
  ) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "SOURCE_FENCE_MISMATCH",
      "Hydrated media does not match the exact plan, source, cell, and source range.",
    );
  }

  const frames = copiedAndCheckedFrames(hydrated, preparedReceipt);
  const audio = copiedAndCheckedAudio(hydrated, preparedReceipt);
  const frameFingerprints = await Promise.all(
    frames.map((frame) =>
      Promise.resolve(
        input.fingerprint({
          cellId: input.task.cellId,
          kind: "frame",
          timestampMs: frame.timestampMs,
          bytes: frame.bytes,
        }),
      ),
    ),
  );
  if (
    frameFingerprints.some(
      (fingerprint, index) =>
        fingerprint !== preparedReceipt.frameContentFingerprints[index],
    )
  ) {
    throw new BroadcastTranscriptVisualMediaEvidenceError(
      "CONTENT_FINGERPRINT_MISMATCH",
      "Hydrated frame bytes do not reproduce the durable frame fingerprints.",
    );
  }
  if (audio !== null && preparedReceipt.audioEvidence !== null) {
    const audioFingerprint = await input.fingerprint({
      cellId: input.task.cellId,
      kind: "audio",
      timestampMs: null,
      bytes: audio.bytes,
    });
    if (
      audioFingerprint !== preparedReceipt.audioEvidence.contentFingerprint
    ) {
      throw new BroadcastTranscriptVisualMediaEvidenceError(
        "CONTENT_FINGERPRINT_MISMATCH",
        "Hydrated audio bytes do not reproduce the durable audio fingerprint.",
      );
    }
  }
  return {
    planFingerprint: hydrated.planFingerprint,
    sourceFingerprint: hydrated.sourceFingerprint,
    cellId: hydrated.cellId,
    sourceStartMs: hydrated.sourceStartMs,
    sourceEndMs: hydrated.sourceEndMs,
    frames,
    audio,
    verified: true,
  };
}
