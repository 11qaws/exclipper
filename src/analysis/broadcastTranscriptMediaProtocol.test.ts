import { describe, expect, it } from "vitest";

import {
  BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
  createBroadcastTranscriptMediaResolveRequest,
  parseBroadcastTranscriptMediaResolveRequest,
  parseBroadcastTranscriptMediaStagedResponse,
} from "./broadcastTranscriptMediaProtocol";

const TICKET = `v2.${"a".repeat(80)}.${"b".repeat(43)}`;

describe("broadcastTranscriptMediaProtocol", () => {
  it("accepts one exact source-fenced staged response", () => {
    expect(
      parseBroadcastTranscriptMediaStagedResponse(
        {
          schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
          status: "staged",
          mediaTicket: TICKET,
          expiresAtMs: 1_999_999_999_999,
          sourceStartMs: 10_000,
          sourceEndMs: 100_000,
        },
        10_000,
        90_000,
      ),
    ).toMatchObject({ status: "staged", mediaTicket: TICKET });
  });

  it("rejects stale, mismatched, and widened staged responses", () => {
    const base = {
      schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
      status: "staged",
      mediaTicket: TICKET,
      expiresAtMs: 1_999_999_999_999,
      sourceStartMs: 10_000,
      sourceEndMs: 100_000,
    };
    expect(
      parseBroadcastTranscriptMediaStagedResponse(
        { ...base, sourceEndMs: 100_001 },
        10_000,
        90_000,
      ),
    ).toBeNull();
    expect(
      parseBroadcastTranscriptMediaStagedResponse(
        { ...base, extra: true },
        10_000,
        90_000,
      ),
    ).toBeNull();
    expect(
      parseBroadcastTranscriptMediaStagedResponse(
        { ...base, expiresAtMs: 1 },
        10_000,
        90_000,
      ),
    ).toBeNull();
  });

  it("round-trips only an exact resolve request", () => {
    const request = createBroadcastTranscriptMediaResolveRequest(TICKET);
    expect(parseBroadcastTranscriptMediaResolveRequest(request)).toEqual(request);
    expect(
      parseBroadcastTranscriptMediaResolveRequest({ ...request, startMs: 0 }),
    ).toBeNull();
  });

  it("rejects the retired v1 ticket format", () => {
    const v1Ticket = `v1.${"a".repeat(80)}.${"b".repeat(43)}`;
    expect(
      parseBroadcastTranscriptMediaResolveRequest({
        schemaVersion: BROADCAST_TRANSCRIPT_MEDIA_SCHEMA_VERSION,
        mediaTicket: v1Ticket,
      }),
    ).toBeNull();
    expect(() =>
      createBroadcastTranscriptMediaResolveRequest(v1Ticket),
    ).toThrow("invalid");
  });
});
