import {
  createContentFingerprint,
  type ContentDigestAdapter,
} from "../security/contentFingerprint";
import { createBroadcastParticipantMediaBundleReuseKeys } from "./broadcastParticipantGroundingPlan";

export const SPEAKER_EMBEDDING_PROTOCOL_VERSION = "1.0.0" as const;
export const SPEAKER_EMBEDDING_MODEL_ID =
  "Xenova/wavlm-base-plus-sv" as const;
export const SPEAKER_EMBEDDING_MODEL_REVISION =
  "e61029603001bd11295c36d878698708bf59190f" as const;
export const SPEAKER_EMBEDDING_MODEL_DTYPE = "q8" as const;
export const SPEAKER_EMBEDDING_RUNTIME_DEVICE = "wasm" as const;
export const SPEAKER_EMBEDDING_TRANSFORMERS_VERSION = "3.8.1" as const;
export const SPEAKER_EMBEDDING_TASK = "audio-xvector" as const;
export const SPEAKER_EMBEDDING_MODEL_FENCE_REVISION =
  "Xenova/wavlm-base-plus-sv@e61029603001bd11295c36d878698708bf59190f:audio-xvector:q8:wasm:transformers-js-3.8.1" as const;

export const SPEAKER_EMBEDDING_SAMPLE_RATE_HZ = 16_000 as const;
export const SPEAKER_EMBEDDING_CHANNEL_COUNT = 1 as const;
export const SPEAKER_EMBEDDING_DIMENSION = 512 as const;
export const SPEAKER_EMBEDDING_MIN_DURATION_MS = 3_000 as const;
export const SPEAKER_EMBEDDING_MAX_DURATION_MS = 30_000 as const;
export const SPEAKER_EMBEDDING_MAX_SOURCE_DURATION_MS =
  12 * 60 * 60 * 1_000;
export const SPEAKER_EMBEDDING_MIN_SAMPLE_COUNT =
  (SPEAKER_EMBEDDING_MIN_DURATION_MS / 1_000) *
  SPEAKER_EMBEDDING_SAMPLE_RATE_HZ;
export const SPEAKER_EMBEDDING_MAX_SAMPLE_COUNT =
  (SPEAKER_EMBEDDING_MAX_DURATION_MS / 1_000) *
  SPEAKER_EMBEDDING_SAMPLE_RATE_HZ;
export const SPEAKER_EMBEDDING_MAX_TRANSFER_BYTES =
  SPEAKER_EMBEDDING_MAX_SAMPLE_COUNT * Float32Array.BYTES_PER_ELEMENT;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;
const MAX_IDENTIFIER_LENGTH = 256;
const INPUT_FINGERPRINT_DOMAIN =
  "exclipper.speaker-embedding-input.v1";

export type SpeakerEmbeddingConditionStatus =
  | "verified-absent"
  | "removed"
  | "unresolved";

/**
 * The speech selector owns these facts. `unresolved` is representable so an
 * upstream gap can be recorded honestly, but it is not eligible for inference.
 */
export interface SpeakerEmbeddingSpeechTurnPreparationReceipt {
  readonly speechActivity: "speech";
  readonly speechActivityRevision: string;
  readonly overlapStatus: SpeakerEmbeddingConditionStatus;
  readonly musicStatus: SpeakerEmbeddingConditionStatus;
  readonly conditioningRevision: string;
}

export interface SpeakerEmbeddingSourceInput {
  readonly sourceFingerprint: string;
  readonly sourceDurationMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly sourceUnitId: string | null;
  readonly audioBundleReuseKey: string;
  readonly preparation: SpeakerEmbeddingSpeechTurnPreparationReceipt;
}

/**
 * Exact, persistence-safe identity of the ephemeral Float32 input.
 * It deliberately contains no PCM, WAV, Base64, or arbitrary model output.
 */
