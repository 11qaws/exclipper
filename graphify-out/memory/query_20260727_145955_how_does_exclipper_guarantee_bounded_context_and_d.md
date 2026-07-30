---
type: "query"
date: "2026-07-27T14:59:55.197061+00:00"
question: "How does ExClipper guarantee bounded context and durable candidate completion?"
contributor: "graphify"
outcome: "corrected"
correction: "The browser preserves the full session source, then deterministically builds a 48 KiB canonical candidate packet with an explicit bilingual omission marker and preserved head/tail. Qwen, Gemini, quota accounting, and the verification receipt all use that same packet and fingerprint, so valid maximum inputs are not stopped for size. A candidate can publish only when the insight is complete, audio plus four distinct frames and thumbnail are receipt-bound, the exact context matches, and the stored artifact survives same-run IndexedDB write/readback structural verification. Missing durability IDs fail closed; legacy incomplete insights remain AI-retry targets rather than becoming completed-empty results."
source_nodes: ["canonicalizeCandidatePassBContextPacket()", "candidatePassBInsightIsComplete()", "finalizeFullyVerifiedCandidates()"]
---

# Q: How does ExClipper guarantee bounded context and durable candidate completion?

## Answer

The broad traversal returned mostly unrelated nodes and did not explain the actual completion contract.

## Outcome

- Signal: corrected
- Correction: The browser preserves the full session source, then deterministically builds a 48 KiB canonical candidate packet with an explicit bilingual omission marker and preserved head/tail. Qwen, Gemini, quota accounting, and the verification receipt all use that same packet and fingerprint, so valid maximum inputs are not stopped for size. A candidate can publish only when the insight is complete, audio plus four distinct frames and thumbnail are receipt-bound, the exact context matches, and the stored artifact survives same-run IndexedDB write/readback structural verification. Missing durability IDs fail closed; legacy incomplete insights remain AI-retry targets rather than becoming completed-empty results.

## Source Nodes

- canonicalizeCandidatePassBContextPacket()
- candidatePassBInsightIsComplete()
- finalizeFullyVerifiedCandidates()