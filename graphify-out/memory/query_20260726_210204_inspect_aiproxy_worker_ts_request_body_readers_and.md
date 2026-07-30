---
type: "query"
date: "2026-07-26T21:02:04.812138+00:00"
question: "Inspect aiProxy.worker.ts request-body readers and quota lease lifecycle; propose the smallest correct ingress timeout and upload-ticket cancellation design."
contributor: "graphify"
outcome: "useful"
source_nodes: ["aiProxy.worker.ts", "readBodyWithLimit()", "handleBroadcastTranscriptRequest()"]
---

# Q: Inspect aiProxy.worker.ts request-body readers and quota lease lifecycle; propose the smallest correct ingress timeout and upload-ticket cancellation design.

## Answer

Expanded from original query via graph vocab: [proxy, quota, lease, request, body, timeout, cancel, read, consume, complete, upstream, coordinator]. Source review found the 60s RequestBodyTimeoutError split from QuotaOutcomeUnknownError is correct, and candidate JSON plus raw WAV readers now return 408 and best-effort cancel unused tickets. However automatic cleanup currently calls public cancel, which atomically permits execution-waiting cancellation; a duplicate request using the same lease can cancel another request already waiting to consume. The safe design is a token-authenticated internal release-upload-ticket action that cancels lease-issued only. Add timeout handling to handleAiQuotaRequest, and retain upstream response-body timeout regression tests.

## Outcome

- Signal: useful

## Source Nodes

- aiProxy.worker.ts
- readBodyWithLimit()
- handleBroadcastTranscriptRequest()