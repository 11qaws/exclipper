import type { BroadcastParticipantVoiceRecognitionScore } from "./broadcastParticipantGroundingPlan";
import {
  PARTICIPANT_VOICE_UNKNOWN_ID,
} from "./participantVoiceEnrollmentManifest";
import type { CandidatePassBParticipantId } from "./participantRoster";
import {
  SPEAKER_EMBEDDING_DIMENSION,
  SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
} from "./speakerEmbeddingWorkerProtocol";

const MIN_VECTOR_NORM = 1e-12;
const NORMALIZED_NORM_TOLERANCE = 1e-4;

export type SpeakerEmbeddingMathErrorCode =
  | "INVALID_DIMENSION"
  | "NON_FINITE_VALUE"
  | "ZERO_VECTOR"
  | "MODEL_FENCE_MISMATCH"
  | "INVALID_COVERAGE";

export class SpeakerEmbeddingMathError extends Error {
  public readonly code: SpeakerEmbeddingMathErrorCode;

  public constructor(
    code: SpeakerEmbeddingMathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpeakerEmbeddingMathError";
    this.code = code;
  }
}

function squaredNorm(
  embedding: Float32Array,
  expectedDimension: number,
): number {
  if (
    !(embedding instanceof Float32Array) ||
    embedding.length !== expectedDimension
  ) {
    throw new SpeakerEmbeddingMathError(
      "INVALID_DIMENSION",
      `Speaker embedding must contain exactly ${expectedDimension} values.`,
    );
  }
  let total = 0;
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new SpeakerEmbeddingMathError(
        "NON_FINITE_VALUE",
        "Speaker embedding contains a non-finite value.",
      );
    }
    total += value * value;
  }
  if (!Number.isFinite(total) || total <= MIN_VECTOR_NORM) {
    throw new SpeakerEmbeddingMathError(
      "ZERO_VECTOR",
      "Speaker embedding has no usable direction.",
    );
  }
  return total;
}

export function l2NormalizeSpeakerEmbedding(
  embedding: Float32Array,
  expectedDimension = SPEAKER_EMBEDDING_DIMENSION,
): Float32Array<ArrayBuffer> {
  const norm = Math.sqrt(squaredNorm(embedding, expectedDimension));
  const normalized = new Float32Array(expectedDimension);
  for (let index = 0; index < normalized.length; index += 1) {
    normalized[index] = embedding[index]! / norm;
  }
  // Float32 rounding is expected, but a broken or underflowed output is not.
  const normalizedNorm = Math.sqrt(
    squaredNorm(normalized, expectedDimension),
  );
  if (Math.abs(normalizedNorm - 1) > NORMALIZED_NORM_TOLERANCE) {
    throw new SpeakerEmbeddingMathError(
      "ZERO_VECTOR",
      "Speaker embedding could not be normalized safely.",
    );
  }
  return normalized;
}

export function assertL2NormalizedSpeakerEmbedding(
  embedding: Float32Array,
  expectedDimension = SPEAKER_EMBEDDING_DIMENSION,
): void {
  const norm = Math.sqrt(squaredNorm(embedding, expectedDimension));
  if (Math.abs(norm - 1) > NORMALIZED_NORM_TOLERANCE) {
    throw new SpeakerEmbeddingMathError(
      "ZERO_VECTOR",
      "Speaker embedding is not L2-normalized.",
    );
  }
}

export function cosineSpeakerEmbeddings(
  left: Float32Array,
  right: Float32Array,
  expectedDimension = SPEAKER_EMBEDDING_DIMENSION,
): number {
  const leftNorm = Math.sqrt(squaredNorm(left, expectedDimension));
  const rightNorm = Math.sqrt(squaredNorm(right, expectedDimension));
  let dot = 0;
  for (let index = 0; index < expectedDimension; index += 1) {
    dot += left[index]! * right[index]!;
  }
  return Math.max(-1, Math.min(1, dot / (leftNorm * rightNorm)));
}

/**
 * The grounding policy consumes a [0, 1] score. Negative cosine similarity is
 * evidence for "not this participant", so it is clamped to zero rather than
 * remapped and made artificially positive.
 */
export function normalizedSpeakerSimilarity(
  left: Float32Array,
  right: Float32Array,
): number {
  return Math.max(0, cosineSpeakerEmbeddings(left, right));
}