export interface SpeakerEmbeddingSourceReceipt
  extends SpeakerEmbeddingSourceInput {
  readonly sampleRateHz: typeof SPEAKER_EMBEDDING_SAMPLE_RATE_HZ;
  readonly channelCount: typeof SPEAKER_EMBEDDING_CHANNEL_COUNT;
  readonly sampleCount: number;
  readonly pcmFormat: "float32";
  readonly audioContentSha256: string;
  readonly inputFingerprint: string;
}

export interface SpeakerEmbeddingRunIdentity {
  readonly protocolVersion: typeof SPEAKER_EMBEDDING_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly writerEpoch: number;
  readonly analysisRunId: string;
  readonly embeddingRunId: string;
  readonly workerEpoch: number;
  readonly workerInstanceId: string;
  readonly taskId: string;
}

export interface SpeakerEmbeddingWorkerIdentity
  extends SpeakerEmbeddingRunIdentity {
  readonly inputFingerprint: string;
}

export interface SpeakerEmbeddingModelDescriptor {
  readonly id: typeof SPEAKER_EMBEDDING_MODEL_ID;
  readonly revision: typeof SPEAKER_EMBEDDING_MODEL_REVISION;
  readonly fenceRevision: typeof SPEAKER_EMBEDDING_MODEL_FENCE_REVISION;
  readonly task: typeof SPEAKER_EMBEDDING_TASK;
  readonly dtype: typeof SPEAKER_EMBEDDING_MODEL_DTYPE;
  readonly device: typeof SPEAKER_EMBEDDING_RUNTIME_DEVICE;
  readonly transformersVersion: typeof SPEAKER_EMBEDDING_TRANSFORMERS_VERSION;
}

export const SPEAKER_EMBEDDING_MODEL_DESCRIPTOR = Object.freeze({
  id: SPEAKER_EMBEDDING_MODEL_ID,
  revision: SPEAKER_EMBEDDING_MODEL_REVISION,
  fenceRevision: SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
  task: SPEAKER_EMBEDDING_TASK,
  dtype: SPEAKER_EMBEDDING_MODEL_DTYPE,
  device: SPEAKER_EMBEDDING_RUNTIME_DEVICE,
  transformersVersion: SPEAKER_EMBEDDING_TRANSFORMERS_VERSION,
}) satisfies SpeakerEmbeddingModelDescriptor;

export type SpeakerEmbeddingWorkerRequest =
  | {
      readonly type: "speaker-embedding-analyze";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
      readonly source: SpeakerEmbeddingSourceReceipt;
      readonly samples: Float32Array<ArrayBuffer>;
    }
  | {
      readonly type: "speaker-embedding-cancel";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
    };

export type SpeakerEmbeddingProgressStage =
  | "loading-processor"
  | "loading-model"
  | "preparing-input"
  | "running-inference"
  | "normalizing"
  | "complete";

export interface SpeakerEmbeddingWorkerProgress {
  readonly stage: SpeakerEmbeddingProgressStage;
  readonly ratio: number;
  readonly loadedBytes: number | null;
  readonly totalBytes: number | null;
}

export interface SpeakerEmbeddingResultReceipt {
  readonly source: SpeakerEmbeddingSourceReceipt;
  readonly model: SpeakerEmbeddingModelDescriptor;
  readonly embeddingDimension: typeof SPEAKER_EMBEDDING_DIMENSION;
  readonly normalization: "l2";
}

/**
 * In-memory result. Only the receipt is persistence-safe; the embedding is
 * intentionally ephemeral and raw PCM never crosses back from the Worker.
 */
export interface SpeakerEmbeddingResult {
  readonly embedding: Float32Array<ArrayBuffer>;
  readonly receipt: SpeakerEmbeddingResultReceipt;
}

export type SpeakerEmbeddingWorkerFailureReason =
  | "INVALID_REQUEST"
  | "INPUT_IDENTITY_MISMATCH"
  | "UNCLEAN_SPEECH_TURN"
  | "WORKER_BUSY"
  | "MODEL_LOAD_FAILED"
  | "INFERENCE_FAILED"
  | "INVALID_MODEL_OUTPUT";

