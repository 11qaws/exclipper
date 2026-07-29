import {
  candidatePassBKnownCastReferences,
  type CandidatePassBParticipantId,
} from "./participantRoster";
import type { ContentDigestAdapter } from "../security/contentFingerprint";

export const PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION =
  "1.0.0" as const;
export const PARTICIPANT_VOICE_ENROLLMENT_GROUNDING_DOMAIN =
  "exclipper.participant-voice-enrollment-manifest.v1" as const;
export const PARTICIPANT_VOICE_UNKNOWN_ID = "unknown" as const;

const MAX_ENROLLMENT_ASSET_COUNT = 192;
const MAX_SOURCE_TIME_MS = 12 * 60 * 60 * 1_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/u;

export const PARTICIPANT_VOICE_ENROLLMENT_PARTICIPANT_IDS = Object.freeze(
  candidatePassBKnownCastReferences().map(({ participantId }) => participantId),
);

const ENROLLMENT_PARTICIPANT_IDS = new Set<CandidatePassBParticipantId>(
  PARTICIPANT_VOICE_ENROLLMENT_PARTICIPANT_IDS,
);

export type ParticipantVoiceRecognitionParticipantId =
  | CandidatePassBParticipantId
  | typeof PARTICIPANT_VOICE_UNKNOWN_ID;

export type ParticipantVoiceEnrollmentSourceType =
  | "user-provided"
  | "creator-published"
  | "project-produced";

export type ParticipantVoiceEnrollmentConsentStatus =
  | "granted"
  | "not-required"
  | "unknown"
  | "denied";

export type ParticipantVoiceEnrollmentSpeechActivity = "speech" | "no-speech";
export type ParticipantVoiceEnrollmentHumanVerificationStatus =
  | "verified"
  | "pending"
  | "rejected";

export interface ParticipantVoiceEnrollmentSourceRange {
  readonly sourceId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface ParticipantVoiceEnrollmentProvenance {
  readonly sourceType: ParticipantVoiceEnrollmentSourceType;
  readonly sourceLocator: string | null;
  readonly note: string | null;
}

export interface ParticipantVoiceEnrollmentConsent {
  readonly status: ParticipantVoiceEnrollmentConsentStatus;
  readonly basis: string;
}

export interface ParticipantVoiceEnrollmentHumanVerification {
  readonly status: ParticipantVoiceEnrollmentHumanVerificationStatus;
  readonly verifierId: string | null;
  readonly verifiedAt: string | null;
  readonly note: string | null;
}

export interface ParticipantVoiceEnrollmentAsset {
  readonly participantId: CandidatePassBParticipantId;
  readonly assetId: string;
  readonly source: ParticipantVoiceEnrollmentSourceRange;
  readonly contentSha256: string;
  readonly provenance: ParticipantVoiceEnrollmentProvenance;
  readonly consent: ParticipantVoiceEnrollmentConsent;
  readonly language: string;
  readonly speechActivity: ParticipantVoiceEnrollmentSpeechActivity;
  readonly containsOverlappingSpeech: boolean;
  readonly containsMusic: boolean;
  readonly humanVerification: ParticipantVoiceEnrollmentHumanVerification;
  readonly embeddingModelRevision: string;
  readonly assetRevision: string;
}

/**
 * Metadata-only catalog. Extracted audio, PCM, Base64 and embeddings are not
 * part of this contract and are rejected as unknown keys by the normalizer.
 */
export interface ParticipantVoiceEnrollmentManifest {
  readonly schemaVersion:
    typeof PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION;
  readonly manifestRevision: string;
  readonly assets: readonly ParticipantVoiceEnrollmentAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function normalizedText(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    /[\p{Cc}\p{Cf}]/u.test(normalized) ||
    (pattern !== undefined && !pattern.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

function normalizedOptionalText(
  value: unknown,
  maximumLength: number,
): string | null | undefined {
  if (value === null) return null;
  return normalizedText(value, maximumLength) ?? undefined;
}

function normalizedLanguage(value: unknown): string | null {
  const language = normalizedText(value, 35);
  if (language === null) return null;
  try {
    return Intl.getCanonicalLocales(language)[0] ?? null;
  } catch {
    return null;
  }
}

function normalizedIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : null;
}

function normalizedSourceRange(
  value: unknown,
): ParticipantVoiceEnrollmentSourceRange | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sourceId", "startMs", "endMs"])
  ) {
    return null;
  }
  const sourceId = normalizedText(value.sourceId, 256, IDENTIFIER_PATTERN);
  if (
    sourceId === null ||
    !Number.isSafeInteger(value.startMs) ||
    !Number.isSafeInteger(value.endMs) ||
    (value.startMs as number) < 0 ||
    (value.endMs as number) <= (value.startMs as number) ||
    (value.endMs as number) > MAX_SOURCE_TIME_MS
  ) {
    return null;
  }
  return {
    sourceId,
    startMs: value.startMs as number,
    endMs: value.endMs as number,
  };
}

function normalizedProvenance(
  value: unknown,
): ParticipantVoiceEnrollmentProvenance | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["sourceType", "sourceLocator", "note"]) ||
    !["user-provided", "creator-published", "project-produced"].includes(
      value.sourceType as string,
    )
  ) {
    return null;
  }
  const sourceLocator = normalizedOptionalText(value.sourceLocator, 2_048);
  const note = normalizedOptionalText(value.note, 1_000);
  if (sourceLocator === undefined || note === undefined) return null;
  return {
    sourceType: value.sourceType as ParticipantVoiceEnrollmentSourceType,
    sourceLocator,
    note,
  };
}

