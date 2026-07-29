import {
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  CANDIDATE_PASS_B_MAX_OUTPUT_TOKENS,
  buildCandidatePassBPrompt,
  extractCandidatePassBGeminiResponse,
  parseCandidatePassBGeminiAnalysis,
} from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  type CandidatePassBContextPacket,
  type CandidatePassBVideoFrame,
} from "./candidatePassBWorkerProtocol";
import {
  isCandidatePassBCastRosterId,
  type CandidatePassBCastRosterId,
} from "./participantRoster";
import {
  isAnalysisLanguage,
  type AnalysisLanguage,
} from "../domain/analysisLanguage";
import {
  canonicalizeCandidatePassBContextPacket,
} from "./candidatePassBContextBudget";
import { isCandidatePassBContextPacket } from "./candidateFinalVerification";

const MAX_BASE64_WAV_LENGTH = 8 * 1024 * 1024;
export const CANDIDATE_PASS_B_QWEN_MAX_OUTPUT_TOKENS =
  CANDIDATE_PASS_B_MAX_OUTPUT_TOKENS;
/**
 * aiProxy reserves one token for every shared-prompt UTF-8 byte, then adds
 * 8,192 prompt-margin tokens, 2,048 output tokens, and the bounded audio/image
 * reservation. Keeping this part at 80 KiB caps a maximum four-frame,
 * sixty-second candidate at 94,180 reserved tokens, below Qwen's 100k TPM
 * single-request ceiling.
 */
export const CANDIDATE_PASS_B_QWEN_MAX_SHARED_PROMPT_UTF8_BYTES = 80 * 1024;

export interface CandidatePassBQwenOmniRequestBody {
  readonly model: typeof CANDIDATE_PASS_B_QWEN_MODEL_ID;
  readonly messages: readonly [{
    readonly role: "user";
    readonly content: readonly unknown[];
  }];
  readonly stream: true;
  readonly stream_options: { readonly include_usage: true };
  readonly modalities: readonly ["text"];
  readonly max_tokens: typeof CANDIDATE_PASS_B_QWEN_MAX_OUTPUT_TOKENS;
}

export interface CandidatePassBQwenOmniDiagnostics {
  readonly sawStop: boolean;
  readonly textLength: number;
  readonly contentWasString: boolean;
  readonly jsonObject: boolean;
  readonly keys: readonly string[];
  readonly containsHan: boolean;
  readonly containsHangul: boolean;
  readonly segmentCount: number | null;
  readonly participantPresence: string | null;
  readonly participantCount: number | null;
  readonly clipDecision: string | null;
  readonly contextConsistency: string | null;
  readonly programMaterial: string | null;
}

export interface CandidatePassBQwenOmniUrlFrame {
  readonly timestampMs: number;
  readonly url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the exact shared prompt used by both Base64 and staged-URL Qwen
 * transports. Candidate context is canonicalized with the same pure contract
 * used before receipt creation, so the model and receipt describe identical
 * bounded evidence rather than rejecting a legal maximum-size packet.
 */
export function buildCandidatePassBQwenOmniSharedPrompt(
  candidateDurationMs: number,
  frameCount: number,
  castRosterId: CandidatePassBCastRosterId | null = null,
  outputLanguage: AnalysisLanguage = "ko",
  context: CandidatePassBContextPacket | null = null,
): string {
  const canonicalContext = context === null
    ? null
    : canonicalizeCandidatePassBContextPacket(context);
  return buildCandidatePassBPrompt(
    candidateDurationMs,
    frameCount,
    castRosterId,
    outputLanguage,
    canonicalContext,
  );
}

function normalizedQwenJson(
  text: string,
  candidateDurationMs: number,
  outputLanguage: AnalysisLanguage,
): string | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (
    !parseCandidatePassBGeminiAnalysis(
      value,
      candidateDurationMs,
      null,
      outputLanguage,
    ).ok
  ) {
    return null;
  }
  return JSON.stringify(value);
}

