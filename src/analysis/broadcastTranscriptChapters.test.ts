import { describe, expect, it } from "vitest";
import { calculateCoverage } from "./broadcastContextProtocol";
import {
  broadcastResolvedAbstentionReasonForChapter,
  createBroadcastNoAudioChapters,
  createBroadcastNoSpeechChapters,
  createBroadcastTranscriptChapters,
  mergeBroadcastTranscriptChapters,
} from "./broadcastTranscriptChapters";

describe("broadcastTranscriptChapters", () => {
  it("persists confirmed no-audio ranges as resolved negative evidence", () => {
    const [chapter] = createBroadcastNoAudioChapters(
      [
        {
          chunkId: "silent-range",
          sourceStartMs: 30_000,
          sourceEndMs: 60_000,
          kind: "uniform",
        },
      ],
      120_000,
    );
    expect(chapter).toMatchObject({
      startMs: 30_000,
      endMs: 60_000,
      evidenceMode: "sampled-audio-video",
    });
    expect(chapter?.summaryKo).toContain("발화나 소리");
    expect(
      broadcastResolvedAbstentionReasonForChapter(chapter!),
    ).toBe("no-audio");
  });

  it("persists VAD-confirmed no-speech without claiming the video is empty", () => {
    const [chapter] = createBroadcastNoSpeechChapters(
      [
        {
          chunkId: "visual-only-range",
          sourceStartMs: 60_000,
          sourceEndMs: 90_000,
          kind: "event",
        },
      ],
      120_000,
    );

    expect(chapter).toMatchObject({
      chapterId: "no-speech-001",
      startMs: 60_000,
      endMs: 90_000,
      evidenceMode: "sampled-audio-video",
    });
    expect(chapter?.summaryKo).toContain("사람 발화");
    expect(chapter?.summaryKo).toContain("화면 사건 분석 대상");
    expect(chapter?.summaryKo).not.toContain("소리 없음");
    expect(
      broadcastResolvedAbstentionReasonForChapter(chapter!),
    ).toBe("no-speech");
    expect(
      broadcastResolvedAbstentionReasonForChapter({
        summaryKo: "스트리머가 조용히 게임 목표를 달성했다.",
      }),
    ).toBeNull();
  });

  it("preserves ASR source fences and reports true full coverage", () => {
    const chapters = createBroadcastTranscriptChapters(
      [
        {
          schemaVersion: "1.0.0",
          modelId: "qwen3-asr-flash",
          sourceStartMs: 0,
          sourceEndMs: 210_000,
          textKo: "첫 구간에서 음식 이야기를 시작한다.",
          detectedLanguage: "ko",
          emotion: "neutral",
          billedSeconds: 210,
        },
        {
          schemaVersion: "1.0.0",
          modelId: "qwen3-asr-flash",
          sourceStartMs: 210_000,
          sourceEndMs: 300_000,
          textKo: "두 번째 구간에서 조용히 성공한다.",
          detectedLanguage: "ko",
          emotion: "happy",
          billedSeconds: 90,
        },
      ],
      300_000,
      true,
    );
    expect(chapters[1]).toMatchObject({
      chapterId: "transcript-002",
      startMs: 210_000,
      endMs: 300_000,
      evidenceMode: "complete-transcript",
    });
    expect(chapters[1]?.summaryKo).toContain("[감정 단서: happy]");
    expect(calculateCoverage(chapters, 300_000).status).toBe("complete");
  });

  it("keeps unsampled source ranges visible as coverage gaps", () => {
    const chapters = createBroadcastTranscriptChapters(
      [
        {
          schemaVersion: "1.0.0",
          modelId: "qwen3-asr-flash",
          sourceStartMs: 100_000,
          sourceEndMs: 150_000,
          textKo: "표본 대사",
          detectedLanguage: "ko",
          emotion: null,
          billedSeconds: 50,
        },
      ],
      600_000,
      false,
    );
    expect(calculateCoverage(chapters, 600_000).gaps).toEqual([
      { startMs: 0, endMs: 100_000 },
      { startMs: 150_000, endMs: 600_000 },
    ]);
  });

  it("keeps evidence from the beginning, middle, and end of a long ASR cell", () => {
    const textKo = `시작사건 ${"가".repeat(1_000)} 중간사건 ${"나".repeat(1_000)} 정확한사과`;
    const [chapter] = createBroadcastTranscriptChapters(
      [{
        schemaVersion: "1.0.0",
        modelId: "qwen3.5-omni-flash",
        sourceStartMs: 0,
        sourceEndMs: 210_000,
        textKo,
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: null,
      }],
      210_000,
      true,
    );
    expect(chapter?.summaryKo).toContain("시작사건");
    expect(chapter?.summaryKo).toContain("중간사건");
    expect(chapter?.summaryKo).toContain("정확한사과");
    expect(Array.from(chapter?.summaryKo ?? "").length).toBeLessThanOrEqual(3_000);
  });

  it("keeps paid checkpoints, inserts recovered gaps, and reindexes the map", () => {
    const existing = [
      {
        chapterId: "transcript-001",
        startMs: 0,
        endMs: 90_000,
        evidenceMode: "sampled-audio-video" as const,
        evidenceCoverageRatio: 1,
        summaryKo: "첫 구간 대사",
      },
      {
        chapterId: "transcript-002",
        startMs: 180_000,
        endMs: 210_000,
        evidenceMode: "sampled-audio-video" as const,
        evidenceCoverageRatio: 1,
        summaryKo: "마지막 구간 대사",
      },
    ];
    const recovered = [{
      chapterId: "transcript-001",
      startMs: 90_000,
      endMs: 180_000,
      evidenceMode: "sampled-audio-video" as const,
      evidenceCoverageRatio: 1,
      summaryKo: "복구한 중간 대사",
    }];

    expect(
      mergeBroadcastTranscriptChapters(existing, recovered, 210_000, true),
    ).toEqual([
      expect.objectContaining({ chapterId: "transcript-001", startMs: 0, evidenceMode: "complete-transcript" }),
      expect.objectContaining({ chapterId: "transcript-002", startMs: 90_000, evidenceMode: "complete-transcript" }),
      expect.objectContaining({ chapterId: "transcript-003", startMs: 180_000, evidenceMode: "complete-transcript" }),
    ]);
  });

  it("rejects partially overlapping checkpoint evidence", () => {
    expect(() =>
      mergeBroadcastTranscriptChapters(
        [{ chapterId: "a", startMs: 0, endMs: 90_000, evidenceMode: "sampled-audio-video", evidenceCoverageRatio: 1, summaryKo: "기존" }],
        [{ chapterId: "b", startMs: 80_000, endMs: 120_000, evidenceMode: "sampled-audio-video", evidenceCoverageRatio: 1, summaryKo: "겹침" }],
        120_000,
        false,
      ),
    ).toThrow(RangeError);
  });
});
