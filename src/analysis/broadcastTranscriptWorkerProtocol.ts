import type { BroadcastContextTranscriptionChunk } from "./broadcastContextSamplingPlan";
import type { BroadcastTranscriptQwenResult } from "./broadcastTranscriptQwen";

export const BROADCAST_TRANSCRIPT_WORKER_VERSION = "1.2.0" as const;
// A 12-hour plan can contain up to 216 fragmented uniform chunks plus twelve
// two-minute event windows (two 90-second requests each). Merging only lowers
// this count, so 240 is a complete, bounded worst-case envelope.
export const MAX_BROADCAST_TRANSCRIPT_WORKER_CHUNKS = 240;

export interface BroadcastTranscriptWorkerIdentity {
  readonly taskId: string;
}

export type BroadcastTranscriptWorkerRequest =
  | {
      readonly type: "broadcast-transcript-analyze";
      readonly identity: BroadcastTranscriptWorkerIdentity;
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
