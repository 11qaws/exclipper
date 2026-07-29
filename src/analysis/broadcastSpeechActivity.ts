/**
 * 방송 전사 전에 실행하는 speech-activity의 순수 계획·후처리 계약.
 *
 * 이 모듈은 model을 다운로드하거나 PCM을 읽지 않는다. 호출자는 정확히 한
 * `BroadcastSpeechActivityCellPlan`의 16 kHz mono PCM을 준비해 model에 전달한
 * 뒤 logits만 `postprocessBroadcastSpeechActivityLogits`에 넘긴다. 영속 가능한
 * 반환값에는 PCM, WAV, Base64, logits 또는 embedding이 포함되지 않는다.
 */

export const BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION = "1.0.0" as const;
export const BROADCAST_SPEECH_ACTIVITY_MODEL_ID =
  "onnx-community/pyannote-segmentation-3.0" as const;
export const BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION =
  "733a93b6473d019a773298e08cefa686894b1854" as const;
export const BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE = "q8" as const;
export const BROADCAST_SPEECH_ACTIVITY_TRANSFORMERS_JS_VERSION =
  "3.8.1" as const;
export const BROADCAST_SPEECH_ACTIVITY_MODEL_KEY =
  "onnx-community/pyannote-segmentation-3.0@733a93b6473d019a773298e08cefa686894b1854:q8" as const;

export const BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ = 16_000;
export const BROADCAST_SPEECH_ACTIVITY_CHANNEL_COUNT = 1;
export const BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS = 10_000;
export const BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT = 160_000;
export const BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT = 7;
export const BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID = 0;
/**
 * 이 id는 화자 identity가 아니다. pyannote powerset 출력에서 `0`이 아닌 class는
 * 모두 "한 명 이상의 speaker가 있음"으로만 축약한다.
 */
export const BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS = Object.freeze([
  1, 2, 3, 4, 5, 6,
] as const);
export const BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD = 0.8;
export const BROADCAST_SPEECH_ACTIVITY_MINIMUM_SPEECH_DURATION_MS = 250;
export const BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION =
  "speech-presence-v1" as const;
export const BROADCAST_SPEECH_ACTIVITY_POLICY_KEY =
  "speech-presence-v1:confidence=0.8:min-speech-ms=250:all-frames-no-speaker" as const;
export const BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS =
  12 * 60 * 60 * 1_000;
export const BROADCAST_SPEECH_ACTIVITY_MAX_OUTPUT_FRAME_COUNT = 4_096;

const MAX_OPERATION_ID_LENGTH = 192;
const MAX_ATTEMPT_ORDINAL = 9_999;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/u;

export interface BroadcastSpeechActivityModelManifest {
  readonly library: "@huggingface/transformers";
  readonly libraryVersion:
    typeof BROADCAST_SPEECH_ACTIVITY_TRANSFORMERS_JS_VERSION;
  readonly modelId: typeof BROADCAST_SPEECH_ACTIVITY_MODEL_ID;
  readonly revision: typeof BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION;
  readonly dtype: typeof BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE;
  readonly sampleRateHz: typeof BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ;
  readonly channelCount: typeof BROADCAST_SPEECH_ACTIVITY_CHANNEL_COUNT;
  readonly cellDurationMs:
    typeof BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS;
  readonly inputSampleCount:
    typeof BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT;
  readonly outputClassCount:
    typeof BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT;
  readonly noSpeakerClassId:
    typeof BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID;
  readonly speechClassIds:
    typeof BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS;
}

export const BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST =
  Object.freeze<BroadcastSpeechActivityModelManifest>({
    library: "@huggingface/transformers",
    libraryVersion: BROADCAST_SPEECH_ACTIVITY_TRANSFORMERS_JS_VERSION,
    modelId: BROADCAST_SPEECH_ACTIVITY_MODEL_ID,
    revision: BROADCAST_SPEECH_ACTIVITY_MODEL_REVISION,
    dtype: BROADCAST_SPEECH_ACTIVITY_MODEL_DTYPE,
    sampleRateHz: BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ,
    channelCount: BROADCAST_SPEECH_ACTIVITY_CHANNEL_COUNT,
    cellDurationMs: BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS,
    inputSampleCount: BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT,
    outputClassCount: BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT,
    noSpeakerClassId: BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID,
    speechClassIds: BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS,
  });

export interface BroadcastSpeechActivityDecisionPolicy {
  readonly revision: typeof BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION;
  readonly confidenceThreshold:
    typeof BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD;
  readonly minimumSpeechDurationMs:
    typeof BROADCAST_SPEECH_ACTIVITY_MINIMUM_SPEECH_DURATION_MS;
  /**
   * 하나라도 `speech` 또는 `inconclusive` frame이면 ASR skip을 금지한다.
   * background/music가 speech로 오인되는 경우에도 안전한 방향으로 ASR을 실행한다.
   */
  readonly requireEveryFrameNoSpeakerForSkip: true;
}

export const BROADCAST_SPEECH_ACTIVITY_DECISION_POLICY =
  Object.freeze<BroadcastSpeechActivityDecisionPolicy>({
    revision: BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION,
    confidenceThreshold: BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD,
    minimumSpeechDurationMs:
      BROADCAST_SPEECH_ACTIVITY_MINIMUM_SPEECH_DURATION_MS,
    requireEveryFrameNoSpeakerForSkip: true,
  });

export interface BroadcastSpeechActivityCellPlan {
  readonly cellId: string;
  readonly ordinal: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly validDurationMs: number;
  readonly validSampleCount: number;
  readonly paddedSampleCount: number;
}

export interface BroadcastSpeechActivityPlan {
  readonly schemaVersion:
    typeof BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION;
  readonly modelKey: typeof BROADCAST_SPEECH_ACTIVITY_MODEL_KEY;
  readonly sourceDurationMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly plannedDurationMs: number;
  readonly cells: readonly BroadcastSpeechActivityCellPlan[];
}

