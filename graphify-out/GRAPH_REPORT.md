# Graph Report - .  (2026-07-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1984 nodes · 4021 edges · 109 communities (95 shown, 14 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a5200df0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- highlightExport.ts
- highlightFusion.ts
- candidateRanking.ts
- candidateAudioEventRun.ts
- candidatePassBRun.ts
- durableAnalysisPayload.ts
- candidateAudioEvent.ts
- candidateEvidenceExplanation.ts
- App.tsx
- candidateAudioEvent.worker.ts
- candidateAudioEventWorkerClient.ts
- IndexedDbAnalysisResultStore
- analysisRun.ts
- localAudioReactionAnalysis.ts
- analysisResultStore.ts
- candidateAudioEventWorkerProtocol.ts
- localAudioReactionAnalysisCore.ts
- localFileFingerprint.ts
- candidatePassBWorkerClient.ts
- chatImport.ts
- AnalysisResultStore
- compilerOptions
- 사람 중심 후보 검토
- candidatePassB.worker.ts
- candidatePassBWorkerProtocol.ts
- candidateAudioEventWorkerClient.test.ts
- audioReactionAnalysis.worker.ts
- candidatePassB.ts
- localMediaPreflight.ts
- localVideoVisualAnalysis.ts
- candidatePassBGemini.ts
- runCandidateAudioEventWorker
- localVideoVisualAnalysisCore.ts
- AnalysisRun State Machine
- 로컬 데이터·비밀정보 보안 경계
- analysisResultStore.test.ts
- runCandidatePassBWorker
- highlightSelector.ts
- compilerOptions
- evaluate-local-audio-fast-pass.mjs
- candidateEvidenceExplanation.test.ts
- candidateMerge.ts
- sourceCheck.ts
- candidatePassB.worker.test.ts
- loadVideoMetadata
- fakeEvent
- chatAnalysisWorkerClient.test.ts
- devDependencies
- chatAnalysisWorkerProtocol.ts
- localVideoVisualAnalysis.test.ts
- candidatePassBPresentation.test.ts
- eventFence.ts
- candidatePassBPresentation.ts
- chatAnalysisWorkerClient.ts
- localMediaPreflight.test.ts
- FakeVideoProbe
- candidatePassBModelDownloadProgress.ts
- .openDatabase
- candidateReviewFeatureAvailability.ts
- isCompletedResult
- FakeVideoProbe
- dependencies
- scripts
- WindowPcmBuilder
- isRecord
- candidatePassBRuntime.ts
- localAudioReactionAnalysisCore.test.ts
- Retto Highlight
- CandidatePassBEvidence
- isValidAnalyzeRequest
- FakeWorker
- cleanupResources
- LocalMediaPreflightAdapters
- package.json
- candidatePassB.test.ts
- LocalVideoVisualAnalysisAdapters
- selectCandidatePassBTargets
- CandidatePassBWorkerFailureReason
- Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?
- Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지
- Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사
- Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해
- Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로
- Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?
- Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle
- Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?
- Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요.
- Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?
- Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스
- Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?
- Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?
- summarizeCandidatePassBAudioGate
- highlightSelector.test.ts
- appendHiddenElement
- tsconfig.json
- @eslint/js
- eslint-plugin-react-hooks
- @types/node
- typescript
- typescript-eslint
- vite
- LocalMediaPreflightError
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES

