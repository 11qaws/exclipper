import {
  BROADCAST_CONTEXT_SCHEMA_VERSION,
  createBroadcastContextRequest,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "./broadcastContextProtocol";
import { compactBroadcastContextChapters } from "./broadcastContextChapterCompaction";
import { rebaseBroadcastParticipantGrounding } from "./broadcastParticipantGrounding";
import {
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
  parseCurrentBroadcastContextResult,
} from "./broadcastContextDeepseek";
import {
  AiQuotaClientError,
  fetchWithAiQuota,
  type AiQuotaClientIdentity,
} from "./aiQuotaClient";

export const BROADCAST_CONTEXT_PROXY_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-context" as const;

export type BroadcastContextAnalysisMode =
  | "overview"
  | "discovery"
  | "refinement"
  | "refinement-fast"
  | "selection";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_BROADCAST_CONTEXT_PROXY_ERROR_BYTES = 2_048;
const PROXY_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const PROXY_FAILURE_KINDS = new Set([
  "timeout",
  "unavailable",
  "outcome-unknown",
  "rate-limited",
  "auth",
  "model-unavailable",
  "response-format",
  "invalid-argument",
  "rejected",
  "invalid-response",
]);

export interface BroadcastContextProxyDiagnosticHeaders {
  readonly "Retry-After"?: string;
  readonly "X-ExClipper-Fallback-Reason"?: string;
  readonly "X-ExClipper-Primary-Failure"?: string;
  readonly "X-ExClipper-Fallback-Failure"?: string;
}

export interface BroadcastContextDeepseekClientErrorDetails {
  readonly status?: number | null;
  readonly proxyErrorCode?: string | null;
  readonly diagnosticHeaders?: BroadcastContextProxyDiagnosticHeaders;
}

export class BroadcastContextDeepseekClientError extends Error {
  public readonly status: number | null;
  public readonly proxyErrorCode: string | null;
  public readonly diagnosticHeaders: BroadcastContextProxyDiagnosticHeaders;

  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "ABORTED"
      | "OUTCOME_UNKNOWN"
      | "PROXY_UNAVAILABLE"
      | "PROXY_REJECTED"
      | "PROXY_INVALID_RESPONSE",
    message: string,
    details: BroadcastContextDeepseekClientErrorDetails = {},
  ) {
    super(message);
    this.name = "BroadcastContextDeepseekClientError";
    this.status = details.status ?? null;
    this.proxyErrorCode = details.proxyErrorCode ?? null;
    this.diagnosticHeaders = Object.freeze({
      ...(details.diagnosticHeaders ?? {}),
    });
  }
}

export type BroadcastContextFailureDisposition =
  | "aborted"
  | "retryable"
  | "outcome-unknown"
  | "fatal";

/**
 * Classifies a failed context unit without guessing whether a paid request can
 * safely be repeated. An ambiguous post-dispatch failure is never an automatic
 * retry; only failures known to happen before dispatch, explicit rate limits,
 * and terminal upstream unavailability enter the repair queue.
 */
export function broadcastContextFailureDisposition(
  error: unknown,
): BroadcastContextFailureDisposition {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof BroadcastContextDeepseekClientError &&
      error.code === "ABORTED")
  ) {
    return "aborted";
  }
  if (!(error instanceof BroadcastContextDeepseekClientError)) {
    return "outcome-unknown";
  }
  if (
    error.code === "OUTCOME_UNKNOWN" ||
    error.proxyErrorCode === "UPSTREAM_OUTCOME_UNKNOWN" ||
    error.proxyErrorCode === "OPERATION_ALREADY_FINISHED"
  ) {
    return "outcome-unknown";
  }
  if (
    error.code === "PROXY_INVALID_RESPONSE" ||
    error.proxyErrorCode === "QUOTA_COORDINATOR_UNAVAILABLE" ||
    error.status === 429 ||
    [
      "QUOTA_QUEUE_FULL",
      "RATE_LIMIT_UNAVAILABLE",
      "REQUEST_BODY_TIMEOUT",
      "UPSTREAM_INVALID_RESPONSE",
      "UPSTREAM_RATE_LIMITED",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_TIMEOUT",
    ].includes(error.proxyErrorCode ?? "")
  ) {
    return "retryable";
  }
  if (error.code === "PROXY_UNAVAILABLE") {
    // A generic transport loss may have happened after dispatch.
    return "outcome-unknown";
  }
  return "fatal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeProxyDiagnosticHeaders(
  headers: Headers,
): BroadcastContextProxyDiagnosticHeaders {
  const diagnostics: {
    "Retry-After"?: string;
    "X-ExClipper-Fallback-Reason"?: string;
    "X-ExClipper-Primary-Failure"?: string;
    "X-ExClipper-Fallback-Failure"?: string;
  } = {};
  const retryAfter = headers.get("Retry-After");
  if (
    retryAfter !== null &&
    /^\d{1,3}$/u.test(retryAfter) &&
    Number(retryAfter) <= 600
  ) {
    diagnostics["Retry-After"] = retryAfter;
  }
  for (const name of [
    "X-ExClipper-Fallback-Reason",
    "X-ExClipper-Primary-Failure",
    "X-ExClipper-Fallback-Failure",
  ] as const) {
    const value = headers.get(name);
    if (value !== null && PROXY_FAILURE_KINDS.has(value)) {
      diagnostics[name] = value;
    }
  }
  return Object.freeze(diagnostics);
}

