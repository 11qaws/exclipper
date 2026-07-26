/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  InputDisposedError,
  UnsupportedInputFormatError,
  type AudioSample,
  type InputAudioTrack,
} from "mediabunny";

import { summarizeCandidatePassBAudioGate } from "./candidatePassBAudioGate";
import {
  CANDIDATE_PASS_B_PROXY_ENDPOINT,
  MAX_CANDIDATE_PASS_B_RESPONSE_BYTES,
  buildCandidatePassBProxyRequestBody,
  classifyCandidatePassBProxyHttpFailure,
  encodeCandidatePassBBase64,
  encodeCandidatePassBPcm16Wav,
  extractCandidatePassBGeminiResponse,
} from "./candidatePassBGemini";
import {
  CANDIDATE_PASS_B_DEVICE,
  CANDIDATE_PASS_B_DTYPE,
  CANDIDATE_PASS_B_GEMINI_MODEL_ID,
  CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
  CANDIDATE_PASS_B_LANGUAGE,
  CANDIDATE_PASS_B_MODEL_ID,
  CANDIDATE_PASS_B_MODEL_REVISION,
  CANDIDATE_PASS_B_QWEN_MODEL_ID,
  CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
  CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
  CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
  CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  CANDIDATE_PASS_B_TASK,
  MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS,
  MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH,
  MAX_CANDIDATE_PASS_B_VIDEO_FRAMES,
  MAX_CANDIDATE_PASS_B_TARGETS,
  candidatePassBWorkerFailureMessage,
  type CandidatePassBCandidateGap,
  type CandidatePassBCandidateGapReason,
  type CandidatePassBCandidateProgress,
  type CandidatePassBModelProgress,
  type CandidatePassBTarget,
  type CandidatePassBTranscriptResult,
  type CandidatePassBWorkerFailureReason,
  type CandidatePassBWorkerIdentity,
  type CandidatePassBWorkerRequest,
  type CandidatePassBWorkerResponse,
  type CandidatePassBWorkerResponsePayload,
} from "./candidatePassBWorkerProtocol";
import { isAnalysisLanguage } from "../domain/analysisLanguage";
import { isCandidatePassBCastRosterId } from "./participantRoster";
import { isCandidatePassBContextPacket } from "./candidateFinalVerification";
import { fetchWithAiQuota } from "./aiQuotaClient";
import {
  isAiQuotaOpaqueId,
  isAiQuotaParticipantId,
} from "./aiQuotaProtocol";

declare const self: DedicatedWorkerGlobalScope;

type AnalyzeRequest = Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-analyze" }
>;

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;
const CANDIDATE_DECODE_RATIO_CEILING = 0.45;
const CANDIDATE_TRANSCRIBE_RATIO = 0.5;
// Keep candidate interpretation parallel, but bounded so a full day's worth of
// candidates does not trigger an unbounded burst of remote AI requests.
const MAX_PARALLEL_GEMINI_REQUESTS = 2;
const PROGRESS_MIN_INTERVAL_MS = 150;
const PROGRESS_MIN_RATIO_STEP = 0.01;

interface ActiveTask {
  readonly identity: CandidatePassBWorkerIdentity;
  readonly quota:
    | { readonly participantId: string; readonly runId: string }
    | undefined;
  cancelled: boolean;
  input: Input<BlobSource> | null;
  inputWasDisposed: boolean;
  /** Candidate requests are kept in a small bounded pool during Pass B. */
  readonly fetchAbortControllers: Set<AbortController>;
}

interface DecodedCandidate {
  readonly pcm: Float32Array;
  readonly decodedOverlapFrameCount: number;
}

class CandidateFailure extends Error {
  public readonly reasonCode: CandidatePassBCandidateGapReason;

  public constructor(
    reasonCode: CandidatePassBCandidateGapReason,
    message: string,
  ) {
    super(message);
    this.name = "CandidateFailure";
    this.reasonCode = reasonCode;
  }
}

class ProxyWorkerFailure extends Error {
  public readonly reasonCode: CandidatePassBWorkerFailureReason;

  public constructor(reasonCode: CandidatePassBWorkerFailureReason) {
    super("Candidate proxy analysis failed.");
    this.name = "ProxyWorkerFailure";
    this.reasonCode = reasonCode;
  }
}

