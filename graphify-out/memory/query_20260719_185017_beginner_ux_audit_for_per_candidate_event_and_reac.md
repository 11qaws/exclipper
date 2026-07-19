---
type: "query"
date: "2026-07-19T18:50:17.389645+00:00"
question: "Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states."
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "buildHighlightNarrative()", "buildCandidatePassBPresentation()", "buildCandidateAudioEventPresentation()"]
---

# Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states.

## Answer

Expanded from original query via graph vocab: app, candidate, narrative, transcript, audio, event, chat, evidence, ranking, reaction, gaps, stale. Existing App candidate cards already have the right minimal location: a visible neutral title and recommendation above one collapsed evidence disclosure. Risks: the current summary claims cause, content is duplicated, default badges are dense, the score looks like confidence, and applied stale ranking exposes only undo. Keep one disclosure named 사건·반응 단서 보기; group 사건 단서, 반응 단서, 확인할 점; show transcript/audio cues conditionally. Hide ranking for one candidate, avoid treating author IDs as people, use candidate headings and summary focus styles, and test mobile/accessibility, retry-preserved evidence, and applied-stale reranking.

## Outcome

- Signal: useful

## Source Nodes

- App()
- buildHighlightNarrative()
- buildCandidatePassBPresentation()
- buildCandidateAudioEventPresentation()