export interface BroadcastSpeechActivitySourceRange {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export interface BroadcastSpeechActivityPlanRange {
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export type BroadcastSpeechActivityRuntime = "webgpu" | "wasm";
export type BroadcastSpeechActivityOutcome =
  | "speech"
  | "no-speech"
  | "inconclusive";
export type BroadcastSpeechActivityAsrDisposition =
  | "asr-required"
  | "asr-skippable-confirmed-no-speech";

interface BroadcastSpeechActivityCellReceiptBase {
  readonly schemaVersion:
    typeof BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION;
  readonly modelKey: typeof BROADCAST_SPEECH_ACTIVITY_MODEL_KEY;
  readonly policyKey: typeof BROADCAST_SPEECH_ACTIVITY_POLICY_KEY;
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly cellId: string;
  readonly ordinal: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
}

export interface BroadcastSpeechActivityCompletedCellReceipt
  extends BroadcastSpeechActivityCellReceiptBase {
  readonly status: "completed";
  readonly runtime: BroadcastSpeechActivityRuntime;
  readonly outputFrameCount: number;
  readonly evaluatedFrameCount: number;
  readonly evaluatedDurationMs: number;
  readonly confidentSpeechDurationMs: number;
  readonly confidentNoSpeechDurationMs: number;
  readonly inconclusiveDurationMs: number;
  readonly minimumWinningConfidence: number;
  readonly meanWinningConfidence: number;
  readonly outcome: BroadcastSpeechActivityOutcome;
  readonly asrDisposition: BroadcastSpeechActivityAsrDisposition;
}

export type BroadcastSpeechActivityGapReason =
  | "source-decode-failed"
  | "model-load-failed"
  | "inference-failed"
  | "invalid-model-output"
  | "runtime-unavailable"
  | "cancelled";

export type BroadcastSpeechActivityGapRecovery =
  | "retry-before-next-phase"
  | "user-cancelled";

export interface BroadcastSpeechActivityGapCellReceipt
  extends BroadcastSpeechActivityCellReceiptBase {
  readonly status: "gap";
  readonly runtime: BroadcastSpeechActivityRuntime | null;
  readonly reason: BroadcastSpeechActivityGapReason;
  readonly recovery: BroadcastSpeechActivityGapRecovery;
  readonly asrDisposition: "asr-required";
}

export type BroadcastSpeechActivityCellReceipt =
  | BroadcastSpeechActivityCompletedCellReceipt
  | BroadcastSpeechActivityGapCellReceipt;

export interface BroadcastSpeechActivityCoverage {
  readonly plannedCellCount: number;
  readonly receivedReceiptCount: number;
  readonly completedCellCount: number;
  readonly speechCellCount: number;
  readonly noSpeechCellCount: number;
  readonly inconclusiveCellCount: number;
  readonly gapCellCount: number;
  readonly missingCellCount: number;
  readonly sourceDurationMs: number;
  readonly plannedDurationMs: number;
  readonly analyzedDurationMs: number;
  readonly gapDurationMs: number;
  readonly missingDurationMs: number;
  readonly asrSkippableDurationMs: number;
  readonly asrRequiredDurationMs: number;
  readonly analysisCoverageRatio: number;
  readonly repairRequired: boolean;
  readonly complete: boolean;
}

export interface BroadcastSpeechActivityRunReceipt {
  readonly schemaVersion:
    typeof BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION;
  readonly model: BroadcastSpeechActivityModelManifest;
  readonly policy: BroadcastSpeechActivityDecisionPolicy;
  readonly sourceDurationMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly cells: readonly BroadcastSpeechActivityCellReceipt[];
  readonly coverage: BroadcastSpeechActivityCoverage;
}

export interface PostprocessBroadcastSpeechActivityLogitsInput {
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly runtime: BroadcastSpeechActivityRuntime;
  readonly cell: BroadcastSpeechActivityCellPlan;
  /**
   * `[frame][classId]`. 이 입력은 즉시 집계되고 반환 receipt에 포함되지 않는다.
   */
  readonly logits: readonly (readonly number[])[];
}

export type BroadcastSpeechActivityContractErrorCode =
  | "INVALID_SOURCE_DURATION"
  | "INVALID_PLAN"
  | "INVALID_CELL"
  | "INVALID_FRAME_INDEX"
  | "INVALID_MODEL_OUTPUT"
  | "INVALID_OPERATION"
  | "DUPLICATE_CELL_RECEIPT"
  | "UNKNOWN_CELL_RECEIPT"
  | "INVALID_RECEIPT";

export class BroadcastSpeechActivityContractError extends Error {
  public readonly code: BroadcastSpeechActivityContractErrorCode;

