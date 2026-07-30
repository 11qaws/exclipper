---
type: "query"
date: "2026-07-27T11:33:42.386477+00:00"
question: "Implement focused free-r2 Worker integration tests without changing production files."
contributor: "graphify"
outcome: "useful"
source_nodes: ["aiProxy.worker.ts", "handleBroadcastTranscriptRequest()", "aiQuotaPolicy.ts", "broadcastTranscriptQwen.test.ts"]
---

# Q: Implement focused free-r2 Worker integration tests without changing production files.

## Answer

Expanded from the original task via graph vocabulary: [transcript, broadcast, media, quota, worker, route, qwen, range, streaming, ticket, provider, cors]. Added a bounded Worker integration suite covering fail-closed transport selection before body/provider work, raw WAV stream staging to R2 with HTTP 202 and no global/provider work, ticket resolution to a Qwen HTTPS URL without inline Base64, terminal-success deletion, local/provider 429 retention, and provider GET/HEAD/range responses without CORS. The new suite passes 6/6 tests, TypeScript strict typecheck, and targeted ESLint.

## Outcome

- Signal: useful

## Source Nodes

- aiProxy.worker.ts
- handleBroadcastTranscriptRequest()
- aiQuotaPolicy.ts
- broadcastTranscriptQwen.test.ts