async function readBoundedProxyErrorCode(
  response: Response,
): Promise<string | null> {
  const contentType = response.headers.get("Content-Type");
  if (
    contentType === null ||
    !/^application\/json(?:\s*;|$)/iu.test(contentType)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (/^\d+$/u.test(declaredLength) === false ||
      Number(declaredLength) > MAX_BROADCAST_CONTEXT_PROXY_ERROR_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BROADCAST_CONTEXT_PROXY_ERROR_BYTES) {
        value.fill(0);
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value.slice());
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
      chunk.fill(0);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } finally {
      bytes.fill(0);
    }
    if (!isRecord(payload) || !isRecord(payload.error)) return null;
    const code = payload.error.code;
    return typeof code === "string" && PROXY_ERROR_CODE_PATTERN.test(code)
      ? code
      : null;
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function proxyFailureMessage(
  status: number,
  proxyErrorCode: string | null,
): string {
  switch (proxyErrorCode) {
    case "UPSTREAM_OUTCOME_UNKNOWN":
      return "AI 응답이 중간에 끊겨 처리 완료 여부를 확인하지 못했어요. 저장된 대사와 탐색 결과는 유지했습니다. 이미 처리됐을 가능성이 있어 다시 시도하면 API 사용량이 추가될 수 있습니다.";
    case "UPSTREAM_INVALID_RESPONSE":
      return "AI가 답변을 보냈지만 맥락 결과 형식이 완전하지 않았어요. 저장된 대사와 탐색 결과는 유지했습니다.";
    case "UPSTREAM_REJECTED":
      return "AI 공급자가 이번 맥락 요청을 처리하지 못했어요. 저장된 근거로 다시 시도할 수 있습니다.";
    case "UPSTREAM_UNAVAILABLE":
      return "AI 공급자 연결이 일시적으로 불안정해 맥락 분석을 마치지 못했어요. 저장된 근거는 그대로 남아 있습니다.";
    case "UPSTREAM_TIMEOUT":
      return "AI 맥락 응답이 제한 시간 안에 끝나지 않았어요. 저장된 근거는 유지했으며 다시 시도할 수 있습니다.";
    case "UPSTREAM_RATE_LIMITED":
      return "AI 요청 한도가 잠시 찼어요. 저장된 근거는 유지했으니 잠시 뒤 다시 시도해 주세요.";
    case "OPERATION_ALREADY_FINISHED":
      return "이 맥락 요청 번호는 이미 종료됐어요. 다시 시도 버튼을 누르면 새 요청 번호로 이어갑니다.";
    default:
      return status === 409
        ? "이 맥락 요청은 이미 종료됐어요. 다시 시도하면 새 요청으로 이어갑니다."
        : "방송 전체 맥락 분석 요청을 처리하지 못했어요. 저장된 근거는 유지했습니다.";
  }
}

function createBoundedBroadcastContextInput(
  input: BroadcastContextRequestInput,
): BroadcastContextRequestInput {
  const chapters = compactBroadcastContextChapters(input.chapters);
  if (chapters !== input.chapters && input.participantGrounding !== undefined) {
    const participantGrounding = rebaseBroadcastParticipantGrounding(
      input.participantGrounding,
      {
        sourceDurationMs: input.sourceDurationMs,
        castRosterId: input.castRosterId,
        chapters: input.chapters,
      },
      {
        sourceDurationMs: input.sourceDurationMs,
        castRosterId: input.castRosterId,
        chapters,
      },
    );
    return {
      sourceDurationMs: input.sourceDurationMs,
      chapters,
      candidates: input.candidates,
      participantGrounding:
        participantGrounding ?? input.participantGrounding,
      castRosterId: input.castRosterId,
      outputLanguage: input.outputLanguage,
    };
  }
  return {
    ...input,
    chapters,
  };
}

export function parseBroadcastContextProxyResult(
  payload: unknown,
  input: BroadcastContextRequestInput,
): BroadcastContextResult | null {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION
  ) {
    return null;
  }
  let request;
  try {
    request = createBroadcastContextRequest(
      createBoundedBroadcastContextInput(input),
    );
  } catch {
    return null;
  }
  return parseCurrentBroadcastContextResult(payload, request);
}