  public constructor(
    code: BroadcastSpeechActivityContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BroadcastSpeechActivityContractError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const canonicalKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === canonicalKeys.length &&
    actualKeys.every((key, index) => key === canonicalKeys[index])
  );
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertSourceDuration(sourceDurationMs: number): void {
  if (
    !Number.isSafeInteger(sourceDurationMs) ||
    sourceDurationMs <= 0 ||
    sourceDurationMs > BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_SOURCE_DURATION",
      "sourceDurationMs must be an integer between 1 ms and 12 hours.",
    );
  }
}

function cellId(sourceStartMs: number, sourceEndMs: number): string {
  return `speech-${sourceStartMs.toString(36)}-${sourceEndMs.toString(36)}`;
}

function createCell(
  ordinal: number,
  sourceStartMs: number,
  sourceEndMs: number,
): BroadcastSpeechActivityCellPlan {
  const validDurationMs = sourceEndMs - sourceStartMs;
  const validSampleCount =
    (validDurationMs * BROADCAST_SPEECH_ACTIVITY_SAMPLE_RATE_HZ) / 1_000;
  return {
    cellId: cellId(sourceStartMs, sourceEndMs),
    ordinal,
    sourceStartMs,
    sourceEndMs,
    validDurationMs,
    validSampleCount,
    paddedSampleCount:
      BROADCAST_SPEECH_ACTIVITY_INPUT_SAMPLE_COUNT - validSampleCount,
  };
}

/**
 * 최대 12시간 source를 빠짐없이 고정 10초 cell로 나눈다. 마지막 cell만 PCM
 * zero-padding이 필요할 수 있으며 그 padding 길이도 metadata로 고정한다.
 */
export function createBroadcastSpeechActivityPlan(
  sourceDurationMs: number,
  sourceRange: BroadcastSpeechActivityPlanRange = {
    sourceStartMs: 0,
    sourceEndMs: sourceDurationMs,
  },
): BroadcastSpeechActivityPlan {
  assertSourceDuration(sourceDurationMs);
  if (
    !Number.isSafeInteger(sourceRange.sourceStartMs) ||
    !Number.isSafeInteger(sourceRange.sourceEndMs) ||
    sourceRange.sourceStartMs < 0 ||
    sourceRange.sourceEndMs <= sourceRange.sourceStartMs ||
    sourceRange.sourceEndMs > sourceDurationMs
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_PLAN",
      "Speech-activity source range must be an exact non-empty source-time fence.",
    );
  }
  const plannedDurationMs =
    sourceRange.sourceEndMs - sourceRange.sourceStartMs;
  const cellCount = Math.ceil(
    plannedDurationMs / BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS,
  );
  const cells = Array.from({ length: cellCount }, (_, ordinal) => {
    const sourceStartMs =
      sourceRange.sourceStartMs +
      ordinal * BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS;
    const sourceEndMs = Math.min(
      sourceRange.sourceEndMs,
      sourceStartMs + BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS,
    );
    return createCell(ordinal, sourceStartMs, sourceEndMs);
  });
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    modelKey: BROADCAST_SPEECH_ACTIVITY_MODEL_KEY,
    sourceDurationMs,
    sourceStartMs: sourceRange.sourceStartMs,
    sourceEndMs: sourceRange.sourceEndMs,
    plannedDurationMs,
    cells,
  };
}

function cellMatches(
  actual: BroadcastSpeechActivityCellPlan,
  expected: BroadcastSpeechActivityCellPlan,
): boolean {
  return (
    actual.cellId === expected.cellId &&
    actual.ordinal === expected.ordinal &&
    actual.sourceStartMs === expected.sourceStartMs &&
    actual.sourceEndMs === expected.sourceEndMs &&
    actual.validDurationMs === expected.validDurationMs &&
    actual.validSampleCount === expected.validSampleCount &&
    actual.paddedSampleCount === expected.paddedSampleCount
  );
}

function assertCell(cell: BroadcastSpeechActivityCellPlan): void {
  if (
    !isSafeIntegerInRange(cell.ordinal, 0, 4_319) ||
    !isSafeIntegerInRange(
      cell.sourceStartMs,
      0,
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS - 1,
    ) ||
    !isSafeIntegerInRange(
      cell.sourceEndMs,
      1,
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
    ) ||
    cell.sourceEndMs <= cell.sourceStartMs ||
    cell.sourceEndMs - cell.sourceStartMs >
      BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS ||
    !cellMatches(
      cell,
      createCell(cell.ordinal, cell.sourceStartMs, cell.sourceEndMs),
    )
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_CELL",
      "Speech-activity cell metadata is not canonical.",
    );
  }
}

/**
 * model output frame을 원본 source-time으로 되돌린다. 마지막 partial cell의
 * padding에만 속하는 frame은 `null`이며 집계에 참여하지 않는다.
 */
export function mapBroadcastSpeechActivityFrameToSourceRange(
  cell: BroadcastSpeechActivityCellPlan,
  frameIndex: number,
  frameCount: number,
): BroadcastSpeechActivitySourceRange | null {
  assertCell(cell);
  if (
    !isSafeIntegerInRange(
      frameCount,
      1,
      BROADCAST_SPEECH_ACTIVITY_MAX_OUTPUT_FRAME_COUNT,
    ) ||
    !isSafeIntegerInRange(frameIndex, 0, frameCount - 1)
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_FRAME_INDEX",
      "frameIndex and frameCount must identify one bounded output frame.",
    );
  }

  const relativeStartMs = Math.round(
    (frameIndex * BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS) / frameCount,
  );
  const relativeEndMs = Math.round(
    ((frameIndex + 1) * BROADCAST_SPEECH_ACTIVITY_CELL_DURATION_MS) /
      frameCount,
  );
  if (relativeStartMs >= cell.validDurationMs) return null;
  return {
    sourceStartMs: cell.sourceStartMs + relativeStartMs,
    sourceEndMs:
      cell.sourceStartMs +
      Math.min(relativeEndMs, cell.validDurationMs),
  };
}

function assertOperation(
  operationId: string,
  attemptOrdinal: number,
): void {
  if (
    operationId.length === 0 ||
    operationId.length > MAX_OPERATION_ID_LENGTH ||
    !IDENTIFIER_PATTERN.test(operationId) ||
    !isSafeIntegerInRange(attemptOrdinal, 0, MAX_ATTEMPT_ORDINAL)
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_OPERATION",
      "operationId or attemptOrdinal is outside the speech-activity contract.",
    );
  }
}

function stableSoftmax(logits: readonly number[]): readonly number[] {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const logit of logits) {
    if (!Number.isFinite(logit)) {
      throw new BroadcastSpeechActivityContractError(
        "INVALID_MODEL_OUTPUT",
        "Every speech-activity logit must be finite.",
      );
    }
    maximum = Math.max(maximum, logit);
  }
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_MODEL_OUTPUT",
      "Speech-activity logits could not be normalized.",
    );
  }
  return exponentials.map((value) => value / denominator);
}

