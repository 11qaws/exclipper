import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import type { BroadcastTranscriptQwenResult } from "./broadcastTranscriptQwen";

export const BROADCAST_TRANSCRIPT_WORKER_VERSION = "1.4.0" as const;
/**
 * 한 실행이 보낼 수 있는 청크 수의 상한.
 *
 * 0.8.5의 30초 완화 실행과 저장된 재개 계획을 읽을 수 있도록 760을 유지한다.
 * 새 0.8.6 계획은 90초 raw WAV라 실제 최악 수가 더 작지만, protocol ceiling을
 * 낮춰 과거 partial checkpoint를 거부할 이유는 없다.
 */
export const MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS = 760;

export interface BroadcastTranscriptWorkerIdentity {
  readonly taskId: string;
}

export interface BroadcastTranscriptQuotaIdentity {
  readonly participantId: string;
  readonly runId: string;
  /** Increments only after the editor explicitly retries a partial/failed run. */
  readonly attemptOrdinal?: number;
}

export type BroadcastTranscriptWorkerRequest =
  | {
      readonly type: "broadcast-transcript-analyze";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly quota?: BroadcastTranscriptQuotaIdentity;
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
      readonly result: BroadcastTranscriptQwenResult;
    }
  | {
      readonly type: "broadcast-transcript-gap";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly chunkId: string;
      readonly reason: "decode-failed" | "no-audio" | "transcription-failed";
    }
  | {
      readonly type: "broadcast-transcript-complete";
      readonly identity: BroadcastTranscriptWorkerIdentity;
      readonly requestedCount: number;
      readonly completedCount: number;
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
