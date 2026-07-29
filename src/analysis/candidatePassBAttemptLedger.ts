import {
  isCandidatePassBDispatchIntent,
  isCandidatePassBTerminalSettlement,
} from "./candidateFinalVerification";
import type {
  CandidatePassBDispatchIntent,
  CandidatePassBTerminalSettlement,
} from "./candidatePassBWorkerProtocol";

export const CANDIDATE_PASS_B_ATTEMPT_LEDGER_SCHEMA_VERSION =
  "1.0.0" as const;
export const CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION = "1.0.0" as const;

export type CandidatePassBRetryGrantMode =
  | "automatic-free-tier"
  | "editor-approved-paid";

export interface CandidatePassBRetryGrant {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION;
  readonly grantId: string;
  readonly candidateId: string;
  readonly replacesOperationId: string;
  readonly nextAttemptOrdinal: number;
  readonly mode: CandidatePassBRetryGrantMode;
}

export interface CandidatePassBAttemptLedgerEntry {
  readonly dispatchIntent: CandidatePassBDispatchIntent;
  readonly retryGrantId: string | null;
  readonly settlement: CandidatePassBTerminalSettlement | null;
}

export interface CandidatePassBAttemptLedger {
  readonly schemaVersion: typeof CANDIDATE_PASS_B_ATTEMPT_LEDGER_SCHEMA_VERSION;
  readonly candidateId: string;
  readonly attempts: readonly CandidatePassBAttemptLedgerEntry[];
  /**
   * Grants are immutable authorizations. A later attempt consumes a grant by
   * referencing its ID; the grant itself is never edited or removed.
   */
  readonly retryGrants: readonly CandidatePassBRetryGrant[];
}

export type CandidatePassBAttemptLedgerState =
  | "auto-eligible"
  | "armed"
  | "completed"
  | "blocked"
  | "retry-granted";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isCandidatePassBRetryGrant(
  value: unknown,
): value is CandidatePassBRetryGrant {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schemaVersion",
      "grantId",
      "candidateId",
      "replacesOperationId",
      "nextAttemptOrdinal",
      "mode",
    ]) &&
    value.schemaVersion === CANDIDATE_PASS_B_RETRY_GRANT_SCHEMA_VERSION &&
    isNonEmptyBoundedString(value.grantId, 240) &&
    isNonEmptyBoundedString(value.candidateId, 180) &&
    isNonEmptyBoundedString(value.replacesOperationId, 512) &&
    Number.isSafeInteger(value.nextAttemptOrdinal) &&
    Number(value.nextAttemptOrdinal) >= 1 &&
    (value.mode === "automatic-free-tier" ||
      value.mode === "editor-approved-paid")
  );
}

function usedGrantIds(
  attempts: readonly CandidatePassBAttemptLedgerEntry[],
): ReadonlySet<string> {
  return new Set(
    attempts.flatMap(({ retryGrantId }) =>
      retryGrantId === null ? [] : [retryGrantId],
    ),
  );
}

function retryGrantMatchesPreviousTransport(
  grant: CandidatePassBRetryGrant,
  previous: CandidatePassBAttemptLedgerEntry,
): boolean {
  if (previous.settlement?.status !== "outcome-unknown") {
    return false;
  }
  return grant.mode === "automatic-free-tier"
    ? previous.dispatchIntent.transportMode === "free-r2"
    : previous.dispatchIntent.transportMode === "paid-direct";
}

function retryGrantMatchesNextTransport(
  grant: CandidatePassBRetryGrant,
  nextDispatchIntent: CandidatePassBDispatchIntent,
): boolean {
  return grant.mode === "automatic-free-tier"
    ? nextDispatchIntent.transportMode === "free-r2"
    : nextDispatchIntent.transportMode === "paid-direct";
}

