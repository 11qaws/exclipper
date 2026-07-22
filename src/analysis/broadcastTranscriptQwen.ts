export const BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION = "1.0.0" as const;
export const BROADCAST_TRANSCRIPT_QWEN_MODEL_ID = "qwen3-asr-flash" as const;
export const BROADCAST_TRANSCRIPT_QWEN_MODEL_REVISION =
  "qwen3-asr-flash-dashscope-native-reviewed-2026-07-22" as const;
export const BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID = "gemini-3.6-flash" as const;
export const BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION =
  "gemini-3.6-flash-audio-transcript-reviewed-2026-07-22" as const;
export const BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID =
  "qwen3.5-omni-flash" as const;
export const BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION =
  "qwen3.5-omni-flash-audio-transcript-reviewed-2026-07-22" as const;
export const BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION =
  BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION;
export const MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS = 210_000;
export const MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH = 9_500_000;
export const MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH = 20_000;
export const MAX_BROADCAST_TRANSCRIPT_QWEN_RESPONSE_BYTES = 128 * 1024;

export interface BroadcastTranscriptQwenProxyRequest {
  readonly audioBase64: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
}

export interface BroadcastTranscriptQwenResult {
  readonly schemaVersion: typeof BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION;
  readonly modelId:
    | typeof BROADCAST_TRANSCRIPT_QWEN_MODEL_ID
    | typeof BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID
    | typeof BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly textKo: string;
  readonly detectedLanguage: string | null;
  readonly emotion: string | null;
  readonly billedSeconds: number | null;
}

export function isBroadcastTranscriptModelId(
  value: unknown,
): value is BroadcastTranscriptQwenResult["modelId"] {
  return (
    value === BROADCAST_TRANSCRIPT_QWEN_MODEL_ID ||
    value === BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID ||
    value === BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID
  );
}

interface QwenAsrAnnotation {
  readonly language: string | null;
  readonly emotion: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizedOptionalLabel(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 40 ? normalized : null;
}

function normalizedTranscript(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 127 ||
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13)
    ) {
      return null;
    }
  }
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH
    ? normalized
    : null;
}

function readAnnotation(value: unknown): QwenAsrAnnotation {
  if (!Array.isArray(value)) return { language: null, emotion: null };
  for (const entry of value) {
    if (!isRecord(entry) || entry.type !== "audio_info") continue;
    return {
      language: normalizedOptionalLabel(entry.language),
      emotion: normalizedOptionalLabel(entry.emotion),
    };
  }
  return { language: null, emotion: null };
}

function readDashscopeNativeResponse(value: unknown): {
  readonly text: string;
  readonly annotation: QwenAsrAnnotation;
  readonly billedSeconds: number | null;
} | null {
  if (
    !isRecord(value) ||
    !isRecord(value.output) ||
    !Array.isArray(value.output.choices) ||
    value.output.choices.length !== 1
  ) return null;
  const choices: readonly unknown[] = value.output.choices;
  const choice = choices[0];
  if (!isRecord(choice) || choice.finish_reason !== "stop" || !isRecord(choice.message)) return null;
  if (!Array.isArray(choice.message.content) || choice.message.content.length !== 1) return null;
  const contents: readonly unknown[] = choice.message.content;
  const content: unknown = contents[0];
  if (!isRecord(content)) return null;
  const text = normalizedTranscript(content.text);
  if (text === null) return null;
  const usage = isRecord(value.usage) ? value.usage : null;
  const seconds = usage?.seconds;
  return {
    text,
    annotation: readAnnotation(choice.message.annotations),
    billedSeconds:
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
        ? seconds
        : null,
  };
}

/** Builds the fixed server-side request for Alibaba's synchronous DashScope API. */
export function buildBroadcastTranscriptQwenRequestBody(audioBase64: string): unknown {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(audioBase64)
  ) {
    throw new RangeError("Qwen ASR audio must be a bounded Base64 WAV payload.");
  }
  return {
    model: BROADCAST_TRANSCRIPT_QWEN_MODEL_ID,
    input: {
      messages: [
        { role: "system", content: [{ text: "" }] },
        {
          role: "user",
          content: [{ audio: `data:audio/wav;base64,${audioBase64}` }],
        },
      ],
    },
    parameters: {
      asr_options: {
        language: "ko",
        enable_itn: false,
      },
    },
  };
}

const GEMINI_TRANSCRIPT_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    textKo: {
      type: "string",
      description:
        "들리는 한국어 발화를 원문 그대로 적은 전사. 발화가 없으면 정확히 [대사 없음]",
    },
  },
  required: ["textKo"],
});

export function buildBroadcastTranscriptGeminiRequestBody(audioBase64: string): unknown {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(audioBase64)
  ) {
    throw new RangeError("Gemini transcript audio must be a bounded Base64 WAV payload.");
  }
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `이 오디오는 VTuber 스트리머의 한국어 방송 일부입니다. 들리는 발화를 한국어 원문 그대로, 순서와 고유명사를 최대한 보존해 전사하세요. 번역하거나 요약하거나 없는 말을 추측하지 마세요. 음악·효과음뿐이고 사람의 발화가 없다면 textKo를 정확히 "[대사 없음]"으로 작성하세요. 다른 설명은 출력하지 마세요.`,
          },
          { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: "APPLICATION_JSON",
          schema: GEMINI_TRANSCRIPT_RESPONSE_SCHEMA,
        },
      },
      thinkingConfig: { thinkingLevel: "MEDIUM" },
      maxOutputTokens: 4_096,
    },
    store: false,
  };
}