## God Nodes (most connected - your core abstractions)
1. `App()` - 26 edges
2. `invalid()` - 23 edges
3. `compilerOptions` - 23 edges
4. `analyzeLocalVideoVisuals()` - 22 edges
5. `IndexedDbAnalysisResultStore` - 22 edges
6. `buildCandidateEvidenceExplanation()` - 19 edges
7. `runCandidatePassBWorker()` - 19 edges
8. `runCandidateAudioEventWorker()` - 18 edges
9. `InMemoryAnalysisResultStore` - 18 edges
10. `asPlainRecord()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `불변 StreamSaver CSS 기준과 Retto 오버라이드` --conceptually_related_to--> `개인용 제품 production 출시 기준`  [INFERRED]
  AGENTS.md → OPERATIONS.md
- `0.3.0 문서 정합성과 미커밋 기록` --conceptually_related_to--> `개인용 제품 production 출시 기준`  [INFERRED]
  DEVELOPMENT_LOG.md → OPERATIONS.md
- `수동 우선 폐기와 AI-first 전환 결정` --rationale_for--> `1인용 로컬 우선 AI 편집 어시스턴트`  [EXTRACTED]
  DEVELOPMENT_LOG.md → AGENTS.md
- `원격 텔레메트리 없는 비식별 로컬 진단` --implements--> `로컬 데이터·비밀정보 보안 경계`  [EXTRACTED]
  OPERATIONS.md → AGENTS.md
- `저장 공간·캐시·보존 상한` --implements--> `로컬 데이터·비밀정보 보안 경계`  [EXTRACTED]
  OPERATIONS.md → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **계층형 AI 하이라이트 분석 파이프라인** — product_plan_analysis_orchestrator, product_plan_fast_pass, product_plan_candidate_recall, product_plan_deep_pass, product_plan_multimodal_fusion, product_plan_boundary_refinement, product_plan_candidate_diversity [EXTRACTED 1.00]

## Communities (109 total, 14 thin omitted)

### Community 0 - "highlightExport.ts"
Cohesion: 0.06
Nodes (66): UnifiedHighlightCandidate, audienceReactionExplanation(), audioRange(), buildHighlightNarrative(), chatRange(), eventExplanation(), HighlightInterpretationBasis, recommendationExplanation() (+58 more)

### Community 1 - "highlightFusion.ts"
Cohesion: 0.06
Nodes (68): attachVisualContext(), AUDIO_EVENT_KINDS, AudioHighlightCandidate, AudioHighlightCandidateEvidence, AudioReactionEventKind, canonicalSignalKinds(), clamp(), compareDrafts() (+60 more)

### Community 2 - "candidateRanking.ts"
Cohesion: 0.06
Nodes (59): CandidateAudioEventEvidenceById, CandidatePassBEvidenceById, buildCandidateRankingProposal(), buildDraft(), CANDIDATE_RANKING_ALGORITHM_VERSION, CANDIDATE_RANKING_MAX_CANDIDATES, CANDIDATE_RANKING_MAX_SUPPORT_POINTS, CandidateRankingAudioEventCoverage (+51 more)

### Community 3 - "candidateAudioEventRun.ts"
Cohesion: 0.07
Nodes (56): CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION, accept(), assertCandidateAudioEventRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES, CandidateAudioEventCancelTerminationKind, CandidateAudioEventCandidateOutcome (+48 more)

### Community 4 - "candidatePassBRun.ts"
Cohesion: 0.07
Nodes (56): accept(), assertCandidatePassBRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_PASS_B_TERMINAL_STATUSES, candidateEventRejection(), CandidatePassBCancelTerminationKind, CandidatePassBCandidateFailureReasonCode (+48 more)

### Community 5 - "durableAnalysisPayload.ts"
Cohesion: 0.10
Nodes (54): ANALYSIS_INPUT_KEYS, asPlainRecord(), assertAudioEvidence(), assertAudioGapReason(), assertBoolean(), assertCandidate(), assertChatEvidence(), assertChatInput() (+46 more)

### Community 6 - "candidateAudioEvent.ts"
Cohesion: 0.07
Nodes (45): aggregateCandidateAudioEventScores(), aggregationQuality(), aggregationQualityTuple(), assertAndIndexWindowScores(), assertScoreVector(), assertTarget(), assertTargetSet(), baseResult() (+37 more)

### Community 7 - "candidateEvidenceExplanation.ts"
Cohesion: 0.09
Nodes (43): assertEffectiveRange(), assertEvidenceBindings(), AUDIO_EVENT_KIND_LABELS, audioEventBasisCodes(), audioEventDetections(), audioEventObservation(), audioObservation(), buildCandidateEvidenceExplanation() (+35 more)

### Community 8 - "App.tsx"
Cohesion: 0.07
Nodes (41): AnalysisCoverageSummary, AnalysisGapApprovalEvidence, analysisRunLabel(), AnalysisSelectionSummary, App(), applyAnalysisEvent(), applySourceEvent(), assessLink() (+33 more)

### Community 9 - "candidateAudioEvent.worker.ts"
Cohesion: 0.10
Nodes (36): acknowledgeAfterLoadedModelCleanup(), ANALYZE_REQUEST_KEYS, analyzeCandidate(), AnalyzeRequest, assertPinnedId2Label(), BUNDLED_ORT_WASM_URL, CancelRequest, CandidateFailure (+28 more)

### Community 10 - "candidateAudioEventWorkerClient.ts"
Cohesion: 0.12
Nodes (38): CandidateAudioEventFenceRejectionReason, CandidateAudioEventWorkerErrorCode, CandidateAudioEventWorkerFactory, FenceOutcome, hasExactKeys(), hasResponseKeys(), hasValidResultBase(), IDENTITY_KEYS (+30 more)

### Community 11 - "IndexedDbAnalysisResultStore"
Cohesion: 0.14
Nodes (9): assertIdentifier(), cloneJson(), IndexedDbAnalysisResultStore, InMemoryAnalysisResultStore, rejectedOperation(), sortTerminalRecordsNewestFirst(), validateAndCloneAnalysisRecord(), validateAndCloneSourceSnapshot() (+1 more)

### Community 12 - "analysisRun.ts"
Cohesion: 0.09
Nodes (32): AnalysisControlState, AnalysisControlStateInput, AnalysisRunStatus, BUSY_RUN_STATUSES, CANCELLABLE_RUN_STATUSES, deriveAnalysisControlState(), accept(), ANALYSIS_STAGES (+24 more)

### Community 13 - "localAudioReactionAnalysis.ts"
Cohesion: 0.10
Nodes (29): AUDIO_REACTION_FEATURE_WINDOW_MS, AudioReactionWorkerIdentity, AudioReactionWorkerResponse, AudioReactionWorkerResponsePayload, LocalAudioReactionAnalysisOutcome, LocalAudioReactionAnalysisProgress, LocalAudioReactionAnalysisStage, LocalAudioReactionUnavailableReason (+21 more)

### Community 14 - "analysisResultStore.ts"
Cohesion: 0.12
Nodes (36): ALL_OBJECT_STORES, AnalysisPayloadByKind, AnalysisRecord, AnalysisRecordKind, AnalysisResultStoreErrorCode, analysisSchemaFamily(), AnalysisStoreName, AnalysisTerminalRecordCatalog (+28 more)

### Community 15 - "candidateAudioEventWorkerProtocol.ts"
Cohesion: 0.12
Nodes (29): CandidateAudioEventAggregation, chronologicalDetectionOrder(), mergeCandidateAudioEventEvidence(), mergeDetectedResults(), sameBinding(), sameDetection(), sameDetectionList(), strengthRank() (+21 more)

### Community 16 - "localAudioReactionAnalysisCore.ts"
Cohesion: 0.11
Nodes (33): adjacentWindows(), amplitudeToDb(), AudioReactionCandidate, AudioReactionCandidateEvidence, AudioReactionEventKind, buildClusters(), clamp(), clampInteger() (+25 more)

### Community 17 - "localFileFingerprint.ts"
Cohesion: 0.10
Nodes (27): bytesToHex(), ContentDigestAdapter, createContentFingerprint(), fallbackFingerprint(), lengthDelimited(), abortedError(), bytesToHex(), createLocalFileFingerprint() (+19 more)

### Community 18 - "candidatePassBWorkerClient.ts"
Cohesion: 0.15
Nodes (31): CandidatePassBEventFenceRejectionReason, CandidatePassBWorkerErrorCode, CandidatePassBWorkerFactory, fenceEvent(), FenceOutcome, hasBoundedCodePointLength(), hasExactKeys(), hasResponseKeys() (+23 more)

### Community 19 - "chatImport.ts"
Cohesion: 0.12
Nodes (30): aliasAuthor(), AliasValue, AUTHOR_ALIASES, ChatImportDiagnostic, ChatImportDiagnosticCode, ChatImportDiagnosticSeverity, ChatImportFormat, ChatImportResult (+22 more)

### Community 20 - "AnalysisResultStore"
Cohesion: 0.10
Nodes (18): AnalysisManifestRecord, AnalysisResultStore, AnalysisTerminalOutcome, AnalysisTerminalRecord, FinalAnalysisResultRecord, durableCoverageDisposition(), auditRecoverableAnalysisResults(), immutableIdentityMatches() (+10 more)

### Community 21 - "compilerOptions"
Cohesion: 0.06
Nodes (30): DOM, DOM.Iterable, ES2022, src, vite/client, WebWorker, compilerOptions, allowJs (+22 more)

### Community 22 - "사람 중심 후보 검토"
Cohesion: 0.12
Nodes (30): AI 우선 하이라이트 흐름, 분석 오케스트레이터, 초심자 중심 단방향 UX, 30~60초 경계 다듬기, 중복 억제·후보 다양성, 후보 회수·탐색 슬롯, 사람 중심 후보 검토, 채팅 로그 가져오기 (+22 more)

### Community 23 - "candidatePassB.worker.ts"
Cohesion: 0.14
Nodes (23): AnalyzeRequest, CandidateFailure, candidateGap(), CandidatePcmBuilder, clamp(), clampInteger(), createEventId(), decodeCandidate() (+15 more)

### Community 24 - "candidatePassBWorkerProtocol.ts"
Cohesion: 0.11
Nodes (27): ActiveTask, CandidatePassBRunResult, FenceState, NormalizedRunInput, RunCandidatePassBWorkerOptions, identity, targets, WorkerEventType (+19 more)

### Community 25 - "candidateAudioEventWorkerClient.test.ts"
Cohesion: 0.09
Nodes (22): ActiveTask, CandidateAudioEventRunResult, CandidateAudioEventWorkerError, FenceState, NormalizedRunInput, RunCandidateAudioEventWorkerOptions, emit(), emitCandidateProgress() (+14 more)

### Community 26 - "audioReactionAnalysis.worker.ts"
Cohesion: 0.14
Nodes (17): ActiveAudioTask, AudioFeatureAccumulator, clamp(), clampInteger(), createEventId(), decodeAndScore(), disposeInputOnce(), handleCancel() (+9 more)

### Community 27 - "candidatePassB.ts"
Cohesion: 0.13
Nodes (26): buildCandidatePassBEvidence(), CandidatePassBEvidenceBase, CandidatePassBFallbackReason, CandidatePassBInputErrorCode, CandidatePassBOverlay, CandidatePassBSelectionOptions, CandidatePassBTranscriptChunk, CandidatePassBTranscriptOptions (+18 more)

### Community 28 - "localMediaPreflight.ts"
Cohesion: 0.12
Nodes (24): assertValidFile(), AUDIO_EXTENSIONS, CapabilityGlobal, createProbeWaitState(), DEFAULT_ADAPTERS, DocumentGlobal, durationSecondsToMilliseconds(), extensionFromName() (+16 more)

### Community 29 - "localVideoVisualAnalysis.ts"
Cohesion: 0.11
Nodes (22): AnalyzeLocalVideoVisualOptions, analyzeLocalVideoVisuals(), assertValidFile(), clampInteger(), copyFingerprint(), DEFAULT_ADAPTERS, DEFAULT_VISUAL_METADATA_TIMEOUT_MS, DEFAULT_VISUAL_SEEK_TIMEOUT_MS (+14 more)

### Community 30 - "candidatePassBGemini.ts"
Cohesion: 0.15
Nodes (23): analyzeCandidateWithGemini(), buildCandidatePassBGeminiRequestBody(), buildPrompt(), CANDIDATE_PASS_B_GEMINI_ENDPOINT, CandidatePassBGeminiAnalysis, CandidatePassBGeminiParseOutcome, CandidatePassBGeminiRelativeSegment, CandidatePassBGeminiRequestBody (+15 more)

### Community 31 - "runCandidateAudioEventWorker"
Cohesion: 0.10
Nodes (14): result(), CandidateAudioEventWorkerLike, fenceEvent(), hasValidDetectionTimeline(), isPreModelSourceGapReason(), matchesTarget(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout() (+6 more)

### Community 32 - "localVideoVisualAnalysisCore.ts"
Cohesion: 0.13
Nodes (23): buildVisualSampleTimestamps(), clamp(), clampInteger(), compareTransitions(), createCandidate(), createTransitionSignals(), LocalVideoVisualAnalysisDiagnostics, LocalVideoVisualAnalysisResult (+15 more)

### Community 33 - "AnalysisRun State Machine"
Cohesion: 0.14
Nodes (25): AnalysisJob AnalysisSpec and AnalysisRun Model, AnalysisRun State Machine, AppSession and Single Writer Lease, Atomic Analysis Checkpoint, AI Candidate and User Revision Merge Policy, Chat Import and Local Live Capture Lifecycles, Completed With Gaps Contract, Domain Event Envelope (+17 more)

### Community 34 - "로컬 데이터·비밀정보 보안 경계"
Cohesion: 0.14
Nodes (24): 초심자 중심 단방향 UI·UX, 상태·생애주기 우선 설계 계약, 계정·공유·공용 백엔드·클라우드 AI 제외, GitHub Pages 서버 없는 핵심 완주, 불변 StreamSaver CSS 기준과 Retto 오버라이드, 로컬 데이터·비밀정보 보안 경계, 1인용 로컬 우선 AI 편집 어시스턴트, SemVer·개발 로그·승인 후 커밋 (+16 more)

### Community 35 - "analysisResultStore.test.ts"
Cohesion: 0.12
Nodes (18): ANALYSIS_RESULT_OBJECT_STORES, AnalysisFailureRecord, AnalysisResultStoreError, ProvisionalAnalysisResultRecord, AUDIO_CANDIDATE, expectStoreError(), FakeEventHandler, FakeFileSystemHandle (+10 more)

### Community 36 - "runCandidatePassBWorker"
Cohesion: 0.12
Nodes (12): CandidatePassBWorkerLike, hasValidSegmentTimeline(), matchesTargetRange(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), runCandidatePassBWorker(), safeCandidateGapMessage(), stageRank() (+4 more)

### Community 37 - "highlightSelector.ts"
Cohesion: 0.18
Nodes (19): baselineValues(), BUCKET_SIZE_MS, clamp(), compareScoredBuckets(), createBucket(), createCandidate(), emptyResult(), finiteNonNegativeInteger() (+11 more)

### Community 38 - "compilerOptions"
Cohesion: 0.11
Nodes (18): ES2023, node, vite.config.ts, vitest.config.ts, compilerOptions, exactOptionalPropertyTypes, lib, module (+10 more)

### Community 39 - "evaluate-local-audio-fast-pass.mjs"
Cohesion: 0.19
Nodes (11): amplitudeToDb(), candidateSummary(), captureStdout(), clamp(), decodeFeatures(), main(), percentile(), probeDurationMs() (+3 more)

### Community 40 - "candidateEvidenceExplanation.test.ts"
Cohesion: 0.12
Nodes (12): CANDIDATE_EVIDENCE_EXPLANATION_VERSION, CANDIDATE_EVIDENCE_MAX_QUOTE_CODE_POINTS, CandidateEvidenceExplanationError, resolveCandidateEvidenceReplayTarget(), audioEventBase(), audioEvidence, candidate(), chatEvidence (+4 more)

### Community 41 - "candidateMerge.ts"
Cohesion: 0.15
Nodes (15): CandidateCompareOnlyReason, CandidateField, CandidateFieldMergeOutcome, CandidateMergeContext, CandidateProposal, CandidateProposalMergeOutcome, compareOnly(), globalCompareOnlyReason() (+7 more)

### Community 42 - "sourceCheck.ts"
Cohesion: 0.19
Nodes (17): accept(), assertNever(), baseOf(), createSourceCheck(), isSourceCheckTerminal(), reduceSourceCheck(), reject(), SourceCheckBase (+9 more)

### Community 43 - "candidatePassB.worker.test.ts"
Cohesion: 0.11
Nodes (9): FakeAudioSampleSink, FakeBlobSource, FakeInput, FakeInputDisposedError, FakeUnsupportedInputFormatError, identity, mediaHarness, CANDIDATE_PASS_B_DEVICE (+1 more)

### Community 44 - "loadVideoMetadata"
Cohesion: 0.20
Nodes (8): abortedError(), attemptCleanup(), cleanupResources(), defaultYieldControl(), loadVideoMetadata(), LocalVideoVisualProbe, mediaFailure(), seekVideo()

### Community 45 - "fakeEvent"
Cohesion: 0.18
Nodes (5): ControlledOpenRequest, ControlledRequest, ControlledTransaction, fakeEvent(), FakeIndexedDbHarness

### Community 46 - "chatAnalysisWorkerClient.test.ts"
Cohesion: 0.17
Nodes (11): ChatAnalysisWorkerLike, normalizeWorkerTimeout(), runChatAnalysisWorker(), emptyResult, identity, startWith(), WorkerEventType, WorkerListener (+3 more)

### Community 47 - "devDependencies"
Cohesion: 0.13
Nodes (15): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, @types/react (+7 more)

### Community 48 - "chatAnalysisWorkerProtocol.ts"
Cohesion: 0.20
Nodes (7): RunChatAnalysisWorkerInput, FakeWorker, ChatAnalysisWorkerIdentity, ChatAnalysisWorkerRequest, ChatAnalysisWorkerResponse, NormalizedChatMessage, HighlightSelectionOptions

### Community 49 - "localVideoVisualAnalysis.test.ts"
Cohesion: 0.16
Nodes (10): captureDefaultLumaFingerprint(), LocalVideoVisualCanvas, createVisualHarness(), FakeCanvas, fingerprint(), samplesFromValues(), VideoEventType, MAX_VISUAL_SAMPLE_COUNT (+2 more)

### Community 50 - "candidatePassBPresentation.test.ts"
Cohesion: 0.15
Nodes (9): CandidatePassBCue, CandidatePassBQualitySummary, MappedTranscriptChunk, CandidatePassBPresentationError, baseNarrative, cue(), expectedFastNarrativeFields, provisionalEvidence() (+1 more)

### Community 51 - "eventFence.ts"
Cohesion: 0.21
Nodes (10): ChatAnalysisWorkerError, createEventFence(), CreateEventFenceInput, EventFenceOutcome, EventFenceRejectionReason, EventFenceState, FenceableEvent, makeFence() (+2 more)

### Community 52 - "candidatePassBPresentation.ts"
Cohesion: 0.22
Nodes (12): CandidatePassBBasisLabel, CandidatePassBCuePhase, basePresentation(), buildCandidatePassBPresentation(), CANDIDATE_PASS_B_CUE_PHASE_LABELS, CandidatePassBCuePhaseLabel, CandidatePassBPresentation, CandidatePassBPresentationCue (+4 more)

### Community 53 - "chatAnalysisWorkerClient.ts"
Cohesion: 0.28
Nodes (11): ChatAnalysisWorkerFactory, hasFiniteNumberFields(), isChatCandidate(), isFenceEnvelope(), isFiniteNumber(), isHighlightSelectionResult(), isNonNegativeInteger(), isRecord() (+3 more)

### Community 54 - "localMediaPreflight.test.ts"
Cohesion: 0.18
Nodes (9): assertNonNegativeFinite(), BrowserCapabilitySnapshot, BrowserCapabilitySupport, formatBytes(), formatDuration(), Harness, ProbeEventType, ProbeListener (+1 more)

### Community 56 - "candidatePassBModelDownloadProgress.ts"
Cohesion: 0.25
Nodes (7): byteCount(), CandidatePassBModelDownloadAggregate, CandidatePassBModelDownloadTracker, DownloadFileState, isRecord(), nonEmptyBoundedString(), safeSum()

### Community 57 - ".openDatabase"
Cohesion: 0.31
Nodes (6): keyPathFor(), normalizeStoreFailure(), requestError(), storeClosedError(), terminalConflictError(), terminalRecordsAreEquivalent()

### Community 58 - "candidateReviewFeatureAvailability.ts"
Cohesion: 0.24
Nodes (7): CandidateReviewFeatureAvailability, CandidateReviewFeatureAvailabilityErrorCode, CandidateReviewFeatureAvailabilityInputError, deriveCandidateReviewFeatureAvailability(), MULTIPLE_CANDIDATE_FEATURES, NO_CANDIDATE_FEATURES, SINGLE_CANDIDATE_FEATURES

### Community 59 - "isCompletedResult"
Cohesion: 0.47
Nodes (10): hasExactKeys(), isCandidate(), isCompletedResult(), isFenceEnvelope(), isFiniteNumber(), isNonNegativeInteger(), isProgress(), isRecord() (+2 more)

### Community 61 - "dependencies"
Cohesion: 0.22
Nodes (9): @huggingface/transformers, mediabunny, dependencies, @huggingface/transformers, mediabunny, react, react-dom, react (+1 more)

### Community 62 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, build, check, dev, lint, preview, test, test:watch (+1 more)

### Community 63 - "WindowPcmBuilder"
Cohesion: 0.25
Nodes (5): CandidateAudioEventWindow, clamp(), clampInteger(), nextPowerOfTwo(), WindowPcmBuilder

### Community 64 - "isRecord"
Cohesion: 0.44
Nodes (9): hasExactKeys(), isBoundedNonEmptyString(), isDenseArray(), isNonNegativeSafeInteger(), isRecord(), isValidAnalyzeRequest(), isValidCancelRequest(), isValidIdentity() (+1 more)

### Community 65 - "candidatePassBRuntime.ts"
Cohesion: 0.28
Nodes (6): CandidatePassBRuntimeCapabilitySnapshot, CandidatePassBRuntimeSelectionOptions, LegacyCandidatePassBDevice, NavigatorWithOptionalGpu, selectCandidatePassBRuntimeDevice(), PreferredPreflightRuntimeTier

### Community 66 - "localAudioReactionAnalysisCore.test.ts"
Cohesion: 0.28
Nodes (8): AUDIO_REACTION_CANDIDATE_WINDOW_MS, AudioReactionFeatureWindow, MAX_AUDIO_REACTION_CANDIDATE_COUNT, NormalizedWindow, ScoredWindow, baseline(), setReaction(), speechWindow()

### Community 67 - "Retto Highlight"
Cohesion: 0.25
Nodes (7): CHZZK 채팅, GitHub Pages 배포, Retto Highlight, 로컬에서 실행하기, 설계 문서, 영상과 개인정보, 지금 구현된 첫 수직 슬라이스

### Community 68 - "CandidatePassBEvidence"
Cohesion: 0.36
Nodes (6): CandidateEvidenceExplanationInput, CandidatePassBEvidence, evidenceQualityRank(), mergeCandidatePassBEvidence(), fallback, provisional

### Community 69 - "isValidAnalyzeRequest"
Cohesion: 0.57
Nodes (8): hasExactKeys(), isNonEmptyString(), isNonNegativeSafeInteger(), isRecord(), isValidAnalyzeRequest(), isValidCancelRequest(), isValidIdentity(), isValidTarget()

### Community 70 - "FakeWorker"
Cohesion: 0.29
Nodes (3): AudioReactionWorkerRequest, emitResponse(), FakeWorker

### Community 72 - "LocalMediaPreflightAdapters"
Cohesion: 0.25
Nodes (3): createDefaultObjectURL(), LocalMediaPreflightAdapters, revokeDefaultObjectURL()

### Community 73 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 74 - "candidatePassB.test.ts"
Cohesion: 0.29
Nodes (4): CandidatePassBInputError, CandidatePassBSourceCandidate, CandidatePassBTarget, target

### Community 76 - "selectCandidatePassBTargets"
Cohesion: 0.40
Nodes (6): assertCandidate(), assertMaxCandidates(), assertSourceDuration(), assertTarget(), compareCandidateSelection(), selectCandidatePassBTargets()

### Community 77 - "CandidatePassBWorkerFailureReason"
Cohesion: 0.47
Nodes (4): GeminiWorkerFailure, CandidatePassBGeminiHttpFailure, CandidatePassBWorkerError, CandidatePassBWorkerFailureReason

### Community 78 - "Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?, Source Nodes

### Community 79 - "Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지, Source Nodes

### Community 80 - "Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사, Source Nodes

### Community 81 - "Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해, Source Nodes

### Community 82 - "Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로, Source Nodes

### Community 83 - "Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?, Source Nodes

### Community 84 - "Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Trace candidate array order consumers and design CandidateRankingProposal lifecycle, Source Nodes

### Community 85 - "Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3.5 후보 재정렬 제안은 canonical 후보, 정밀 근거, 검토·경계·미리보기·export를 어떻게 안전하게 분리해야 하는가?, Source Nodes

### Community 86 - "Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Beginner UX audit for per-candidate event and reaction explanations including evidence lifecycle states., Source Nodes

### Community 87 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요., Source Nodes

### Community 88 - "Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요."
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 v0.3.6 미커밋 diff를 초심자 UI/UX, 접근성, 모바일, 과장 표현 관점에서 다시 읽기 전용 감사해 주세요. App.tsx, styles/retto-highlight.css, README와 새 설명 모듈을 보되 수정은 하지 말고 P0/P1/P2만 파일·라인 근거로 보고하세요. 이전 지적이 실제로 해결됐는지도 확인하세요., Source Nodes

### Community 89 - "Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 후보별 사건·반응 설명을 어떤 근거 경계로 구현하고 UI에 연결해야 하나?, Source Nodes

### Community 90 - "Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재 repo에서 local Whisper CandidatePassB 흐름을 Gemini API 기반 후보 오디오 전사/사건 설명으로 교체하거나 병행하는 최소 안전 수직 슬라이스, Source Nodes

### Community 91 - "Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How does App start Gemini candidate analysis and keep the response fenced from canonical editing state?, Source Nodes

### Community 92 - "Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?"
Cohesion: 0.50
Nodes (3): Answer, Outcome, Q: Should v0.3.6 add a Korean text generator or deterministic evidence explanation?

### Community 94 - "highlightSelector.test.ts"
Cohesion: 0.83
Nodes (3): addCollectiveSpike(), message(), quietBaseline()

### Community 95 - "appendHiddenElement"
Cohesion: 0.83
Nodes (4): appendHiddenElement(), createDefaultCanvas(), createDefaultVideoProbe(), requireDocument()

## Knowledge Gaps
- **446 isolated node(s):** `지금 구현된 첫 수직 슬라이스`, `영상과 개인정보`, `CHZZK 채팅`, `로컬에서 실행하기`, `GitHub Pages 배포` (+441 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `App()` (11× useful, score=10.941398882) _(code changed — re-verify)_
- `fuseHighlightCandidates()` (4× useful, score=3.970148174)
- `runCandidatePassBWorker()` (3× useful, score=2.994466508)
- `selectChatHighlights()` (3× useful, score=2.972948655)
- `selectVisualHighlightsFromSamples()` (3× useful, score=2.972948655)
- `buildCandidatePassBEvidence()` (2× useful, score=1.99446968)
- `reduceCandidatePassBRun()` (2× useful, score=1.99446968)
- `durableAnalysisPayload.ts` (2× useful, score=1.989295557)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selectVisualHighlightsFromSamples()` connect `localVideoVisualAnalysisCore.ts` to `localVideoVisualAnalysis.test.ts`, `candidateRanking.ts`, `localVideoVisualAnalysis.ts`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `accepted()` connect `candidateRanking.ts` to `localVideoVisualAnalysisCore.ts`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `UnifiedHighlightCandidate` connect `highlightExport.ts` to `highlightFusion.ts`, `candidateRanking.ts`, `CandidatePassBEvidence`, `durableAnalysisPayload.ts`, `candidateEvidenceExplanation.ts`, `candidateEvidenceExplanation.test.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `App()` (e.g. with `candidateEvidenceUnknownLabel()` and `initialTheme()`) actually correct?**
  _`App()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `지금 구현된 첫 수직 슬라이스`, `영상과 개인정보`, `CHZZK 채팅` to the rest of the system?**
  _446 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `highlightExport.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.061828952239911146 - nodes in this community are weakly interconnected._
- **Should `highlightFusion.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0624048706240487 - nodes in this community are weakly interconnected._