function winningClass(
  probabilities: readonly number[],
): { readonly classId: number; readonly confidence: number } {
  let classId = 0;
  let confidence = probabilities[0] ?? Number.NEGATIVE_INFINITY;
  for (let index = 1; index < probabilities.length; index += 1) {
    const probability = probabilities[index];
    if (probability !== undefined && probability > confidence) {
      classId = index;
      confidence = probability;
    }
  }
  return { classId, confidence };
}

function deriveOutcome(
  evaluatedDurationMs: number,
  confidentSpeechDurationMs: number,
  confidentNoSpeechDurationMs: number,
  inconclusiveDurationMs: number,
): BroadcastSpeechActivityOutcome {
  if (
    confidentSpeechDurationMs >=
    BROADCAST_SPEECH_ACTIVITY_MINIMUM_SPEECH_DURATION_MS
  ) {
    return "speech";
  }
  if (
    confidentSpeechDurationMs === 0 &&
    inconclusiveDurationMs === 0 &&
    confidentNoSpeechDurationMs === evaluatedDurationMs
  ) {
    return "no-speech";
  }
  return "inconclusive";
}

function asrDisposition(
  outcome: BroadcastSpeechActivityOutcome,
): BroadcastSpeechActivityAsrDisposition {
  return outcome === "no-speech"
    ? "asr-skippable-confirmed-no-speech"
    : "asr-required";
}

/**
 * logits를 source-time duration 집계로 즉시 축약한다.
 *
 * `confidenceThreshold`는 winning class 하나에 적용한다. speech class가 여러
 * 개라는 이유만으로 불확실한 확률을 합쳐 speech라고 만들지 않는다. 하지만
 * `speech`와 `inconclusive`는 모두 ASR 대상이라 이 보수성으로 발화를 잃지 않는다.
 */
export function postprocessBroadcastSpeechActivityLogits(
  input: PostprocessBroadcastSpeechActivityLogitsInput,
): BroadcastSpeechActivityCompletedCellReceipt {
  assertOperation(input.operationId, input.attemptOrdinal);
  assertCell(input.cell);
  if (
    input.runtime !== "webgpu" &&
    input.runtime !== "wasm"
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_OPERATION",
      "runtime must be webgpu or wasm.",
    );
  }
  if (
    input.logits.length === 0 ||
    input.logits.length >
      BROADCAST_SPEECH_ACTIVITY_MAX_OUTPUT_FRAME_COUNT
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_MODEL_OUTPUT",
      "Speech-activity output must contain a bounded frame sequence.",
    );
  }

  let evaluatedFrameCount = 0;
  let evaluatedDurationMs = 0;
  let confidentSpeechDurationMs = 0;
  let confidentNoSpeechDurationMs = 0;
  let inconclusiveDurationMs = 0;
  let minimumWinningConfidence = 1;
  let weightedWinningConfidence = 0;

  for (let frameIndex = 0; frameIndex < input.logits.length; frameIndex += 1) {
    const frameLogits = input.logits[frameIndex];
    if (
      frameLogits === undefined ||
      frameLogits.length !==
        BROADCAST_SPEECH_ACTIVITY_OUTPUT_CLASS_COUNT
    ) {
      throw new BroadcastSpeechActivityContractError(
        "INVALID_MODEL_OUTPUT",
        "Every output frame must contain exactly seven logits.",
      );
    }
    const sourceRange = mapBroadcastSpeechActivityFrameToSourceRange(
      input.cell,
      frameIndex,
      input.logits.length,
    );
    if (sourceRange === null) continue;

    const durationMs =
      sourceRange.sourceEndMs - sourceRange.sourceStartMs;
    if (durationMs <= 0) continue;
    const probabilities = stableSoftmax(frameLogits);
    const winner = winningClass(probabilities);

    evaluatedFrameCount += 1;
    evaluatedDurationMs += durationMs;
    minimumWinningConfidence = Math.min(
      minimumWinningConfidence,
      winner.confidence,
    );
    weightedWinningConfidence += winner.confidence * durationMs;

    if (
      winner.confidence <
      BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD
    ) {
      inconclusiveDurationMs += durationMs;
    } else if (
      winner.classId ===
      BROADCAST_SPEECH_ACTIVITY_NO_SPEAKER_CLASS_ID
    ) {
      confidentNoSpeechDurationMs += durationMs;
    } else {
      confidentSpeechDurationMs += durationMs;
    }
  }

  if (
    evaluatedFrameCount === 0 ||
    evaluatedDurationMs !== input.cell.validDurationMs
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_MODEL_OUTPUT",
      "Output frames did not cover the valid source-time part of the cell.",
    );
  }

  const outcome = deriveOutcome(
    evaluatedDurationMs,
    confidentSpeechDurationMs,
    confidentNoSpeechDurationMs,
    inconclusiveDurationMs,
  );
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    status: "completed",
    modelKey: BROADCAST_SPEECH_ACTIVITY_MODEL_KEY,
    policyKey: BROADCAST_SPEECH_ACTIVITY_POLICY_KEY,
    operationId: input.operationId,
    attemptOrdinal: input.attemptOrdinal,
    cellId: input.cell.cellId,
    ordinal: input.cell.ordinal,
    sourceStartMs: input.cell.sourceStartMs,
    sourceEndMs: input.cell.sourceEndMs,
    runtime: input.runtime,
    outputFrameCount: input.logits.length,
    evaluatedFrameCount,
    evaluatedDurationMs,
    confidentSpeechDurationMs,
    confidentNoSpeechDurationMs,
    inconclusiveDurationMs,
    minimumWinningConfidence: roundRatio(minimumWinningConfidence),
    meanWinningConfidence: roundRatio(
      weightedWinningConfidence / evaluatedDurationMs,
    ),
    outcome,
    asrDisposition: asrDisposition(outcome),
  };
}

