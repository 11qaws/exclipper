import {
  isAnalysisLanguage,
  type AnalysisLanguage,
} from "../domain/analysisLanguage";
import { canonicalizeCandidatePassBContextPacket } from "./candidatePassBContextBudget";
import type { CandidatePassBContextPacket } from "./candidatePassBWorkerProtocol";
import {
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
} from "./participantRoster";

export const CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION = "1.0.0" as const;
export const CANDIDATE_INSIGHT_MEDIA_ENDPOINT_PATH =
  "/v1/candidate-insight-media" as const;
export const CANDIDATE_INSIGHT_MEDIA_BUNDLE_CONTENT_TYPE =
  "application/vnd.exclipper.candidate-media-bundle" as const;
export const CANDIDATE_INSIGHT_MEDIA_RESOLVE_CONTENT_TYPE =
  "application/vnd.exclipper.candidate-media-resolve+json" as const;
export const BROADCAST_TRANSCRIPT_VISUAL_MEDIA_RESOLVE_CONTENT_TYPE =
  "application/vnd.exclipper.transcript-visual-media-resolve+json" as const;
export const CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_LENGTH = 1_024;

export interface CandidateInsightMediaStagedResponse {
  readonly schemaVersion: typeof CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION;
  readonly status: "staged";
  readonly mediaTicket: string;
  readonly expiresAtMs: number;
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly frameCount: 4;
}

export interface CandidateInsightMediaResolveRequest {
  readonly schemaVersion: typeof CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION;
  readonly mediaTicket: string;
  readonly candidateDurationMs: number;
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly context: CandidatePassBContextPacket;
}

export interface CandidateInsightMediaSemanticRequestIdentity {
  readonly mediaPayloadDigest: string;
  readonly candidateHash: string;
  readonly candidateDurationMs: number;
  readonly audioByteLength: number;
  readonly frames: readonly {
    readonly timestampMs: number;
    readonly byteLength: number;
  }[];
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly context: CandidatePassBContextPacket;
}

export interface BroadcastTranscriptVisualMediaResolveRequest {
  readonly schemaVersion: typeof CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION;
  readonly mediaTicket: string;
  readonly candidateDurationMs: number;
  readonly transcriptAbstentionReason:
    | "no-speech"
    | "no-audio"
    | "dialogue-sample";
  readonly castRosterId: CandidatePassBCastRosterId | null;
  readonly outputLanguage: AnalysisLanguage;
  readonly context: CandidatePassBContextPacket | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

/**
 * Stable provider-operation payload identity. The signed media ticket is an
 * expiring transport capability and is intentionally excluded.
 */
export async function createCandidateInsightMediaSemanticPayloadDigest(
  input: CandidateInsightMediaSemanticRequestIdentity,
): Promise<string> {
  const rawFrames: unknown = input.frames;
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.mediaPayloadDigest) ||
    !/^[a-f0-9]{24}$/u.test(input.candidateHash) ||
    !Number.isSafeInteger(input.candidateDurationMs) ||
    input.candidateDurationMs <= 0 ||
    input.candidateDurationMs > 60_000 ||
    !Number.isSafeInteger(input.audioByteLength) ||
    input.audioByteLength < 0 ||
    !Array.isArray(rawFrames) ||
    rawFrames.length !== 4 ||
    (input.castRosterId !== null &&
      !isCandidatePassBCastRosterId(input.castRosterId)) ||
    !isAnalysisLanguage(input.outputLanguage)
  ) {
    throw new RangeError("Candidate media semantic identity is invalid.");
  }
  const frames = rawFrames as readonly unknown[];
  const canonicalFrames: Array<{
    readonly timestampMs: number;
    readonly byteLength: number;
  }> = [];
  let previousTimestampMs = -1;
  for (const rawFrame of frames) {
    if (!isRecord(rawFrame)) {
      throw new RangeError(
        "Candidate media semantic frame identity is invalid.",
      );
    }
    const timestampMs = rawFrame.timestampMs;
    const byteLength = rawFrame.byteLength;
    if (
      typeof timestampMs !== "number" ||
      !Number.isSafeInteger(timestampMs) ||
      timestampMs <= previousTimestampMs ||
      timestampMs >= input.candidateDurationMs ||
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength <= 0
    ) {
      throw new RangeError("Candidate media semantic frame identity is invalid.");
    }
    canonicalFrames.push({ timestampMs, byteLength });
    previousTimestampMs = timestampMs;
  }
  const canonicalContext = canonicalizeCandidatePassBContextPacket(
    input.context,
  );
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "candidate-insight-media-semantic-request-v1",
      CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
      input.mediaPayloadDigest,
      input.candidateHash,
      input.candidateDurationMs,
      input.audioByteLength,
      canonicalFrames.map(({ timestampMs, byteLength }) => [
        timestampMs,
        byteLength,
      ]),
      input.castRosterId,
      input.outputLanguage,
      canonicalContext,
    ]),
  );
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  return `sha256:${bytesToHex(digest)}`;
}

export function isCandidateInsightMediaTicket(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 64 &&
    value.length <= CANDIDATE_INSIGHT_MEDIA_TICKET_MAX_LENGTH &&
    /^[A-Za-z0-9._-]+$/u.test(value)
  );
}

export function parseCandidateInsightMediaStagedResponse(
  value: unknown,
  candidateHash: string,
  candidateDurationMs: number,
): CandidateInsightMediaStagedResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "mediaTicket",
      "expiresAtMs",
      "candidateHash",
      "candidateDurationMs",
      "frameCount",
    ]) ||
    value.schemaVersion !== CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION ||
    value.status !== "staged" ||
    !isCandidateInsightMediaTicket(value.mediaTicket) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    (value.expiresAtMs as number) <= Date.now() ||
    value.candidateHash !== candidateHash ||
    value.candidateDurationMs !== candidateDurationMs ||
    value.frameCount !== 4
  ) {
    return null;
  }
  return value as unknown as CandidateInsightMediaStagedResponse;
}

export function createCandidateInsightMediaResolveRequest(
  mediaTicket: string,
  candidateDurationMs: number,
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket,
): CandidateInsightMediaResolveRequest {
  if (!isCandidateInsightMediaTicket(mediaTicket)) {
    throw new RangeError("Candidate media ticket is invalid.");
  }
  return {
    schemaVersion: CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
    mediaTicket,
    candidateDurationMs,
    castRosterId,
    outputLanguage,
    context,
  };
}

export function createBroadcastTranscriptVisualMediaResolveRequest(
  mediaTicket: string,
  candidateDurationMs: number,
  transcriptAbstentionReason:
    | "no-speech"
    | "no-audio"
    | "dialogue-sample",
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket | null,
): BroadcastTranscriptVisualMediaResolveRequest {
  if (!isCandidateInsightMediaTicket(mediaTicket)) {
    throw new RangeError("Candidate media ticket is invalid.");
  }
  return {
    schemaVersion: CANDIDATE_INSIGHT_MEDIA_SCHEMA_VERSION,
    mediaTicket,
    candidateDurationMs,
    transcriptAbstentionReason,
    castRosterId,
    outputLanguage,
    context,
  };
}