export type SpeakerEmbeddingWorkerResponse =
  | {
      readonly type: "speaker-embedding-progress";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
      readonly eventId: string;
      readonly progress: SpeakerEmbeddingWorkerProgress;
    }
  | {
      readonly type: "speaker-embedding-completed";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
      readonly eventId: string;
      readonly result: SpeakerEmbeddingResult;
    }
  | {
      readonly type: "speaker-embedding-cancelled";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
      readonly eventId: string;
    }
  | {
      readonly type: "speaker-embedding-failed";
      readonly identity: SpeakerEmbeddingWorkerIdentity;
      readonly eventId: string;
      readonly reasonCode: SpeakerEmbeddingWorkerFailureReason;
      readonly message: string;
    };

export type SpeakerEmbeddingProtocolErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_SOURCE"
  | "INVALID_AUDIO"
  | "UNCLEAN_SPEECH_TURN"
  | "CRYPTO_UNAVAILABLE";

export class SpeakerEmbeddingProtocolError extends Error {
  public readonly code: SpeakerEmbeddingProtocolErrorCode;

  public constructor(
    code: SpeakerEmbeddingProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpeakerEmbeddingProtocolError";
    this.code = code;
  }
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isSpeakerEmbeddingRunIdentity(
  value: unknown,
): value is SpeakerEmbeddingRunIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const identity = value as Record<string, unknown>;
  const expectedKeys = [
    "protocolVersion",
    "sessionId",
    "writerEpoch",
    "analysisRunId",
    "embeddingRunId",
    "workerEpoch",
    "workerInstanceId",
    "taskId",
  ];
  const actualKeys = Object.keys(identity).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    !actualKeys.every(
      (key, index) => key === [...expectedKeys].sort()[index],
    )
  ) {
    return false;
  }
  return (
    identity.protocolVersion === SPEAKER_EMBEDDING_PROTOCOL_VERSION &&
    isBoundedIdentifier(identity.sessionId) &&
    isNonNegativeSafeInteger(identity.writerEpoch) &&
    isBoundedIdentifier(identity.analysisRunId) &&
    isBoundedIdentifier(identity.embeddingRunId) &&
    isNonNegativeSafeInteger(identity.workerEpoch) &&
    isBoundedIdentifier(identity.workerInstanceId) &&
    isBoundedIdentifier(identity.taskId)
  );
}

export function isCleanSpeakerEmbeddingSpeechTurn(
  preparation: SpeakerEmbeddingSpeechTurnPreparationReceipt,
): boolean {
  return (
    preparation.speechActivity === "speech" &&
    preparation.overlapStatus !== "unresolved" &&
    preparation.musicStatus !== "unresolved"
  );
}

function assertPreparation(
  value: SpeakerEmbeddingSpeechTurnPreparationReceipt,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !==
      [
        "speechActivity",
        "speechActivityRevision",
        "overlapStatus",
        "musicStatus",
        "conditioningRevision",
      ]
        .sort()
        .join("|") ||
    value.speechActivity !== "speech" ||
    !isBoundedIdentifier(value.speechActivityRevision) ||
    !["verified-absent", "removed", "unresolved"].includes(
      value.overlapStatus,
    ) ||
    !["verified-absent", "removed", "unresolved"].includes(
      value.musicStatus,
    ) ||
    !isBoundedIdentifier(value.conditioningRevision)
  ) {
    throw new SpeakerEmbeddingProtocolError(
      "INVALID_SOURCE",
      "The speech-turn preparation receipt is malformed.",
    );
  }
  if (!isCleanSpeakerEmbeddingSpeechTurn(value)) {
    throw new SpeakerEmbeddingProtocolError(
      "UNCLEAN_SPEECH_TURN",
      "Speaker embedding requires overlap and music to be removed or verified absent.",
    );
  }
}