function recoveryForGapReason(
  reason: BroadcastSpeechActivityGapReason,
): BroadcastSpeechActivityGapRecovery {
  return reason === "cancelled"
    ? "user-cancelled"
    : "retry-before-next-phase";
}

export interface CreateBroadcastSpeechActivityGapReceiptInput {
  readonly operationId: string;
  readonly attemptOrdinal: number;
  readonly runtime: BroadcastSpeechActivityRuntime | null;
  readonly cell: BroadcastSpeechActivityCellPlan;
  readonly reason: BroadcastSpeechActivityGapReason;
}

export function createBroadcastSpeechActivityGapReceipt(
  input: CreateBroadcastSpeechActivityGapReceiptInput,
): BroadcastSpeechActivityGapCellReceipt {
  assertOperation(input.operationId, input.attemptOrdinal);
  assertCell(input.cell);
  if (
    input.runtime !== null &&
    input.runtime !== "webgpu" &&
    input.runtime !== "wasm"
  ) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_OPERATION",
      "runtime must be null, webgpu, or wasm.",
    );
  }
  const gapReasons: readonly BroadcastSpeechActivityGapReason[] = [
    "source-decode-failed",
    "model-load-failed",
    "inference-failed",
    "invalid-model-output",
    "runtime-unavailable",
    "cancelled",
  ];
  if (!gapReasons.includes(input.reason)) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_RECEIPT",
      "Unknown speech-activity gap reason.",
    );
  }
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    status: "gap",
    modelKey: BROADCAST_SPEECH_ACTIVITY_MODEL_KEY,
    policyKey: BROADCAST_SPEECH_ACTIVITY_POLICY_KEY,
    operationId: input.operationId,
    attemptOrdinal: input.attemptOrdinal,
    cellId: input.cell.cellId,
    ordinal: input.cell.ordinal,
    sourceStartMs: input.cell.sourceStartMs,
    sourceEndMs: input.cell.sourceEndMs,
    runtime: input.runtime,
    reason: input.reason,
    recovery: recoveryForGapReason(input.reason),
    asrDisposition: "asr-required",
  };
}

function canonicalReceiptMap(
  plan: BroadcastSpeechActivityPlan,
  receipts: readonly BroadcastSpeechActivityCellReceipt[],
): ReadonlyMap<string, BroadcastSpeechActivityCellReceipt> {
  const plannedIds = new Set(plan.cells.map(({ cellId: id }) => id));
  const receiptByCellId = new Map<
    string,
    BroadcastSpeechActivityCellReceipt
  >();
  const operationIds = new Set<string>();
  for (const receipt of receipts) {
    if (!plannedIds.has(receipt.cellId)) {
      throw new BroadcastSpeechActivityContractError(
        "UNKNOWN_CELL_RECEIPT",
        `Receipt ${receipt.cellId} does not belong to this plan.`,
      );
    }
    if (receiptByCellId.has(receipt.cellId)) {
      throw new BroadcastSpeechActivityContractError(
        "DUPLICATE_CELL_RECEIPT",
        `Cell ${receipt.cellId} has more than one receipt.`,
      );
    }
    if (operationIds.has(receipt.operationId)) {
      throw new BroadcastSpeechActivityContractError(
        "DUPLICATE_CELL_RECEIPT",
        `Operation ${receipt.operationId} was reused for multiple cells.`,
      );
    }
    receiptByCellId.set(receipt.cellId, receipt);
    operationIds.add(receipt.operationId);
  }
  return receiptByCellId;
}

function assertCanonicalPlan(plan: BroadcastSpeechActivityPlan): void {
  const normalized = normalizeBroadcastSpeechActivityPlan(plan);
  if (normalized === null) {
    throw new BroadcastSpeechActivityContractError(
      "INVALID_PLAN",
      "Speech-activity plan is not canonical.",
    );
  }
}

export function aggregateBroadcastSpeechActivityCoverage(
  plan: BroadcastSpeechActivityPlan,
  receipts: readonly BroadcastSpeechActivityCellReceipt[],
): BroadcastSpeechActivityCoverage {
  assertCanonicalPlan(plan);
  const receiptByCellId = canonicalReceiptMap(plan, receipts);

  let completedCellCount = 0;
  let speechCellCount = 0;
  let noSpeechCellCount = 0;
  let inconclusiveCellCount = 0;
  let gapCellCount = 0;
  let missingCellCount = 0;
  let analyzedDurationMs = 0;
  let gapDurationMs = 0;
  let missingDurationMs = 0;
  let asrSkippableDurationMs = 0;

  for (const cell of plan.cells) {
    const receipt = receiptByCellId.get(cell.cellId);
    if (receipt === undefined) {
      missingCellCount += 1;
      missingDurationMs += cell.validDurationMs;
      continue;
    }
    const normalized = normalizeBroadcastSpeechActivityCellReceipt(
      receipt,
      cell,
    );
    if (normalized === null) {
      throw new BroadcastSpeechActivityContractError(
        "INVALID_RECEIPT",
        `Receipt ${receipt.cellId} is malformed or contradicts its cell.`,
      );
    }
    if (normalized.status === "gap") {
      gapCellCount += 1;
      gapDurationMs += cell.validDurationMs;
      continue;
    }

    completedCellCount += 1;
    analyzedDurationMs += cell.validDurationMs;
    if (normalized.outcome === "speech") {
      speechCellCount += 1;
    } else if (normalized.outcome === "no-speech") {
      noSpeechCellCount += 1;
      asrSkippableDurationMs += cell.validDurationMs;
    } else {
      inconclusiveCellCount += 1;
    }
  }

  const repairRequired = gapCellCount > 0 || missingCellCount > 0;
  return {
    plannedCellCount: plan.cells.length,
    receivedReceiptCount: receipts.length,
    completedCellCount,
    speechCellCount,
    noSpeechCellCount,
    inconclusiveCellCount,
    gapCellCount,
    missingCellCount,
    sourceDurationMs: plan.sourceDurationMs,
    plannedDurationMs: plan.plannedDurationMs,
    analyzedDurationMs,
    gapDurationMs,
    missingDurationMs,
    asrSkippableDurationMs,
    asrRequiredDurationMs:
      plan.plannedDurationMs - asrSkippableDurationMs,
    analysisCoverageRatio: roundRatio(
      analyzedDurationMs / plan.plannedDurationMs,
    ),
    repairRequired,
    complete:
      !repairRequired &&
      completedCellCount === plan.cells.length &&
      analyzedDurationMs === plan.plannedDurationMs,
  };
}

