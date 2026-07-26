import {
  AI_QUOTA_SCHEMA_VERSION,
  type AiQuotaOperationIdentity,
  type AiQuotaPublicRequest,
  type AiQuotaPublicResponse,
} from "../analysis/aiQuotaProtocol";
import type {
  AiQuotaInternalRequest,
  AiQuotaInternalResponse,
} from "./aiQuotaPolicy";

const GLOBAL_COORDINATOR_NAME = "exclipper-ai-global-v1";
const INTERNAL_COORDINATOR_URL = "https://ai-quota.internal/request";

export type AiQuotaMode = "disabled" | "optional" | "required";

export interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  getByName?(name: string): DurableObjectStubLike;
  idFromName?(name: string): unknown;
  get?(id: unknown): DurableObjectStubLike;
}

export interface AiQuotaCoordinatorEnvironment {
  readonly AI_QUOTA_COORDINATOR?: DurableObjectNamespaceLike;
  readonly AI_QUOTA_MODE?: AiQuotaMode;
}

export class AiQuotaCoordinatorUnavailableError extends Error {
  public constructor() {
    super("AI quota coordinator is unavailable.");
    this.name = "AiQuotaCoordinatorUnavailableError";
  }
}

function coordinatorStub(
  environment: AiQuotaCoordinatorEnvironment,
): DurableObjectStubLike {
  const namespace = environment.AI_QUOTA_COORDINATOR;
  if (namespace === undefined) throw new AiQuotaCoordinatorUnavailableError();
  if (namespace.getByName !== undefined) {
    return namespace.getByName(GLOBAL_COORDINATOR_NAME);
  }
  if (namespace.idFromName !== undefined && namespace.get !== undefined) {
    return namespace.get(namespace.idFromName(GLOBAL_COORDINATOR_NAME));
  }
  throw new AiQuotaCoordinatorUnavailableError();
}

async function postCoordinator<T>(
  environment: AiQuotaCoordinatorEnvironment,
  body: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await coordinatorStub(environment).fetch(
      INTERNAL_COORDINATOR_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new AiQuotaCoordinatorUnavailableError();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiQuotaCoordinatorUnavailableError();
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new AiQuotaCoordinatorUnavailableError();
  }
}

export function aiQuotaMode(
  environment: AiQuotaCoordinatorEnvironment,
): AiQuotaMode {
  return environment.AI_QUOTA_MODE === "required" ||
    environment.AI_QUOTA_MODE === "optional" ||
    environment.AI_QUOTA_MODE === "disabled"
    ? environment.AI_QUOTA_MODE
    : "required";
}

export async function requestCoordinatorPublicLease(
  environment: AiQuotaCoordinatorEnvironment,
  request: AiQuotaPublicRequest,
): Promise<AiQuotaPublicResponse> {
  return postCoordinator<AiQuotaPublicResponse>(environment, request);
}

export async function inspectCoordinatorLease(
  environment: AiQuotaCoordinatorEnvironment,
  identity: AiQuotaOperationIdentity,
  leaseToken: string,
): Promise<AiQuotaInternalResponse> {
  return postCoordinator<AiQuotaInternalResponse>(environment, {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: "inspect",
    ...identity,
    leaseToken,
  });
}

export async function releaseCoordinatorUploadLease(
  environment: AiQuotaCoordinatorEnvironment,
  identity: AiQuotaOperationIdentity,
  leaseToken: string,
): Promise<AiQuotaInternalResponse> {
  return postCoordinator<AiQuotaInternalResponse>(environment, {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: "release-upload",
    ...identity,
    leaseToken,
  });
}

export async function consumeCoordinatorLease(
  environment: AiQuotaCoordinatorEnvironment,
  identity: AiQuotaOperationIdentity,
  leaseToken: string,
  tokenReservation: number,
): Promise<AiQuotaInternalResponse> {
  return postCoordinator<AiQuotaInternalResponse>(environment, {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: "consume",
    ...identity,
    leaseToken,
    tokenReservation,
  });
}

export async function completeCoordinatorLease(
  environment: AiQuotaCoordinatorEnvironment,
  request: Extract<
    AiQuotaInternalRequest,
    { readonly action: "complete" }
  >,
): Promise<AiQuotaInternalResponse> {
  return postCoordinator<AiQuotaInternalResponse>(environment, {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    ...request,
  });
}

export async function checkCoordinatorHealth(
  environment: AiQuotaCoordinatorEnvironment,
): Promise<boolean> {
  const response = await postCoordinator<{
    readonly ok?: unknown;
    readonly status?: unknown;
    readonly schemaVersion?: unknown;
  }>(environment, {
    schemaVersion: AI_QUOTA_SCHEMA_VERSION,
    action: "health",
  });
  return (
    response.ok === true &&
    response.status === "healthy" &&
    response.schemaVersion === AI_QUOTA_SCHEMA_VERSION
  );
}
