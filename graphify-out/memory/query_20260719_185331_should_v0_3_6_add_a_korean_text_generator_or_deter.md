---
type: "feasibility"
date: "2026-07-19T18:53:31.404227+00:00"
question: "Should v0.3.6 add a Korean text generator or deterministic evidence explanation?"
contributor: "graphify"
outcome: "useful"
---

# Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?

## Answer

Use a pure deterministic evidence-ledger projection now. A text-only generator cannot recover missing visual semantics and risks inventing cause, subject, or outcome from provisional transcript and mixed-audio cues. Qwen2.5-0.5B is the later pilot candidate, but browser artifacts add roughly 0.5 to 0.8 GB and practical runtime depends on WebGPU. Later evaluate an allowlisted multilingual encoder, then gate generation behind opt-in and fact-ID validation.

## Outcome

- Signal: useful