export function assertCandidatePassBAttemptLedger(
  value: unknown,
): asserts value is CandidatePassBAttemptLedger {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "candidateId",
      "attempts",
      "retryGrants",
    ]) ||
    value.schemaVersion !== CANDIDATE_PASS_B_ATTEMPT_LEDGER_SCHEMA_VERSION ||
    !isNonEmptyBoundedString(value.candidateId, 180) ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.retryGrants)
  ) {
    throw new TypeError("Invalid Candidate Pass B attempt ledger.");
  }

  const candidateId = value.candidateId;
  const attempts: CandidatePassBAttemptLedgerEntry[] = [];
  const operationIds = new Set<string>();
  for (const [attemptOrdinal, rawAttempt] of value.attempts.entries()) {
    if (
      !isRecord(rawAttempt) ||
      !hasExactKeys(rawAttempt, [
        "dispatchIntent",
        "retryGrantId",
        "settlement",
      ]) ||
      !isCandidatePassBDispatchIntent(rawAttempt.dispatchIntent) ||
      rawAttempt.dispatchIntent.candidateId !== candidateId ||
      rawAttempt.dispatchIntent.attemptOrdinal !== attemptOrdinal ||
      operationIds.has(rawAttempt.dispatchIntent.operationId) ||
      (rawAttempt.retryGrantId !== null &&
        !isNonEmptyBoundedString(rawAttempt.retryGrantId, 240)) ||
      rawAttempt.dispatchIntent.retryGrantId !== rawAttempt.retryGrantId ||
      (rawAttempt.settlement !== null &&
        !isCandidatePassBTerminalSettlement(rawAttempt.settlement)) ||
      (rawAttempt.settlement !== null &&
        (rawAttempt.settlement.operationId !==
          rawAttempt.dispatchIntent.operationId ||
        rawAttempt.settlement.providerPayloadDigest !==
            rawAttempt.dispatchIntent.mediaReceipt.providerPayloadDigest ||
          rawAttempt.settlement.outputLanguage !==
            rawAttempt.dispatchIntent.outputLanguage ||
          rawAttempt.settlement.castRosterId !==
            rawAttempt.dispatchIntent.castRosterId))
    ) {
      throw new TypeError("Invalid Candidate Pass B attempt entry.");
    }
    if (
      (attemptOrdinal === 0 && rawAttempt.retryGrantId !== null) ||
      (attemptOrdinal > 0 && rawAttempt.retryGrantId === null) ||
      (attemptOrdinal < value.attempts.length - 1 &&
        rawAttempt.settlement === null)
    ) {
      throw new TypeError("Candidate Pass B attempt ordering is invalid.");
    }
    operationIds.add(rawAttempt.dispatchIntent.operationId);
    attempts.push({
      dispatchIntent: rawAttempt.dispatchIntent,
      retryGrantId: rawAttempt.retryGrantId,
      settlement: rawAttempt.settlement,
    });
  }

  const grants: CandidatePassBRetryGrant[] = [];
  const grantIds = new Set<string>();
  for (const rawGrant of value.retryGrants) {
    if (
      !isCandidatePassBRetryGrant(rawGrant) ||
      rawGrant.candidateId !== candidateId ||
      grantIds.has(rawGrant.grantId)
    ) {
      throw new TypeError("Invalid Candidate Pass B retry grant.");
    }
    grantIds.add(rawGrant.grantId);
    grants.push(rawGrant);
  }

  const consumedGrantIds = usedGrantIds(attempts);
  for (const grant of grants) {
    const previous = attempts[grant.nextAttemptOrdinal - 1];
    const next = attempts[grant.nextAttemptOrdinal];
    if (
      previous === undefined ||
      previous.settlement === null ||
      grant.replacesOperationId !== previous.dispatchIntent.operationId ||
      !retryGrantMatchesPreviousTransport(grant, previous) ||
      (next !== undefined &&
        (next.retryGrantId !== grant.grantId ||
          !retryGrantMatchesNextTransport(grant, next.dispatchIntent)))
    ) {
      throw new TypeError("Candidate Pass B retry grant route is invalid.");
    }
  }
  for (const [attemptOrdinal, attempt] of attempts.entries()) {
    if (attemptOrdinal === 0) continue;
    const grant = grants.find(
      ({ grantId }) => grantId === attempt.retryGrantId,
    );
    const previous = attempts[attemptOrdinal - 1];
    if (
      grant === undefined ||
      previous === undefined ||
      grant.nextAttemptOrdinal !== attemptOrdinal ||
      grant.replacesOperationId !== previous.dispatchIntent.operationId
    ) {
      throw new TypeError("Candidate Pass B retry grant fence is invalid.");
    }
  }
  const unusedGrants = grants.filter(
    ({ grantId }) => !consumedGrantIds.has(grantId),
  );
  if (unusedGrants.length > 1) {
    throw new TypeError("Only one unused Candidate Pass B retry grant is valid.");
  }
  if (unusedGrants.length === 1) {
    const lastAttempt = attempts.at(-1);
    const unusedGrant = unusedGrants[0]!;
    if (
      lastAttempt === undefined ||
      lastAttempt.settlement === null ||
      unusedGrant.replacesOperationId !==
        lastAttempt.dispatchIntent.operationId ||
      unusedGrant.nextAttemptOrdinal !== attempts.length
    ) {
      throw new TypeError("Unused Candidate Pass B retry grant is stale.");
    }
  }
  if (
    grants.some(
      ({ grantId }) =>
        !consumedGrantIds.has(grantId) &&
        unusedGrants[0]?.grantId !== grantId,
    )
  ) {
    throw new TypeError("Candidate Pass B retry grant was not consumed.");
  }
}

