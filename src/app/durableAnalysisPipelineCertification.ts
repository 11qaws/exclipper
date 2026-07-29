import type { AnalysisStage } from "../domain/analysisRun";
import type { BroadcastContextSessionRecord } from "../storage/broadcastContextSessionStore";
import type { CandidatePassBInsightsRecord } from "../storage/candidatePassBInsightStore";
import {
  AnalysisResultStoreError,
  type AnalysisManifestRecord,
  type AnalysisResultStore,
  type AnalysisTerminalRecord,
  type FinalAnalysisResultRecord,
} from "../storage/analysisResultStore";
import {
  certifyAnalysisPipelineSuccess,
  createAnalysisPipelineDurableSnapshotToken,
  type AnalysisPipelineDurableSnapshot,
  type AnalysisPipelineSuccessCertificate,
  type AnalysisPipelineSuccessGap,
  type AnalysisPipelineSuccessInput,
} from "./analysisPipelineSuccess";
import {
  DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY,
  runDurableAnalysisMutation,
  type DurableAnalysisMutationFailure,
  type DurableAnalysisMutationPhase,
  type DurableAnalysisMutationPolicy,
  type DurableAnalysisMutationResult,
} from "./durableAnalysisMutation";

export interface DurableAnalysisPipelineCertificationIdentity {
  readonly runId: string;
  readonly operationToken: string;
}

export type DurableAnalysisPipelineCertificationStore = Pick<
  AnalysisResultStore,
  | "getManifest"
  | "getFinalResult"
  | "getTerminalRecord"
  | "getBroadcastContextSession"
  | "getCandidatePassBInsights"
>;

export type AnalysisPipelineCertificationEvidence = Pick<
  AnalysisPipelineSuccessInput,
  "candidates"
>;

export interface DurableAnalysisPipelineCertificationPolicy {
  readonly maximumAttempts: number;
  readonly readbackTimeoutMs: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
}

export const DEFAULT_DURABLE_ANALYSIS_PIPELINE_CERTIFICATION_POLICY: DurableAnalysisPipelineCertificationPolicy =
  Object.freeze({
    maximumAttempts:
      DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY.maximumAttempts,
    readbackTimeoutMs:
      DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY.readbackTimeoutMs,
    initialBackoffMs:
      DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY.initialBackoffMs,
    maximumBackoffMs:
      DEFAULT_DURABLE_ANALYSIS_MUTATION_POLICY.maximumBackoffMs,
  });

export type AnalysisPipelineCertificationReadbackFailure =
  | {
      readonly kind: "retry";
      readonly reasonCode: string;
    }
  | {
      readonly kind: "permanent";
      readonly reasonCode: string;
    };

export interface DurableAnalysisPipelineCertificationOptions {
  readonly identity: DurableAnalysisPipelineCertificationIdentity;
  readonly store: DurableAnalysisPipelineCertificationStore;
  readonly evidence: AnalysisPipelineCertificationEvidence;
  readonly isCurrent: (
    identity: DurableAnalysisPipelineCertificationIdentity,
  ) => boolean;
  readonly signal?: AbortSignal;
  readonly policy?: Partial<DurableAnalysisPipelineCertificationPolicy>;
  readonly classifyReadbackError?: (
    cause: unknown,
  ) => AnalysisPipelineCertificationReadbackFailure;
}

export type DurableAnalysisPipelineCertificationResult =
  | {
      readonly status: "succeeded";
      readonly certificate: AnalysisPipelineSuccessCertificate;
      readonly durableToken: string;
      readonly durableSnapshot: AnalysisPipelineDurableSnapshot;
      readonly attempts: number;
    }
  | {
      readonly status: "certificate-rejected";
      readonly failedStage: AnalysisStage;
      readonly gaps: readonly AnalysisPipelineSuccessGap[];
      readonly attempts: number;
    }
  | {
      readonly status: "retry-exhausted";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "stale";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "permanent";
      readonly reasonCode: string;
      readonly attempts: number;
    }
  | {
      readonly status: "aborted";
      readonly attempts: number;
    };

interface AnalysisPipelineDurableReadback {
  readonly manifest: AnalysisManifestRecord | null;
  readonly fastResult: FinalAnalysisResultRecord | null;
  readonly fastTerminal: AnalysisTerminalRecord | null;
  readonly session: BroadcastContextSessionRecord | null;
  readonly candidateRecord: CandidatePassBInsightsRecord | null;
}

