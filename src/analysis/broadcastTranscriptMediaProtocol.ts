export const BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION = "1.0.0" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_ENDPOINT_PATH =
  "/v1/broadcast-transcript-media" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_RESOLVE_CONTENT_TYPE =
  "application/vnd.exclipper.transcript-media-resolve+json" as const;
export const BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_LENGTH = 512;

export interface BroadcastTranscriptMediaStagedResponse {
  readonly schemaVersion: typeof BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION;
  readonly status: "staged";
  readonly mediaTicket: string;
  readonly expiresAtMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export interface BroadcastTranscriptMediaResolveRequest {
  readonly schemaVersion: typeof BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION;
  readonly mediaTicket: string;
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

export function isBroadcastTranscriptMediaTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 64 &&
    value.length <= BROADCAST_TRANSCRIPT_MEDIA_TICKET_MAX_LENGTH &&
    /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)
  );
}

export function parseBroadcastTranscriptMediaStagedResponse(
  value: unknown,
  sourceStartMs: number,
  durationMs: number,
): BroadcastTranscriptMediaStagedResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "mediaTicket",
      "expiresAtMs",
      "sourceStartMs",
      "sourceEndMs",
    ]) ||
    value.schemaVersion !== BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION ||
    value.status !== "staged" ||
    !isBroadcastTranscriptMediaTicket(value.mediaTicket) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    (value.expiresAtMs as number) <= Date.now() ||
    value.sourceStartMs !== sourceStartMs ||
    value.sourceEndMs !== sourceStartMs + durationMs
  ) {
    return null;
  }
  return value as unknown as BroadcastTranscriptMediaStagedResponse;
}

export function createBroadcastTranscriptMediaResolveRequest(
  mediaTicket: string,
): BroadcastTranscriptMediaResolveRequest {
  if (!isBroadcastTranscriptMediaTicket(mediaTicket)) {
    throw new RangeError("Broadcast transcript media ticket is invalid.");
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
    mediaTicket,
  };
}

export function parseBroadcastTranscriptMediaResolveRequest(
  value: unknown,
): BroadcastTranscriptMediaResolveRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "mediaTicket"]) ||
    value.schemaVersion !== BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION ||
    !isBroadcastTranscriptMediaTicket(value.mediaTicket)
  ) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
    mediaTicket: value.mediaTicket,
  };
}