export function createCandidatePassBAttemptLedger(
  candidateId: string,
): CandidatePassBAttemptLedger {
  if (!isNonEmptyBoundedString(candidateId, 180)) {
    throw new TypeError("Candidate Pass B candidate ID is invalid.");
  }
  return {
    schemaVersion: CANDIDATE_PASS_B_ATTEMPT_LEDGER_SCHEMA_VERSION,
    candidateId,
    attempts: [],
    retryGrants: [],
  };
}

function cloneLedger(
  ledger: CandidatePassBAttemptLedger,
): CandidatePassBAttemptLedger {
  return {
    schemaVersion: ledger.schemaVersion,
    candidateId: ledger.candidateId,
    attempts: ledger.attempts.map((attempt) => ({
      dispatchIntent: attempt.dispatchIntent,
      retryGrantId: attempt.retryGrantId,
      settlement: attempt.settlement,
    })),
    retryGrants: [...ledger.retryGrants],
  };
}

export function candidatePassBAttemptLedgerState(
  ledger: CandidatePassBAttemptLedger,
): CandidatePassBAttemptLedgerState {
  assertCandidatePassBAttemptLedger(ledger);
  const lastAttempt = ledger.attempts.at(-1);
  if (lastAttempt === undefined) return "auto-eligible";
  const consumed = usedGrantIds(ledger.attempts);
  if (ledger.retryGrants.some(({ grantId }) => !consumed.has(grantId))) {
    return "retry-granted";
  }
  if (lastAttempt.settlement === null) return "armed";
  return lastAttempt.settlement.status === "completed"
    ? "completed"
    : "blocked";
}

export function candidatePassBActiveAttempt(
  ledger: CandidatePassBAttemptLedger,
): CandidatePassBAttemptLedgerEntry | null {
  assertCandidatePassBAttemptLedger(ledger);
  return ledger.attempts.at(-1) ?? null;
}