function normalizedConsent(
  value: unknown,
): ParticipantVoiceEnrollmentConsent | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "basis"]) ||
    !["granted", "not-required", "unknown", "denied"].includes(
      value.status as string,
    )
  ) {
    return null;
  }
  const basis = normalizedText(value.basis, 1_000);
  return basis === null
    ? null
    : {
        status: value.status as ParticipantVoiceEnrollmentConsentStatus,
        basis,
      };
}

function normalizedHumanVerification(
  value: unknown,
): ParticipantVoiceEnrollmentHumanVerification | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "status",
      "verifierId",
      "verifiedAt",
      "note",
    ]) ||
    !["verified", "pending", "rejected"].includes(value.status as string)
  ) {
    return null;
  }
  const verifierId =
    value.verifierId === null
      ? null
      : normalizedText(value.verifierId, 128, IDENTIFIER_PATTERN) ?? undefined;
  const verifiedAt =
    value.verifiedAt === null
      ? null
      : normalizedIsoTimestamp(value.verifiedAt) ?? undefined;
  const note = normalizedOptionalText(value.note, 1_000);
  if (
    verifierId === undefined ||
    verifiedAt === undefined ||
    note === undefined ||
    (value.status === "verified" &&
      (verifierId === null || verifiedAt === null)) ||
    (value.status !== "verified" &&
      (verifierId !== null || verifiedAt !== null))
  ) {
    return null;
  }
  return {
    status: value.status as ParticipantVoiceEnrollmentHumanVerificationStatus,
    verifierId,
    verifiedAt,
    note,
  };
}

function normalizedAsset(
  value: unknown,
): ParticipantVoiceEnrollmentAsset | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "participantId",
      "assetId",
      "source",
      "contentSha256",
      "provenance",
      "consent",
      "language",
      "speechActivity",
      "containsOverlappingSpeech",
      "containsMusic",
      "humanVerification",
      "embeddingModelRevision",
      "assetRevision",
    ]) ||
    !ENROLLMENT_PARTICIPANT_IDS.has(
      value.participantId as CandidatePassBParticipantId,
    ) ||
    !SHA256_PATTERN.test(value.contentSha256 as string) ||
    !["speech", "no-speech"].includes(value.speechActivity as string) ||
    typeof value.containsOverlappingSpeech !== "boolean" ||
    typeof value.containsMusic !== "boolean"
  ) {
    return null;
  }
  const assetId = normalizedText(value.assetId, 192, IDENTIFIER_PATTERN);
  const source = normalizedSourceRange(value.source);
  const provenance = normalizedProvenance(value.provenance);
  const consent = normalizedConsent(value.consent);
  const language = normalizedLanguage(value.language);
  const humanVerification = normalizedHumanVerification(
    value.humanVerification,
  );
  const embeddingModelRevision = normalizedText(
    value.embeddingModelRevision,
    192,
    IDENTIFIER_PATTERN,
  );
  const assetRevision = normalizedText(
    value.assetRevision,
    128,
    IDENTIFIER_PATTERN,
  );
  if (
    assetId === null ||
    source === null ||
    provenance === null ||
    consent === null ||
    language === null ||
    humanVerification === null ||
    embeddingModelRevision === null ||
    assetRevision === null
  ) {
    return null;
  }
  return {
    participantId: value.participantId as CandidatePassBParticipantId,
    assetId,
    source,
    contentSha256: value.contentSha256 as string,
    provenance,
    consent,
    language,
    speechActivity:
      value.speechActivity as ParticipantVoiceEnrollmentSpeechActivity,
    containsOverlappingSpeech: value.containsOverlappingSpeech,
    containsMusic: value.containsMusic,
    humanVerification,
    embeddingModelRevision,
    assetRevision,
  };
}

