import { describe, expect, it } from "vitest";
import {
  BROADCAST_TRANSCRIPT_CHECKPOINT_MIXED_REVISION_PREFIX,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
  buildBroadcastTranscriptGroqRequestBody,
  buildBroadcastTranscriptQwenOmniRequestBody,
  buildBroadcastTranscriptQwenOmniUrlRequestBody,
  extractBroadcastTranscriptGroqResponse,
  extractBroadcastTranscriptQwenOmniSseResponse,
  isBroadcastTranscriptModelId,
  isCurrentBroadcastTranscriptCheckpointModelRevision,
  resolveBroadcastTranscriptCheckpointModelRevision,
} from "./broadcastTranscriptQwen";

describe("broadcastTranscriptQwen", () => {
  it("builds a bounded HTTPS media URL request without embedding audio bytes", () => {
    const mediaUrl =
      "https://rettohighlight-gemini.example/v1/broadcast-transcript-media/0123456789abcdef0123456789abcdef.wav";
    const request = buildBroadcastTranscriptQwenOmniUrlRequestBody(mediaUrl) as {
      readonly messages: readonly [{
        readonly content: readonly [
          { readonly input_audio: { readonly data: string; readonly format: string } },
          { readonly type: string },
        ];
      }];
    };

    expect(request).toMatchObject({
      model: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      stream: true,
      modalities: ["text"],
    });
    expect(request.messages[0].content[0].input_audio).toEqual({
      data: mediaUrl,
      format: "wav",
    });
    expect(request.messages[0].content[1].type).toBe("text");
  });

  it.each([
    "http://example.com/audio.wav",
    "https://user:secret@example.com/audio.wav",
    "not-a-url",
  ])("rejects unsafe transcript media URL %s", (mediaUrl) => {
    expect(() =>
      buildBroadcastTranscriptQwenOmniUrlRequestBody(mediaUrl),
    ).toThrow(RangeError);
  });

  it("builds the current Qwen Omni Korean transcript request", () => {
    expect(buildBroadcastTranscriptQwenOmniRequestBody("UklGRg==")).toMatchObject({
      model: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      stream: true,
      modalities: ["text"],
      messages: [{
        content: [{
          input_audio: {
            data: "data:;base64,UklGRg==",
            format: "wav",
          },
          type: "input_audio",
        }, {
          type: "text",
        }],
      }],
    });
  });

  it("builds a fixed Korean Groq Whisper request with segment timestamps", () => {
    const audioUrl =
      "https://rettohighlight-gemini.example/v1/broadcast-transcript-media?mediaTicket=bounded";
    const request = buildBroadcastTranscriptGroqRequestBody({
      kind: "audio-url",
      audioUrl,
    });

    expect(request.get("model")).toBe(BROADCAST_TRANSCRIPT_GROQ_MODEL_ID);
    expect(request.get("language")).toBe("ko");
    expect(request.get("response_format")).toBe("verbose_json");
    expect(request.get("timestamp_granularities[]")).toBe("segment");
    expect(request.get("temperature")).toBe("0");
    expect(request.get("url")).toBe(audioUrl);
    expect(request.get("file")).toBeNull();
  });

  it("copies a bounded WAV into the Groq multipart request", async () => {
    const wav = new Uint8Array(44);
    const request = buildBroadcastTranscriptGroqRequestBody({
      kind: "wav-bytes",
      wavBytes: wav,
    });
    const file = request.get("file");

    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/wav");
    expect((file as Blob).size).toBe(44);
    wav.fill(0xff);
    expect(new Uint8Array(await (file as Blob).arrayBuffer())).toEqual(
      new Uint8Array(44),
    );
    expect(request.get("url")).toBeNull();
  });

  it("maps a validated current Qwen Omni response onto the source timeline", () => {
    const result = extractBroadcastTranscriptQwenOmniSseResponse(
      [
        'data: {"choices":[{"delta":{"content":"고구마를 먹고 "},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"예상 밖의 맛에 놀랐다."},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n"),
      { sourceStartMs: 1_700_000, durationMs: 32_000 },
    );

    expect(result).toEqual({
      schemaVersion: "1.0.0",
      modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
      sourceStartMs: 1_700_000,
      sourceEndMs: 1_732_000,
      textKo: "고구마를 먹고 예상 밖의 맛에 놀랐다.",
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: null,
    });
  });

  it("validates Groq Korean text and bounded segment timestamps", () => {
    expect(
      extractBroadcastTranscriptGroqResponse(
        {
          language: "Korean",
          duration: 29.7,
          text: "고구마를 먹고 예상 밖의 맛에 놀랐다.",
          segments: [
            { start: 0.2, end: 11.4, text: "고구마를 먹고" },
            { start: 11.4, end: 29.7, text: "예상 밖의 맛에 놀랐다." },
          ],
        },
        { sourceStartMs: 1_700_000, durationMs: 30_000 },
      ),
    ).toEqual({
      schemaVersion: "1.0.0",
      modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
      modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
      sourceStartMs: 1_700_000,
      sourceEndMs: 1_730_000,
      textKo: "고구마를 먹고 예상 밖의 맛에 놀랐다.",
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 29.7,
      segments: [
        {
          relativeStartMs: 200,
          relativeEndMs: 11_400,
          textKo: "고구마를 먹고",
          noSpeechProbability: null,
          averageLogProbability: null,
        },
        {
          relativeStartMs: 11_400,
          relativeEndMs: 29_700,
          textKo: "예상 밖의 맛에 놀랐다.",
          noSpeechProbability: null,
          averageLogProbability: null,
        },
      ],
    });
  });

  it("preserves bounded Whisper confidence signals for conservative no-speech filtering", () => {
    const result = extractBroadcastTranscriptGroqResponse(
      {
        language: "ko",
        duration: 12,
        text: "음악 소리 뒤에 실제 대사가 들린다.",
        segments: [
          {
            start: 0,
            end: 5,
            text: "음악 소리",
            no_speech_prob: 0.99,
            avg_logprob: -1.2,
          },
          {
            start: 5,
            end: 12,
            text: "뒤에 실제 대사가 들린다.",
            no_speech_prob: 0.65,
            avg_logprob: -0.2,
          },
        ],
      },
      { sourceStartMs: 90_000, durationMs: 12_000 },
    );

    expect(result?.segments).toEqual([
      {
        relativeStartMs: 0,
        relativeEndMs: 5_000,
        textKo: "음악 소리",
        noSpeechProbability: 0.99,
        averageLogProbability: -1.2,
      },
      {
        relativeStartMs: 5_000,
        relativeEndMs: 12_000,
        textKo: "뒤에 실제 대사가 들린다.",
        noSpeechProbability: 0.65,
        averageLogProbability: -0.2,
      },
    ]);
  });

  it("rejects incomplete current Qwen Omni output", () => {
    expect(
      extractBroadcastTranscriptQwenOmniSseResponse(
        'data: {"choices":[{"delta":{"content":"미완성"},"finish_reason":"length"}]}',
        { sourceStartMs: 0, durationMs: 1_000 },
      ),
    ).toBeNull();
  });

  it("seals the current providers used by a mixed transcript checkpoint", () => {
    const revision = resolveBroadcastTranscriptCheckpointModelRevision(
      [{
        schemaVersion: "1.0.0",
        modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
        modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
        sourceStartMs: 0,
        sourceEndMs: 30_000,
        textKo: "첫 구간입니다.",
        detectedLanguage: "ko",
        emotion: null,
        billedSeconds: 30,
      }],
      BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
    );

    expect(revision).toBe(
      `${BROADCAST_TRANSCRIPT_CHECKPOINT_MIXED_REVISION_PREFIX}groq-whisper+qwen-omni`,
    );
    expect(isCurrentBroadcastTranscriptCheckpointModelRevision(revision)).toBe(
      true,
    );
  });

  it("rejects a transcript whose revision does not match its model ID", () => {
    expect(() =>
      resolveBroadcastTranscriptCheckpointModelRevision(
        [{
          schemaVersion: "1.0.0",
          modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
          modelRevision: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION,
          sourceStartMs: 0,
          sourceEndMs: 30_000,
          textKo: "현재 모델 검사",
          detectedLanguage: "ko",
          emotion: null,
          billedSeconds: 30,
        }],
        null,
      ),
    ).toThrow(/does not match/u);
  });

  it("rejects the removed qwen3-asr model and checkpoint revision", () => {
    expect(isBroadcastTranscriptModelId("qwen3-asr-flash")).toBe(false);
    expect(
      isCurrentBroadcastTranscriptCheckpointModelRevision(
        "qwen3-asr-flash-api-reviewed-2026-07-22",
      ),
    ).toBe(false);
  });
});