function requiredCandidateFrames(
  frames: readonly CandidatePassBVideoFrame[],
  candidateDurationMs: number,
): readonly [
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
  CandidatePassBVideoFrame,
] {
  const values: readonly unknown[] =
    Array.isArray(frames) &&
    frames.length === MAX_CANDIDATE_PASS_B_VIDEO_FRAMES
      ? frames
      : [];
  const normalized: CandidatePassBVideoFrame[] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const timestampMs =
      typeof value.timestampMs === "number" ? value.timestampMs : null;
    const dataBase64 =
      typeof value.dataBase64 === "string" ? value.dataBase64 : null;
    if (
      timestampMs === null ||
      !Number.isSafeInteger(timestampMs) ||
      timestampMs < 0 ||
      timestampMs >= candidateDurationMs ||
      value.mimeType !== "image/jpeg" ||
      dataBase64 === null ||
      dataBase64.length === 0 ||
      dataBase64.length > MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH
    ) {
      throw new RangeError(
        "Candidate analysis requires four valid source-bounded video frames.",
      );
    }
    normalized.push({
      timestampMs,
      mimeType: "image/jpeg",
      dataBase64,
    });
  }
  if (
    normalized.length !== MAX_CANDIDATE_PASS_B_VIDEO_FRAMES ||
    new Set(normalized.map(({ timestampMs }) => timestampMs)).size !==
    MAX_CANDIDATE_PASS_B_VIDEO_FRAMES
  ) {
    throw new RangeError(
      "Candidate analysis requires four distinct source-bounded video frames.",
    );
  }
  return normalized as unknown as readonly [
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
  ];
}

