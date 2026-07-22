import {
  createBroadcastContextRequest,
  type BroadcastContextRequestInput,
  type BroadcastContextResult,
} from "./broadcastContextProtocol";
import {
  extractBroadcastContextDeepseekResponse,
  MAX_BROADCAST_CONTEXT_DEEPSEEK_RESPONSE_BYTES,
} from "./broadcastContextDeepseek";

export const BROADCAST_CONTEXT_PROXY_ENDPOINT =
  "https://rettohighlight-gemini.11qaws.workers.dev/v1/broadcast-context" as const;

export type BroadcastContextAnalysisMode =
  | "overview"
  | "discovery"
  | "refinement"
  | "selection";

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class BroadcastContextDeepseekClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "PROXY_UNAVAILABLE"
      | "PROXY_REJECTED"
      | "PROXY_INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "BroadcastContextDeepseekClientError";
  }
}

export function parseBroadcastContextProxyResult(
  payload: unknown,
  input: BroadcastContextRequestInput,
): BroadcastContextResult | null {
  let request;
  try {
    request = createBroadcastContextRequest(input);
  } catch {
    return null;
  }
  const parsed = extractBroadcastContextDeepseekResponse(
    { choices: [{ message: { content: JSON.stringify(payload) } }] },
    request,
  );
  return parsed.ok ? parsed.result : null;
}

export async function requestBroadcastContextDeepseek(
  input: BroadcastContextRequestInput,
  options: {
    readonly signal?: AbortSignal;
    readonly fetchImplementation?: FetchImplementation;
    readonly analysisMode?: BroadcastContextAnalysisMode;
  } = {},
): Promise<BroadcastContextResult> {
  let request;
  try {
    request = createBroadcastContextRequest(input);
  } catch {
    throw new BroadcastContextDeepseekClientError(
      "INVALID_INPUT",
      "방송 전체 맥락 자료를 준비하지 못했어요.",
    );
  }

  let response: Response;
  try {
    response = await (options.fetchImplementation ?? fetch)(
      BROADCAST_CONTEXT_PROXY_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDurationMs: request.sourceDurationMs,
          chapters: request.chapters,
          candidates: request.candidates,
          ...(request.castRosterId === null
            ? {}
            : { castRosterId: request.castRosterId }),
          ...(options.analysisMode === undefined || options.analysisMode === "overview"
            ? {}
            : { analysisMode: options.analysisMode }),
        }),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch {
    throw new BroadcastContextDeepseekClientError(
      "PROXY_UNAVAILABLE",
      "방송 전체 맥락 분석 서버에 연결하지 못했어요.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new BroadcastContextDeepseekClientError(
      "PROXY_REJECTED",
      "방송 전체 맥락 분석 요청을 처리하지 못했어요.",
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

  const parsed = parseBroadcastContextProxyResult(payload, input);
  if (parsed === null) {
    throw new BroadcastContextDeepseekClientError(
      "PROXY_INVALID_RESPONSE",
      "방송 전체 맥락 분석 응답 형식을 확인하지 못했어요.",
    );
  }
  return parsed;
}
