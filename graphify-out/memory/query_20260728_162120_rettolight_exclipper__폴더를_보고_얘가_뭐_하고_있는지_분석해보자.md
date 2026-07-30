---
type: "query"
date: "2026-07-28T16:21:20.654832+00:00"
question: "rettolight(exclipper) 폴더를 보고 얘가 뭐 하고 있는지 분석해보자"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App()", "fuseReactionHighlightCandidates()", "runCandidatePassBWorker()", "finalizeFullyVerifiedCandidates()", "IndexedDbAnalysisResultStore", "createHighlightExportFile()"]
---

# Q: rettolight(exclipper) 폴더를 보고 얘가 뭐 하고 있는지 분석해보자

## Answer

Expanded from original query via graph vocab: [app, project, source, video, chat, analysis, pipeline, candidate, context, highlight, review, export]. ExClipper is a browser-first personal editing assistant for long broadcast recordings. App() performs local preflight, runs local audio/video and optional chat analysis in parallel, fuses reaction-anchored candidates, persists and read-verifies a fast result, then runs whole-broadcast context and a bounded candidate deep pass. runCandidatePassBWorker() analyzes at most the selected candidate cohort with audio, four representative frames, and bounded context through the Cloudflare AI relay; finalizeFullyVerifiedCandidates() prevents incomplete evidence from being published. IndexedDbAnalysisResultStore stores manifests, checkpoints, final results, terminal dispositions, and candidate evidence locally. Human review adjusts boundaries and approves/rejects candidates; createHighlightExportFile() produces CSV/Markdown/JSON and local sources may be rendered as clips. The current worktree is an in-progress 0.8.7-era snapshot focused on participant grounding and phase-ledger durability. Main risks are the 11k-line App.tsx orchestrator, a 5k-line AI proxy worker, documentation/code drift, and incomplete persistence of review decisions and boundary edits.

## Outcome

- Signal: useful

## Source Nodes

- App()
- fuseReactionHighlightCandidates()
- runCandidatePassBWorker()
- finalizeFullyVerifiedCandidates()
- IndexedDbAnalysisResultStore
- createHighlightExportFile()