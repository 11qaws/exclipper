import {
  createCurrentContextRequest,
  currentSmokePlan,
  DEFAULT_PROXY_ORIGIN,
  runContextSmoke,
} from "./current-ai-smoke-contract.mjs";

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify(currentSmokePlan("context"), null, 2)}\n`);
  process.exit(0);
}

const endpointIndex = process.argv.indexOf("--endpoint");
const endpoint =
  endpointIndex >= 0
    ? process.argv[endpointIndex + 1]
    : `${DEFAULT_PROXY_ORIGIN}/v1/broadcast-context`;
if (typeof endpoint !== "string" || endpoint.length === 0) {
  throw new Error(
    "Usage: node scripts/smoke-broadcast-context.mjs [--endpoint <url>] [--dry-run]",
  );
}

const { response, generationCount } = await runContextSmoke({
  request: createCurrentContextRequest(),
  proxyOrigin: new URL(endpoint).origin,
});
const payload = await response.json().catch(() => null);
const diagnosticHeaders = Object.fromEntries(
  [...response.headers.entries()].filter(([name]) =>
    name.toLowerCase().startsWith("x-upstream-") ||
    name.toLowerCase().startsWith("x-exclipper-"),
  ),
);
process.stdout.write(
  `${JSON.stringify(
    response.ok
      ? {
          status: response.status,
          generationCount,
          schemaVersion: payload?.schemaVersion ?? null,
          broadcastSummaryKo: payload?.broadcastSummaryKo ?? null,
          clipDecision: payload?.annotations?.[0]?.clipDecision ?? null,
        }
        : {
          status: response.status,
          generationCount,
          errorCode: payload?.error?.code ?? "UNKNOWN",
          diagnosticHeaders,
        },
    null,
    2,
  )}\n`,
);
if (!response.ok) process.exitCode = 1;