export async function requestBroadcastContextDeepseek(
  input: BroadcastContextRequestInput,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
    readonly analysisMode?: BroadcastContextAnalysisMode;
    readonly quota?: Omit<AiQuotaClientIdentity, "pool">;
  } = {},
): Promise<BroadcastContextResult> {
  let request;
  try {
    request = createBroadcastContextRequest(
      createBoundedBroadcastContextInput(input),
    );
  } catch {
    throw new BroadcastContextDeepseekClientError(
      "INVALID_INPUT",
      "방송 전체 맥락 자료를 준비하지 못했어요.",
    );
  }

  let response: Response;
  const requestBody = JSON.stringify({
    sourceDurationMs: request.sourceDurationMs,
    chapters: request.chapters,
    candidates: request.candidates,
    participantGrounding: request.participantGrounding,
    outputLanguage: request.outputLanguage,
    castRosterId: request.castRosterId,
    ...(options.analysisMode === undefined || options.analysisMode === "overview"
      ? {}
      : { analysisMode: options.analysisMode }),
  });
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  try {
    response =
      options.quota === undefined
        ? await (options.fetchImplementation ?? fetch)(
            BROADCAST_CONTEXT_PROXY_ENDPOINT,
            requestInit,
          )
        : await fetchWithAiQuota(
            BROADCAST_CONTEXT_PROXY_ENDPOINT,
            requestInit,
            {
              ...options.quota,
              pool: "context",
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              ...(options.fetchImplementation === undefined
                ? {}
                : { fetchImplementation: options.fetchImplementation }),
            },
          );
  } catch (error) {
    if (error instanceof AiQuotaClientError) {
      if (error.code === "ABORTED") {
        throw new BroadcastContextDeepseekClientError(
          "ABORTED",
          "방송 전체 맥락 분석을 멈췄어요.",
        );
      }
      if (error.code === "OUTCOME_UNKNOWN") {
        throw new BroadcastContextDeepseekClientError(
          "OUTCOME_UNKNOWN",
          "AI 요청이 전달된 뒤 응답 연결이 끊겨 처리 결과를 확인하지 못했어요. 같은 작업을 자동으로 다시 결제하지 않았습니다.",
          { proxyErrorCode: "UPSTREAM_OUTCOME_UNKNOWN" },
        );
      }
      if (error.code === "COORDINATOR_UNAVAILABLE") {
        throw new BroadcastContextDeepseekClientError(
          "PROXY_UNAVAILABLE",
          "AI 분석 순서 서버에 연결하지 못했어요. 공급자 요청은 시작하지 않았습니다.",
          { proxyErrorCode: "QUOTA_COORDINATOR_UNAVAILABLE" },
        );
      }
      if (error.code === "COORDINATOR_REJECTED") {
        const terminal = error.coordinatorStatus === "terminal";
        const queueFull = error.coordinatorStatus === "queue-full";
        throw new BroadcastContextDeepseekClientError(
          "PROXY_REJECTED",
          terminal
            ? "이 맥락 요청 번호는 이미 종료됐어요. 다시 시도하면 새 요청 번호로 이어갑니다."
            : queueFull
              ? "AI 분석 대기열이 잠시 가득 찼어요. 저장된 근거는 유지했으니 잠시 뒤 다시 시도해 주세요."
              : "현재 AI 분석 작업과 요청 순서가 일치하지 않아요. 새 요청 번호로 다시 시도해 주세요.",
          {
            status: queueFull ? 429 : 409,
            proxyErrorCode: terminal
              ? "OPERATION_ALREADY_FINISHED"
              : queueFull
                ? "QUOTA_QUEUE_FULL"
                : "QUOTA_OPERATION_REJECTED",
          },
        );
      }
    }
    throw new BroadcastContextDeepseekClientError(
      "PROXY_UNAVAILABLE",
      "방송 전체 맥락 분석 서버에 연결하지 못했어요.",
    );
  }
  if (!response.ok) {
    const diagnosticHeaders = readSafeProxyDiagnosticHeaders(response.headers);
    const proxyErrorCode = await readBoundedProxyErrorCode(response);
    throw new BroadcastContextDeepseekClientError(
      "PROXY_REJECTED",
      proxyFailureMessage(response.status, proxyErrorCode),
      {
        status: response.status,
        proxyErrorCode,
        diagnosticHeaders,
      },
    );
  }
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new BroadcastContextDeepseekClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 전체 맥락 분석 응답을 확인하지 못했어요.",
    );
  }

  let payload: unknown;
  try {
    const responseText = await response.text();
    if (
      new TextEncoder().encode(responseText).byteLength >
      MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES
    ) {
      throw new RangeError("response too large");
    }
    payload = JSON.parse(responseText);
  } catch {
    throw new BroadcastContextDeepseekClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 전체 맥락 분석 응답을 확인하지 못했어요.",
    );
  }

  if (
    !isRecord(payload) ||
    payload.schemaVersion !== BROADCAST_CONTEXT_SCHEMA_VERSION
  ) {
    throw new BroadcastContextDeepseekClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 전체 맥락 분석 응답이 현재 스키마가 아니에요.",
    );
  }
  const parsed = parseCurrentBroadcastContextResult(payload, request);
  if (parsed === null) {
    throw new BroadcastContextDeepseekClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 전체 맥락 분석 응답 형식을 확인하지 못했어요.",
    );
  }
  return parsed;
}