export function assertSpeakerEmbeddingSourceInput(
  source: SpeakerEmbeddingSourceInput,
): void {
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    Object.keys(source).sort().join("|") !==
      [
        "sourceFingerprint",
        "sourceDurationMs",
        "sourceStartMs",
        "sourceEndMs",
        "sourceUnitId",
        "audioBundleReuseKey",
        "preparation",
      ]
        .sort()
        .join("|") ||
    !isSha256(source.sourceFingerprint) ||
    !Number.isSafeInteger(source.sourceDurationMs) ||
    source.sourceDurationMs <= 0 ||
    source.sourceDurationMs > SPEAKER_EMBEDDING_MAX_SOURCE_DURATION_MS ||
    !Number.isSafeInteger(source.sourceStartMs) ||
    !Number.isSafeInteger(source.sourceEndMs) ||
    source.sourceStartMs < 0 ||
    source.sourceEndMs <= source.sourceStartMs ||
    source.sourceEndMs > source.sourceDurationMs ||
    source.sourceEndMs - source.sourceStartMs <
      SPEAKER_EMBEDDING_MIN_DURATION_MS ||
    source.sourceEndMs - source.sourceStartMs >
      SPEAKER_EMBEDDING_MAX_DURATION_MS ||
    (source.sourceUnitId !== null &&
      !isBoundedIdentifier(source.sourceUnitId)) ||
    !isBoundedIdentifier(source.audioBundleReuseKey)
  ) {
    throw new SpeakerEmbeddingProtocolError(
      "INVALID_SOURCE",
      "Speaker embedding requires a bounded 3–30 second source-fenced range.",
    );
  }
  const expectedBundleKey =
    createBroadcastParticipantMediaBundleReuseKeys({
      sourceFingerprint: source.sourceFingerprint,
      sourceDurationMs: source.sourceDurationMs,
      sourceStartMs: source.sourceStartMs,
      sourceEndMs: source.sourceEndMs,
    }).audioBundleReuseKey;
  if (source.audioBundleReuseKey !== expectedBundleKey) {
    throw new SpeakerEmbeddingProtocolError(
      "INVALID_SOURCE",
      "The audio bundle key does not match the exact source range.",
    );
  }
  assertPreparation(source.preparation);
}

