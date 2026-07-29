import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
  buildBroadcastTranscriptVisualQwenOmniUrlRequestBody,
  buildCandidatePassBQwenOmniSharedPrompt,
  buildCandidatePassBQwenOmniRequestBody,
  buildCandidatePassBQwenOmniUrlRequestBody,
  extractCandidatePassBQwenOmniSseResponse,
} from "./candidatePassBQwenOmni";
import {
  buildCandidatePassBPrompt,
  extractCandidatePassBGeminiResponse,
} from "./candidatePassBGemini";
import {
  MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH,
  type CandidatePassBContextPacket,
} from "./candidatePassBWorkerProtocol";
import { DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID } from "./participantRoster";
import {
  CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER,
  canonicalizeCandidatePassBContextPacket,
} from "./candidatePassBContextBudget";
import { candidatePassBContextFingerprint } from "./candidateFinalVerification";

function contextPacket(
  overrides: Partial<CandidatePassBContextPacket> = {},
): CandidatePassBContextPacket {
  return {
    schemaVersion: "1.0.0",
    transcriptSource: "broadcast-transcript",
    transcriptKo: "후보 대사",
    beforeContextKo: "직전에는 음식 이름을 맞히고 있었다.",
    afterContextKo: "직후에는 자신의 실수를 인정했다.",
    broadcastSummaryKo: "방송 전체에서 음식 이름 맞히기 퀴즈를 진행했다.",
    topicContextKo: "음식 이름 맞히기",
    fastEvidenceKo: "짧은 비명과 웃음 반응이 포착됐다.",
    contextDecision: "select",
    contextCategory: "reaction",
    contextVerdictKo: "실수와 정정이 이어지는 독립된 사건이다.",
    chatReactionKo: "채팅에서 정답을 알려 주며 함께 웃었다.",
    ...overrides,
  };
}

function maximumContextField(label: string, fill: string): string {
  const prefix = `${label}시작`;
  const suffix = `${label}끝`;
  return `${prefix}${fill.repeat(
    MAX_CANDIDATE_PASS_B_CONTEXT_TEXT_LENGTH -
      prefix.length -
      suffix.length,
  )}${suffix}`;
}