export function averageSpeakerEmbeddingPrototype(
  embeddings: readonly Float32Array[],
  expectedDimension = SPEAKER_EMBEDDING_DIMENSION,
): Float32Array<ArrayBuffer> {
  if (embeddings.length === 0) {
    throw new SpeakerEmbeddingMathError(
      "INVALID_COVERAGE",
      "A speaker prototype requires at least one enrollment embedding.",
    );
  }
  const average = new Float32Array(expectedDimension);
  for (const embedding of embeddings) {
    const normalized = l2NormalizeSpeakerEmbedding(
      embedding,
      expectedDimension,
    );
    for (let index = 0; index < expectedDimension; index += 1) {
      average[index] = average[index]! + normalized[index]!;
    }
  }
  for (let index = 0; index < expectedDimension; index += 1) {
    average[index] = average[index]! / embeddings.length;
  }
  return l2NormalizeSpeakerEmbedding(average, expectedDimension);
}

/**
 * Ephemeral in-memory prototype. Enrollment asset ids and the exact model fence
 * survive into diagnostics; the embedding itself must not be persisted.
 */
export interface SpeakerEmbeddingParticipantPrototype {
  readonly participantId: CandidatePassBParticipantId;
  readonly modelRevision: typeof SPEAKER_EMBEDDING_MODEL_FENCE_REVISION;
  readonly enrollmentAssetIds: readonly [string, ...string[]];
  readonly embedding: Float32Array<ArrayBuffer>;
}

export interface SpeakerEmbeddingGroundingScoreSet {
  readonly modelRevision: typeof SPEAKER_EMBEDDING_MODEL_FENCE_REVISION;
  readonly coveredParticipantIds: readonly CandidatePassBParticipantId[];
  readonly missingParticipantIds: readonly CandidatePassBParticipantId[];
  readonly scores: readonly BroadcastParticipantVoiceRecognitionScore[];
  /**
   * The next grounding-policy projection may identify a covered participant.
   * Until then, and for every uncovered participant, the only safe identity is
   * the existing open-set unknown sentinel.
   */
  readonly unresolvedParticipantId: typeof PARTICIPANT_VOICE_UNKNOWN_ID;
}

/**
 * Produces the exact score shape consumed by
 * `projectBroadcastParticipantVoiceRecognition`.
 */
export function scoreSpeakerEmbeddingAgainstParticipantPrototypes(
  query: Float32Array,
  expectedParticipantIds: readonly CandidatePassBParticipantId[],
  prototypes: readonly SpeakerEmbeddingParticipantPrototype[],
): SpeakerEmbeddingGroundingScoreSet {
  const expected = new Set(expectedParticipantIds);
  if (
    expected.size !== expectedParticipantIds.length ||
    prototypes.length > expectedParticipantIds.length
  ) {
    throw new SpeakerEmbeddingMathError(
      "INVALID_COVERAGE",
      "Speaker prototype coverage must be a unique subset of the expected roster.",
    );
  }
  assertL2NormalizedSpeakerEmbedding(query);
  const prototypeByParticipantId = new Map<
    CandidatePassBParticipantId,
    SpeakerEmbeddingParticipantPrototype
  >();
  for (const prototype of prototypes) {
    if (
      !expected.has(prototype.participantId) ||
      prototypeByParticipantId.has(prototype.participantId) ||
      prototype.modelRevision !== SPEAKER_EMBEDDING_MODEL_FENCE_REVISION ||
      prototype.enrollmentAssetIds.length === 0 ||
      new Set(prototype.enrollmentAssetIds).size !==
        prototype.enrollmentAssetIds.length
    ) {
      throw new SpeakerEmbeddingMathError(
        prototype.modelRevision !== SPEAKER_EMBEDDING_MODEL_FENCE_REVISION
          ? "MODEL_FENCE_MISMATCH"
          : "INVALID_COVERAGE",
        "Speaker prototype does not match the roster and model fence.",
      );
    }
    assertL2NormalizedSpeakerEmbedding(prototype.embedding);
    prototypeByParticipantId.set(prototype.participantId, prototype);
  }

  const coveredParticipantIds = expectedParticipantIds.filter(
    (participantId) => prototypeByParticipantId.has(participantId),
  );
  const missingParticipantIds = expectedParticipantIds.filter(
    (participantId) => !prototypeByParticipantId.has(participantId),
  );
  const scores = coveredParticipantIds.map((participantId) => ({
    participantId,
    normalizedSimilarity: normalizedSpeakerSimilarity(
      query,
      prototypeByParticipantId.get(participantId)!.embedding,
    ),
  }));
  return {
    modelRevision: SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
    coveredParticipantIds,
    missingParticipantIds,
    scores,
    unresolvedParticipantId: PARTICIPANT_VOICE_UNKNOWN_ID,
  };
}