export function createCandidatePassBInitialAttemptLedger(
  dispatchIntent: CandidatePassBDispatchIntent,
  settlement: CandidatePassBTerminalSettlement | null = null,
): CandidatePassBAttemptLedger {
  const armed = appendCandidatePassBArmedAttempt(
    createCandidatePassBAttemptLedger(dispatchIntent.candidateId),
    { dispatchIntent, retryGrantId: null },
  );
  return settlement === null
    ? armed
    : settleCandidatePassBAttempt(armed, settlement);
}

export function issueCandidatePassBRetryGrant(
  ledger: CandidatePassBAttemptLedger,
  grant: CandidatePassBRetryGrant,
): CandidatePassBAttemptLedger {
  assertCandidatePassBAttemptLedger(ledger);
  if (!isCandidatePassBRetryGrant(grant)) {
    throw new TypeError("Candidate Pass B retry grant is invalid.");
  }
  const existingGrant = ledger.retryGrants.find(
    ({ grantId }) => grantId === grant.grantId,
  );
  if (existingGrant !== undefined) {
    if (!exactJson(existingGrant, grant)) {
      throw new TypeError("Candidate Pass B retry grant ID was reused.");
    }
    if (usedGrantIds(ledger.attempts).has(grant.grantId)) {
      throw new TypeError("Candidate Pass B retry grant was already consumed.");
    }
    return ledger;
  }
  const lastAttempt = ledger.attempts.at(-1);
  if (lastAttempt === undefined || lastAttempt.settlement === null) {
    throw new TypeError("Candidate Pass B retry grant requires a settlement.");
  }
  if (
    candidatePassBAttemptLedgerState(ledger) !==
      (lastAttempt.settlement.status === "completed"
        ? "completed"
        : "blocked") ||
    grant.candidateId !== ledger.candidateId ||
    grant.replacesOperationId !== lastAttempt.dispatchIntent.operationId ||
    grant.nextAttemptOrdinal !== ledger.attempts.length ||
    !retryGrantMatchesPreviousTransport(grant, lastAttempt)
  ) {
    throw new TypeError("Candidate Pass B retry grant fence is invalid.");
  }
  const next = cloneLedger({
    ...ledger,
    retryGrants: [...ledger.retryGrants, grant],
  });
  assertCandidatePassBAttemptLedger(next);
  return next;
}

export function appendCandidatePassBArmedAttempt(
  ledger: CandidatePassBAttemptLedger,
  input: {
    readonly dispatchIntent: CandidatePassBDispatchIntent;
    readonly retryGrantId: string | null;
  },
): CandidatePassBAttemptLedger {
  assertCandidatePassBAttemptLedger(ledger);
  if (!isCandidatePassBDispatchIntent(input.dispatchIntent)) {
    throw new TypeError("Candidate Pass B dispatch intent is invalid.");
  }
  if (input.dispatchIntent.retryGrantId !== input.retryGrantId) {
    throw new TypeError("Candidate Pass B retry grant binding is invalid.");
  }

  const existing = ledger.attempts.find(
    ({ dispatchIntent }) =>
      dispatchIntent.operationId === input.dispatchIntent.operationId,
  );
  if (existing !== undefined) {
    if (
      !exactJson(existing.dispatchIntent, input.dispatchIntent) ||
      existing.retryGrantId !== input.retryGrantId
    ) {
      throw new TypeError("Candidate Pass B operation ID was reused.");
    }
    return ledger;
  }

  const attemptOrdinal = ledger.attempts.length;
  if (
    input.dispatchIntent.candidateId !== ledger.candidateId ||
    input.dispatchIntent.attemptOrdinal !== attemptOrdinal
  ) {
    throw new TypeError("Candidate Pass B attempt ordinal is invalid.");
  }
  if (attemptOrdinal === 0) {
    if (
      input.retryGrantId !== null ||
      candidatePassBAttemptLedgerState(ledger) !== "auto-eligible"
    ) {
      throw new TypeError("Initial Candidate Pass B attempt cannot use a grant.");
    }
  } else {
    const lastAttempt = ledger.attempts.at(-1)!;
    const grant = ledger.retryGrants.find(
      ({ grantId }) => grantId === input.retryGrantId,
    );
    if (
      candidatePassBAttemptLedgerState(ledger) !== "retry-granted" ||
      grant === undefined ||
      grant.replacesOperationId !== lastAttempt.dispatchIntent.operationId ||
      grant.nextAttemptOrdinal !== attemptOrdinal ||
      usedGrantIds(ledger.attempts).has(grant.grantId) ||
      !retryGrantMatchesNextTransport(grant, input.dispatchIntent)
    ) {
      throw new TypeError("Candidate Pass B retry attempt lacks a live grant.");
    }
  }

  const next = cloneLedger({
    ...ledger,
    attempts: [
      ...ledger.attempts,
      {
        dispatchIntent: input.dispatchIntent,
        retryGrantId: input.retryGrantId,
        settlement: null,
      },
    ],
  });
  assertCandidatePassBAttemptLedger(next);
  return next;
}

