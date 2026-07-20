import type {
  AnalysisManifestRecord,
  AnalysisResultStore,
  AnalysisTerminalRecord,
  FinalAnalysisResultRecord,
} from "./analysisResultStore";
import { durableCoverageDisposition } from "./durableAnalysisPayload";
import type { CandidatePassBInsightsRecord } from "./candidatePassBInsightStore";

export interface RecoverableAnalysisResult {
  readonly terminal: AnalysisTerminalRecord & {
    readonly outcome: "completed" | "completedWithGaps";
    readonly resultRecordKind: "finalResult";
  };
  readonly finalResult: FinalAnalysisResultRecord;
  readonly manifest: AnalysisManifestRecord;
  readonly candidatePassBInsights: CandidatePassBInsightsRecord | null;
}

export interface RecoverableAnalysisAudit {
  readonly results: readonly RecoverableAnalysisResult[];
  /** Completed pointers whose final artifact was missing, invalid, or mismatched. */
  readonly skippedCompletedResultCount: number;
  readonly rejectedTerminalRecordCount: number;
}

function isCompletedTerminal(
  terminal: AnalysisTerminalRecord,
): terminal is RecoverableAnalysisResult["terminal"] {
  return (
    terminal.resultRecordKind === "finalResult" &&
    (terminal.outcome === "completed" || terminal.outcome === "completedWithGaps")
  );
}

function immutableIdentityMatches(
  terminal: RecoverableAnalysisResult["terminal"],
  artifact: AnalysisManifestRecord | FinalAnalysisResultRecord,
): boolean {
  return (
    artifact.runId === terminal.runId &&
    artifact.schemaVersion === terminal.schemaVersion &&
    artifact.inputSignature === terminal.inputSignature &&
    artifact.modelManifestHash === terminal.modelManifestHash
  );
}

function recoveryBundleMatches(
  terminal: RecoverableAnalysisResult["terminal"],
  manifest: AnalysisManifestRecord,
  finalResult: FinalAnalysisResultRecord,
): boolean {
  const expectedOutcome = durableCoverageDisposition(finalResult.result.coverage);
  return (
    terminal.resultArtifactId === finalResult.artifactId &&
    terminal.outcome === expectedOutcome &&
    JSON.stringify(manifest.result.input) === JSON.stringify(finalResult.result.input)
  );
}

function resolveLimit(limit: number | undefined): number {
  const resolved = limit ?? 5;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > 50) {
    throw new RangeError("Recovery result limit must be a whole number from 1 to 50.");
  }
  return resolved;
}

/**
 * Rebuilds the small reload menu from the sole durable terminal authority.
 * Staged final artifacts are never exposed unless every immutable identity field
 * agrees with a completed terminal pointer.
 */
export async function auditRecoverableAnalysisResults(
  store: AnalysisResultStore,
  limit?: number,
): Promise<RecoverableAnalysisAudit> {
  const resolvedLimit = resolveLimit(limit);
  const terminalCatalog = await store.listTerminalRecords();
  const results: RecoverableAnalysisResult[] = [];
  let skippedCompletedResultCount = 0;

  for (const terminal of terminalCatalog.records) {
    if (!isCompletedTerminal(terminal)) {
      continue;
    }
    if (results.length >= resolvedLimit) {
      break;
    }

    try {
      const [manifest, finalResult, candidatePassBInsights] = await Promise.all([
        store.getManifest(terminal.runId),
        store.getFinalResult(terminal.runId),
        store.getCandidatePassBInsights(terminal.runId),
      ]);
      if (
        manifest === null ||
        finalResult === null ||
        finalResult.kind !== terminal.resultRecordKind ||
        !immutableIdentityMatches(terminal, manifest) ||
        !immutableIdentityMatches(terminal, finalResult) ||
        !recoveryBundleMatches(terminal, manifest, finalResult)
      ) {
        skippedCompletedResultCount += 1;
        continue;
      }
      results.push({ terminal, manifest, finalResult, candidatePassBInsights });
    } catch {
      skippedCompletedResultCount += 1;
    }
  }

  return {
    results,
    skippedCompletedResultCount,
    rejectedTerminalRecordCount: terminalCatalog.rejectedRecordCount,
  };
}
