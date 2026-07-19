export const CANDIDATE_PASS_B_MODEL_DOWNLOAD_MINIMUM_BYTES = 40 * 1024 * 1024;
export const CANDIDATE_PASS_B_MODEL_DOWNLOAD_PRE_READY_CEILING = 0.9;

export interface CandidatePassBModelDownloadAggregate {
  /** Conservative ratio while the library can still discover more files. */
  readonly ratio: number;
  readonly loadedBytes: number | null;
  /** Null until Transformers.js reports ready and every observed file has settled. */
  readonly totalBytes: number | null;
}

interface DownloadFileState {
  readonly loadedBytes: number;
  readonly reportedTotalBytes: number;
  readonly done: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyBoundedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 2_048
    ? value
    : null;
}

function byteCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total = Math.min(Number.MAX_SAFE_INTEGER, total + value);
  }
  return total;
}

/**
 * Aggregates Transformers.js' per-file callbacks without treating the first
 * small config/tokenizer file as the whole model download. The pinned q8
 * Whisper sessions alone are over 40 MiB, so that size is a conservative floor
 * until the library finishes discovering files. Unknown streaming totals stay
 * null instead of being presented as an exact byte total.
 */
export class CandidatePassBModelDownloadTracker {
  private readonly files = new Map<string, DownloadFileState>();
  private ready = false;

  public update(value: unknown): CandidatePassBModelDownloadAggregate | null {
    if (!isRecord(value) || typeof value.status !== "string") {
      return null;
    }
    if (value.status === "ready") {
      this.ready = true;
      return this.snapshot();
    }
    if (
      value.status !== "initiate" &&
      value.status !== "download" &&
      value.status !== "progress" &&
      value.status !== "done"
    ) {
      return null;
    }

    const name = nonEmptyBoundedString(value.name);
    const file = nonEmptyBoundedString(value.file);
    if (name === null || file === null) {
      return null;
    }
    const key = `${name}\u0000${file}`;
    const previous = this.files.get(key) ?? {
      loadedBytes: 0,
      reportedTotalBytes: 0,
      done: false,
    };
    const nextLoadedBytes =
      value.status === "progress"
        ? Math.max(previous.loadedBytes, byteCount(value.loaded) ?? 0)
        : previous.loadedBytes;
    const nextReportedTotalBytes =
      value.status === "progress"
        ? Math.max(
            previous.reportedTotalBytes,
            byteCount(value.total) ?? 0,
            nextLoadedBytes,
          )
        : previous.reportedTotalBytes;
    this.files.set(key, {
      loadedBytes: nextLoadedBytes,
      reportedTotalBytes: nextReportedTotalBytes,
      done: previous.done || value.status === "done",
    });
    return this.snapshot();
  }

  private snapshot(): CandidatePassBModelDownloadAggregate {
    const files = [...this.files.values()];
    const loadedBytes = safeSum(files.map((file) => file.loadedBytes));
    const observedTotalBytes = safeSum(
      files.map((file) => Math.max(file.loadedBytes, file.reportedTotalBytes)),
    );
    const allObservedFilesSettled =
      files.length > 0 && files.every((file) => file.done);
    const exactTotalIsKnown = this.ready && allObservedFilesSettled;
    const denominator = Math.max(
      1,
      CANDIDATE_PASS_B_MODEL_DOWNLOAD_MINIMUM_BYTES,
      observedTotalBytes,
      loadedBytes,
    );
    const conservativeRatio = Math.min(
      CANDIDATE_PASS_B_MODEL_DOWNLOAD_PRE_READY_CEILING,
      loadedBytes / denominator,
    );

    return {
      ratio: this.ready ? 1 : conservativeRatio,
      loadedBytes: files.length === 0 ? null : loadedBytes,
      totalBytes: exactTotalIsKnown ? observedTotalBytes : null,
    };
  }
}