/**
 * receipt 순서는 source-time 순으로 canonicalize한다. gap·누락은 ASR skip으로
 * 바뀌지 않으며 `coverage.repairRequired`에 남는다.
 */
export function createBroadcastSpeechActivityRunReceipt(
  plan: BroadcastSpeechActivityPlan,
  receipts: readonly BroadcastSpeechActivityCellReceipt[],
): BroadcastSpeechActivityRunReceipt {
  const coverage = aggregateBroadcastSpeechActivityCoverage(plan, receipts);
  const cells = [...receipts].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    model: BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST,
    policy: BROADCAST_SPEECH_ACTIVITY_DECISION_POLICY,
    sourceDurationMs: plan.sourceDurationMs,
    sourceStartMs: plan.sourceStartMs,
    sourceEndMs: plan.sourceEndMs,
    cells,
    coverage,
  };
}

export function broadcastSpeechActivityCanSkipAsr(
  receipt: BroadcastSpeechActivityCellReceipt,
): boolean {
  return (
    receipt.status === "completed" &&
    receipt.outcome === "no-speech" &&
    receipt.asrDisposition ===
      "asr-skippable-confirmed-no-speech"
  );
}

const PLAN_KEYS = [
  "schemaVersion",
  "modelKey",
  "sourceDurationMs",
  "sourceStartMs",
  "sourceEndMs",
  "plannedDurationMs",
  "cells",
] as const;
const PLAN_CELL_KEYS = [
  "cellId",
  "ordinal",
  "sourceStartMs",
  "sourceEndMs",
  "validDurationMs",
  "validSampleCount",
  "paddedSampleCount",
] as const;
const COMPLETED_RECEIPT_KEYS = [
  "schemaVersion",
  "status",
  "modelKey",
  "policyKey",
  "operationId",
  "attemptOrdinal",
  "cellId",
  "ordinal",
  "sourceStartMs",
  "sourceEndMs",
  "runtime",
  "outputFrameCount",
  "evaluatedFrameCount",
  "evaluatedDurationMs",
  "confidentSpeechDurationMs",
  "confidentNoSpeechDurationMs",
  "inconclusiveDurationMs",
  "minimumWinningConfidence",
  "meanWinningConfidence",
  "outcome",
  "asrDisposition",
] as const;
const GAP_RECEIPT_KEYS = [
  "schemaVersion",
  "status",
  "modelKey",
  "policyKey",
  "operationId",
  "attemptOrdinal",
  "cellId",
  "ordinal",
  "sourceStartMs",
  "sourceEndMs",
  "runtime",
  "reason",
  "recovery",
  "asrDisposition",
] as const;
const MODEL_KEYS = [
  "library",
  "libraryVersion",
  "modelId",
  "revision",
  "dtype",
  "sampleRateHz",
  "channelCount",
  "cellDurationMs",
  "inputSampleCount",
  "outputClassCount",
  "noSpeakerClassId",
  "speechClassIds",
] as const;
const POLICY_KEYS = [
  "revision",
  "confidenceThreshold",
  "minimumSpeechDurationMs",
  "requireEveryFrameNoSpeakerForSkip",
] as const;
const COVERAGE_KEYS = [
  "plannedCellCount",
  "receivedReceiptCount",
  "completedCellCount",
  "speechCellCount",
  "noSpeechCellCount",
  "inconclusiveCellCount",
  "gapCellCount",
  "missingCellCount",
  "sourceDurationMs",
  "plannedDurationMs",
  "analyzedDurationMs",
  "gapDurationMs",
  "missingDurationMs",
  "asrSkippableDurationMs",
  "asrRequiredDurationMs",
  "analysisCoverageRatio",
  "repairRequired",
  "complete",
] as const;
const RUN_RECEIPT_KEYS = [
  "schemaVersion",
  "model",
  "policy",
  "sourceDurationMs",
  "sourceStartMs",
  "sourceEndMs",
  "cells",
  "coverage",
] as const;

function normalizePlanCell(
  value: unknown,
  expected: BroadcastSpeechActivityCellPlan,
): BroadcastSpeechActivityCellPlan | null {
  if (!isRecord(value) || !hasExactKeys(value, PLAN_CELL_KEYS)) return null;
  const candidate: BroadcastSpeechActivityCellPlan = {
    cellId: value.cellId as string,
    ordinal: value.ordinal as number,
    sourceStartMs: value.sourceStartMs as number,
    sourceEndMs: value.sourceEndMs as number,
    validDurationMs: value.validDurationMs as number,
    validSampleCount: value.validSampleCount as number,
    paddedSampleCount: value.paddedSampleCount as number,
  };
  return cellMatches(candidate, expected) ? expected : null;
}

