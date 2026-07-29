import { describe, expect, it } from "vitest";

import {
  SpeakerEmbeddingMathError,
  assertL2NormalizedSpeakerEmbedding,
  averageSpeakerEmbeddingPrototype,
  cosineSpeakerEmbeddings,
  l2NormalizeSpeakerEmbedding,
  normalizedSpeakerSimilarity,
  scoreSpeakerEmbeddingAgainstParticipantPrototypes,
} from "./speakerEmbeddingMath";
import { SPEAKER_EMBEDDING_MODEL_FENCE_REVISION } from "./speakerEmbeddingWorkerProtocol";

function axis(index: number, sign = 1): Float32Array<ArrayBuffer> {
  const embedding = new Float32Array(512);
  embedding[index] = sign;
  return embedding;
}

describe("speaker embedding math", () => {
  it("L2-normalizes a finite 512-dimensional embedding", () => {
    const embedding = new Float32Array(512).fill(2);
    const normalized = l2NormalizeSpeakerEmbedding(embedding);

    expect(() =>
      assertL2NormalizedSpeakerEmbedding(normalized),
    ).not.toThrow();
    expect(
      normalized.reduce((sum, value) => sum + value * value, 0),
    ).toBeCloseTo(1, 5);
  });

  it("rejects the wrong shape, NaN, and zero vectors", () => {
    const nan = axis(0);
    nan[4] = Number.NaN;
    for (const invalid of [
      new Float32Array(511).fill(1),
      nan,
      new Float32Array(512),
    ]) {
      expect(() => l2NormalizeSpeakerEmbedding(invalid)).toThrowError(
        SpeakerEmbeddingMathError,
      );
    }
  });

  it("computes cosine similarity without making negative matches positive", () => {
    expect(cosineSpeakerEmbeddings(axis(0), axis(0))).toBeCloseTo(1);
    expect(cosineSpeakerEmbeddings(axis(0), axis(1))).toBeCloseTo(0);
    expect(cosineSpeakerEmbeddings(axis(0), axis(0, -1))).toBeCloseTo(-1);
    expect(
      normalizedSpeakerSimilarity(axis(0), axis(0, -1)),
    ).toBe(0);
  });

  it("averages normalized enrollment vectors into one normalized prototype", () => {
    const prototype = averageSpeakerEmbeddingPrototype([
      axis(0),
      axis(1),
    ]);

    expect(prototype[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(prototype[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(() =>
      assertL2NormalizedSpeakerEmbedding(prototype),
    ).not.toThrow();
  });

  it("projects partial enrollment coverage into existing grounding score types", () => {
    const scoreSet =
      scoreSpeakerEmbeddingAgainstParticipantPrototypes(
        axis(0),
        ["sera-professor", "amoretto", "eureka"],
        [
          {
            participantId: "sera-professor",
            modelRevision: SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
            enrollmentAssetIds: ["sera-voice-1"],
            embedding: axis(0),
          },
          {
            participantId: "amoretto",
            modelRevision: SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
            enrollmentAssetIds: ["amoretto-voice-1"],
            embedding: axis(1),
          },
        ],
      );

    expect(scoreSet.coveredParticipantIds).toEqual([
      "sera-professor",
      "amoretto",
    ]);
    expect(scoreSet.missingParticipantIds).toEqual(["eureka"]);
    expect(scoreSet.scores).toEqual([
      { participantId: "sera-professor", normalizedSimilarity: 1 },
      { participantId: "amoretto", normalizedSimilarity: 0 },
    ]);
    expect(scoreSet.unresolvedParticipantId).toBe("unknown");
  });

  it("rejects an enrollment prototype built by another model fence", () => {
    expect(() =>
      scoreSpeakerEmbeddingAgainstParticipantPrototypes(
        axis(0),
        ["sera-professor"],
        [
          {
            participantId: "sera-professor",
            modelRevision:
              "another-model" as typeof SPEAKER_EMBEDDING_MODEL_FENCE_REVISION,
            enrollmentAssetIds: ["sera-voice-1"],
            embedding: axis(0),
          },
        ],
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SpeakerEmbeddingMathError>>({
        code: "MODEL_FENCE_MISMATCH",
      }),
    );
  });
});
