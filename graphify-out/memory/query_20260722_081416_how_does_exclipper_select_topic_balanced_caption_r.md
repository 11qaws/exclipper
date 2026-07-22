---
type: "query"
date: "2026-07-22T08:14:16.794520+00:00"
question: "How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["selectBroadcastTopicalRefinementLeadIds()", "extractBroadcastContextQwenSelectionResponse()", "createCaptionDiscoveredLeadRefinementPlan()", "App()"]
---

# Q: How does ExClipper select topic-balanced caption refinements and prevent routine gameplay from reaching canonical editor cards?

## Answer

Topical discovery merges up to 32 grounded leads, Qwen jury approvals unlock a confidence-scaled internal budget of 6 to 20, and selectBroadcastTopicalRefinementLeadIds distributes reserves across represented semantic chapters with farthest-midpoint diversity. Caption refinement is bounded to three concurrent calls and at most 20 internal leads, while semantic proposals and multimodal editor cards remain capped at 12. extractBroadcastContextQwenSelectionResponse combines repeated whole-broadcast gameplay evidence with candidate-local context, applies a stricter threshold, and deterministically rejects routine gameplay or generic banter unless a consequential exception is grounded. App stores this as an AI projection and preserves canonical candidates and editor decisions.

## Outcome

- Signal: useful

## Source Nodes

- selectBroadcastTopicalRefinementLeadIds()
- extractBroadcastContextQwenSelectionResponse()
- createCaptionDiscoveredLeadRefinementPlan()
- App()