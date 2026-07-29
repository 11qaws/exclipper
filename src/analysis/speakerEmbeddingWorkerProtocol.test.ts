import { describe, expect, it } from "vitest";

import {
  SPEAKER_EMBEDDING_MAX_TRANSFER_BYTES,
  SPEAKER_EMBEDDING_SAMPLE_RATE_HZ,
  assertSpeakerEmbeddingPcm,
  createSpeakerEmbeddingSourceReceipt,
  type SpeakerEmbeddingProtocolError,
  type SpeakerEmbeddingSourceInput,
} from "./speakerEmbeddingWorkerProtocol";

const sourceFingerprint = `sha256:${"a".repeat(64)}`;

function source(
  overrides: Partial<SpeakerEmbeddingSourceInput> = {},
): SpeakerEmbeddingSourceInput {
  return {
    sourceFingerprint,
    sourceDurationMs: 60_000,
    sourceStartMs: 10_000,
    sourceEndMs: 13_000,
    sourceUnitId: "speech-turn-1",
    audioBundleReuseKey:
      `participant-media-bundle-v1:${sourceFingerprint}:10000-13000:pcm16k-mono`,
    preparation: {
      speechActivity: "speech",
      speechActivityRevision: "vad-v1",
      overlapStatus: "verified-absent",
      musicStatus: "removed",
      conditioningRevision: "speech-conditioning-v1",
    },
    ...overrides,
  };
}

function speechSamples(durationMs = 3_000): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(
    (durationMs / 1_000) * SPEAKER_EMBEDDING_SAMPLE_RATE_HZ,
  );
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(index / 19) * 0.2;
  }
  return samples;
}

describe("speaker embedding worker protocol", () => {
  it("creates an exact persistence-safe source receipt", async () => {
    const receipt = await createSpeakerEmbeddingSourceReceipt(
      source(),
      speechSamples(),
    );

    expect(receipt.sampleRateHz).toBe(16_000);
    expect(receipt.channelCount).toBe(1);
    expect(receipt.sampleCount).toBe(48_000);
    expect(receipt.audioContentSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.preparation).toEqual({
      speechActivity: "speech",
      speechActivityRevision: "vad-v1",
      overlapStatus: "verified-absent",
      musicStatus: "removed",
      conditioningRevision: "speech-conditioning-v1",
    });

    const persisted = JSON.stringify(receipt);
    expect(persisted).not.toContain('"samples"');
    expect(persisted).not.toContain('"base64"');
    expect(persisted).not.toContain('"audioData"');
  });

  it("binds the input fingerprint to the exact Float32 bytes", async () => {
    const first = speechSamples();
    const second = speechSamples();
    second[12_345] = second[12_345]! + 0.01;

    const [firstReceipt, secondReceipt] = await Promise.all([
      createSpeakerEmbeddingSourceReceipt(source(), first),
      createSpeakerEmbeddingSourceReceipt(source(), second),
    ]);

    expect(firstReceipt.audioContentSha256).not.toBe(
      secondReceipt.audioContentSha256,
    );
    expect(firstReceipt.inputFingerprint).not.toBe(
      secondReceipt.inputFingerprint,
    );
  });

  it("rejects unresolved overlap or music before inference", () => {
    const unresolvedOverlap = source({
      preparation: {
        ...source().preparation,
        overlapStatus: "unresolved",
      },
    });
    const unresolvedMusic = source({
      preparation: {
        ...source().preparation,
        musicStatus: "unresolved",
      },
    });

    for (const invalidSource of [unresolvedOverlap, unresolvedMusic]) {
      expect(() =>
        assertSpeakerEmbeddingPcm(speechSamples(), invalidSource),
      ).toThrowError(
        expect.objectContaining<Partial<SpeakerEmbeddingProtocolError>>({
          code: "UNCLEAN_SPEECH_TURN",
        }),
      );
    }
  });

  it("rejects malformed, NaN, out-of-range, zero, and oversized PCM", () => {
    const invalidInputs = [
      new Float32Array(48_000),
      (() => {
        const value = speechSamples();
        value[10] = Number.NaN;
        return value;
      })(),
      (() => {
        const value = speechSamples();
        value[10] = 1.1;
        return value;
      })(),
      new Float32Array(47_999).fill(0.1),
    ];

    for (const samples of invalidInputs) {
      expect(() =>
        assertSpeakerEmbeddingPcm(samples, source()),
      ).toThrowError(
        expect.objectContaining<Partial<SpeakerEmbeddingProtocolError>>({
          code: "INVALID_AUDIO",
        }),
      );
    }
    expect(SPEAKER_EMBEDDING_MAX_TRANSFER_BYTES).toBe(1_920_000);
  });

  it("rejects a bundle key that does not describe the exact source range", () => {
    expect(() =>
      assertSpeakerEmbeddingPcm(
        speechSamples(),
        source({
          audioBundleReuseKey:
            `participant-media-bundle-v1:${sourceFingerprint}:10001-13000:pcm16k-mono`,
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SpeakerEmbeddingProtocolError>>({
        code: "INVALID_SOURCE",
      }),
    );
  });
});