function completeSnapshot(
  readback: AnalysisPipelineDurableReadback,
): AnalysisPipelineDurableSnapshot | null {
  if (
    readback.manifest === null ||
    readback.fastResult === null ||
    readback.fastTerminal === null ||
    readback.session === null
  ) {
    return null;
  }
  return {
    manifest: readback.manifest,
    fastResult: readback.fastResult,
    fastTerminal: readback.fastTerminal,
    session: readback.session,
    candidateRecord: readback.candidateRecord,
  };
}

async function readDurableSnapshotWave(
  options: DurableAnalysisPipelineCertificationOptions,
): Promise<{
  readonly readback: AnalysisPipelineDurableReadback;
  readonly durableToken: string | null;
}> {
  const { runId } = options.identity;
  const [
    manifest,
    fastResult,
    fastTerminal,
    session,
    candidateRecord,
  ] = await Promise.all([
    options.store.getManifest(runId),
    options.store.getFinalResult(runId),
    options.store.getTerminalRecord(runId),
    options.store.getBroadcastContextSession(runId),
    options.store.getCandidatePassBInsights(runId),
  ]);
  const readback = {
    manifest,
    fastResult,
    fastTerminal,
    session,
    candidateRecord,
  };
  const snapshot = completeSnapshot(readback);
  return {
    readback,
    durableToken:
      snapshot === null
        ? null
        : await createAnalysisPipelineDurableSnapshotToken(snapshot),
  };
}

interface ConsecutiveAnalysisPipelineReadback {
  readonly first: Awaited<ReturnType<typeof readDurableSnapshotWave>>;
  readonly second: Awaited<ReturnType<typeof readDurableSnapshotWave>>;
}

async function readConsecutiveDurableSnapshots(
  options: DurableAnalysisPipelineCertificationOptions,
): Promise<ConsecutiveAnalysisPipelineReadback> {
  const first = await readDurableSnapshotWave(options);
  const second = await readDurableSnapshotWave(options);
  return { first, second };
}

function defaultReadbackFailure(
  cause: unknown,
): AnalysisPipelineCertificationReadbackFailure {
  if (cause instanceof AnalysisResultStoreError) {
    switch (cause.code) {
      case "INDEXED_DB_UNAVAILABLE":
      case "OPEN_BLOCKED":
      case "OPEN_FAILED":
      case "TRANSACTION_FAILED":
        return {
          kind: "retry",
          reasonCode: "analysis_pipeline_readback_storage_unavailable",
        };
      case "STORE_CLOSED":
      case "INVALID_PAYLOAD":
      case "SCHEMA_MISMATCH":
        return {
          kind: "permanent",
          reasonCode: "analysis_pipeline_readback_storage_rejected",
        };
    }
  }
  return {
    kind: "permanent",
    reasonCode: "analysis_pipeline_readback_exception",
  };
}

function classifyThrown(
  options: DurableAnalysisPipelineCertificationOptions,
  cause: unknown,
  phase: DurableAnalysisMutationPhase,
): DurableAnalysisMutationFailure {
  if (phase !== "readback") {
    return {
      kind: "permanent",
      reasonCode: "analysis_pipeline_runner_exception",
    };
  }
  return (
    options.classifyReadbackError ?? defaultReadbackFailure
  )(cause);
}

function mutationPolicy(
  policy:
    | Partial<DurableAnalysisPipelineCertificationPolicy>
    | undefined,
): Partial<DurableAnalysisMutationPolicy> | undefined {
  if (policy === undefined) return undefined;
  return {
    ...(policy.maximumAttempts === undefined
      ? {}
      : { maximumAttempts: policy.maximumAttempts }),
    ...(policy.readbackTimeoutMs === undefined
      ? {}
      : {
          mutationTimeoutMs: policy.readbackTimeoutMs,
          readbackTimeoutMs: policy.readbackTimeoutMs,
        }),
    ...(policy.initialBackoffMs === undefined
      ? {}
      : { initialBackoffMs: policy.initialBackoffMs }),
    ...(policy.maximumBackoffMs === undefined
      ? {}
      : { maximumBackoffMs: policy.maximumBackoffMs }),
  };
}

function normalizedReason(reasonCode: string): string {
  switch (reasonCode) {
    case "analysis_mutation_fence_stale":
      return "analysis_pipeline_certification_fence_stale";
    case "readback_timeout":
      return "analysis_pipeline_readback_timeout";
    case "failure_classifier_failed":
      return "analysis_pipeline_readback_classifier_failed";
    default:
      return reasonCode;
  }
}

