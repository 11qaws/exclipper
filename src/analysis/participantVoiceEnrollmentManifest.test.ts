import { describe, expect, it } from "vitest";

import {
  PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
  PARTICIPANT_VOICE_ENROLLMENT_PARTICIPANT_IDS,
  PARTICIPANT_VOICE_UNKNOWN_ID,
  canonicalParticipantVoiceEnrollmentManifestForGroundingSignature,
  createParticipantVoiceEnrollmentManifestHash,
  eligibleParticipantVoiceEnrollmentAssets,
  isParticipantVoiceEnrollmentEligible,
  isParticipantVoiceEnrollmentParticipantId,
  isParticipantVoiceRecognitionParticipantId,
  normalizeParticipantVoiceEnrollmentManifest,
  participantVoiceEnrollmentGroundingSignaturePart,
  type ParticipantVoiceEnrollmentAsset,
  type ParticipantVoiceEnrollmentManifest,
} from "./participantVoiceEnrollmentManifest";
import type { CandidatePassBParticipantId } from "./participantRoster";

function asset(
  participantId: CandidatePassBParticipantId,
  ordinal = 1,
): ParticipantVoiceEnrollmentAsset {
  return {
    participantId,
    assetId: `synthetic:${participantId}:${ordinal}`,
    source: {
      sourceId: `synthetic-source:${participantId}`,
      startMs: ordinal * 10_000,
      endMs: ordinal * 10_000 + 30_000,
    },
    contentSha256: `sha256:${ordinal.toString(16).padStart(64, "0")}`,
    provenance: {
      sourceType: "user-provided",
      sourceLocator: null,
      note: "단위 테스트용 합성 메타데이터",
    },
    consent: {
      status: "granted",
      basis: "테스트 fixture 사용 동의",
    },
    language: "ko",
    speechActivity: "speech",
    containsOverlappingSpeech: false,
    containsMusic: false,
    humanVerification: {
      status: "verified",
      verifierId: "reviewer:test",
      verifiedAt: "2026-07-29T00:00:00.000Z",
      note: "단독 발화 확인",
    },
    embeddingModelRevision: "speaker-embedding:test-v1",
    assetRevision: "asset-v1",
  };
}

function manifest(
  assets: readonly ParticipantVoiceEnrollmentAsset[],
): ParticipantVoiceEnrollmentManifest {
  return {
    schemaVersion: PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
    manifestRevision: "manifest-v1",
    assets,
  };
}

