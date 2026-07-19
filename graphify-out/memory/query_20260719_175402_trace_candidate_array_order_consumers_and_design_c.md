---
type: "query"
date: "2026-07-19T17:54:02.619416+00:00"
question: "Trace candidate array order consumers and design CandidateRankingProposal lifecycle"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "fuseHighlightCandidates()", "candidateBoundaryRevision.ts", "highlightExport.ts", "durableAnalysisPayload.ts"]
---

# Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle

## Answer

Expanded from original query via graph vocab: candidate, candidates, order, rank, review, revision, boundary, preview, approval, export, recovery, segment. Source verification found that App renders and numbers cards from candidate array order; review and boundary state are candidate-ID keyed; preview return numbering is index-sensitive; export is independently chronological; recovery restores original durable candidate order and clears session edits. Recommendation: immutable ranking proposal plus separate active view order, explicit apply and one-level undo, evidence/candidate fingerprints, and stale-event guards; never sort or rewrite canonical candidates.

## Outcome

- Signal: useful

## Source Nodes

- App()
- fuseHighlightCandidates()
- candidateBoundaryRevision.ts
- highlightExport.ts
- durableAnalysisPayload.ts