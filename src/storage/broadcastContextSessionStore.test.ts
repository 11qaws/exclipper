import { describe, expect, it } from "vitest";
import {
  BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  assertBroadcastContextSessionRecord,
  cloneBroadcastContextSessionRecord,
  type BroadcastContextSessionRecord,
} from "./broadcastContextSessionStore";

const record: BroadcastContextSessionRecord = {
  kind: "broadcastContextSession",
  runId: "run-1",
  schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
  inputSignature: "source-signature",
  sourceDurationMs: 300_000,
  completeAudioCoverage: true,
  chapters: [
    {
      chapterId: "transcript-001",
      startMs: 0,
      endMs: 300_000,
      evidenceMode: "complete-transcript",
      evidenceCoverageRatio: 1,
      summaryKo: "방송에서 음식 이야기를 나눈다.",
    },
  ],
  gapChunkIds: [],
  fragmentGaps: [],
  modelRevision: "qwen3-asr-flash-api-reviewed-2026-07-22",
  contextInputSignature: null,
  contextResultJson: null,
  refinementInputSignature: null,
  refinementCandidatesJson: null,
  recordedAt: "2026-07-22T04:00:00.000Z",
};

describe("broadcastContextSessionStore", () => {
  it("validates and clones replayable chapter evidence", () => {
    expect(() => assertBroadcastContextSessionRecord(record)).not.toThrow();
    const cloned = cloneBroadcastContextSessionRecord(record);
    expect(cloned).toEqual(record);
    expect(cloned).not.toBe(record);
    expect(cloned.chapters).not.toBe(record.chapters);
    expect(cloned.fragmentGaps).not.toBe(record.fragmentGaps);
  });

  it("migrates a legacy 1.2 checkpoint without discarding paid chapters", () => {
    const legacy: Record<string, unknown> = {
      ...record,
      schemaVersion: "1.2.0",
    };
    Reflect.deleteProperty(legacy, "fragmentGaps");
    expect(
      cloneBroadcastContextSessionRecord(legacy),
    ).toMatchObject({
      schemaVersion: BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION,
      chapters: record.chapters,
      gapChunkIds: [],
      fragmentGaps: [],
    });
  });

  it("pairs refined semantic candidates with the exact refinement input", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: "refinement-signature",
        refinementCandidatesJson: "[]",
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        refinementInputSignature: null,
        refinementCandidatesJson: "[]",
      }),
    ).toThrow(TypeError);
  });

  it("keeps a bounded, paired whole-context result for paid-result recovery", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: JSON.stringify({ schemaVersion: "1.4.0" }),
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        contextInputSignature: "context-signature",
        contextResultJson: null,
      }),
    ).toThrow(TypeError);
  });

  it("preserves an empty transcript map when every sampled chunk is an explicit gap", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        completeAudioCoverage: false,
        chapters: [],
        gapChunkIds: ["chunk-001", "chunk-002"],
        fragmentGaps: [
          {
            chunkId: "chunk-001",
            sourceStartMs: 0,
            sourceEndMs: 30_000,
            reason: "in-flight",
            attemptCount: 3,
          },
          {
            chunkId: "chunk-002",
            sourceStartMs: 30_000,
            sourceEndMs: 60_000,
            reason: "outcome-unknown",
            attemptCount: 1,
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        chapters: [],
      }),
    ).toThrow(TypeError);
  });

  it("stores a detailed chapter map larger than the 144-item transport projection", () => {
    const chapters = Array.from({ length: 145 }, (_, index) => ({
      chapterId: `transcript-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      evidenceMode: "complete-transcript" as const,
      evidenceCoverageRatio: 1,
      summaryKo: `${index + 1}번째 방송 구간`,
    }));
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        sourceDurationMs: 145_000,
        chapters,
      }),
    ).not.toThrow();
  });

  it("rejects raw provider-shaped fields and invalid chapter ranges", () => {
    expect(() =>
      assertBroadcastContextSessionRecord({ ...record, rawTranscript: "secret" }),
    ).toThrow(TypeError);
    expect(() =>
      assertBroadcastContextSessionRecord({
        ...record,
        chapters: [{ ...record.chapters[0], endMs: 400_000 }],
      }),
    ).toThrow();
  });
});
