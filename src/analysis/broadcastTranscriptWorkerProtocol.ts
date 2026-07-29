import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import type {
  BroadcastTranscriptRouteSelection,
  BroadcastTranscriptVerifiedResult,
} from "./broadcastTranscriptRouteManifest";
import type {
  BroadcastSpeechActivityRunReceipt,
} from "./broadcastSpeechActivity";

export const BROADCAST_TRANSCRIPT_WORKER_VERSION = "2.0.0" as const;
/**
 * 한 실행이 보낼 수 있는 청크 수의 상한.
 *
 * 0.8.5의 30초 완화 실행과 저장된 재개 계획을 읽을 수 있도록 760을 유지한다.
 * 새 0.8.6 계획은 90초 raw WAV라 실제 최악 수가 더 작지만, protocol ceiling을
 * 낮춰 과거 partial checkpoint를 거부할 이유는 없다.
 */
export const MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS = 760;
export const MAX_BROADCAST_TRANSCRIPT_CHUNK_ID_LENGTH = 96;

export function isBroadcastTranscriptChunkId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BROADCAST_TRANSCRIPT_CHUNK_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

export interface BroadcastTranscriptWorkerIdentity {
  readonly taskId: string;
}

export type BroadcastTranscriptQuotaOperationNamespace =
  | "uniform"
  | "event-boost"
  | "refinement";

export interface BroadcastTranscriptQuotaIdentity {
  readonly participantId: string;
  readonly runId: string;
  /**
   * Prevents the same source-fenced chunk from reusing a terminal quota
   * operation when it moves from uniform discovery to event boost or later
   * semantic refinement.
   */
  readonly operationNamespace: BroadcastTranscriptQuotaOperationNamespace;
  /**
   * Exact-input scope for a phase whose source-fenced chunk IDs can be reused
   * after its model, context, caption source, or range plan changes.
   */
  readonly operationScope?: string;
  /** Disjoint generation for the editor attempt and its fragment-repair wave. */
  readonly attemptOrdinal?: number;
}

export function isBroadcastTranscriptQuotaOperationScope(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 32 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

/**
 * Why one requested transcript fragment did not produce a transcript despite
 * requiring ASR. Current 2.0 values are either safe to retry or must remain
 * explicitly blocked until their billing outcome is known. `no-audio` remains
 * only so a 1.6 response can be normalized into an abstention during rollout.
 */
export type BroadcastTranscriptChunkGapReason =
  | "decode-failed"
  /** Legacy 1.6 worker response; 2.0 emits a resolved abstention instead. */
  | "no-audio"
  | "transcription-failed"
  | "rate-limited"
  | "outcome-unknown";

export interface BroadcastTranscriptChunkGap {
  readonly chunkId: string;
  readonly reason: BroadcastTranscriptChunkGapReason;
}

/**
 * A source-fenced fragment that was resolved without a paid ASR request.
 *
 * `no-audio` means decoding produced no audio frames. `no-speech` is stricter:
 * every valid frame in every 10-second VAD cell confidently selected the pinned
 * model's NO_SPEAKER class. Neither outcome belongs in the retry queue.
 */
export type BroadcastTranscriptChunkAbstentionReason =
  | "no-audio"
  | "no-speech";

export type BroadcastTranscriptChunkAbstention =
  | {
      readonly chunkId: string;
      readonly reason: "no-audio";
      readonly speechActivityReceipt: null;
    }
  | {
      readonly chunkId: string;
      readonly reason: "no-speech";
      readonly speechActivityReceipt: BroadcastSpeechActivityRunReceipt;
    };

export type BroadcastTranscriptWorkerRequest =
  | {
      readonly type: "broadcast-transcript-analyze";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly quota?: BroadcastTranscriptQuotaIdentity;
      readonly route: BroadcastTranscriptRouteSelection;
      readonly file: File;
      readonly sourceDurationMs: number;
      readonly chunks: readonly BroadcastContextTranscriptionChunk[];
    }
  | {
      readonly type: "broadcast-transcript-cancel";
      readonly identity: BroadcastTranscriptWorkerIdentity;
    };

export interface BroadcastTranscriptWorkerProgress {
  readonly chunkId: string;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly stage: "decoding" | "transcribing";
  /**
   * 지금 실제로 쓰고 있는 동시 요청 수.
   *
   * 화면이 "동시 N" 으로 보여 주는 값이다. 한때 상수를 화면에 박아 뒀는데, 이제는
   * 실행 중에 오르내리므로 워커가 알려 주지 않으면 화면이 거짓말한다 — 그리고
   * 그 거짓말은 아무 오류도 내지 않는다.
   */
  readonly concurrency: number;
}

export type BroadcastTranscriptWorkerResponse =
  | {
      readonly type: "broadcast-transcript-progress";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly progress: BroadcastTranscriptWorkerProgress;
    }
  | {
      readonly type: "broadcast-transcript-partial";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly chunkId: string;
      readonly result: BroadcastTranscriptVerifiedResult;
    }
  | {
      readonly type: "broadcast-transcript-gap";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly chunkId: string;
      readonly reason: BroadcastTranscriptChunkGapReason;
    }
  | ({
      readonly type: "broadcast-transcript-abstention";
      readonly identity: BroadcastTranscriptWorkerIdentity;
    } & BroadcastTranscriptChunkAbstention)
  | {
      readonly type: "broadcast-transcript-complete";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly requestedCount: number;
      readonly completedCount: number;
      readonly abstentionCount: number;
      readonly gapCount: number;
      /**
       * 동시성이 **어디서 멈췄나.** 예: `동시 7 (8 에서 실패)`.
       *
       * 진행 중에 보이는 "동시 N" 은 스쳐 지나가므로 결론을 알 수 없다. 이 실행이
       * 실제로 어디까지 올라갔고 무엇에 막혔는지가 **처음으로 관측되는 값**이며,
       * 그것을 모르면 다음 고정값도 또 추측이 된다.
       */
      readonly concurrencyOutcome: string;
    }
  | {
      readonly type: "broadcast-transcript-cancelled";
      readonly identity: BroadcastTranscriptWorkerIdentity;
    }
  | {
      readonly type: "broadcast-transcript-failed";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly reason: "invalid-input" | "unsupported-source" | "worker-failed";
    };