describe("participant voice enrollment manifest", () => {
  it("allows only the fixed six-person enrollment catalog while recognition may be unknown", () => {
    expect(PARTICIPANT_VOICE_ENROLLMENT_PARTICIPANT_IDS).toEqual([
      "sera-professor",
      "amoretto",
      "eureka",
      "sena-arbel",
      "torori-coco",
      "mangjing",
    ]);
    for (const participantId of PARTICIPANT_VOICE_ENROLLMENT_PARTICIPANT_IDS) {
      expect(isParticipantVoiceEnrollmentParticipantId(participantId)).toBe(true);
      expect(isParticipantVoiceRecognitionParticipantId(participantId)).toBe(true);
    }
    expect(isParticipantVoiceEnrollmentParticipantId("unknown")).toBe(false);
    expect(
      isParticipantVoiceRecognitionParticipantId(PARTICIPANT_VOICE_UNKNOWN_ID),
    ).toBe(true);
    expect(isParticipantVoiceRecognitionParticipantId("outside-person")).toBe(
      false,
    );
    expect(
      normalizeParticipantVoiceEnrollmentManifest(
        manifest([
          {
            ...asset("amoretto"),
            participantId: "unknown",
          } as unknown as ParticipantVoiceEnrollmentAsset,
        ]),
      ),
    ).toBeNull();
  });

  it("requires verified speech without overlap or music for enrollment", () => {
    const eligible = asset("sera-professor");
    expect(isParticipantVoiceEnrollmentEligible(eligible)).toBe(true);
    expect(
      isParticipantVoiceEnrollmentEligible({
        ...eligible,
        contentSha256: "",
      }),
    ).toBe(false);
    expect(
      eligibleParticipantVoiceEnrollmentAssets(
        manifest([
          eligible,
          { ...asset("amoretto", 2), speechActivity: "no-speech" },
          { ...asset("eureka", 3), containsOverlappingSpeech: true },
          { ...asset("sena-arbel", 4), containsMusic: true },
          {
            ...asset("torori-coco", 5),
            humanVerification: {
              status: "pending",
              verifierId: null,
              verifiedAt: null,
              note: null,
            },
          },
          {
            ...asset("mangjing", 6),
            consent: { status: "unknown", basis: "동의 상태 확인 전" },
          },
        ]),
      ).map(({ participantId }) => participantId),
    ).toEqual(["sera-professor"]);
  });

  it("rejects a missing hash, invalid exact range, and binary payload fields", () => {
    const valid = asset("eureka");
    expect(
      normalizeParticipantVoiceEnrollmentManifest(
        manifest([{ ...valid, contentSha256: "" }]),
      ),
    ).toBeNull();
    expect(
      normalizeParticipantVoiceEnrollmentManifest(
        manifest([
          {
            ...valid,
            source: { ...valid.source, endMs: valid.source.startMs },
          },
        ]),
      ),
    ).toBeNull();
    expect(
      normalizeParticipantVoiceEnrollmentManifest({
        ...manifest([valid]),
        assets: [{ ...valid, base64Audio: "AAAA" }],
      }),
    ).toBeNull();
  });

  it("rejects contradictory human verification and duplicate asset IDs", () => {
    const first = asset("sena-arbel");
    expect(
      normalizeParticipantVoiceEnrollmentManifest(
        manifest([
          {
            ...first,
            humanVerification: {
              status: "verified",
              verifierId: null,
              verifiedAt: null,
              note: null,
            },
          },
        ]),
      ),
    ).toBeNull();
    expect(
      normalizeParticipantVoiceEnrollmentManifest(
        manifest([
          first,
          {
            ...asset("mangjing", 2),
            assetId: first.assetId,
          },
        ]),
      ),
    ).toBeNull();
  });

  it("canonicalizes order and language before producing a deterministic hash", async () => {
    const first = asset("torori-coco", 1);
    const second = {
      ...asset("amoretto", 2),
      language: "ko-kr",
    };
    const forward = manifest([first, second]);
    const reverse = manifest([second, first]);

    const forwardCanonical =
      canonicalParticipantVoiceEnrollmentManifestForGroundingSignature(forward);
    const reverseCanonical =
      canonicalParticipantVoiceEnrollmentManifestForGroundingSignature(reverse);
    expect(reverseCanonical).toBe(forwardCanonical);
    expect(forwardCanonical).toContain('"language":"ko-KR"');

    const forwardHash =
      await createParticipantVoiceEnrollmentManifestHash(forward);
    const reverseHash =
      await createParticipantVoiceEnrollmentManifestHash(reverse);
    expect(forwardHash).toBe(reverseHash);
    expect(forwardHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(participantVoiceEnrollmentGroundingSignaturePart(forwardHash)).toContain(
      forwardHash,
    );
  });

  it("changes the grounding hash when an evidence-bearing field changes", async () => {
    const original = manifest([asset("mangjing")]);
    const changed = manifest([
      {
        ...asset("mangjing"),
        source: {
          ...asset("mangjing").source,
          startMs: asset("mangjing").source.startMs + 1,
        },
      },
    ]);
    await expect(
      createParticipantVoiceEnrollmentManifestHash(changed),
    ).resolves.not.toBe(
      await createParticipantVoiceEnrollmentManifestHash(original),
    );
  });

  it("does not downgrade a grounding manifest hash without SHA-256", async () => {
    await expect(
      createParticipantVoiceEnrollmentManifestHash(
        manifest([asset("sera-professor")]),
        null,
      ),
    ).rejects.toThrow(/SHA-256/u);
    expect(() =>
      participantVoiceEnrollmentGroundingSignaturePart("not-a-hash"),
    ).toThrow(/SHA-256/u);
  });
});