export function assertSpeakerEmbeddingPcm(
  samples: Float32Array,
  source: SpeakerEmbeddingSourceInput,
): void {
  assertSpeakerEmbeddingSourceInput(source);
  const expectedSampleCount =
    (source.sourceEndMs - source.sourceStartMs) *
    (SPEAKER_EMBEDDING_SAMPLE_RATE_HZ / 1_000);
  if (
    !(samples instanceof Float32Array) ||
    !(samples.buffer instanceof ArrayBuffer) ||
    samples.byteOffset !== 0 ||
    samples.byteLength !== samples.buffer.byteLength ||
    samples.length !== expectedSampleCount ||
    samples.length < SPEAKER_EMBEDDING_MIN_SAMPLE_COUNT ||
    samples.length > SPEAKER_EMBEDDING_MAX_SAMPLE_COUNT ||
    samples.byteLength > SPEAKER_EMBEDDING_MAX_TRANSFER_BYTES
  ) {
    throw new SpeakerEmbeddingProtocolError(
      "INVALID_AUDIO",
      "PCM must be an exact, bounded 16 kHz mono Float32 turn.",
    );
  }
  let hasSignal = false;
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw new SpeakerEmbeddingProtocolError(
        "INVALID_AUDIO",
        "PCM contains a non-finite or out-of-range sample.",
      );
    }
    hasSignal ||= Math.abs(sample) > 1e-7;
  }
  if (!hasSignal) {
    throw new SpeakerEmbeddingProtocolError(
      "INVALID_AUDIO",
      "A speech turn cannot be an all-zero PCM vector.",
    );
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createSpeakerEmbeddingAudioContentSha256(
  samples: Float32Array<ArrayBuffer>,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<string> {
  if (digestAdapter === null) {
    throw new SpeakerEmbeddingProtocolError(
      "CRYPTO_UNAVAILABLE",
      "SHA-256 is required to identify speaker embedding audio.",
    );
  }
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  const digest = await digestAdapter.digest("SHA-256", bytes);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

interface SpeakerEmbeddingSourceReceiptWithoutFingerprint
  extends SpeakerEmbeddingSourceInput {
  readonly sampleRateHz: typeof SPEAKER_EMBEDDING_SAMPLE_RATE_HZ;
  readonly channelCount: typeof SPEAKER_EMBEDDING_CHANNEL_COUNT;
  readonly sampleCount: number;
  readonly pcmFormat: "float32";
  readonly audioContentSha256: string;
}

export async function createSpeakerEmbeddingInputFingerprint(
  source: SpeakerEmbeddingSourceReceiptWithoutFingerprint,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<string> {
  if (digestAdapter === null) {
    throw new SpeakerEmbeddingProtocolError(
      "CRYPTO_UNAVAILABLE",
      "SHA-256 is required to fence speaker embedding input.",
    );
  }
  return createContentFingerprint(
    [
      INPUT_FINGERPRINT_DOMAIN,
      source.sourceFingerprint,
      String(source.sourceDurationMs),
      String(source.sourceStartMs),
      String(source.sourceEndMs),
      source.sourceUnitId ?? "",
      source.audioBundleReuseKey,
      source.preparation.speechActivity,
      source.preparation.speechActivityRevision,
      source.preparation.overlapStatus,
      source.preparation.musicStatus,
      source.preparation.conditioningRevision,
      String(source.sampleRateHz),
      String(source.channelCount),
      String(source.sampleCount),
      source.pcmFormat,
      source.audioContentSha256,
    ],
    digestAdapter,
  );
}

export async function createSpeakerEmbeddingSourceReceipt(
  source: SpeakerEmbeddingSourceInput,
  samples: Float32Array<ArrayBuffer>,
  digestAdapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ??
    null,
): Promise<SpeakerEmbeddingSourceReceipt> {
  assertSpeakerEmbeddingPcm(samples, source);
  const canonicalSource: SpeakerEmbeddingSourceInput = {
    sourceFingerprint: source.sourceFingerprint,
    sourceDurationMs: source.sourceDurationMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
    sourceUnitId: source.sourceUnitId,
    audioBundleReuseKey: source.audioBundleReuseKey,
    preparation: {
      speechActivity: source.preparation.speechActivity,
      speechActivityRevision:
        source.preparation.speechActivityRevision,
      overlapStatus: source.preparation.overlapStatus,
      musicStatus: source.preparation.musicStatus,
      conditioningRevision: source.preparation.conditioningRevision,
    },
  };
  const withoutFingerprint: SpeakerEmbeddingSourceReceiptWithoutFingerprint = {
    ...canonicalSource,
    sampleRateHz: SPEAKER_EMBEDDING_SAMPLE_RATE_HZ,
    channelCount: SPEAKER_EMBEDDING_CHANNEL_COUNT,
    sampleCount: samples.length,
    pcmFormat: "float32",
    audioContentSha256:
      await createSpeakerEmbeddingAudioContentSha256(samples, digestAdapter),
  };
  return {
    ...withoutFingerprint,
    inputFingerprint: await createSpeakerEmbeddingInputFingerprint(
      withoutFingerprint,
      digestAdapter,
    ),
  };
}

export function speakerEmbeddingWorkerIdentityEquals(
  left: SpeakerEmbeddingWorkerIdentity,
  right: SpeakerEmbeddingWorkerIdentity,
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.sessionId === right.sessionId &&
    left.writerEpoch === right.writerEpoch &&
    left.analysisRunId === right.analysisRunId &&
    left.embeddingRunId === right.embeddingRunId &&
    left.workerEpoch === right.workerEpoch &&
    left.workerInstanceId === right.workerInstanceId &&
    left.taskId === right.taskId &&
    left.inputFingerprint === right.inputFingerprint
  );
}