export function buildBroadcastTranscriptQwenOmniRequestBody(audioBase64: string): unknown {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(audioBase64)
  ) {
    throw new RangeError("Qwen Omni transcript audio must be a bounded Base64 WAV payload.");
  }
  return {
    model: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: `data:;base64,${audioBase64}`,
              format: "wav",
            },
          },
          {
            type: "text",
            text: "VTuber 스트리머의 한국어 방송 음성이다. 들리는 발화를 한국어 원문 그대로 순서대로 전사하라. 번역·요약·설명·추측을 하지 말고 전사문만 출력하라. 사람 발화가 없고 음악이나 효과음뿐이면 정확히 [대사 없음]만 출력하라.",
          },
        ],
      },
    ],
    stream: true,
    stream_options: { include_usage: true },
    modalities: ["text"],
  };
}

export function extractBroadcastTranscriptQwenOmniSseResponse(
  value: string,
  request: Pick<BroadcastTranscriptQwenProxyRequest, "sourceStartMs" | "durationMs">,
): BroadcastTranscriptQwenResult | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let text = "";
  let sawStop = false;
  for (const line of value.split(/\r?\n/gu)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      return null;
    }
    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return null;
    if (chunk.choices.length === 0) continue;
    if (chunk.choices.length !== 1 || !isRecord(chunk.choices[0])) return null;
    const choice = chunk.choices[0];
    if (choice.finish_reason === "stop") sawStop = true;
    if (!isRecord(choice.delta)) return null;
    const content = choice.delta.content;
    if (content !== undefined && typeof content !== "string") return null;
    if (typeof content === "string") text += content;
    if (text.length > MAX_BROADCAST_TRANSCRIPT_QWEN_TEXT_LENGTH) return null;
  }
  const normalized = normalizedTranscript(text);
  if (normalized === null || !sawStop || !/\p{Script=Hangul}/u.test(normalized)) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID,
    sourceStartMs: request.sourceStartMs,
    sourceEndMs: request.sourceStartMs + request.durationMs,
    textKo: normalized,
    detectedLanguage: normalized === "[대사 없음]" ? null : "ko",
    emotion: null,
    billedSeconds: null,
  };
}

export function extractBroadcastTranscriptGeminiResponse(
  value: unknown,
  request: Pick<BroadcastTranscriptQwenProxyRequest, "sourceStartMs" | "durationMs">,
): BroadcastTranscriptQwenResult | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length !== 1) {
    return null;
  }
  const candidates: readonly unknown[] = value.candidates;
  const candidate: unknown = candidates[0];
  if (
    !isRecord(candidate) ||
    candidate.finishReason !== "STOP" ||
    !isRecord(candidate.content) ||
    !Array.isArray(candidate.content.parts) ||
    candidate.content.parts.length !== 1 ||
    !isRecord(candidate.content.parts[0]) ||
    typeof candidate.content.parts[0].text !== "string"
  ) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(candidate.content.parts[0].text);
  } catch {
    return null;
  }
  if (!isRecord(payload) || !hasExactKeys(payload, ["textKo"])) return null;
  const text = normalizedTranscript(payload.textKo);
  if (text === null || !/\p{Script=Hangul}/u.test(text)) return null;
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID,
    sourceStartMs: request.sourceStartMs,
    sourceEndMs: request.sourceStartMs + request.durationMs,
    textKo: text,
    detectedLanguage: text === "[대사 없음]" ? null : "ko",
    emotion: null,
    billedSeconds: null,
  };
}

export function parseBroadcastTranscriptQwenProxyRequest(
  value: unknown,
): BroadcastTranscriptQwenProxyRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["audioBase64", "sourceStartMs", "durationMs"]) ||
    typeof value.audioBase64 !== "string" ||
    value.audioBase64.length === 0 ||
    value.audioBase64.length > MAX_BROADCAST_TRANSCRIPT_QWEN_BASE64_LENGTH ||
    !Number.isSafeInteger(value.sourceStartMs) ||
    (value.sourceStartMs as number) < 0 ||
    !Number.isSafeInteger(value.durationMs) ||
    (value.durationMs as number) <= 0 ||
    (value.durationMs as number) > MAX_BROADCAST_TRANSCRIPT_QWEN_DURATION_MS
  ) {
    return null;
  }
  return {
    audioBase64: value.audioBase64,
    sourceStartMs: value.sourceStartMs as number,
    durationMs: value.durationMs as number,
  };
}

export function extractBroadcastTranscriptQwenResponse(
  value: unknown,
  request: Pick<BroadcastTranscriptQwenProxyRequest, "sourceStartMs" | "durationMs">,
): BroadcastTranscriptQwenResult | null {
  const parsed = readDashscopeNativeResponse(value);
  if (parsed === null) return null;
  return {
    schemaVersion: BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION,
    modelId: BROADCAST_TRANSCRIPT_QWEN_MODEL_ID,
    sourceStartMs: request.sourceStartMs,
    sourceEndMs: request.sourceStartMs + request.durationMs,
    textKo: parsed.text,
    detectedLanguage: parsed.annotation.language,
    emotion: parsed.annotation.emotion,
    billedSeconds: parsed.billedSeconds,
  };
}
