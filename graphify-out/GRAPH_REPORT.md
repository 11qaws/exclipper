# Graph Report - workspace  (2026-07-20)

## Corpus Check
- 99 files · ~143,549 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1729 nodes · 3738 edges · 93 communities (81 shown, 12 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a252cbce`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- 운영·릴리스 안전성
- 개인용 Pages 제품 경계
- 멀티모달 AI 분석
- CHZZK 채팅·정적 제약
- 원본·출력 어댑터
- 입력·모델 스냅샷
- 분석 실행·종료 계약
- AI 후보·사람 검토
- 이벤트 식별·펜싱
- 초심자 UI·스타일
- 후보 수정·안전 경계
- 저장·복구 커밋
- candidateMerge.ts
- eventFence.ts
- Retto Highlight
- tsconfig.json
- localVideoVisualAnalysis.ts
- loadVideoMetadata
- analyzeLocalVideoVisuals
- fakeEvent
- localVideoVisualAnalysis.test.ts
- FakeVideoProbe
- inspectLocalMedia
- FakeVideoProbe
- localMediaPreflight.test.ts
- cleanupResources
- LocalMediaPreflightAdapters
- createContentFingerprint
- highlightSelector.ts
- AnalysisResultStore
- durableAnalysisPayload.ts
- App.tsx
- sourceCheck.ts
- chatAnalysisWorkerClient.ts
- runChatAnalysisWorker
- chatAnalysisWorkerProtocol.ts
- InMemoryAnalysisResultStore
- FakeWorker
- Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?
- highlightSelector.test.ts
- IndexedDbAnalysisResultStore
- localAudioReactionAnalysis.ts
- sourceCheck.ts
- audioReactionAnalysis.worker.ts
- AudioFeatureAccumulator
- analyzeLocalAudioReactions
- HighlightSelectionResult
- highlightNarrative.ts
- scripts
- highlightExport.test.ts
- inspectLocalMedia
- dependencies
- package.json
- Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지
- Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사
- Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해
- EventFenceRejectionReason
- eslint-plugin-react-hooks
- eslint-plugin-react-refresh
- @types/react
- typescript
- @vitejs/plugin-react
- vitest
- localMediaPreflight.test.ts
- LocalMediaPreflightAdapters
- AudioReactionWorkerIdentity
- candidatePassBRuntime.ts
- appendHiddenElement
- candidatePassBAudioGate.ts
- CandidatePassBCandidateGapReason
- CandidatePassBWorkerError
- @types/node
- typescript-eslint
- vite
- Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?
- appendHiddenElement
- @eslint/js
- candidateAudioEventWorkerClient.ts
- candidateAudioEventEvidenceState.test.ts
- candidateBoundaryRevision.ts
- candidateAudioEventWorkerProtocol.ts
- highlightNarrative.ts
- fakeEvent
- highlightFusion.test.ts
- candidateAudioEventEvidenceState.ts
- createReactionUnifiedCandidate
- AudioFeatureAccumulator
- EventFenceRejectionReason
- MAX_CANDIDATE_AUDIO_EVENT_CANDIDATES

## God Nodes (most connected - your core abstractions)
1. `App()` - 67 edges
2. `analyzeLocalVideoVisuals()` - 24 edges
3. `IndexedDbAnalysisResultStore` - 23 edges
4. `invalid()` - 23 edges
5. `compilerOptions` - 23 edges
6. `runCandidateAudioEventWorker()` - 20 edges
7. `runCandidatePassBWorker()` - 19 edges
8. `fuseReactionHighlightCandidates()` - 19 edges
9. `inspectLocalMedia()` - 18 edges
10. `InMemoryAnalysisResultStore` - 18 edges

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

## Communities (93 total, 12 thin omitted)

### Community 0 - "운영·릴리스 안전성"
Cohesion: 0.14
Nodes (24): 초심자 중심 단방향 UI·UX, 상태·생애주기 우선 설계 계약, 계정·공유·공용 백엔드·클라우드 AI 제외, GitHub Pages 서버 없는 핵심 완주, 불변 StreamSaver CSS 기준과 Retto 오버라이드, 로컬 데이터·비밀정보 보안 경계, 1인용 로컬 우선 AI 편집 어시스턴트, SemVer·개발 로그·승인 후 커밋 (+16 more)

### Community 1 - "개인용 Pages 제품 경계"
Cohesion: 0.11
Nodes (17): AUDIO_EXTENSIONS, BrowserCapabilitySnapshot, BrowserCapabilitySupport, CapabilityGlobal, DEFAULT_ADAPTERS, DocumentGlobal, InspectLocalMediaOptions, kindFromFile() (+9 more)

### Community 2 - "멀티모달 AI 분석"
Cohesion: 0.12
Nodes (30): AI 우선 하이라이트 흐름, 분석 오케스트레이터, 초심자 중심 단방향 UX, 30~60초 경계 다듬기, 중복 억제·후보 다양성, 후보 회수·탐색 슬롯, 사람 중심 후보 검토, 채팅 로그 가져오기 (+22 more)

### Community 3 - "CHZZK 채팅·정적 제약"
Cohesion: 0.09
Nodes (32): AnalysisControlState, AnalysisControlStateInput, AnalysisRunStatus, BUSY_RUN_STATUSES, CANCELLABLE_RUN_STATUSES, deriveAnalysisControlState(), accept(), ANALYSIS_STAGES (+24 more)

### Community 4 - "원본·출력 어댑터"
Cohesion: 0.12
Nodes (30): aliasAuthor(), AliasValue, AUTHOR_ALIASES, ChatImportDiagnostic, ChatImportDiagnosticCode, ChatImportDiagnosticSeverity, ChatImportFormat, ChatImportResult (+22 more)

### Community 5 - "입력·모델 스냅샷"
Cohesion: 0.14
Nodes (25): AnalysisJob AnalysisSpec and AnalysisRun Model, AnalysisRun State Machine, AppSession and Single Writer Lease, Atomic Analysis Checkpoint, AI Candidate and User Revision Merge Policy, Chat Import and Local Live Capture Lifecycles, Completed With Gaps Contract, Domain Event Envelope (+17 more)

### Community 6 - "분석 실행·종료 계약"
Cohesion: 0.06
Nodes (30): DOM, DOM.Iterable, ES2022, src, vite/client, WebWorker, compilerOptions, allowJs (+22 more)

### Community 7 - "AI 후보·사람 검토"
Cohesion: 0.13
Nodes (15): eslint, eslint-plugin-react-refresh, globals, devDependencies, eslint, eslint-plugin-react-refresh, globals, @types/react (+7 more)

### Community 8 - "이벤트 식별·펜싱"
Cohesion: 0.13
Nodes (35): ALL_OBJECT_STORES, AnalysisPayloadByKind, AnalysisRecord, AnalysisRecordKind, AnalysisResultStoreErrorCode, analysisSchemaFamily(), AnalysisStoreName, AnalysisTerminalRecordCatalog (+27 more)

### Community 9 - "초심자 UI·스타일"
Cohesion: 0.15
Nodes (14): createEventFence(), CreateEventFenceInput, EventFenceOutcome, EventFenceState, FenceableEvent, fenceEvent(), reject(), makeFence() (+6 more)

### Community 10 - "후보 수정·안전 경계"
Cohesion: 0.09
Nodes (47): attachVisualContext(), AUDIO_EVENT_KINDS, AudioReactionEventKind, canonicalSignalKinds(), clamp(), compareDrafts(), comparePairProposals(), comparePreparedCandidates() (+39 more)

### Community 11 - "저장·복구 커밋"
Cohesion: 0.11
Nodes (18): ES2023, node, vite.config.ts, vitest.config.ts, compilerOptions, exactOptionalPropertyTypes, lib, module (+10 more)

### Community 12 - "candidateMerge.ts"
Cohesion: 0.15
Nodes (15): CandidateCompareOnlyReason, CandidateField, CandidateFieldMergeOutcome, CandidateMergeContext, CandidateProposal, CandidateProposalMergeOutcome, compareOnly(), globalCompareOnlyReason() (+7 more)

### Community 13 - "eventFence.ts"
Cohesion: 0.13
Nodes (23): buildVisualSampleTimestamps(), clamp(), clampInteger(), compareTransitions(), createCandidate(), createTransitionSignals(), LocalVideoVisualAnalysisDiagnostics, LocalVideoVisualAnalysisResult (+15 more)

### Community 14 - "Retto Highlight"
Cohesion: 0.25
Nodes (7): CHZZK 채팅, GitHub Pages 배포, Retto Highlight, 로컬에서 실행하기, 설계 문서, 영상과 개인정보, 지금 구현된 첫 수직 슬라이스

### Community 20 - "localVideoVisualAnalysis.ts"
Cohesion: 0.11
Nodes (22): AnalyzeLocalVideoVisualOptions, analyzeLocalVideoVisuals(), assertValidFile(), clampInteger(), copyFingerprint(), DEFAULT_ADAPTERS, DEFAULT_VISUAL_METADATA_TIMEOUT_MS, DEFAULT_VISUAL_SEEK_TIMEOUT_MS (+14 more)

### Community 21 - "loadVideoMetadata"
Cohesion: 0.20
Nodes (8): abortedError(), attemptCleanup(), cleanupResources(), defaultYieldControl(), loadVideoMetadata(), LocalVideoVisualProbe, mediaFailure(), seekVideo()

### Community 22 - "analyzeLocalVideoVisuals"
Cohesion: 0.10
Nodes (38): amplitudeToDb(), AUDIO_REACTION_CANDIDATE_WINDOW_MS, AudioReactionCandidate, AudioReactionCandidateEvidence, AudioReactionEventKind, AudioReactionFeatureWindow, buildClusters(), clamp() (+30 more)

### Community 23 - "fakeEvent"
Cohesion: 0.12
Nodes (18): ANALYSIS_RESULT_OBJECT_STORES, AnalysisFailureRecord, AnalysisResultStoreError, ProvisionalAnalysisResultRecord, AUDIO_CANDIDATE, expectStoreError(), FakeEventHandler, FakeFileSystemHandle (+10 more)

### Community 24 - "localVideoVisualAnalysis.test.ts"
Cohesion: 0.16
Nodes (10): captureDefaultLumaFingerprint(), LocalVideoVisualCanvas, createVisualHarness(), FakeCanvas, fingerprint(), samplesFromValues(), VideoEventType, MAX_VISUAL_SAMPLE_COUNT (+2 more)

### Community 26 - "inspectLocalMedia"
Cohesion: 0.23
Nodes (17): LocalAudioReactionAnalysisStage, hasExactKeys(), isCandidate(), isCompletedResult(), isFenceEnvelope(), isFiniteNumber(), isNonNegativeInteger(), isProgress() (+9 more)

### Community 27 - "FakeVideoProbe"
Cohesion: 0.13
Nodes (5): expectCoreCleanup(), FakeVideoProbe, Harness, ProbeEventType, ProbeListener

### Community 28 - "localMediaPreflight.test.ts"
Cohesion: 0.22
Nodes (7): assertIdentifier(), cloneJson(), InMemoryAnalysisResultStore, rejectedOperation(), validateAndCloneAnalysisRecord(), validateAndCloneSourceSnapshot(), validateAndCloneTerminalRecord()

### Community 30 - "LocalMediaPreflightAdapters"
Cohesion: 0.17
Nodes (8): IndexedDbAnalysisResultStore, keyPathFor(), normalizeStoreFailure(), requestError(), sortTerminalRecordsNewestFirst(), storeClosedError(), terminalConflictError(), terminalRecordsAreEquivalent()

### Community 31 - "createContentFingerprint"
Cohesion: 0.10
Nodes (27): bytesToHex(), ContentDigestAdapter, createContentFingerprint(), fallbackFingerprint(), lengthDelimited(), abortedError(), bytesToHex(), createLocalFileFingerprint() (+19 more)

### Community 32 - "highlightSelector.ts"
Cohesion: 0.18
Nodes (19): baselineValues(), BUCKET_SIZE_MS, clamp(), compareScoredBuckets(), createBucket(), createCandidate(), emptyResult(), finiteNonNegativeInteger() (+11 more)

### Community 33 - "AnalysisResultStore"
Cohesion: 0.09
Nodes (17): AnalysisManifestRecord, AnalysisResultStore, AnalysisTerminalOutcome, AnalysisTerminalRecord, FinalAnalysisResultRecord, auditRecoverableAnalysisResults(), immutableIdentityMatches(), isCompletedTerminal() (+9 more)

### Community 34 - "durableAnalysisPayload.ts"
Cohesion: 0.11
Nodes (52): ANALYSIS_INPUT_KEYS, asPlainRecord(), assertAudioEvidence(), assertAudioGapReason(), assertBoolean(), assertCandidate(), assertChatEvidence(), assertChatInput() (+44 more)

### Community 35 - "App.tsx"
Cohesion: 0.07
Nodes (46): highlightReasonForSignalKinds(), AnalysisCoverageSummary, AnalysisGapApprovalEvidence, analysisRunLabel(), AnalysisSelectionSummary, App(), applyAnalysisEvent(), applySourceEvent() (+38 more)

### Community 36 - "sourceCheck.ts"
Cohesion: 0.13
Nodes (31): UnifiedHighlightCandidate, CandidateBoundaryProvenance, CandidateBoundaryRevision, CandidateTimeRange, ApprovedHighlightExportCandidate, assertMilliseconds(), chronologicalCandidates(), createCsv() (+23 more)

### Community 37 - "chatAnalysisWorkerClient.ts"
Cohesion: 0.28
Nodes (11): ChatAnalysisWorkerFactory, hasFiniteNumberFields(), isChatCandidate(), isFenceEnvelope(), isFiniteNumber(), isHighlightSelectionResult(), isNonNegativeInteger(), isRecord() (+3 more)

### Community 38 - "runChatAnalysisWorker"
Cohesion: 0.20
Nodes (9): ChatAnalysisWorkerLike, normalizeWorkerTimeout(), runChatAnalysisWorker(), emptyResult, identity, startWith(), WorkerEventType, WorkerListener (+1 more)

### Community 39 - "chatAnalysisWorkerProtocol.ts"
Cohesion: 0.20
Nodes (7): RunChatAnalysisWorkerInput, FakeWorker, ChatAnalysisWorkerIdentity, ChatAnalysisWorkerRequest, ChatAnalysisWorkerResponse, NormalizedChatMessage, HighlightSelectionOptions

### Community 41 - "FakeWorker"
Cohesion: 0.13
Nodes (26): buildCandidatePassBEvidence(), CandidatePassBEvidenceBase, CandidatePassBFallbackReason, CandidatePassBInputErrorCode, CandidatePassBOverlay, CandidatePassBSelectionOptions, CandidatePassBTranscriptChunk, CandidatePassBTranscriptOptions (+18 more)

### Community 42 - "Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: How do durable analysis records prevent raw chat and nickname leakage through arbitrary nested fields?, Source Nodes

### Community 43 - "highlightSelector.test.ts"
Cohesion: 0.83
Nodes (3): addCollectiveSpike(), message(), quietBaseline()

### Community 44 - "IndexedDbAnalysisResultStore"
Cohesion: 0.07
Nodes (53): CANDIDATE_AUDIO_EVENT_PROTOCOL_VERSION, accept(), assertCandidateAudioEventRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES, CandidateAudioEventCancelTerminationKind, CandidateAudioEventCandidateOutcome (+45 more)

### Community 45 - "localAudioReactionAnalysis.ts"
Cohesion: 0.13
Nodes (24): ActiveAudioTask, clampInteger(), createEventId(), decodeAndScore(), disposeInputOnce(), handleCancel(), isUnsupportedAudioCodecError(), MutableFeatureWindow (+16 more)

### Community 46 - "sourceCheck.ts"
Cohesion: 0.19
Nodes (17): accept(), assertNever(), baseOf(), createSourceCheck(), isSourceCheckTerminal(), reduceSourceCheck(), reject(), SourceCheckBase (+9 more)

### Community 47 - "audioReactionAnalysis.worker.ts"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 0.3 오디오 반응부터 설명·저장·내보내기까지의 경로, Source Nodes

### Community 48 - "AudioFeatureAccumulator"
Cohesion: 0.12
Nodes (14): AudioAnalysisOutcome, AudioReactionWorkerRequest, completeResult, decodingProgress, emitResponse(), fakeVideoFile(), FakeWorker, identity (+6 more)

### Community 49 - "analyzeLocalAudioReactions"
Cohesion: 0.07
Nodes (56): accept(), assertCandidatePassBRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_PASS_B_TERMINAL_STATUSES, candidateEventRejection(), CandidatePassBCancelTerminationKind, CandidatePassBCandidateFailureReasonCode (+48 more)

### Community 50 - "HighlightSelectionResult"
Cohesion: 0.15
Nodes (9): CandidatePassBCue, CandidatePassBQualitySummary, MappedTranscriptChunk, CandidatePassBPresentationError, baseNarrative, cue(), expectedFastNarrativeFields, provisionalEvidence() (+1 more)

### Community 51 - "highlightNarrative.ts"
Cohesion: 0.22
Nodes (12): CandidatePassBBasisLabel, CandidatePassBCuePhase, basePresentation(), buildCandidatePassBPresentation(), CANDIDATE_PASS_B_CUE_PHASE_LABELS, CandidatePassBCuePhaseLabel, CandidatePassBPresentation, CandidatePassBPresentationCue (+4 more)

### Community 52 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, build, check, dev, lint, preview, test, test:watch (+1 more)

### Community 53 - "highlightExport.test.ts"
Cohesion: 0.14
Nodes (30): AnalyzeRequest, BUNDLED_ORT_WASM_URL, candidateGap(), clampInteger(), configureBundledOrtWasm(), createEventId(), DecodedCandidate, disposeInputOnce() (+22 more)

### Community 54 - "inspectLocalMedia"
Cohesion: 0.20
Nodes (11): assertValidFile(), createProbeWaitState(), durationSecondsToMilliseconds(), extensionFromName(), inspectLocalMedia(), normalizeCapabilities(), ProbeWaitState, resolveAdapters() (+3 more)

### Community 55 - "dependencies"
Cohesion: 0.22
Nodes (9): @huggingface/transformers, mediabunny, dependencies, @huggingface/transformers, mediabunny, react, react-dom, react (+1 more)

### Community 56 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 57 - "Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 현재의 하이라이트 검출은 무슨 기준을 사용하고 있지, Source Nodes

### Community 58 - "Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 스트리머 반응 중심 목표 대비 현재 하이라이트 검출 신호의 적합성, 오탐, 미탐, 다음 구조를 감사, Source Nodes

### Community 59 - "Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: 근데 클립이란건 스트리머의 반응을 보는거지 화려한 연출을 보는게 아니야. 이게 맞는 접근인지 알려진 다른 사례들과 함께 확인해, Source Nodes

### Community 60 - "EventFenceRejectionReason"
Cohesion: 0.11
Nodes (27): ActiveTask, CandidatePassBRunResult, CandidatePassBWorkerError, FenceState, RunCandidatePassBWorkerOptions, identity, targets, WorkerEventType (+19 more)

### Community 62 - "eslint-plugin-react-refresh"
Cohesion: 0.18
Nodes (26): CandidatePassBEventFenceRejectionReason, CandidatePassBWorkerErrorCode, CandidatePassBWorkerFactory, FenceOutcome, hasExactKeys(), hasResponseKeys(), isCandidateGap(), isCandidateProgress() (+18 more)

### Community 63 - "@types/react"
Cohesion: 0.08
Nodes (43): aggregateCandidateAudioEventScores(), aggregationQuality(), aggregationQualityTuple(), assertAndIndexWindowScores(), assertScoreVector(), assertTarget(), assertTargetSet(), baseResult() (+35 more)

### Community 65 - "@vitejs/plugin-react"
Cohesion: 0.11
Nodes (13): CandidatePassBWorkerLike, fenceEvent(), hasValidSegmentTimeline(), matchesTargetRange(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), rejectFence(), runCandidatePassBWorker() (+5 more)

### Community 66 - "vitest"
Cohesion: 0.06
Nodes (60): CandidateAudioEventWindow, acknowledgeAfterLoadedModelCleanup(), ANALYZE_REQUEST_KEYS, analyzeCandidate(), AnalyzeRequest, assertPinnedId2Label(), BUNDLED_ORT_WASM_URL, CancelRequest (+52 more)

### Community 67 - "localMediaPreflight.test.ts"
Cohesion: 0.24
Nodes (7): CandidatePcmBuilder, clamp(), decodeCandidate(), isUnsupportedAudioCodecError(), nextPowerOfTwo(), NormalizedRunInput, CandidatePassBTarget

### Community 68 - "LocalMediaPreflightAdapters"
Cohesion: 0.22
Nodes (3): createDefaultObjectURL(), LocalMediaPreflightAdapters, revokeDefaultObjectURL()

### Community 69 - "AudioReactionWorkerIdentity"
Cohesion: 0.06
Nodes (24): CandidateAudioEventWorkerError, CandidateAudioEventWorkerLike, fenceEvent(), hasValidDetectionTimeline(), isPreModelSourceGapReason(), matchesTarget(), normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout() (+16 more)

### Community 70 - "candidatePassBRuntime.ts"
Cohesion: 0.32
Nodes (5): CandidatePassBRuntimeCapabilitySnapshot, CandidatePassBRuntimeSelectionOptions, NavigatorWithOptionalGpu, selectCandidatePassBRuntimeDevice(), PreferredPreflightRuntimeTier

### Community 71 - "appendHiddenElement"
Cohesion: 0.36
Nodes (6): CandidatePassBEvidence, CandidatePassBEvidenceById, evidenceQualityRank(), mergeCandidatePassBEvidence(), fallback, provisional

### Community 72 - "candidatePassBAudioGate.ts"
Cohesion: 0.29
Nodes (4): CandidatePassBInputError, CandidatePassBSourceCandidate, CandidatePassBTarget, target

### Community 74 - "CandidatePassBWorkerError"
Cohesion: 0.40
Nodes (6): assertCandidate(), assertMaxCandidates(), assertSourceDuration(), assertTarget(), compareCandidateSelection(), selectCandidatePassBTargets()

### Community 78 - "Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Candidate Pass B 구조가 App, Worker, provisional evidence, finalizing 완료 fence를 어떻게 연결하는가?, Source Nodes

### Community 79 - "appendHiddenElement"
Cohesion: 0.83
Nodes (4): appendHiddenElement(), createDefaultCanvas(), createDefaultVideoProbe(), requireDocument()

### Community 81 - "candidateAudioEventWorkerClient.ts"
Cohesion: 0.12
Nodes (37): CandidateAudioEventFenceRejectionReason, CandidateAudioEventRunResult, CandidateAudioEventWorkerErrorCode, CandidateAudioEventWorkerFactory, FenceOutcome, hasExactKeys(), hasResponseKeys(), hasValidResultBase() (+29 more)

### Community 82 - "candidateAudioEventEvidenceState.test.ts"
Cohesion: 0.13
Nodes (20): CandidateAudioEventAggregation, DetectionDraft, base, result(), buildCandidateAudioEventPresentation(), CandidateAudioEventCuePresentation, candidateAudioEventKindLabel(), CandidateAudioEventPresentation (+12 more)

### Community 83 - "candidateBoundaryRevision.ts"
Cohesion: 0.18
Nodes (19): applyCandidateBoundaryCommand(), BoundaryCommandBase, CandidateBoundaryAdjustmentReason, CandidateBoundaryCommand, CandidateBoundaryIgnoreReason, CandidateBoundaryProposalInput, CandidateBoundaryRejectionReason, CandidateBoundaryTransition (+11 more)

### Community 84 - "candidateAudioEventWorkerProtocol.ts"
Cohesion: 0.15
Nodes (16): ActiveTask, FenceState, NormalizedRunInput, RunCandidateAudioEventWorkerOptions, CANDIDATE_AUDIO_EVENT_WINDOW_DURATION_MS, CandidateAudioEventCandidateProgress, CandidateAudioEventDetectedResult, CandidateAudioEventModelDescriptor (+8 more)

### Community 85 - "highlightNarrative.ts"
Cohesion: 0.29
Nodes (14): audienceReactionExplanation(), audioRange(), buildHighlightNarrative(), chatRange(), eventExplanation(), HighlightInterpretationBasis, recommendationExplanation(), relationBetween() (+6 more)

### Community 86 - "fakeEvent"
Cohesion: 0.18
Nodes (5): ControlledOpenRequest, ControlledRequest, ControlledTransaction, fakeEvent(), FakeIndexedDbHarness

### Community 87 - "highlightFusion.test.ts"
Cohesion: 0.16
Nodes (11): AudioHighlightCandidate, AudioHighlightCandidateEvidence, NormalizedSignalEvidence, chatCandidate(), chatEvidence(), TestVisualEvidence, UnifiedAudioEvidence, UnifiedChatEvidence (+3 more)

### Community 88 - "candidateAudioEventEvidenceState.ts"
Cohesion: 0.36
Nodes (9): CandidateAudioEventEvidenceById, chronologicalDetectionOrder(), mergeCandidateAudioEventEvidence(), mergeDetectedResults(), sameBinding(), sameDetection(), sameDetectionList(), strengthRank() (+1 more)

### Community 89 - "createReactionUnifiedCandidate"
Cohesion: 0.31
Nodes (10): createAudioEvidence(), createChatEvidence(), createReactionUnifiedCandidate(), createUnifiedCandidate(), createVisualEvidence(), finiteNumberOrDefault(), normalizedEvidence(), reactionReasonForSignalKinds() (+2 more)

### Community 90 - "AudioFeatureAccumulator"
Cohesion: 0.31
Nodes (3): AudioFeatureAccumulator, clamp(), nextPowerOfTwo()

### Community 91 - "EventFenceRejectionReason"
Cohesion: 0.60
Nodes (3): ChatAnalysisWorkerError, EventFenceRejectionReason, LocalAudioReactionAnalysisError

## Knowledge Gaps
- **352 isolated node(s):** `name`, `private`, `version`, `type`, `node` (+347 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Preferred sources** — corroborated by past sessions; start here.
- `App()` (6× useful, score=5.976996166) _(code changed — re-verify)_
- `fuseHighlightCandidates()` (3× useful, score=2.98689088)
- `selectChatHighlights()` (3× useful, score=2.98689088)
- `selectVisualHighlightsFromSamples()` (3× useful, score=2.98689088)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `analyzeLocalVideoVisuals()` connect `localVideoVisualAnalysis.ts` to `App.tsx`, `InMemoryAnalysisResultStore`, `eventFence.ts`, `loadVideoMetadata`, `localVideoVisualAnalysis.test.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `IndexedDbAnalysisResultStore` connect `LocalMediaPreflightAdapters` to `AnalysisResultStore`, `App.tsx`, `이벤트 식별·펜싱`, `fakeEvent`, `localMediaPreflight.test.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `FakeVideoProbe` connect `FakeVideoProbe` to `localVideoVisualAnalysis.test.ts`, `loadVideoMetadata`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `App()` (e.g. with `result()` and `event()`) actually correct?**
  _`App()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _352 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `운영·릴리스 안전성` be split into smaller, more focused modules?**
  _Cohesion score 0.14130434782608695 - nodes in this community are weakly interconnected._
- **Should `개인용 Pages 제품 경계` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._