export function isParticipantVoiceEnrollmentParticipantId(
  value: unknown,
): value is CandidatePassBParticipantId {
  return ENROLLMENT_PARTICIPANT_IDS.has(
    value as CandidatePassBParticipantId,
  );
}

export function isParticipantVoiceRecognitionParticipantId(
  value: unknown,
): value is ParticipantVoiceRecognitionParticipantId {
  return (
    value === PARTICIPANT_VOICE_UNKNOWN_ID ||
    isParticipantVoiceEnrollmentParticipantId(value)
  );
}

export function normalizeParticipantVoiceEnrollmentManifest(
  value: unknown,
): ParticipantVoiceEnrollmentManifest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "manifestRevision", "assets"]) ||
    value.schemaVersion !==
      PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(value.assets) ||
    value.assets.length > MAX_ENROLLMENT_ASSET_COUNT
  ) {
    return null;
  }
  const manifestRevision = normalizedText(
    value.manifestRevision,
    128,
    IDENTIFIER_PATTERN,
  );
  if (manifestRevision === null) return null;
  const assets = value.assets.map(normalizedAsset);
  if (assets.some((asset) => asset === null)) return null;
  const canonicalAssets = (
    assets as ParticipantVoiceEnrollmentAsset[]
  ).sort((left, right) =>
    left.participantId.localeCompare(right.participantId) ||
    left.assetId.localeCompare(right.assetId)
  );
  const assetIds = new Set(canonicalAssets.map(({ assetId }) => assetId));
  if (assetIds.size !== canonicalAssets.length) return null;
  return {
    schemaVersion: PARTICIPANT_VOICE_ENROLLMENT_MANIFEST_SCHEMA_VERSION,
    manifestRevision,
    assets: canonicalAssets,
  };
}

export function isParticipantVoiceEnrollmentEligible(
  asset: ParticipantVoiceEnrollmentAsset,
): boolean {
  const canonical = normalizedAsset(asset);
  if (canonical === null) return false;
  return (
    canonical.speechActivity === "speech" &&
    !canonical.containsOverlappingSpeech &&
    !canonical.containsMusic &&
    canonical.humanVerification.status === "verified" &&
    canonical.humanVerification.verifierId !== null &&
    canonical.humanVerification.verifiedAt !== null &&
    ["granted", "not-required"].includes(canonical.consent.status)
  );
}

export function eligibleParticipantVoiceEnrollmentAssets(
  manifest: ParticipantVoiceEnrollmentManifest,
): readonly ParticipantVoiceEnrollmentAsset[] {
  return manifest.assets.filter(isParticipantVoiceEnrollmentEligible);
}

export function canonicalParticipantVoiceEnrollmentManifestForGroundingSignature(
  value: unknown,
): string {
  const manifest = normalizeParticipantVoiceEnrollmentManifest(value);
  if (manifest === null) {
    throw new TypeError("Invalid participant voice enrollment manifest.");
  }
  return JSON.stringify({
    domain: PARTICIPANT_VOICE_ENROLLMENT_GROUNDING_DOMAIN,
    manifest,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createParticipantVoiceEnrollmentManifestHash(
  value: unknown,
  adapter: ContentDigestAdapter | null = globalThis.crypto?.subtle ?? null,
): Promise<string> {
  if (adapter === null) {
    throw new Error(
      "SHA-256 is required to bind a voice enrollment manifest to grounding.",
    );
  }
  const canonical =
    canonicalParticipantVoiceEnrollmentManifestForGroundingSignature(value);
  const encoded = new TextEncoder().encode(canonical);
  const digest = await adapter.digest("SHA-256", encoded);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export function participantVoiceEnrollmentGroundingSignaturePart(
  manifestHash: string,
): string {
  if (!SHA256_PATTERN.test(manifestHash)) {
    throw new TypeError("Voice enrollment manifest hash must be SHA-256.");
  }
  return `${PARTICIPANT_VOICE_ENROLLMENT_GROUNDING_DOMAIN}:${manifestHash}`;
}