export function normalizeBroadcastSpeechActivityPlan(
  value: unknown,
): BroadcastSpeechActivityPlan | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PLAN_KEYS) ||
    value.schemaVersion !== BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION ||
    value.modelKey !== BROADCAST_SPEECH_ACTIVITY_MODEL_KEY ||
    !isSafeIntegerInRange(
      value.sourceDurationMs,
      1,
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
    ) ||
    !isSafeIntegerInRange(
      value.sourceStartMs,
      0,
      value.sourceDurationMs - 1,
    ) ||
    !isSafeIntegerInRange(
      value.sourceEndMs,
      value.sourceStartMs + 1,
      value.sourceDurationMs,
    ) ||
    value.plannedDurationMs !== value.sourceEndMs - value.sourceStartMs ||
    !Array.isArray(value.cells)
  ) {
    return null;
  }
  const expected = createBroadcastSpeechActivityPlan(value.sourceDurationMs, {
    sourceStartMs: value.sourceStartMs,
    sourceEndMs: value.sourceEndMs,
  });
  if (value.cells.length !== expected.cells.length) return null;
  for (let index = 0; index < expected.cells.length; index += 1) {
    const expectedCell = expected.cells[index];
    if (
      expectedCell === undefined ||
      normalizePlanCell(value.cells[index], expectedCell) === null
    ) {
      return null;
    }
  }
  return expected;
}

function baseReceiptMatches(
  value: Record<string, unknown>,
  expectedCell: BroadcastSpeechActivityCellPlan,
): boolean {
  return (
    value.schemaVersion === BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION &&
    value.modelKey === BROADCAST_SPEECH_ACTIVITY_MODEL_KEY &&
    value.policyKey === BROADCAST_SPEECH_ACTIVITY_POLICY_KEY &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    value.operationId.length <= MAX_OPERATION_ID_LENGTH &&
    IDENTIFIER_PATTERN.test(value.operationId) &&
    isSafeIntegerInRange(
      value.attemptOrdinal,
      0,
      MAX_ATTEMPT_ORDINAL,
    ) &&
    value.cellId === expectedCell.cellId &&
    value.ordinal === expectedCell.ordinal &&
    value.sourceStartMs === expectedCell.sourceStartMs &&
    value.sourceEndMs === expectedCell.sourceEndMs
  );
}

function normalizeCompletedReceipt(
  value: Record<string, unknown>,
  expectedCell: BroadcastSpeechActivityCellPlan,
): BroadcastSpeechActivityCompletedCellReceipt | null {
  if (
    !hasExactKeys(value, COMPLETED_RECEIPT_KEYS) ||
    value.status !== "completed" ||
    !baseReceiptMatches(value, expectedCell) ||
    (value.runtime !== "webgpu" && value.runtime !== "wasm") ||
    !isSafeIntegerInRange(
      value.outputFrameCount,
      1,
      BROADCAST_SPEECH_ACTIVITY_MAX_OUTPUT_FRAME_COUNT,
    ) ||
    !isSafeIntegerInRange(
      value.evaluatedFrameCount,
      1,
      value.outputFrameCount,
    ) ||
    value.evaluatedDurationMs !== expectedCell.validDurationMs ||
    !isSafeIntegerInRange(
      value.confidentSpeechDurationMs,
      0,
      expectedCell.validDurationMs,
    ) ||
    !isSafeIntegerInRange(
      value.confidentNoSpeechDurationMs,
      0,
      expectedCell.validDurationMs,
    ) ||
    !isSafeIntegerInRange(
      value.inconclusiveDurationMs,
      0,
      expectedCell.validDurationMs,
    ) ||
    value.confidentSpeechDurationMs +
      value.confidentNoSpeechDurationMs +
      value.inconclusiveDurationMs !==
      expectedCell.validDurationMs ||
    !isProbability(value.minimumWinningConfidence) ||
    !isProbability(value.meanWinningConfidence) ||
    value.minimumWinningConfidence > value.meanWinningConfidence
  ) {
    return null;
  }

  const outcome = deriveOutcome(
    expectedCell.validDurationMs,
    value.confidentSpeechDurationMs,
    value.confidentNoSpeechDurationMs,
    value.inconclusiveDurationMs,
  );
  if (
    value.outcome !== outcome ||
    value.asrDisposition !== asrDisposition(outcome) ||
    (outcome === "no-speech" &&
      value.minimumWinningConfidence <
        BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD)
  ) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    status: "completed",
    modelKey: BROADCAST_SPEECH_ACTIVITY_MODEL_KEY,
    policyKey: BROADCAST_SPEECH_ACTIVITY_POLICY_KEY,
    operationId: value.operationId as string,
    attemptOrdinal: value.attemptOrdinal as number,
    cellId: expectedCell.cellId,
    ordinal: expectedCell.ordinal,
    sourceStartMs: expectedCell.sourceStartMs,
    sourceEndMs: expectedCell.sourceEndMs,
    runtime: value.runtime,
    outputFrameCount: value.outputFrameCount,
    evaluatedFrameCount: value.evaluatedFrameCount,
    evaluatedDurationMs: expectedCell.validDurationMs,
    confidentSpeechDurationMs: value.confidentSpeechDurationMs,
    confidentNoSpeechDurationMs: value.confidentNoSpeechDurationMs,
    inconclusiveDurationMs: value.inconclusiveDurationMs,
    minimumWinningConfidence: value.minimumWinningConfidence,
    meanWinningConfidence: value.meanWinningConfidence,
    outcome,
    asrDisposition: asrDisposition(outcome),
  };
}