let activeTask: ActiveTask | null = null;
let eventSequence = 0;

function createEventId(taskId: string): string {
  eventSequence += 1;
  const randomId = self.crypto?.randomUUID?.();
  return `${taskId}-${eventSequence}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function postResponse(
  identity: CandidatePassBWorkerIdentity,
  response: CandidatePassBWorkerResponsePayload,
): void {
  const message = {
    ...identity,
    eventId: createEventId(identity.taskId),
    ...response,
  } satisfies CandidatePassBWorkerResponse;
  self.postMessage(message);
}

function postModelProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBModelProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-model-progress",
    progress,
  });
}

function postCandidateProgress(
  identity: CandidatePassBWorkerIdentity,
  progress: CandidatePassBCandidateProgress,
): void {
  postResponse(identity, {
    type: "candidate-pass-b-candidate-progress",
    progress,
  });
}

function sameIdentity(
  left: CandidatePassBWorkerIdentity,
  right: CandidatePassBWorkerIdentity,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.writerEpoch === right.writerEpoch &&
    left.analysisRunId === right.analysisRunId &&
    left.passBRunId === right.passBRunId &&
    left.workerEpoch === right.workerEpoch &&
    left.workerInstanceId === right.workerInstanceId &&
    left.taskId === right.taskId
  );
}

function disposeInputOnce(task: ActiveTask): void {
  if (task.input === null || task.inputWasDisposed) {
    return;
  }
  task.inputWasDisposed = true;
  try {
    task.input.dispose();
  } catch {
    // Cancellation and final cleanup remain best-effort. No source details are logged.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidIdentity(value: unknown): value is CandidatePassBWorkerIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sessionId",
      "writerEpoch",
      "analysisRunId",
      "passBRunId",
      "workerEpoch",
      "workerInstanceId",
      "taskId",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.sessionId) &&
    isNonNegativeSafeInteger(value.writerEpoch) &&
    isNonEmptyString(value.analysisRunId) &&
    isNonEmptyString(value.passBRunId) &&
    isNonNegativeSafeInteger(value.workerEpoch) &&
    isNonEmptyString(value.workerInstanceId) &&
    isNonEmptyString(value.taskId)
  );
}

function isValidTarget(
  value: unknown,
  sourceDurationMs: number,
): value is CandidatePassBTarget {
  if (
    !isRecord(value) ||
    !["candidateId", "startMs", "endMs"].every((key) => key in value) ||
    Object.keys(value).some((key) => ![
      "candidateId",
      "startMs",
      "endMs",
      "videoFrames",
      "context",
      "castRosterId",
      "outputLanguage",
    ].includes(key))
  ) {
    return false;
  }
  const rawFrames = "videoFrames" in value ? value.videoFrames : [];
  if (!Array.isArray(rawFrames) || rawFrames.length > MAX_CANDIDATE_PASS_B_VIDEO_FRAMES) {
    return false;
  }
  if (!rawFrames.every((frame) =>
    isRecord(frame) &&
    hasExactKeys(frame, ["timestampMs", "mimeType", "dataBase64"]) &&
    Number.isSafeInteger(frame.timestampMs) &&
    (frame.timestampMs as number) >= 0 &&
    (frame.timestampMs as number) <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS &&
    frame.mimeType === "image/jpeg" &&
    typeof frame.dataBase64 === "string" &&
    frame.dataBase64.length > 0 &&
    frame.dataBase64.length <= MAX_CANDIDATE_PASS_B_VIDEO_FRAME_BASE64_LENGTH
  )) {
    return false;
  }
  if (
    "context" in value &&
    !isCandidatePassBContextPacket(value.context)
  ) {
    return false;
  }
  if (
    "castRosterId" in value &&
    !isCandidatePassBCastRosterId(value.castRosterId)
  ) {
    return false;
  }
  if (
    "outputLanguage" in value &&
    !isAnalysisLanguage(value.outputLanguage)
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonNegativeSafeInteger(value.startMs) &&
    isNonNegativeSafeInteger(value.endMs) &&
    value.endMs > value.startMs &&
    value.endMs <= sourceDurationMs &&
    value.endMs - value.startMs <= MAX_CANDIDATE_PASS_B_TARGET_DURATION_MS
  );
}

function isValidAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (
    !isRecord(value) ||
    !(
      hasExactKeys(value, [
        "type",
        "identity",
        "file",
        "sourceDurationMs",
        "device",
        "targets",
      ]) ||
      hasExactKeys(value, [
        "type",
        "identity",
        "quota",
        "file",
        "sourceDurationMs",
        "device",
        "targets",
      ])
    )
  ) {
    return false;
  }
  if (
    value.quota !== undefined &&
    (!isRecord(value.quota) ||
      !hasExactKeys(value.quota, ["participantId", "runId"]) ||
      !isAiQuotaParticipantId(value.quota.participantId) ||
      !isAiQuotaOpaqueId(value.quota.runId))
  ) {
    return false;
  }
  if (
    value.type !== "candidate-pass-b-analyze" ||
    !isValidIdentity(value.identity) ||
    !(value.file instanceof File) ||
    !Number.isFinite(value.file.size) ||
    value.file.size < 0 ||
    !isNonNegativeSafeInteger(value.sourceDurationMs) ||
    value.sourceDurationMs <= 0 ||
    value.sourceDurationMs > MAX_CANDIDATE_PASS_B_SOURCE_DURATION_MS ||
    value.device !== CANDIDATE_PASS_B_DEVICE ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > MAX_CANDIDATE_PASS_B_TARGETS
  ) {
    return false;
  }
  const sourceDurationMs = value.sourceDurationMs;
  if (!value.targets.every((target) => isValidTarget(target, sourceDurationMs))) {
    return false;
  }
  const candidateIds = new Set(
    value.targets.map((target) => target.candidateId),
  );
  return candidateIds.size === value.targets.length;
}

function isValidCancelRequest(
  value: unknown,
): value is Extract<
  CandidatePassBWorkerRequest,
  { readonly type: "candidate-pass-b-cancel" }
> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "identity"]) &&
    value.type === "candidate-pass-b-cancel" &&
    isValidIdentity(value.identity)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function candidateGap(
  target: CandidatePassBTarget,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): CandidatePassBCandidateGap {
  return {
    candidateId: target.candidateId,
    sourceStartMs: target.startMs,
    sourceEndMs: target.endMs,
    reasonCode,
    message,
  };
}

function postGap(
  identity: CandidatePassBWorkerIdentity,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): void {
  postCandidateProgress(identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "gap",
    ratio: 1,
  });
  postResponse(identity, {
    type: "candidate-pass-b-candidate-gap",
    gap: candidateGap(target, reasonCode, message),
  });
}

function postAllTargetsAsGaps(
  request: AnalyzeRequest,
  reasonCode: CandidatePassBCandidateGapReason,
  message: string,
): void {
  request.targets.forEach((target, index) => {
    postGap(
      request.identity,
      target,
      index + 1,
      request.targets.length,
      reasonCode,
      message,
    );
  });
  postResponse(request.identity, {
    type: "candidate-pass-b-completed",
    summary: {
      requestedCount: request.targets.length,
      completedCount: 0,
      gapCount: request.targets.length,
    },
  });
}

class CandidatePcmBuilder {
  private channelScratch = new Float32Array(0);
  private monoScratch = new Float32Array(0);
  private nextOutputFrame = 0;
  private decodedOverlapFrameCount = 0;

  public readonly pcm: Float32Array;

  public constructor(private readonly target: CandidatePassBTarget) {
    const durationSeconds = (target.endMs - target.startMs) / 1_000;
    this.pcm = new Float32Array(
      Math.max(1, Math.ceil(durationSeconds * CANDIDATE_PASS_B_SAMPLE_RATE_HZ)),
    );
  }

  public consume(sample: AudioSample): void {
    if (
      sample.numberOfFrames <= 0 ||
      sample.numberOfChannels <= 0 ||
      sample.sampleRate <= 0
    ) {
      return;
    }

    const targetStartSeconds = this.target.startMs / 1_000;
    const targetEndSeconds = this.target.endMs / 1_000;
    const sampleStartSeconds = sample.timestamp;
    const sampleEndSeconds = sample.timestamp + sample.duration;
    const overlapStartSeconds = Math.max(targetStartSeconds, sampleStartSeconds);
    const overlapEndSeconds = Math.min(targetEndSeconds, sampleEndSeconds);
    if (overlapEndSeconds <= overlapStartSeconds) {
      return;
    }

    this.decodedOverlapFrameCount += Math.max(
      1,
      Math.floor((overlapEndSeconds - overlapStartSeconds) * sample.sampleRate),
    );
    this.ensureScratchCapacity(sample.numberOfFrames);
    const channel = this.channelScratch.subarray(0, sample.numberOfFrames);
    const mono = this.monoScratch.subarray(0, sample.numberOfFrames);
    mono.fill(0);

    for (
      let channelIndex = 0;
      channelIndex < sample.numberOfChannels;
      channelIndex += 1
    ) {
      sample.copyTo(channel, {
        planeIndex: channelIndex,
        format: "f32-planar",
      });
      for (
        let frameIndex = 0;
        frameIndex < sample.numberOfFrames;
        frameIndex += 1
      ) {
        const value = channel[frameIndex] ?? 0;
        mono[frameIndex] =
          (mono[frameIndex] ?? 0) +
          (Number.isFinite(value) ? value : 0) / sample.numberOfChannels;
      }
    }

    const firstOutputFrame = clampInteger(
      Math.ceil(
        (Math.max(sampleStartSeconds, targetStartSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    const lastOutputFrameExclusive = clampInteger(
      Math.ceil(
        (Math.min(sampleEndSeconds, targetEndSeconds) - targetStartSeconds) *
          CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
      ),
      0,
      this.pcm.length,
    );
    this.nextOutputFrame = Math.max(this.nextOutputFrame, firstOutputFrame);

    while (this.nextOutputFrame < lastOutputFrameExclusive) {
      const outputTimestampSeconds =
        targetStartSeconds +
        this.nextOutputFrame / CANDIDATE_PASS_B_SAMPLE_RATE_HZ;
      const sourcePosition =
        (outputTimestampSeconds - sampleStartSeconds) * sample.sampleRate;
      if (sourcePosition < 0) {
        this.nextOutputFrame += 1;
        continue;
      }
      if (sourcePosition >= sample.numberOfFrames) {
        break;
      }

      const lowerIndex = Math.floor(sourcePosition);
      const upperIndex = Math.min(sample.numberOfFrames - 1, lowerIndex + 1);
      const interpolation = sourcePosition - lowerIndex;
      const lowerValue = mono[lowerIndex] ?? 0;
      const upperValue = mono[upperIndex] ?? lowerValue;
      this.pcm[this.nextOutputFrame] = clamp(
        lowerValue + (upperValue - lowerValue) * interpolation,
        -1,
        1,
      );
      this.nextOutputFrame += 1;
    }
  }

  public finish(): DecodedCandidate {
    return {
      pcm: this.pcm,
      decodedOverlapFrameCount: this.decodedOverlapFrameCount,
    };
  }

  private ensureScratchCapacity(frameCount: number): void {
    if (this.channelScratch.length >= frameCount) {
      return;
    }
    const capacity = nextPowerOfTwo(frameCount);
    this.channelScratch = new Float32Array(capacity);
    this.monoScratch = new Float32Array(capacity);
  }
}

async function decodeCandidate(
  audioTrack: InputAudioTrack,
  target: CandidatePassBTarget,
  candidateOrdinal: number,
  targetCount: number,
  task: ActiveTask,
): Promise<DecodedCandidate | null> {
  const builder = new CandidatePcmBuilder(target);
  const sink = new AudioSampleSink(audioTrack);
  const targetStartSeconds = target.startMs / 1_000;
  const targetEndSeconds = target.endMs / 1_000;
  let lastRatio = 0;
  let lastPostedAt = 0;

  postCandidateProgress(task.identity, {
    candidateId: target.candidateId,
    candidateOrdinal,
    targetCount,
    stage: "decoding",
    ratio: 0,
  });

  try {
    for await (const sample of sink.samples(targetStartSeconds, targetEndSeconds)) {
      try {
        if (task.cancelled) {
          builder.pcm.fill(0);
          return null;
        }
        builder.consume(sample);
        const decodedThroughSeconds = clamp(
          sample.timestamp + sample.duration,
          targetStartSeconds,
          targetEndSeconds,
        );
        const rangeRatio =
          (decodedThroughSeconds - targetStartSeconds) /
          (targetEndSeconds - targetStartSeconds);
        const nextRatio = clamp(
          rangeRatio * CANDIDATE_DECODE_RATIO_CEILING,
          0,
          CANDIDATE_DECODE_RATIO_CEILING,
        );
        const now = Date.now();
        if (
          nextRatio > lastRatio &&
          (nextRatio - lastRatio >= PROGRESS_MIN_RATIO_STEP ||
            now - lastPostedAt >= PROGRESS_MIN_INTERVAL_MS)
        ) {
          lastRatio = nextRatio;
          lastPostedAt = now;
          postCandidateProgress(task.identity, {
            candidateId: target.candidateId,
            candidateOrdinal,
            targetCount,
            stage: "decoding",
            ratio: round(nextRatio),
          });
        }
      } finally {
        sample.close();
      }
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      builder.pcm.fill(0);
      return null;
    }
    builder.pcm.fill(0);
    if (isUnsupportedAudioCodecError(cause)) {
      throw new CandidateFailure(
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
      );
    }
    throw new CandidateFailure(
      "AUDIO_DECODE_FAILED",
      "이 후보 구간의 오디오를 읽는 중 문제가 생겼어요.",
    );
  }

  if (task.cancelled) {
    builder.pcm.fill(0);
    return null;
  }
  const decoded = builder.finish();
  if (decoded.decodedOverlapFrameCount === 0) {
    decoded.pcm.fill(0);
    throw new CandidateFailure(
      "EMPTY_AUDIO",
      "이 후보 구간에서 읽을 수 있는 오디오를 찾지 못했어요.",
    );
  }
  return decoded;
}

async function analyzeCandidateWithRemoteAi(
  pcm: Float32Array,
  target: CandidatePassBTarget,
  task: ActiveTask,
): Promise<CandidatePassBTranscriptResult | null> {
  const wav = encodeCandidatePassBPcm16Wav(
    pcm,
    CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
  );
  const fetchAbortController = new AbortController();
  task.fetchAbortControllers.add(fetchAbortController);

  try {
    const base64Wav = encodeCandidatePassBBase64(wav);
    const serializedRequest = JSON.stringify(
      buildCandidatePassBProxyRequestBody(
        base64Wav,
        target.endMs - target.startMs,
        target.videoFrames ?? [],
        target.castRosterId ?? null,
        target.outputLanguage ?? "ko",
        target.context ?? null,
      ),
    );

    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: serializedRequest,
        signal: fetchAbortController.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      };
      response =
        task.quota === undefined
          ? await fetch(CANDIDATE_PASS_B_PROXY_ENDPOINT, requestInit)
          : await fetchWithAiQuota(
              CANDIDATE_PASS_B_PROXY_ENDPOINT,
              requestInit,
              {
                participantId: task.quota.participantId,
                runId: task.quota.runId,
                operationId: `candidate-${target.startMs}-${target.endMs}`,
                pool: "candidate",
                signal: fetchAbortController.signal,
              },
            );
    } catch {
      if (task.cancelled || fetchAbortController.signal.aborted) {
        return null;
      }
      throw new ProxyWorkerFailure("PROXY_UNAVAILABLE");
    }

    if (task.cancelled) {
      return null;
    }
    if (!response.ok) {
      let errorPayload: unknown;
      try {
        const rawError = await response.text();
        if (
          new TextEncoder().encode(rawError).byteLength >
          MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
        ) {
          throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
        }
        errorPayload = JSON.parse(rawError);
      } catch (error) {
        if (error instanceof ProxyWorkerFailure) {
          throw error;
        }
        errorPayload = undefined;
      }
      throw new ProxyWorkerFailure(
        classifyCandidatePassBProxyHttpFailure(response.status, errorPayload)
          .reasonCode,
      );
    }

    let rawResponse: string;
    try {
      rawResponse = await response.text();
    } catch {
      if (task.cancelled || fetchAbortController.signal.aborted) {
        return null;
      }
      throw new ProxyWorkerFailure("PROXY_UNAVAILABLE");
    }
    if (task.cancelled) {
      return null;
    }
    if (
      new TextEncoder().encode(rawResponse).byteLength >
      MAX_CANDIDATE_PASS_B_RESPONSE_BYTES
    ) {
      throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
    }

    let responsePayload: unknown;
    try {
      responsePayload = JSON.parse(rawResponse);
    } catch {
      throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
    }
    const parsed = extractCandidatePassBGeminiResponse(
      responsePayload,
      target.endMs - target.startMs,
      target.castRosterId ?? null,
      target.outputLanguage ?? "ko",
    );
    if (!parsed.ok) {
      throw new ProxyWorkerFailure("PROXY_INVALID_RESPONSE");
    }

    const responseModelId = response.headers.get(
      CANDIDATE_PASS_B_RESPONSE_MODEL_ID_HEADER,
    );
    const responseModelRevision = response.headers.get(
      CANDIDATE_PASS_B_RESPONSE_MODEL_REVISION_HEADER,
    );
    const model =
      responseModelId === CANDIDATE_PASS_B_GEMINI_MODEL_ID &&
      responseModelRevision === CANDIDATE_PASS_B_GEMINI_MODEL_REVISION
        ? {
            id: CANDIDATE_PASS_B_GEMINI_MODEL_ID,
            revision: CANDIDATE_PASS_B_GEMINI_MODEL_REVISION,
          }
        : responseModelId === CANDIDATE_PASS_B_QWEN_MODEL_ID &&
            responseModelRevision === CANDIDATE_PASS_B_QWEN_MODEL_REVISION
          ? {
              id: CANDIDATE_PASS_B_QWEN_MODEL_ID,
              revision: CANDIDATE_PASS_B_QWEN_MODEL_REVISION,
            }
          : {
              // Older deployed Workers did not expose model metadata. Preserve
              // their established Qwen identity instead of trusting arbitrary
              // response headers or making an already-paid result unusable.
              id: CANDIDATE_PASS_B_MODEL_ID,
              revision: CANDIDATE_PASS_B_MODEL_REVISION,
            };

    const segments = parsed.analysis.segments.map((segment) => ({
      startMs: target.startMs + segment.relativeStartMs,
      endMs: target.startMs + segment.relativeEndMs,
      text: segment.text,
    }));
    return {
      mode: "candidate-pass-b-transcript",
      candidateId: target.candidateId,
      sourceStartMs: target.startMs,
      sourceEndMs: target.endMs,
      text: segments.map((segment) => segment.text).join(" "),
      segments,
      insight: parsed.analysis.insight,
      model: {
        ...model,
        dtype: CANDIDATE_PASS_B_DTYPE,
        device: CANDIDATE_PASS_B_DEVICE,
      },
      language: CANDIDATE_PASS_B_LANGUAGE,
      task: CANDIDATE_PASS_B_TASK,
      sampleRateHz: CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
    };
  } finally {
    task.fetchAbortControllers.delete(fetchAbortController);
    wav.fill(0);
  }
}

async function openAudioTrack(
  request: AnalyzeRequest,
  task: ActiveTask,
): Promise<InputAudioTrack | null> {
  task.input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(request.file, { maxCacheSize: SOURCE_CACHE_BYTES }),
  });
  if (task.cancelled) {
    return null;
  }
  return task.input.getPrimaryAudioTrack();
}

async function runTask(request: AnalyzeRequest, task: ActiveTask): Promise<void> {
  try {
    let audioTrack: InputAudioTrack | null;
    try {
      audioTrack = await openAudioTrack(request, task);
    } catch (cause) {
      if (task.cancelled || cause instanceof InputDisposedError) {
        return;
      }
      if (cause instanceof UnsupportedInputFormatError) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_CONTAINER",
          "이 영상 형식은 현재 브라우저에서 읽을 수 없어요.",
        );
        return;
      }
      postAllTargetsAsGaps(
        request,
        isUnsupportedAudioCodecError(cause)
          ? "UNSUPPORTED_AUDIO_CODEC"
          : "AUDIO_DECODE_FAILED",
        isUnsupportedAudioCodecError(cause)
          ? "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요."
          : "영상의 오디오를 여는 중 문제가 생겼어요.",
      );
      return;
    }

    if (task.cancelled) {
      return;
    }
    if (audioTrack === null) {
      postAllTargetsAsGaps(
        request,
        "NO_AUDIO_TRACK",
        "이 영상에는 분석할 오디오 트랙이 없어요.",
      );
      return;
    }
    try {
      if (!(await audioTrack.canDecode())) {
        postAllTargetsAsGaps(
          request,
          "UNSUPPORTED_AUDIO_CODEC",
          "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
        );
        return;
      }
    } catch (cause) {
      if (task.cancelled || cause instanceof InputDisposedError) {
        return;
      }
      postAllTargetsAsGaps(
        request,
        "UNSUPPORTED_AUDIO_CODEC",
        "이 브라우저에서 이 영상의 오디오 코덱을 읽을 수 없어요.",
      );
      return;
    }

    postModelProgress(task.identity, {
      stage: "ready",
      ratio: 1,
      loadedBytes: null,
      totalBytes: null,
    });

    let completedCount = 0;
    let gapCount = 0;
    const fatalProxyFailures: ProxyWorkerFailure[] = [];
    const inFlight = new Set<Promise<void>>();
    for (let index = 0; index < request.targets.length; index += 1) {
      if (task.cancelled) {
        return;
      }
      const target = request.targets[index];
      if (target === undefined) {
        continue;
      }
      while (inFlight.size >= MAX_PARALLEL_GEMINI_REQUESTS) {
        if (task.cancelled) {
          return;
        }
        await Promise.race([...inFlight]);
      }
      const candidateOrdinal = index + 1;
      let candidatePcm: Float32Array | null = null;
      try {
        const decoded = await decodeCandidate(
          audioTrack,
          target,
          candidateOrdinal,
          request.targets.length,
          task,
        );
        if (task.cancelled || decoded === null) {
          return;
        }
        candidatePcm = decoded.pcm;
        if (
          !summarizeCandidatePassBAudioGate(
            candidatePcm,
            CANDIDATE_PASS_B_SAMPLE_RATE_HZ,
          ).audible
        ) {
          throw new CandidateFailure(
            "EMPTY_AUDIO",
            "이 후보 구간에서 이어지는 말소리 단서를 찾지 못했어요.",
          );
        }
        postCandidateProgress(task.identity, {
          candidateId: target.candidateId,
          candidateOrdinal,
          targetCount: request.targets.length,
          stage: "transcribing",
          ratio: CANDIDATE_TRANSCRIBE_RATIO,
        });
        const pcmForRequest = candidatePcm;
        candidatePcm = null;
        const requestPromise = (async (): Promise<void> => {
          try {
            const result = await analyzeCandidateWithRemoteAi(
              pcmForRequest,
              target,
              task,
            );
            if (task.cancelled || result === null) {
              return;
            }
            postCandidateProgress(task.identity, {
              candidateId: target.candidateId,
              candidateOrdinal,
              targetCount: request.targets.length,
              stage: "complete",
              ratio: 1,
            });
            postResponse(task.identity, {
              type: "candidate-pass-b-partial-result",
              result,
            });
            completedCount += 1;
          } catch (cause) {
            if (task.cancelled || cause instanceof InputDisposedError) {
              return;
            }
            if (
              cause instanceof ProxyWorkerFailure &&
              cause.reasonCode !== "PROXY_INVALID_RESPONSE"
            ) {
              fatalProxyFailures.push(cause);
              return;
            }
            const failure =
              cause instanceof ProxyWorkerFailure
                ? new CandidateFailure(
                    "TRANSCRIPTION_FAILED",
                    "AI 응답에서 안전하게 후보 설명을 읽지 못했습니다.",
                  )
                : cause instanceof CandidateFailure
                  ? cause
                  : new CandidateFailure(
                      "TRANSCRIPTION_FAILED",
                      "후보 구간을 분석하는 중 문제가 발생했습니다.",
                    );
            postGap(
              task.identity,
              target,
              candidateOrdinal,
              request.targets.length,
              failure.reasonCode,
              failure.message,
            );
            gapCount += 1;
          } finally {
            pcmForRequest.fill(0);
          }
        })();
        inFlight.add(requestPromise);
        void requestPromise.then(
          () => {
            inFlight.delete(requestPromise);
          },
          () => {
            inFlight.delete(requestPromise);
          },
        );
      } catch (cause) {
        if (task.cancelled || cause instanceof InputDisposedError) {
          return;
        }
        const failure =
          cause instanceof ProxyWorkerFailure
            ? new CandidateFailure(
                "TRANSCRIPTION_FAILED",
                "AI 응답에서 안전하게 사용할 대사 단서를 얻지 못했어요.",
              )
            : cause instanceof CandidateFailure
            ? cause
            : new CandidateFailure(
                "TRANSCRIPTION_FAILED",
                "이 후보 구간을 정밀 분석하는 중 문제가 생겼어요.",
              );
        postGap(
          task.identity,
          target,
          candidateOrdinal,
          request.targets.length,
          failure.reasonCode,
          failure.message,
        );
        gapCount += 1;
      } finally {
        if (candidatePcm !== null) {
          candidatePcm.fill(0);
          candidatePcm = null;
        }
      }
    }

    await Promise.all(inFlight);
    const fatalReasonCode = fatalProxyFailures[0]?.reasonCode;
    if (fatalReasonCode !== undefined) {
      throw new ProxyWorkerFailure(fatalReasonCode);
    }

    if (!task.cancelled) {
      postResponse(task.identity, {
        type: "candidate-pass-b-completed",
        summary: {
          requestedCount: request.targets.length,
          completedCount,
          gapCount,
        },
      });
    }
  } catch (cause) {
    if (task.cancelled || cause instanceof InputDisposedError) {
      return;
    }
    const reasonCode =
      cause instanceof ProxyWorkerFailure
        ? cause.reasonCode
        : "UNEXPECTED_WORKER_FAILURE";
    postResponse(task.identity, {
      type: "candidate-pass-b-failed",
      reasonCode,
      message: candidatePassBWorkerFailureMessage(reasonCode),
    });
  } finally {
    for (const controller of task.fetchAbortControllers) {
      controller.abort();
    }
    task.fetchAbortControllers.clear();
    disposeInputOnce(task);
    if (activeTask === task) {
      activeTask = null;
    }
  }
}

function handleCancel(
  request: Extract<
    CandidatePassBWorkerRequest,
    { readonly type: "candidate-pass-b-cancel" }
  >,
): void {
  const task = activeTask;
  if (task !== null && sameIdentity(task.identity, request.identity)) {
    task.cancelled = true;
    for (const controller of task.fetchAbortControllers) {
      controller.abort();
    }
    disposeInputOnce(task);
  }
  postResponse(request.identity, {
    type: "candidate-pass-b-cancel-acknowledged",
  });
}

function isUnsupportedAudioCodecError(cause: unknown): boolean {
  if (
    typeof DOMException !== "undefined" &&
    cause instanceof DOMException &&
    cause.name === "NotSupportedError"
  ) {
    return true;
  }
  if (!(cause instanceof Error)) {
    return false;
  }
  const message = cause.message.toLowerCase();
  return (
    message.includes("cannot be decoded") ||
    message.includes("codec is not supported") ||
    message.includes("unsupported audio codec") ||
    (message.includes("audiodecoder") && message.includes("support"))
  );
}

function nextPowerOfTwo(value: number): number {
  let capacity = 1;
  const target = Math.max(1, Math.ceil(value));
  while (capacity < target) {
    capacity *= 2;
  }
  return capacity;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (isValidCancelRequest(request)) {
    handleCancel(request);
    return;
  }
  if (!isRecord(request) || request.type !== "candidate-pass-b-analyze") {
    return;
  }
  if (!isValidAnalyzeRequest(request)) {
    if (isValidIdentity(request.identity)) {
      postResponse(request.identity, {
        type: "candidate-pass-b-failed",
        reasonCode: "INVALID_REQUEST",
        message: candidatePassBWorkerFailureMessage("INVALID_REQUEST"),
      });
    }
    return;
  }
  if (activeTask !== null) {
    postResponse(request.identity, {
      type: "candidate-pass-b-failed",
      reasonCode: "WORKER_BUSY",
      message: candidatePassBWorkerFailureMessage("WORKER_BUSY"),
    });
    return;
  }

  const task: ActiveTask = {
    identity: request.identity,
    quota: request.quota,
    cancelled: false,
    input: null,
    inputWasDisposed: false,
    fetchAbortControllers: new Set(),
  };
  activeTask = task;
  void runTask(request, task);
});

export {};
