---
type: "diagnostic"
date: "2026-07-27T12:16:38.469743+00:00"
question: "Audit candidate ID/version/context fingerprint joins across fast and semantic candidates, context annotations, Pass B receipts, and restore: how can 12 topics/31 leads plus 5 context-not-ready and 8 Pass B incomplete yield zero without a context API error?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "finalizeFullyVerifiedCandidates()", "buildCandidatePassBContextPackets()", "runCandidatePassBWorker()", "candidatePassB.worker.ts"]
---

# Q: Audit candidate ID/version/context fingerprint joins across fast and semantic candidates, context annotations, Pass B receipts, and restore: how can 12 topics/31 leads plus 5 context-not-ready and 8 Pass B incomplete yield zero without a context API error?

## Answer

The zero is caused by strict AND gating, not by topic/lead counts. finalizeFullyVerifiedCandidates requires exact candidate-id joins to a context packet, Pass B insight, schema-1.1 receipt matching the current context fingerprint, and recommend/consistent/streamer-event verdicts. Five reservoir candidates have no context packet because buildCandidatePassBContextPackets intentionally skips reject/unsupported/no-transcript inputs, but applyContextResult computes survivingCandidates and never setCandidates(survivingCandidates), so those intentional context rejects remain and are mislabeled as pipeline context-missing. The remaining eight enter Pass B. Candidate Pass B still sends multi-megabyte Base64 audio plus four frames as JSON to the free Worker; 5xx/CORS from CPU termination maps to fatal PROXY_UNAVAILABLE. mapWithConcurrency is fail-fast, so one lane rejection aborts the batch and leaves all eight without insights. In 0.8.4, quota operation IDs use only generation/start/end, so different candidate IDs sharing a range can also collide with different payloads and produce 409. The context fingerprint is not the present cause because mismatches report evidence-incomplete, whereas the screenshot reports detail-result-missing. Minimal fixes: R2/staged upload for candidate media, all-settled per-candidate retries preserving partial results, include a bounded stable candidate-id hash in operation ID, remove or separately classify context rejects, and prune restored artifacts by exact final ID set after semantic restoration.

## Outcome

- Signal: useful

## Source Nodes

- App()
- finalizeFullyVerifiedCandidates()
- buildCandidatePassBContextPackets()
- runCandidatePassBWorker()
- candidatePassB.worker.ts