function normalizeGapReceipt(
  value: Record<string, unknown>,
  expectedCell: BroadcastSpeechActivityCellPlan,
): BroadcastSpeechActivityGapCellReceipt | null {
  const reasons: readonly BroadcastSpeechActivityGapReason[] = [
    "source-decode-failed",
    "model-load-failed",
    "inference-failed",
    "invalid-model-output",
    "runtime-unavailable",
    "cancelled",
  ];
  if (
    !hasExactKeys(value, GAP_RECEIPT_KEYS) ||
    value.status !== "gap" ||
    !baseReceiptMatches(value, expectedCell) ||
    (value.runtime !== null &&
      value.runtime !== "webgpu" &&
      value.runtime !== "wasm") ||
    !reasons.includes(value.reason as BroadcastSpeechActivityGapReason) ||
    value.recovery !==
      recoveryForGapReason(value.reason as BroadcastSpeechActivityGapReason) ||
    value.asrDisposition !== "asr-required"
  ) {
    return null;
  }
  return {
    schemaVersion: BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION,
    status: "gap",
    modelKey: BROADCAST_SPEECH_ACTIVITY_MODEL_KEY,
    policyKey: BROADCAST_SPEECH_ACTIVITY_POLICY_KEY,
    operationId: value.operationId as string,
    attemptOrdinal: value.attemptOrdinal as number,
    cellId: expectedCell.cellId,
    ordinal: expectedCell.ordinal,
    sourceStartMs: expectedCell.sourceStartMs,
    sourceEndMs: expectedCell.sourceEndMs,
    runtime: value.runtime,
    reason: value.reason as BroadcastSpeechActivityGapReason,
    recovery: value.recovery as BroadcastSpeechActivityGapRecovery,
    asrDisposition: "asr-required",
  };
}

export function normalizeBroadcastSpeechActivityCellReceipt(
  value: unknown,
  expectedCell: BroadcastSpeechActivityCellPlan,
): BroadcastSpeechActivityCellReceipt | null {
  if (!isRecord(value)) return null;
  if (value.status === "completed") {
    return normalizeCompletedReceipt(value, expectedCell);
  }
  if (value.status === "gap") {
    return normalizeGapReceipt(value, expectedCell);
  }
  return null;
}

function modelManifestMatches(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, MODEL_KEYS)) return false;
  return (
    value.library === BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.library &&
    value.libraryVersion ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.libraryVersion &&
    value.modelId === BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.modelId &&
    value.revision === BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.revision &&
    value.dtype === BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.dtype &&
    value.sampleRateHz ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.sampleRateHz &&
    value.channelCount ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.channelCount &&
    value.cellDurationMs ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.cellDurationMs &&
    value.inputSampleCount ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.inputSampleCount &&
    value.outputClassCount ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.outputClassCount &&
    value.noSpeakerClassId ===
      BROADCAST_SPEECH_ACTIVITY_MODEL_MANIFEST.noSpeakerClassId &&
    Array.isArray(value.speechClassIds) &&
    value.speechClassIds.length ===
      BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS.length &&
    value.speechClassIds.every(
      (classId, index) =>
        classId === BROADCAST_SPEECH_ACTIVITY_SPEECH_CLASS_IDS[index],
    )
  );
}

function decisionPolicyMatches(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, POLICY_KEYS)) return false;
  return (
    value.revision === BROADCAST_SPEECH_ACTIVITY_POLICY_REVISION &&
    value.confidenceThreshold ===
      BROADCAST_SPEECH_ACTIVITY_CONFIDENCE_THRESHOLD &&
    value.minimumSpeechDurationMs ===
      BROADCAST_SPEECH_ACTIVITY_MINIMUM_SPEECH_DURATION_MS &&
    value.requireEveryFrameNoSpeakerForSkip === true
  );
}

function coverageMatches(
  value: unknown,
  expected: BroadcastSpeechActivityCoverage,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, COVERAGE_KEYS)) return false;
  return COVERAGE_KEYS.every((key) => Object.is(value[key], expected[key]));
}

export function normalizeBroadcastSpeechActivityRunReceipt(
  value: unknown,
): BroadcastSpeechActivityRunReceipt | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RUN_RECEIPT_KEYS) ||
    value.schemaVersion !== BROADCAST_SPEECH_ACTIVITY_SCHEMA_VERSION ||
    !modelManifestMatches(value.model) ||
    !decisionPolicyMatches(value.policy) ||
    !isSafeIntegerInRange(
      value.sourceDurationMs,
      1,
      BROADCAST_SPEECH_ACTIVITY_MAX_SOURCE_DURATION_MS,
    ) ||
    !isSafeIntegerInRange(
      value.sourceStartMs,
      0,
      value.sourceDurationMs - 1,
    ) ||
    !isSafeIntegerInRange(
      value.sourceEndMs,
      value.sourceStartMs + 1,
      value.sourceDurationMs,
    ) ||
    !Array.isArray(value.cells)
  ) {
    return null;
  }

  const plan = createBroadcastSpeechActivityPlan(value.sourceDurationMs, {
    sourceStartMs: value.sourceStartMs,
    sourceEndMs: value.sourceEndMs,
  });
  if (value.cells.length > plan.cells.length) return null;
  const expectedCellById = new Map(
    plan.cells.map((cell) => [cell.cellId, cell] as const),
  );
  const normalizedCells: BroadcastSpeechActivityCellReceipt[] = [];
  for (const cellValue of value.cells) {
    if (!isRecord(cellValue) || typeof cellValue.cellId !== "string") {
      return null;
    }
    const expectedCell = expectedCellById.get(cellValue.cellId);
    if (expectedCell === undefined) return null;
    const normalized = normalizeBroadcastSpeechActivityCellReceipt(
      cellValue,
      expectedCell,
    );
    if (normalized === null) return null;
    normalizedCells.push(normalized);
  }

  try {
    const canonical = createBroadcastSpeechActivityRunReceipt(
      plan,
      normalizedCells,
    );
    if (
      !coverageMatches(value.coverage, canonical.coverage) ||
      value.cells.some(
        (cellValue, index) =>
          !isRecord(cellValue) ||
          cellValue.cellId !== canonical.cells[index]?.cellId,
      )
    ) {
      return null;
    }
    return canonical;
  } catch {
    return null;
  }
}

export function isBroadcastSpeechActivityRunReceipt(
  value: unknown,
): value is BroadcastSpeechActivityRunReceipt {
  return normalizeBroadcastSpeechActivityRunReceipt(value) !== null;
}