export function settleCandidatePassBAttempt(
  ledger: CandidatePassBAttemptLedger,
  settlement: CandidatePassBTerminalSettlement,
): CandidatePassBAttemptLedger {
  assertCandidatePassBAttemptLedger(ledger);
  if (!isCandidatePassBTerminalSettlement(settlement)) {
    throw new TypeError("Candidate Pass B settlement is invalid.");
  }
  const activeIndex = ledger.attempts.length - 1;
  const active = ledger.attempts[activeIndex];
  if (
    active === undefined ||
    settlement.operationId !== active.dispatchIntent.operationId ||
    settlement.providerPayloadDigest !==
      active.dispatchIntent.mediaReceipt.providerPayloadDigest ||
    settlement.outputLanguage !== active.dispatchIntent.outputLanguage ||
    settlement.castRosterId !== active.dispatchIntent.castRosterId
  ) {
    throw new TypeError("Candidate Pass B settlement fence is invalid.");
  }
  if (active.settlement !== null) {
    if (!exactJson(active.settlement, settlement)) {
      throw new TypeError("Candidate Pass B settlement cannot be replaced.");
    }
    return ledger;
  }
  const next = cloneLedger({
    ...ledger,
    attempts: ledger.attempts.map((attempt, index) =>
      index === activeIndex ? { ...attempt, settlement } : attempt,
    ),
  });
  assertCandidatePassBAttemptLedger(next);
  return next;
}

/**
 * Same-run CAS reconciliation is append-only. Either side may be a strict
 * prefix of the other; divergent history is rejected.
 */
export function mergeCandidatePassBAttemptLedgers(
  left: CandidatePassBAttemptLedger,
  right: CandidatePassBAttemptLedger,
): CandidatePassBAttemptLedger | null {
  try {
    assertCandidatePassBAttemptLedger(left);
    assertCandidatePassBAttemptLedger(right);
  } catch {
    return null;
  }
  if (left.candidateId !== right.candidateId) return null;
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  if (leftJson === rightJson) return left;

  const extendsLedger = (
    base: CandidatePassBAttemptLedger,
    next: CandidatePassBAttemptLedger,
  ): boolean =>
    base.attempts.length <= next.attempts.length &&
    base.retryGrants.length <= next.retryGrants.length &&
    base.retryGrants.every((grant, index) =>
      exactJson(grant, next.retryGrants[index]),
    ) &&
    base.attempts.every((attempt, index) => {
      const nextAttempt = next.attempts[index];
      return (
        nextAttempt !== undefined &&
        exactJson(attempt.dispatchIntent, nextAttempt.dispatchIntent) &&
        attempt.retryGrantId === nextAttempt.retryGrantId &&
        (attempt.settlement === null ||
          exactJson(attempt.settlement, nextAttempt.settlement))
      );
    });

  if (extendsLedger(left, right)) return right;
  if (extendsLedger(right, left)) return left;
  return null;
}
