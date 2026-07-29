import { describe, expect, it } from "vitest";
import {
  BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
  BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
  BROADCAST_TRANSCRIPT_QWEN_MODEL_ID,
  BROADCAST_TRANSCRIPT_QWEN_MODEL_REVISION,
  buildBroadcastTranscriptGroqRequestBody,
  buildBroadcastTranscriptQwenOmniUrlRequestBody,
  buildBroadcastTranscriptQwenRequestBody,
  extractBroadcastTranscriptGroqResponse,
  extractBroadcastTranscriptQwenResponse,
  isCompatibleBroadcastTranscriptCheckpointModelRevision,
  parseBroadcastTranscriptQwenProxyRequest,
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
      model: "qwen3.5-omni-flash",
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

  it("builds the documented Korean ASR request without accepting provider controls", () => {
    expect(buildBroadcastTranscriptQwenRequestBody("UklGRg==")).toEqual({
      model: BROADCAST_TRANSCRIPT_QWEN_MODEL_ID,
      input: {
        messages: [
          { role: "system", content: [{ text: "" }] },
          {
            role: "user",
            content: [{ audio: "data:audio/wav;base64,UklGRg==" }],
          },
        ],
      },
      parameters: {
        asr_options: { language: "ko", enable_itn: false },
      },
    });
  });

  it("builds a fixed Korean Groq Whisper request with segment timestamps", () => {
    const request = buildBroadcastTranscriptGroqRequestBody({
      kind: "audio-url",
      audioUrl:
        "https://rettohighlight-gemini.example/v1/broadcast-transcript-media?mediaTicket=bounded",
    });

    expect(request.get("model")).toBe(BROADCAST_TRANSCRIPT_GROQ_MODEL_ID);
    expect(request.get("language")).toBe("ko");
    expect(request.get("response_format")).toBe("verbose_json");
    expect(request.get("timestamp_granularities[]")).toBe("segment");
    expect(request.get("temperature")).toBe("0");
    expect(request.get("url")).toBe(
      "https://rettohighlight-gemini.example/v1/broadcast-transcript-media?mediaTicket=bounded",
    );
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

  it.each([
    "http://example.com/audio.wav",
    "https://user:secret@example.com/audio.wav",
    "https://example.com/audio.wav#fragment",
    "not-a-url",
  ])("rejects unsafe Groq transcript URL %s", (audioUrl) => {
    expect(() =>
      buildBroadcastTranscriptGroqRequestBody({
        kind: "audio-url",
        audioUrl,
      }),
    ).toThrow(RangeError);
  });

  it("validates the exact browser-to-proxy envelope", () => {
    const valid = { audioBase64: "UklGRg==", sourceStartMs: 600_000, durationMs: 90_000 };
    expect(parseBroadcastTranscriptQwenProxyRequest(valid)).toEqual(valid);
    expect(parseBroadcastTranscriptQwenProxyRequest({ ...valid, model: "other" })).toBeNull();
    expect(parseBroadcastTranscriptQwenProxyRequest({ ...valid, durationMs: 90_001 })).toBeNull();
  });

  it("maps a validated provider response back onto the source timeline", () => {
    const result = extractBroadcastTranscriptQwenResponse(
      {
        output: { choices: [
          {
            finish_reason: "stop",
            message: {
              content: [{ text: "  두바이 초콜릿을 먹고 예상 밖의 맛에 놀란다.  " }],
              annotations: [{ type: "audio_info", language: "ko", emotion: "surprised" }],
            },
          },
        ] },
        usage: { seconds: 32 },
      },
      { sourceStartMs: 1_700_000, durationMs: 32_000 },
    );
    expect(result).toMatchObject({
      sourceStartMs: 1_700_000,
      sourceEndMs: 1_732_000,
      textKo: "두바이 초콜릿을 먹고 예상 밖의 맛에 놀란다.",
      detectedLanguage: "ko",
      emotion: "surprised",
      billedSeconds: 32,
    });
  });

  it("validates Groq Korean text and bounded segment timestamps", () => {
    expect(
      extractBroadcastTranscriptGroqResponse(
        {
          task: "transcribe",
          language: "Korean",
          duration: 29.7,
          text: "두바이 초콜릿을 먹고 예상 밖의 맛에 놀란다.",
          segments: [
            {
              id: 0,
              start: 0.2,
              end: 11.4,
              text: "두바이 초콜릿을 먹고",
            },
            {
              id: 1,
              start: 11.4,
              end: 29.7,
              text: "예상 밖의 맛에 놀란다.",
            },
          ],
          x_groq: { id: "request-id-not-forwarded" },
        },
        { sourceStartMs: 1_700_000, durationMs: 30_000 },
      ),
    ).toEqual({
      schemaVersion: "1.0.0",
      modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
      sourceStartMs: 1_700_000,
      sourceEndMs: 1_730_000,
      textKo: "두바이 초콜릿을 먹고 예상 밖의 맛에 놀란다.",
      detectedLanguage: "ko",
      emotion: null,
      billedSeconds: 29.7,
    });
  });

  it("maps a timestamped empty Groq response to the existing no-speech marker", () => {
    expect(
      extractBroadcastTranscriptGroqResponse(
        {
          language: "ko",
          duration: 10,
          text: " ",
          segments: [],
        },
        { sourceStartMs: 0, durationMs: 10_000 },
      ),
    ).toMatchObject({
      textKo: "[대사 없음]",
      detectedLanguage: null,
    });
  });

  it.each([
    {
      language: "english",
      duration: 10,
      text: "안녕하세요.",
      segments: [{ start: 0, end: 1, text: "안녕하세요." }],
    },
    {
      language: "ko",
      duration: 10,
      text: "Hello.",
      segments: [{ start: 0, end: 1, text: "Hello." }],
    },
    {
      language: "ko",
      duration: 10,
      text: "안녕하세요.",
      segments: [{ start: 0, end: 11.1, text: "안녕하세요." }],
    },
  ])("rejects malformed or non-Korean Groq output", (payload) => {
    expect(
      extractBroadcastTranscriptGroqResponse(payload, {
        sourceStartMs: 0,
        durationMs: 10_000,
      }),
    ).toBeNull();
  });

  it("rejects incomplete and overlong provider output", () => {
    expect(extractBroadcastTranscriptQwenResponse({ output: { choices: [] } }, { sourceStartMs: 0, durationMs: 1_000 })).toBeNull();
    expect(
      extractBroadcastTranscriptQwenResponse(
        { output: { choices: [{ finish_reason: "length", message: { content: [{ text: "partial" }] } }] } },
        { sourceStartMs: 0, durationMs: 1_000 },
      ),
    ).toBeNull();
  });

  it("seals the actual provider revisions used by a mixed transcript checkpoint", () => {
    const revision = resolveBroadcastTranscriptCheckpointModelRevision(
      [
        {
          schemaVersion: "1.0.0",
          modelId: BROADCAST_TRANSCRIPT_GROQ_MODEL_ID,
          modelRevision: BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION,
          sourceStartMs: 0,
          sourceEndMs: 30_000,
          textKo: "첫 구간입니다.",
          detectedLanguage: "ko",
          emotion: null,
          billedSeconds: 30,
        },
      ],
      BROADCAST_TRANSCRIPT_QWEN_MODEL_REVISION,
    );

    expect(revision).toContain(BROADCAST_TRANSCRIPT_GROQ_MODEL_REVISION);
    expect(revision).toContain(BROADCAST_TRANSCRIPT_QWEN_MODEL_REVISION);
    expect(isCompatibleBroadcastTranscriptCheckpointModelRevision(revision)).toBe(
      true,
    );
    expect(
      isCompatibleBroadcastTranscriptCheckpointModelRevision(
        `${revision}|unknown-model`,
      ),
    ).toBe(false);
  });
});