function buildQwenOmniRequestBody(
  audioBase64: string,
  candidateDurationMs: number,
  frames: readonly [
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
    CandidatePassBVideoFrame,
  ],
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket | null,
): CandidatePassBQwenOmniRequestBody {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BASE64_WAV_LENGTH ||
    !Number.isSafeInteger(candidateDurationMs) ||
    candidateDurationMs <= 0 ||
    candidateDurationMs > MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
    (castRosterId !== null && !isCandidatePassBCastRosterId(castRosterId)) ||
    !isAnalysisLanguage(outputLanguage)
  ) {
    throw new RangeError("Invalid Qwen Omni candidate input.");
  }
  const qwenGroundingRules =
    "\n대표 화면에서 실제로 확인되는 것만 서술하세요. 작아서 선명하게 읽히지 않는 글자는 인용하지 말고, 아바타 이미지의 프레임별 차이만으로 몸짓·행동·감정을 단정하지 마세요. 프레임 사이의 움직임과 인과관계는 보이지 않으므로 대사와 화면 양쪽에서 확인되지 않으면 uncertaintiesKo에 남기세요.";
  const responseShape = `\n\n다음 JSON 형식만 출력하세요:\n{"segments":[{"relativeStartMs":0,"relativeEndMs":1000,"text":"실제 한국어 발화"}],"eventSummaryKo":"전체 흐름 속 화면 장면·사건·반응 200~300자","reactionSummaryKo":"관찰한 반응 과정","whyGoodClipKo":"클립 가치 또는 제외 이유","uncertaintiesKo":[],"participantPresence":"identified","participantSummaryKo":"확인된 인물 또는 등장인물 없음","identifiedParticipants":[{"displayName":"화면이나 호명으로 확인한 이름","role":"streamer","evidenceBasis":"on-screen-name","evidenceKo":"화면 자막에 이름이 표시됨","confidence":0.9,"relativeTimestampMs":5000,"observedFrameIndices":[0,1]}],"clipDecision":"recommend","contextConsistency":"consistent","programMaterial":"streamer-event"}`;
  return {
    model: CANDIDATE_PASS_B_QWEN_MODEL_ID,
    messages: [{
      role: "user",
      content: [
        {
          type: "input_audio",
          input_audio: {
            data: `data:;base64,${audioBase64}`,
            format: "wav",
          },
        },
        ...frames.flatMap((frame, index) => [
          {
            type: "text",
            text: `[대표 화면 ${index + 1} · 후보 시작 후 ${(frame.timestampMs / 1_000).toFixed(1)}초]`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${frame.mimeType};base64,${frame.dataBase64}`,
            },
          },
        ]),
        {
          type: "text",
          text: `${buildCandidatePassBQwenOmniSharedPrompt(candidateDurationMs, frames.length, castRosterId, outputLanguage, context)}${qwenGroundingRules}\nDo not mix Chinese or Japanese characters into narrative text.${responseShape}`,
        },
      ],
    }],
    stream: true,
    stream_options: { include_usage: true },
    modalities: ["text"],
    max_tokens: CANDIDATE_PASS_B_QWEN_MAX_OUTPUT_TOKENS,
  };
}

export function buildCandidatePassBQwenOmniRequestBody(
  audioBase64: string,
  candidateDurationMs: number,
  videoFrames: readonly CandidatePassBVideoFrame[],
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket,
): CandidatePassBQwenOmniRequestBody {
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_BASE64_WAV_LENGTH ||
    !Number.isSafeInteger(candidateDurationMs) ||
    candidateDurationMs <= 0 ||
    candidateDurationMs > MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS ||
    !isCandidatePassBContextPacket(context)
  ) {
    throw new RangeError("Invalid Qwen Omni candidate input.");
  }
  const frames = requiredCandidateFrames(videoFrames, candidateDurationMs);
  const canonicalContext = canonicalizeCandidatePassBContextPacket(context);
  return buildQwenOmniRequestBody(
    audioBase64,
    candidateDurationMs,
    frames,
    castRosterId,
    outputLanguage,
    canonicalContext,
  );
}

function boundedHttpsMediaUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RangeError("Candidate media URL must be valid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    value.length > 2_048
  ) {
    throw new RangeError("Candidate media URL must be bounded HTTPS.");
  }
  return value;
}

/**
 * Builds the candidate request with provider-fetched private media.
 *
 * The prompt and response contract intentionally come from the established
 * Base64 builder. Only the five media locations are replaced, preventing the
 * staged transport from drifting away from the direct transport's analysis
 * semantics.
 */
function buildQwenOmniUrlRequestBody(
  audioUrl: string | null,
  candidateDurationMs: number,
  videoFrames: readonly CandidatePassBQwenOmniUrlFrame[],
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket | null,
): CandidatePassBQwenOmniRequestBody {
  const safeAudioUrl =
    audioUrl === null ? null : boundedHttpsMediaUrl(audioUrl);
  if (videoFrames.length !== 4) {
    throw new RangeError("Candidate staged media requires four frames.");
  }
  const safeFrameUrls = videoFrames.map((frame) => ({
    timestampMs: frame.timestampMs,
    url: boundedHttpsMediaUrl(frame.url),
  }));
  const placeholderFrames = requiredCandidateFrames(
    safeFrameUrls.map((frame) => ({
      timestampMs: frame.timestampMs,
      mimeType: "image/jpeg" as const,
      dataBase64: "AAAA",
    })),
    candidateDurationMs,
  );
  const base = buildQwenOmniRequestBody(
    "AAAA",
    candidateDurationMs,
    placeholderFrames,
    castRosterId,
    outputLanguage,
    context,
  );
  let frameIndex = 0;
  const content = base.messages[0].content.flatMap((part) => {
    if (!isRecord(part)) return part;
    if (part.type === "input_audio") {
      if (safeAudioUrl === null) return [];
      return {
        type: "input_audio",
        input_audio: { data: safeAudioUrl, format: "wav" },
      };
    }
    if (part.type === "image_url") {
      const frame = safeFrameUrls[frameIndex];
      frameIndex += 1;
      if (frame === undefined) {
        throw new RangeError("Candidate staged frame order is invalid.");
      }
      return {
        type: "image_url",
        image_url: { url: frame.url },
      };
    }
    return part;
  });
  if (frameIndex !== 4) {
    throw new RangeError("Candidate staged frame count is invalid.");
  }
  return {
    ...base,
    messages: [{ ...base.messages[0], content }],
  };
}

export function buildCandidatePassBQwenOmniUrlRequestBody(
  audioUrl: string,
  candidateDurationMs: number,
  videoFrames: readonly CandidatePassBQwenOmniUrlFrame[],
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket,
): CandidatePassBQwenOmniRequestBody {
  if (!isCandidatePassBContextPacket(context)) {
    throw new RangeError("Invalid Qwen Omni candidate context.");
  }
  return buildQwenOmniUrlRequestBody(
    boundedHttpsMediaUrl(audioUrl),
    candidateDurationMs,
    videoFrames,
    castRosterId,
    outputLanguage,
    canonicalizeCandidatePassBContextPacket(context),
  );
}

/**
 * Pre-context visual inspection intentionally runs before a candidate context
 * packet exists. It is a separate contract and cannot be used for Candidate
 * Pass B publication.
 */
export function buildBroadcastTranscriptVisualQwenOmniUrlRequestBody(
  audioUrl: string | null,
  candidateDurationMs: number,
  videoFrames: readonly CandidatePassBQwenOmniUrlFrame[],
  castRosterId: CandidatePassBCastRosterId | null,
  outputLanguage: AnalysisLanguage,
  context: CandidatePassBContextPacket | null,
): CandidatePassBQwenOmniRequestBody {
  return buildQwenOmniUrlRequestBody(
    audioUrl,
    candidateDurationMs,
    videoFrames,
    castRosterId,
    outputLanguage,
    context === null
      ? null
      : canonicalizeCandidatePassBContextPacket(context),
  );
}

/**
 * Converts Qwen Omni's mandatory SSE stream into the already-hardened Gemini
 * response envelope consumed by the browser worker. No provider text bypasses
 * the existing Korean/timestamp/schema validation.
 */
export function extractCandidatePassBQwenOmniSseResponse(
  value: string,
  candidateDurationMs: number,
  castRosterId: CandidatePassBCastRosterId | null = null,
  outputLanguage: AnalysisLanguage = "ko",
): Record<string, unknown> | null {
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
    if (new TextEncoder().encode(text).byteLength > MAX_CANDIDATE_PASS_B_RESPONSE_BYTES) {
      return null;
    }
  }
  if (!sawStop) return null;
  const normalized = normalizedQwenJson(text, candidateDurationMs, outputLanguage);
  if (normalized === null) return null;
  const envelope = {
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: normalized }] },
    }],
  };
  return extractCandidatePassBGeminiResponse(
    envelope,
    candidateDurationMs,
    castRosterId,
    outputLanguage,
  ).ok
    ? envelope
    : null;
}

export function inspectCandidatePassBQwenOmniSseResponse(
  value: string,
): CandidatePassBQwenOmniDiagnostics {
  let text = "";
  let sawStop = false;
  let contentWasString = true;
  for (const line of typeof value === "string" ? value.split(/\r?\n/gu) : []) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as unknown;
      if (!isRecord(chunk) || !Array.isArray(chunk.choices)) continue;
      for (const rawChoice of chunk.choices) {
        if (!isRecord(rawChoice)) continue;
        if (rawChoice.finish_reason === "stop") sawStop = true;
        if (!isRecord(rawChoice.delta)) continue;
        const content = rawChoice.delta.content;
        if (content !== undefined && typeof content !== "string") {
          contentWasString = false;
        } else if (typeof content === "string") {
          text += content;
        }
      }
    } catch {
      contentWasString = false;
    }
  }
  let jsonObject = false;
  let keys: readonly string[] = [];
  let segmentCount: number | null = null;
  let participantPresence: string | null = null;
  let participantCount: number | null = null;
  let clipDecision: string | null = null;
  let contextConsistency: string | null = null;
  let programMaterial: string | null = null;
  try {
    const parsed = JSON.parse(
      text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""),
    ) as unknown;
    if (isRecord(parsed)) {
      jsonObject = true;
      keys = Object.keys(parsed).sort();
      segmentCount = Array.isArray(parsed.segments)
        ? parsed.segments.length
        : null;
      participantPresence =
        typeof parsed.participantPresence === "string"
          ? parsed.participantPresence
          : null;
      participantCount = Array.isArray(parsed.identifiedParticipants)
        ? parsed.identifiedParticipants.length
        : null;
      clipDecision =
        typeof parsed.clipDecision === "string"
          ? parsed.clipDecision
          : null;
      contextConsistency =
        typeof parsed.contextConsistency === "string"
          ? parsed.contextConsistency
          : null;
      programMaterial =
        typeof parsed.programMaterial === "string"
          ? parsed.programMaterial
          : null;
    }
  } catch {
    // Shape-only diagnostics intentionally omit generated text.
  }
  return {
    sawStop,
    textLength: text.length,
    contentWasString,
    jsonObject,
    keys,
    containsHan: /\p{Script=Han}/u.test(text),
    containsHangul: /\p{Script=Hangul}/u.test(text),
    segmentCount,
    participantPresence,
    participantCount,
    clipDecision,
    contextConsistency,
    programMaterial,
  };
}
