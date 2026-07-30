---
type: "query"
date: "2026-07-27T01:01:01.182821+00:00"
question: "탐색 구간 CORS 뒤 broadcast-context 502와 ai-quota 409가 발생하고 최종 후보 0개로 끝나는 이유와 복구 방법"
contributor: "graphify"
outcome: "useful"
source_nodes: ["fetchWithAiQuota", "requestBroadcastContextDeepseek", "retryWholeContextPhase", "handleBroadcastContextRequest", "runBroadcastTranscriptWorker"]
---

# Q: 탐색 구간 CORS 뒤 broadcast-context 502와 ai-quota 409가 발생하고 최종 후보 0개로 끝나는 이유와 복구 방법

## Answer

Expanded from graph vocabulary: [broadcast, transcript, context, quota, retry, worker, response, error, operation, chapter, coverage, gap]. 502 is the primary provider/context failure; the following 409 was a client cancel sent after the Worker had already consumed and finalized the lease. The client now preserves a bounded safe proxy error code and sends no cancel after any paid HTTP response. Explicit retries increment a stable attempt ordinal for context, transcript, semantic refinement, and candidate detail requests. completedWithGaps reopens the saved transcript session, subtracts covered ranges, and sends only missing 30-second chunks. The Worker additionally compacts stale-client chapter maps to 144 before validation, and successful discovery slices are checkpointed in memory while overview settles.

## Outcome

- Signal: useful

## Source Nodes

- fetchWithAiQuota
- requestBroadcastContextDeepseek
- retryWholeContextPhase
- handleBroadcastContextRequest
- runBroadcastTranscriptWorker