import type { AnalysisLanguage } from "../domain/analysisLanguage";
import type { CandidatePassBContextPacket } from "./candidatePassBWorkerProtocol";
import type { CandidatePassBCastRosterId } from "./participantRoster";

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