function mapRunnerFailure(
  result: Exclude<
    DurableAnalysisMutationResult<AnalysisPipelineDurableSnapshot>,
    { readonly status: "succeeded" }
  >,
): DurableAnalysisPipelineCertificationResult {
  switch (result.status) {
    case "aborted":
      return result;
    case "retry-exhausted":
      return {
        ...result,
        reasonCode: normalizedReason(result.reasonCode),
      };
    case "stale":
      return {
        ...result,
        reasonCode: normalizedReason(result.reasonCode),
      };
    case "permanent-failure":
      return {
        status: "permanent",
        reasonCode: normalizedReason(result.reasonCode),
        attempts: result.attempts,
      };
  }
}

function finalFence(
  options: DurableAnalysisPipelineCertificationOptions,
  attempts: number,
): DurableAnalysisPipelineCertificationResult | null {
  if (options.signal?.aborted === true) {
    return { status: "aborted", attempts };
  }
  try {
    return options.isCurrent(options.identity)
      ? null
      : {
          status: "stale",
          reasonCode: "analysis_pipeline_certification_fence_stale",
          attempts,
        };
  } catch {
    return {
      status: "permanent",
      reasonCode: "analysis_pipeline_certification_fence_check_failed",
      attempts,
    };
  }
}

/**
 * Reads every durable artifact twice. Certification starts only when two
 * consecutive complete snapshots have the same canonical token, preventing
 * records written at different moments from being combined into one result.
 *
 * Candidate Pass B is reopened even when absent so the success certifier can
 * report a deterministic repair gap. A verified empty result still requires
 * a current empty record carrying the exact durable plan receipt.
 */
export async function runDurableAnalysisPipelineCertification(
  options: DurableAnalysisPipelineCertificationOptions,
): Promise<DurableAnalysisPipelineCertificationResult> {
  if (
    options.identity.runId.trim().length === 0 ||
    options.identity.operationToken.trim().length === 0
  ) {
    return {
      status: "permanent",
      reasonCode: "analysis_pipeline_certification_identity_invalid",
      attempts: 0,
    };
  }

  let reopened:
    | DurableAnalysisMutationResult<AnalysisPipelineDurableSnapshot>;
  try {
    const policy = mutationPolicy(options.policy);
    reopened = await runDurableAnalysisMutation({
      identity: options.identity,
      expected: null,
      isCurrent: options.isCurrent,
      mutate: () => Promise.resolve({ kind: "accepted" }),
      readback: () => readConsecutiveDurableSnapshots(options),
      reconcile: ({ readback }) => {
        const first = completeSnapshot(readback.first.readback);
        const second = completeSnapshot(readback.second.readback);
        if (first === null || second === null) {
          return {
            kind: "retry",
            reasonCode: "analysis_pipeline_snapshot_incomplete",
          };
        }
        return readback.first.durableToken !== null &&
          readback.first.durableToken === readback.second.durableToken
          ? {
              kind: "succeeded",
              value: second,
            }
          : {
              kind: "retry",
              reasonCode: "analysis_pipeline_snapshot_changed_during_read",
            };
      },
      classifyThrown: (cause, phase) =>
        classifyThrown(options, cause, phase),
      ...(options.signal === undefined
        ? {}
        : { signal: options.signal }),
      ...(policy === undefined ? {} : { policy }),
    });
  } catch {
    return {
      status: "permanent",
      reasonCode: "analysis_pipeline_certification_policy_invalid",
      attempts: 0,
    };
  }

  if (reopened.status !== "succeeded") {
    return mapRunnerFailure(reopened);
  }

  const durableToken = await createAnalysisPipelineDurableSnapshotToken(
    reopened.value,
  );
  const beforeCertificationFence = finalFence(
    options,
    reopened.attempts,
  );
  if (beforeCertificationFence !== null) {
    return beforeCertificationFence;
  }

  let certification;
  try {
    certification = await certifyAnalysisPipelineSuccess({
      ...reopened.value,
      ...options.evidence,
    });
  } catch {
    if (options.signal?.aborted === true) {
      return { status: "aborted", attempts: reopened.attempts };
    }
    return {
      status: "permanent",
      reasonCode: "analysis_pipeline_certification_exception",
      attempts: reopened.attempts,
    };
  }

  const afterCertificationFence = finalFence(
    options,
    reopened.attempts,
  );
  if (afterCertificationFence !== null) {
    return afterCertificationFence;
  }
  if (!certification.ok) {
    return {
      status: "certificate-rejected",
      failedStage: certification.failedStage,
      gaps: certification.gaps,
      attempts: reopened.attempts,
    };
  }
  return {
    status: "succeeded",
    certificate: certification.certificate,
    durableToken,
    durableSnapshot: reopened.value,
    attempts: reopened.attempts,
  };
}