describe("candidatePassBQwenOmni", () => {
  it("builds one combined audio and multi-image streaming request", () => {
    const body = buildCandidatePassBQwenOmniRequestBody("AA==", 30_000, [
      { timestampMs: 5_000, mimeType: "image/jpeg", dataBase64: "AQ==" },
      { timestampMs: 15_000, mimeType: "image/jpeg", dataBase64: "Ag==" },
      { timestampMs: 22_000, mimeType: "image/jpeg", dataBase64: "Aw==" },
      { timestampMs: 28_000, mimeType: "image/jpeg", dataBase64: "BA==" },
    ], null, "ko", contextPacket());
    expect(body.model).toBe("qwen3.5-omni-flash");
    expect(body.stream).toBe(true);
    expect(body.modalities).toEqual(["text"]);
    expect(body.max_tokens).toBe(2_048);
    expect(body.messages[0].content).toHaveLength(10);
    const serializedContent = JSON.stringify(body.messages[0].content);
    expect(serializedContent).toContain("input_audio");
    expect(serializedContent).toContain("5.0초");
    expect(serializedContent).toContain("15.0초");
    expect(
      body.messages[0].content.filter(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "image_url",
    ),
    ).toHaveLength(4);
  });

  it("keeps no-audio visual inspection on its explicit pre-context contract", () => {
    const body = buildBroadcastTranscriptVisualQwenOmniUrlRequestBody(
      null,
      30_000,
      [1_000, 10_000, 20_000, 29_000].map((timestampMs, index) => ({
        timestampMs,
        url: `https://media.example/frame-${index}.jpg`,
      })),
      null,
      "ko",
      null,
    );
    const typedParts = body.messages[0].content.filter(
      (part): part is Record<string, unknown> =>
        typeof part === "object" && part !== null,
    );
    expect(typedParts.some(({ type }) => type === "input_audio")).toBe(false);
    expect(
      typedParts.filter(({ type }) => type === "image_url"),
    ).toHaveLength(4);
  });

  it("requires current candidate URL requests to carry audio, four frames, and context", () => {
    const body = buildCandidatePassBQwenOmniUrlRequestBody(
      "https://media.example/candidate.wav",
      30_000,
      [1_000, 10_000, 20_000, 29_000].map((timestampMs, index) => ({
        timestampMs,
        url: `https://media.example/candidate-frame-${index}.jpg`,
      })),
      null,
      "ko",
      contextPacket(),
    );
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("https://media.example/candidate.wav");
    expect(serialized).toContain("방송 전체 흐름");
  });

  it("rejects legacy candidate requests with fewer than four frames or no context", () => {
    const threeFrames = [1_000, 10_000, 20_000].map((timestampMs, index) => ({
      timestampMs,
      url: `https://media.example/candidate-frame-${index}.jpg`,
    }));
    expect(() =>
      buildCandidatePassBQwenOmniUrlRequestBody(
        "https://media.example/candidate.wav",
        30_000,
        threeFrames,
        null,
        "ko",
        contextPacket(),
      ),
    ).toThrow(RangeError);
    expect(() =>
      buildCandidatePassBQwenOmniRequestBody(
        "AA==",
        30_000,
        [1_000, 10_000, 20_000, 29_000].map((timestampMs, index) => ({
          timestampMs,
          mimeType: "image/jpeg" as const,
          dataBase64: btoa(`frame-${index}`),
        })),
        null,
        "ko",
        null as unknown as CandidatePassBContextPacket,
      ),
    ).toThrow(RangeError);
  });

  it("preserves normal Korean and English context without compaction", () => {
    const koreanContext = contextPacket();
    const englishContext = contextPacket({
      transcriptKo: "I mixed up the two dishes.",
      beforeContextKo: "The streamer was comparing food names.",
      afterContextKo: "She corrected herself and laughed.",
      broadcastSummaryKo:
        "The broadcast followed a food-name quiz and a conversation with chat.",
      topicContextKo: "Food-name quiz",
      fastEvidenceKo: "A short surprised reaction was detected.",
      contextVerdictKo: "The mistake and correction form one complete event.",
      chatReactionKo: "Chat corrected the answer and laughed with the streamer.",
    });

    expect(
      buildCandidatePassBQwenOmniSharedPrompt(
        30_000,
        4,
        null,
        "ko",
        koreanContext,
      ),
    ).toBe(buildCandidatePassBPrompt(30_000, 4, null, "ko", koreanContext));
    expect(
      buildCandidatePassBQwenOmniSharedPrompt(
        30_000,
        4,
        null,
        "en",
        englishContext,
      ),
    ).toBe(buildCandidatePassBPrompt(30_000, 4, null, "en", englishContext));
  });

  it("canonicalizes all seven maximum Korean context fields plus chat without aborting", () => {
    const maximumContext = contextPacket({
      transcriptKo: maximumContextField("대사", "가"),
      beforeContextKo: maximumContextField("직전", "나"),
      afterContextKo: maximumContextField("직후", "다"),
      broadcastSummaryKo: maximumContextField("전체", "라"),
      topicContextKo: maximumContextField("주제", "마"),
      fastEvidenceKo: maximumContextField("탐색", "바"),
      contextVerdictKo: maximumContextField("판정", "사"),
      chatReactionKo: maximumContextField("채팅", "아"),
    });
    const rawPrompt = buildCandidatePassBPrompt(
      60_000,
      4,
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "ko",
      maximumContext,
    );
    expect(new TextEncoder().encode(rawPrompt).byteLength).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
    );
    const firstPrompt = buildCandidatePassBQwenOmniSharedPrompt(
      60_000,
      4,
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "ko",
      maximumContext,
    );
    const secondPrompt = buildCandidatePassBQwenOmniSharedPrompt(
      60_000,
      4,
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "ko",
      maximumContext,
    );
    expect(new TextEncoder().encode(firstPrompt).byteLength).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
    );
    expect(firstPrompt).toBe(rawPrompt);
    expect(secondPrompt).toBe(firstPrompt);
    expect(firstPrompt).toContain(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
    expect(firstPrompt).toContain("대사시작");
    expect(firstPrompt).toContain("대사끝");
    for (const label of ["직전", "직후", "전체", "주제", "탐색", "판정", "채팅"]) {
      expect(firstPrompt).toContain(`${label}시작`);
      expect(firstPrompt).toContain(`${label}끝`);
    }

    const body = buildCandidatePassBQwenOmniRequestBody(
      "AA==",
      60_000,
      [
        { timestampMs: 5_000, mimeType: "image/jpeg", dataBase64: "AQ==" },
        { timestampMs: 15_000, mimeType: "image/jpeg", dataBase64: "Ag==" },
        { timestampMs: 30_000, mimeType: "image/jpeg", dataBase64: "Aw==" },
        { timestampMs: 45_000, mimeType: "image/jpeg", dataBase64: "BA==" },
      ],
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "ko",
      maximumContext,
    );
    expect(body.max_tokens).toBe(2_048);
    expect(JSON.stringify(body.messages[0].content)).toContain(
      "programMaterial",
    );

    const maximumReservation =
      CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES +
      8 * 1024 +
      60 * 7 +
      4 * 400 +
      2_048;
    expect(maximumReservation).toBe(94_180);
    expect(maximumReservation).toBeLessThan(100_000);
  });

  it("keeps a full maximum-length ASCII packet byte-identical when it fits", () => {
    const maximumContext = contextPacket({
      transcriptKo: maximumContextField("transcript", "a"),
      beforeContextKo: maximumContextField("before", "b"),
      afterContextKo: maximumContextField("after", "c"),
      broadcastSummaryKo: maximumContextField("broadcast", "d"),
      topicContextKo: maximumContextField("topic", "e"),
      fastEvidenceKo: maximumContextField("evidence", "f"),
      contextVerdictKo: maximumContextField("verdict", "g"),
      chatReactionKo: maximumContextField("chat", "h"),
    });
    const rawPrompt = buildCandidatePassBPrompt(
      60_000,
      4,
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "en",
      maximumContext,
    );
    expect(new TextEncoder().encode(rawPrompt).byteLength).toBeLessThan(
      CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
    );
    expect(
      buildCandidatePassBQwenOmniSharedPrompt(
        60_000,
        4,
        DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        "en",
        maximumContext,
      ),
    ).toBe(rawPrompt);
    expect(rawPrompt).toContain("chat시작");
    expect(rawPrompt).toContain("chat끝");
  });

  it("builds a bounded English prompt from maximum multibyte Latin fields", () => {
    const maximumContext = contextPacket({
      transcriptKo: maximumContextField("transcript", "é"),
      beforeContextKo: maximumContextField("before", "é"),
      afterContextKo: maximumContextField("after", "é"),
      broadcastSummaryKo: maximumContextField("broadcast", "é"),
      topicContextKo: maximumContextField("topic", "é"),
      fastEvidenceKo: maximumContextField("evidence", "é"),
      contextVerdictKo: maximumContextField("verdict", "é"),
      chatReactionKo: maximumContextField("chat", "é"),
    });
    const prompt = buildCandidatePassBQwenOmniSharedPrompt(
      60_000,
      4,
      DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
      "en",
      maximumContext,
    );

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(
      CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES,
    );
    expect(prompt).toContain("transcript시작");
    expect(prompt).toContain("transcript끝");
    expect(prompt).toContain(CANDIDATE_PASS_B_CONTEXT_OMISSION_MARKER);
  });

  it.each<{
    readonly label: string;
    readonly outputLanguage: "ko" | "en";
    readonly context: CandidatePassBContextPacket;
  }>([
    {
      label: "maximum Korean",
      outputLanguage: "ko",
      context: contextPacket({
        transcriptKo: maximumContextField("대사", "가"),
        beforeContextKo: maximumContextField("직전", "나"),
        afterContextKo: maximumContextField("직후", "다"),
        broadcastSummaryKo: maximumContextField("전체", "라"),
        topicContextKo: maximumContextField("주제", "마"),
        fastEvidenceKo: maximumContextField("탐색", "바"),
        contextVerdictKo: maximumContextField("판정", "사"),
        chatReactionKo: maximumContextField("채팅", "아"),
      }),
    },
    {
      label: "maximum multibyte English",
      outputLanguage: "en",
      context: contextPacket({
        transcriptKo: maximumContextField("transcript", "é"),
        beforeContextKo: maximumContextField("before", "é"),
        afterContextKo: maximumContextField("after", "é"),
        broadcastSummaryKo: maximumContextField("broadcast", "é"),
        topicContextKo: maximumContextField("topic", "é"),
        fastEvidenceKo: maximumContextField("evidence", "é"),
        contextVerdictKo: maximumContextField("verdict", "é"),
        chatReactionKo: maximumContextField("chat", "é"),
      }),
    },
  ])(
    "uses the receipt canonical packet in the Qwen provider prompt: $label",
    ({ outputLanguage, context: rawContext }) => {
      const canonicalContext =
        canonicalizeCandidatePassBContextPacket(rawContext);
      const prompt = buildCandidatePassBQwenOmniSharedPrompt(
        60_000,
        4,
        DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        outputLanguage,
        rawContext,
      );
      const canonicalPrompt = buildCandidatePassBPrompt(
        60_000,
        4,
        DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
        outputLanguage,
        canonicalContext,
      );
      expect(prompt).toBe(canonicalPrompt);
      expect(candidatePassBContextFingerprint(rawContext)).toBe(
        candidatePassBContextFingerprint(canonicalContext),
      );
      expect(
        buildCandidatePassBQwenOmniSharedPrompt(
          60_000,
          4,
          DEFAULT_CANDIDATE_PASS_B_CAST_ROSTER_ID,
          outputLanguage,
          canonicalContext,
        ),
      ).toBe(prompt);
    },
  );

  it("converts a valid SSE result into the hardened candidate envelope", () => {
    const analysis = {
      segments: [{ relativeStartMs: 0, relativeEndMs: 2_000, text: "제가 틀렸어요." }],
      eventSummaryKo: "음식 이름을 잘못 말한 뒤 화면을 다시 보고 자신의 실수를 깨닫는 장면이다.",
      reactionSummaryKo: "스트리머가 잠시 멈춘 뒤 당황하며 잘못을 인정한다.",
      whyGoodClipKo: "사건의 원인과 스트리머의 반응이 짧은 구간 안에서 완결된다.",
      uncertaintiesKo: ["대표 화면 사이의 움직임은 재생 확인이 필요하다."],
      participantPresence: "identified",
      participantSummaryKo: "화면 이름표로 유레카가 진행자인 것을 확인했다.",
      identifiedParticipants: [
        {
          displayName: "유레카",
          role: "streamer",
          evidenceBasis: "on-screen-name",
          evidenceKo: "소개 자막에 유레카라는 이름이 표시된다.",
          confidence: 0.94,
          relativeTimestampMs: 1_000,
          observedFrameIndices: [0],
        },
      ],
      clipDecision: "recommend",
      contextConsistency: "consistent",
      programMaterial: "streamer-event",
    };
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(analysis) }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const envelope = extractCandidatePassBQwenOmniSseResponse(sse, 30_000);
    expect(envelope).not.toBeNull();
    const parsed = extractCandidatePassBGeminiResponse(envelope, 30_000);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.analysis.insight.identifiedParticipants?.[0]).toMatchObject({
        displayName: "유레카",
        evidenceBasis: "on-screen-name",
      });
    }
    for (const field of [
      "segments",
      "identifiedParticipants",
      "clipDecision",
      "contextConsistency",
      "programMaterial",
    ] as const) {
      const malformed: Record<string, unknown> = { ...analysis };
      delete malformed[field];
      const malformedSse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(malformed) }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
        "",
      ].join("\n");
      expect(
        extractCandidatePassBQwenOmniSseResponse(malformedSse, 30_000),
        field,
      ).toBeNull();
    }
  });
});
