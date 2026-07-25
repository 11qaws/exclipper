# Graph Report - .  (2026-07-25)

## Corpus Check
- 231 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2855 nodes · 6690 edges · 146 communities (125 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 140
- Community 141
- Community 142

## God Nodes (most connected - your core abstractions)
1. `App()` - 165 edges
2. `IndexedDbAnalysisResultStore` - 27 edges
3. `UnifiedHighlightCandidate` - 24 edges
4. `analyzeLocalVideoVisuals()` - 24 edges
5. `rejectedOperation()` - 24 edges
6. `InMemoryAnalysisResultStore` - 23 edges
7. `invalid()` - 23 edges
8. `compilerOptions` - 23 edges
9. `extractBroadcastContextDeepseekResponse()` - 21 edges
10. `handleBroadcastTranscriptRequest()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `requestContext()` --calls--> `createBroadcastContextRequest()`  [EXTRACTED]
  scripts/evaluate-live-caption-context.mjs → src/analysis/broadcastContextProtocol.ts
- `row()` --calls--> `contrastBetween()`  [EXTRACTED]
  dev/gen-palettes.mjs → src/app/streamerPalette.ts
- `parseChatImport()` --indirect_call--> `row()`  [INFERRED]
  src/analysis/chatImport.ts → dev/gen-palettes.mjs
- `rowsFromJsonContainer()` --indirect_call--> `row()`  [INFERRED]
  src/analysis/chatImport.ts → dev/gen-palettes.mjs
- `buildFastPassCandidates()` --calls--> `calculateTemporalEventDensity()`  [EXTRACTED]
  scripts/evaluate-live-caption-context.mjs → src/analysis/temporalPointProcess.ts

## Import Cycles
- None detected.

## Communities (146 total, 21 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (73): BroadcastContextDiscoveredLeadCategory, attachVisualContext(), AUDIO_EVENT_KINDS, AudioHighlightCandidate, AudioHighlightCandidateEvidence, AudioReactionEventKind, canonicalSignalKinds(), clamp() (+65 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (65): UnifiedHighlightCandidate, audienceReactionExplanation(), audioRange(), buildHighlightNarrative(), chatRange(), eventExplanation(), HighlightInterpretationBasis, recommendationExplanation() (+57 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (53): BROADCAST_TRANSCRIPT_ACTIVE_MODEL_REVISION, candidateAudioEventKindLabel(), CandidateEvidenceUnknown, CandidatePassBWorkerError, AnalysisCoverageSummary, AnalysisGapApprovalEvidence, AnalysisSelectionSummary, App() (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (50): here, IMG, BroadcastContextInputError, CandidatePassBParticipantRole, AMORETTO_CHANNEL_CAST_ROSTER_ID, CANDIDATE_PASS_B_CAST_ROSTER_VERSION, CandidatePassBCastReference, candidatePassBCastReferenceForName() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (49): acknowledgeAfterLoadedModelCleanup(), ANALYZE_REQUEST_KEYS, analyzeCandidate(), AnalyzeRequest, assertPinnedId2Label(), BUNDLED_ORT_WASM_URL, CancelRequest, CandidateFailure (+41 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (54): accept(), assertCandidateAudioEventRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_AUDIO_EVENT_TERMINAL_STATUSES, CandidateAudioEventCancelTerminationKind, CandidateAudioEventCandidateOutcome, CandidateAudioEventCandidateSnapshot (+46 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (53): accept(), assertCandidatePassBRunInvariant(), baseAfterWorkerEvent(), baseOf(), CANDIDATE_PASS_B_TERMINAL_STATUSES, candidateEventRejection(), CandidatePassBCancelTerminationKind, CandidatePassBCandidateOutcome (+45 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (53): UnifiedHighlightEvidence, ANALYSIS_INPUT_KEYS, asPlainRecord(), assertAudioEvidence(), assertAudioGapReason(), assertBoolean(), assertCandidate(), assertChatEvidence() (+45 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (44): aggregateCandidateAudioEventScores(), aggregationQuality(), aggregationQualityTuple(), assertAndIndexWindowScores(), assertScoreVector(), assertTarget(), assertTargetSet(), baseResult() (+36 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (42): isCandidatePassBContextPacket(), CandidatePassBEventFenceRejectionReason, CandidatePassBWorkerErrorCode, CandidatePassBWorkerFactory, CandidatePassBWorkerLike, fenceEvent(), FenceOutcome, hasBoundedCodePointLength() (+34 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (45): CANDIDATE_PASS_B_CONTEXTLESS_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_CONTEXTLESS_QWEN_MODEL_REVISION, CANDIDATE_PASS_B_CONTEXTLESS_ROUTING_MODEL_REVISION, CANDIDATE_PASS_B_GEMINI_MODEL_ID, CANDIDATE_PASS_B_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_ID, CANDIDATE_PASS_B_LEGACY_GEMINI_MODEL_REVISION, CANDIDATE_PASS_B_LEGACY_ROUTING_MODEL_REVISION (+37 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (45): buildBroadcastContextCastRosterBlock(), buildBroadcastContextDeepseekRequestBody(), buildBroadcastContextQwenRequestBody(), formatDuration(), buildBroadcastTranscriptGeminiRequestBody(), buildBroadcastTranscriptQwenOmniRequestBody(), AI_PROVIDER_ROUTING_POLICY_VERSION, QWEN_CONTEXT_QUALITY_REFINEMENT_MODEL_ID (+37 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (44): CandidateAudioEventFenceRejectionReason, CandidateAudioEventWorkerErrorCode, CandidateAudioEventWorkerFactory, fenceEvent(), FenceOutcome, hasExactKeys(), hasResponseKeys(), hasValidDetectionTimeline() (+36 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (43): AI_MODEL_ROUTING_POLICY_VERSION, AI_PROVIDER_CONFIGURATION_VERSION, AiProviderConfigurationErrorCode, AiProviderConfigurationFailure, AiProviderDescriptor, AiProviderFallbackMode, AiProviderImplementationStatus, AiProviderReadinessManifest (+35 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (24): isCompatibleCandidatePassBRoutingModelRevision(), AnalysisManifestRecord, AnalysisResultStore, AnalysisTerminalOutcome, AnalysisTerminalRecord, FinalAnalysisResultRecord, CANDIDATE_PASS_B_INSIGHT_SCHEMA_VERSION, CandidatePassBInsightsRecord (+16 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (42): assertEffectiveRange(), assertEvidenceBindings(), AUDIO_EVENT_KIND_LABELS, audioEventBasisCodes(), audioEventDetections(), audioEventObservation(), audioObservation(), buildCandidateEvidenceExplanation() (+34 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (38): BroadcastTranscriptWorkerProgress, AudioAnalysisOutcome, BroadcastTranscriptExplorationCell, BroadcastTranscriptExplorationCellState, CandidateBoundaryFeedback, CandidateGeminiInsight, CandidateGeminiInsightById, CandidatePassBModelById (+30 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (9): assertIdentifier(), cloneJson(), IndexedDbAnalysisResultStore, InMemoryAnalysisResultStore, rejectedOperation(), sortTerminalRecordsNewestFirst(), validateAndCloneAnalysisRecord(), validateAndCloneSourceSnapshot() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (33): AnalyzeRequest, CandidateFailure, candidateGap(), CandidatePcmBuilder, clamp(), clampInteger(), createEventId(), decodeCandidate() (+25 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (33): CandidateAudioEventAggregation, ActiveTask, CandidateAudioEventRunResult, CandidateAudioEventWorkerError, FenceState, NormalizedRunInput, RunCandidateAudioEventWorkerOptions, emit() (+25 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (37): adjacentWindows(), amplitudeToDb(), AUDIO_REACTION_CANDIDATE_WINDOW_MS, AudioReactionCandidate, AudioReactionCandidateEvidence, AudioReactionEventKind, AudioReactionFeatureWindow, buildClusters() (+29 more)

### Community 21 - "Community 21"
Cohesion: 0.10
Nodes (29): BASE, buildCandidates(), Case(), fill(), ReviewStage(), ReviewStageProps, formatTime(), PlayerCardOrigin (+21 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (22): ANALYSIS_RESULT_OBJECT_STORES, AnalysisFailureRecord, AnalysisResultStoreError, ProvisionalAnalysisResultRecord, AUDIO_CANDIDATE, ControlledOpenRequest, ControlledRequest, ControlledTransaction (+14 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (36): ALL_OBJECT_STORES, AnalysisPayloadByKind, AnalysisRecord, AnalysisRecordKind, AnalysisResultStoreErrorCode, analysisSchemaFamily(), AnalysisStoreName, AnalysisTerminalRecordCatalog (+28 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (32): card(), row(), aliasAuthor(), AliasValue, AUTHOR_ALIASES, ChatImportDiagnostic, ChatImportDiagnosticCode, ChatImportDiagnosticSeverity (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (29): analyzeCandidateWithRemoteAi(), ProxyWorkerFailure, buildCandidatePassBAudioOnlySafeResponse(), buildCandidatePassBGeminiRequestBody(), buildCandidatePassBProxyRequestBody(), CANDIDATE_PASS_B_PROXY_ENDPOINT, CandidatePassBGeminiParseOutcome, CandidatePassBGeminiRelativeSegment (+21 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (31): BROADCAST_CONTEXT_DEEPSEEK_ENDPOINT, BroadcastContextDeepseekParseOutcome, BroadcastContextDeepseekRequestBody, BroadcastContextParseOptions, BroadcastContextQwenMode, BroadcastContextQwenRequestBody, containsUnexpectedHan(), extractBroadcastContextDeepseekResponse() (+23 more)

### Community 27 - "Community 27"
Cohesion: 0.10
Nodes (27): CandidateAudioEventEvidenceById, CandidatePassBEvidenceById, buildCandidateRankingProposal(), buildDraft(), CANDIDATE_RANKING_ALGORITHM_VERSION, CANDIDATE_RANKING_MAX_CANDIDATES, CANDIDATE_RANKING_MAX_SUPPORT_POINTS, CandidateRankingAudioEventCoverage (+19 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (26): bytesToHex(), ContentDigestAdapter, createContentFingerprint(), fallbackFingerprint(), lengthDelimited(), abortedError(), bytesToHex(), createLocalFileFingerprint() (+18 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (30): DOM, DOM.Iterable, ES2022, src, vite/client, WebWorker, compilerOptions, allowJs (+22 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (23): ActiveTask, CandidatePassBRunResult, FenceState, RunCandidatePassBWorkerOptions, emit(), FakeWorker, identity, targets (+15 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (25): ActiveAudioTask, clamp(), clampInteger(), createEventId(), decodeAndScore(), disposeInputOnce(), handleCancel(), isUnsupportedAudioCodecError() (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.13
Nodes (15): BroadcastContextTranscriptionChunk, BroadcastTranscriptQwenResult, BroadcastTranscriptWorkerClientError, BroadcastTranscriptWorkerRunResult, inputIssue(), isRecord(), isResponse(), runBroadcastTranscriptWorker() (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.10
Nodes (19): base, base, CANDIDATE_AUDIO_EVENT_MODEL_DTYPE, CANDIDATE_AUDIO_EVENT_MODEL_ID, CANDIDATE_AUDIO_EVENT_MODEL_REVISION, CANDIDATE_AUDIO_EVENT_RUNTIME_DEVICE, CANDIDATE_AUDIO_EVENT_SAMPLE_RATE_HZ, CANDIDATE_EVIDENCE_EXPLANATION_VERSION (+11 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (25): assertValidFile(), AUDIO_EXTENSIONS, BrowserCapabilitySnapshot, BrowserCapabilitySupport, CapabilityGlobal, createProbeWaitState(), DEFAULT_ADAPTERS, DocumentGlobal (+17 more)

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (26): buildCandidatePassBEvidence(), CandidatePassBEvidenceBase, CandidatePassBFallbackReason, CandidatePassBInputErrorCode, CandidatePassBOverlay, CandidatePassBSelectionOptions, CandidatePassBTranscriptChunk, CandidatePassBTranscriptOptions (+18 more)

### Community 36 - "Community 36"
Cohesion: 0.13
Nodes (25): accept(), ANALYSIS_STAGES, AnalysisCompletionTarget, AnalysisRunBase, AnalysisRunEvent, AnalysisRunRejectionReason, AnalysisRunTransitionOutcome, AnalysisStage (+17 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (16): AudioReactionWorkerRequest, analyzeLocalAudioReactions(), LocalAudioReactionWorkerLike, normalizeCancelAcknowledgementTimeout(), normalizeWorkerTimeout(), completeResult, decodingProgress, emitResponse() (+8 more)

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (21): BroadcastContextCandidateInput, BroadcastContextDiscoveredLead, BroadcastContextDiscoveredLeadReference, boundedText(), BROADCAST_TOPICAL_DISCOVERY_VERSION, BroadcastTopicalDiscoverySlice, BroadcastTopicalLeadJuryPlan, createBroadcastTopicalDiscoverySlices() (+13 more)

### Community 39 - "Community 39"
Cohesion: 0.13
Nodes (23): buildVisualSampleTimestamps(), clamp(), clampInteger(), compareTransitions(), createCandidate(), createTransitionSignals(), LocalVideoVisualAnalysisDiagnostics, LocalVideoVisualAnalysisResult (+15 more)

### Community 40 - "Community 40"
Cohesion: 0.18
Nodes (23): buildFastPassCandidates(), buildEventEpisodes(), calculateBlockQuotas(), CandidateSelectionEligibility, canJoinEpisode(), clamp(), compareCandidateStrength(), ContextAwareSelectionOptions (+15 more)

### Community 41 - "Community 41"
Cohesion: 0.14
Nodes (22): BROADCAST_TRANSCRIPT_GEMINI_MODEL_ID, BROADCAST_TRANSCRIPT_GEMINI_MODEL_REVISION, BROADCAST_TRANSCRIPT_MIXED_CHECKPOINT_MODEL_REVISION, BROADCAST_TRANSCRIPT_PREVIOUS_ACTIVE_MODEL_REVISION, BROADCAST_TRANSCRIPT_QWEN_MODEL_ID, BROADCAST_TRANSCRIPT_QWEN_MODEL_REVISION, BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_ID, BROADCAST_TRANSCRIPT_QWEN_OMNI_MODEL_REVISION (+14 more)

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (19): AI_BROADCAST_CONTEXT_ROUTING_REVISION, AiAnalysisPlanStep, AiAnalysisRoutingPlan, AiAnalysisStage, createAiAnalysisRoutingPlan(), EXCLIPPER_MODEL_IDS, boundedEventPeaks(), BROADCAST_CONTEXT_SAMPLING_PLAN_VERSION (+11 more)

### Community 43 - "Community 43"
Cohesion: 0.16
Nodes (21): BroadcastContextRequest, buildCandidatePassBPrompt(), CandidatePassBProxyRequestBody, buildCandidatePassBQwenOmniRequestBody(), CandidatePassBQwenOmniDiagnostics, CandidatePassBQwenOmniRequestBody, extractCandidatePassBQwenOmniSseResponse(), inspectCandidatePassBQwenOmniSseResponse() (+13 more)

### Community 44 - "Community 44"
Cohesion: 0.17
Nodes (19): ALLOWED_CATEGORIES, allowedCategory(), buildCandidatePassBContextPackets(), CandidateContextPacketBuildInput, chatReaction(), matchingTopic(), nearestChapterText(), surroundingContext() (+11 more)

### Community 45 - "Community 45"
Cohesion: 0.10
Nodes (20): boundedText(), captionTextForRange(), chapters, discoverySlices, fastPass, fastRefinementLeadIdSet, juryPlan, overviewCostUsd (+12 more)

### Community 46 - "Community 46"
Cohesion: 0.15
Nodes (16): BROADCAST_CONTEXT_PROXY_ENDPOINT, BroadcastContextAnalysisMode, BroadcastContextDeepseekClientError, createBoundedBroadcastContextInput(), FetchImplementation, parseBroadcastContextProxyResult(), requestBroadcastContextDeepseek(), input (+8 more)

### Community 47 - "Community 47"
Cohesion: 0.18
Nodes (19): baselineValues(), BUCKET_SIZE_MS, clamp(), compareScoredBuckets(), createBucket(), createCandidate(), emptyResult(), finiteNonNegativeInteger() (+11 more)

### Community 48 - "Community 48"
Cohesion: 0.26
Nodes (21): base64DecodedByteLength(), broadcastTranscriptProviderFailureResponse(), candidateProviderFailureResponse(), clientRateLimitKey(), corsHeaders(), fetch(), fetchWithTimeout(), handleBroadcastContextRequest() (+13 more)

### Community 49 - "Community 49"
Cohesion: 0.23
Nodes (20): accepted(), applyProposal(), CandidateRankingProjectable, CandidateRankingProposalDisposition, CandidateRankingViewEvent, CandidateRankingViewIgnoreReason, CandidateRankingViewSnapshot, CandidateRankingViewTransition (+12 more)

### Community 50 - "Community 50"
Cohesion: 0.18
Nodes (12): amplitudeToDb(), candidatePeakDistribution(), candidateSummary(), captureStdout(), clamp(), decodeFeatures(), main(), percentile() (+4 more)

### Community 51 - "Community 51"
Cohesion: 0.18
Nodes (14): shouldExpandBroadcastContextChunk(), ActiveTask, clamp(), decodeRange(), disposeTask(), isRecord(), isValidAnalyzeRequest(), isValidCancelRequest() (+6 more)

### Community 52 - "Community 52"
Cohesion: 0.10
Nodes (11): FakeAudioSampleSink, FakeBlobSource, FakeInput, FakeInputDisposedError, FakeUnsupportedInputFormatError, identity, mediaHarness, CANDIDATE_PASS_B_DEVICE (+3 more)

### Community 53 - "Community 53"
Cohesion: 0.20
Nodes (18): abortIfRequested(), asReadyBundle(), CANDIDATE_VIDEO_FRAME_SAMPLE_RATIOS, CandidateVideoFrameBundleResult, CandidateVideoFrameBundleTarget, CandidateVideoFrameProducerOptions, CandidateVideoFrameSamplerSession, CandidateVideoFrameSamplingOptions (+10 more)

### Community 54 - "Community 54"
Cohesion: 0.21
Nodes (18): LocalAudioReactionAnalysisStage, hasExactKeys(), isCandidate(), isCompletedResult(), isFenceEnvelope(), isFiniteNumber(), isNonNegativeInteger(), isProgress() (+10 more)

### Community 55 - "Community 55"
Cohesion: 0.11
Nodes (18): ES2023, node, vite.config.ts, vitest.config.ts, compilerOptions, exactOptionalPropertyTypes, lib, module (+10 more)

### Community 56 - "Community 56"
Cohesion: 0.12
Nodes (6): CANDIDATE_PASS_B_SAMPLE_RATE_HZ, AiProviderEnvironment, AiProxyEnvironment, createGeminiPayload(), createQwenSsePayload(), silentWav()

### Community 57 - "Community 57"
Cohesion: 0.15
Nodes (15): CandidateCompareOnlyReason, CandidateField, CandidateFieldMergeOutcome, CandidateMergeContext, CandidateProposal, CandidateProposalMergeOutcome, compareOnly(), globalCompareOnlyReason() (+7 more)

### Community 58 - "Community 58"
Cohesion: 0.14
Nodes (15): AnalyzeLocalVideoVisualOptions, appendHiddenElement(), createDefaultCanvas(), createDefaultVideoProbe(), DEFAULT_ADAPTERS, DEFAULT_VISUAL_METADATA_TIMEOUT_MS, DEFAULT_VISUAL_SEEK_TIMEOUT_MS, ErrorDetailValue (+7 more)

### Community 59 - "Community 59"
Cohesion: 0.18
Nodes (10): abortedError(), attemptCleanup(), cleanupResources(), defaultYieldControl(), loadVideoMetadata(), LocalVideoVisualProbe, mediaFailure(), seekVideo() (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.18
Nodes (16): DetectionDraft, chronologicalDetectionOrder(), mergeCandidateAudioEventEvidence(), mergeDetectedResults(), sameBinding(), sameDetection(), sameDetectionList(), strengthRank() (+8 more)

### Community 61 - "Community 61"
Cohesion: 0.17
Nodes (15): boundedInspectionRange(), createCaptionDiscoveredLeadRefinementPlan(), createDiscoveredLeadRefinementChapters(), createDiscoveredLeadRefinementPlan(), DISCOVERED_LEAD_REFINEMENT_VERSION, DiscoveredLeadRefinementPlan, DiscoveredLeadRefinementPlanOptions, DiscoveredLeadRefinementSegment (+7 more)

### Community 62 - "Community 62"
Cohesion: 0.20
Nodes (16): accept(), assertNever(), baseOf(), createSourceCheck(), isSourceCheckTerminal(), reduceSourceCheck(), reject(), SourceCheckBase (+8 more)

### Community 63 - "Community 63"
Cohesion: 0.20
Nodes (15): buildClipBaseName(), buildClipFileName(), ClipOutputKind, ClipRenderError, ClipRenderFailureCode, ClipRenderProgress, ClipRenderRequest, ClipRenderResult (+7 more)

### Community 64 - "Community 64"
Cohesion: 0.12
Nodes (17): @emnapi/core, globals, devDependencies, @emnapi/core, globals, tsx, @types/react, @types/react-dom (+9 more)

### Community 65 - "Community 65"
Cohesion: 0.19
Nodes (13): delay(), FetchImplementation, isRecord(), isRetryableCaptionStatus(), parseYouTubeCaptionProxyResult(), requestYouTubeCaptionTrack(), requestYouTubeCaptionTrackOnce(), payload (+5 more)

### Community 66 - "Community 66"
Cohesion: 0.17
Nodes (15): assertIdentifier(), assertRange(), assertText(), assertUniqueIdentifiers(), BroadcastContextCandidateCategory, BroadcastContextClipDecision, BroadcastContextCoverage, BroadcastContextCoverageGap (+7 more)

### Community 67 - "Community 67"
Cohesion: 0.17
Nodes (14): CandidateFinalVerificationInput, CandidateFinalVerificationResult, CONTEXT_PACKET_KEYS, createCandidatePassBVerificationReceipt(), finalizeFullyVerifiedCandidates(), isCandidatePassBVerificationReceipt(), isRecord(), candidate (+6 more)

### Community 68 - "Community 68"
Cohesion: 0.15
Nodes (11): captureDefaultLumaFingerprint(), LocalVideoVisualCanvas, createVisualHarness(), FakeCanvas, fingerprint(), samplesFromValues(), VideoEventType, VisualHarness (+3 more)

### Community 69 - "Community 69"
Cohesion: 0.19
Nodes (13): BroadcastContextResult, BroadcastContextSemanticChapterKind, BroadcastContextSemanticFamily, BroadcastContextTimelineMetric, BroadcastContextTimelinePresentation, BroadcastContextTimelinePresentationInput, BroadcastContextTimelineState, BroadcastContextUiStatus (+5 more)

### Community 70 - "Community 70"
Cohesion: 0.14
Nodes (10): CandidatePassBCue, CandidatePassBQualitySummary, MappedTranscriptChunk, CANDIDATE_PASS_B_CUE_PHASE_LABELS, CandidatePassBPresentationError, baseNarrative, cue(), expectedFastNarrativeFields (+2 more)

### Community 71 - "Community 71"
Cohesion: 0.20
Nodes (7): RunChatAnalysisWorkerInput, FakeWorker, ChatAnalysisWorkerIdentity, ChatAnalysisWorkerRequest, ChatAnalysisWorkerResponse, NormalizedChatMessage, HighlightSelectionOptions

### Community 72 - "Community 72"
Cohesion: 0.16
Nodes (3): CandidateAudioEventWorkerLike, FakeWorker, CandidateAudioEventWorkerRequest

### Community 73 - "Community 73"
Cohesion: 0.16
Nodes (12): CandidateRankingProposal, CandidateRankingProposalView, candidateRankingViewHasSessionWork(), CandidateRankingViewState, createCandidateRankingViewState(), projectCandidateOrder(), projectCandidateOrderIds(), snapshotState() (+4 more)

### Community 74 - "Community 74"
Cohesion: 0.22
Nodes (11): ChatAnalysisWorkerError, createEventFence(), CreateEventFenceInput, EventFenceOutcome, EventFenceRejectionReason, EventFenceState, FenceableEvent, fenceEvent() (+3 more)

### Community 75 - "Community 75"
Cohesion: 0.20
Nodes (9): ChatAnalysisWorkerLike, normalizeWorkerTimeout(), runChatAnalysisWorker(), emptyResult, identity, startWith(), WorkerEventType, WorkerListener (+1 more)

### Community 76 - "Community 76"
Cohesion: 0.30
Nodes (12): balancedJsonObject(), createYouTubeCaptionChapters(), createYouTubeCaptionRefinementTranscripts(), extractKoreanYouTubeCaptionTrack(), extractKoreanYouTubeCaptionTrackFromPlayerResponse(), isRecord(), normalizedCaptionText(), parseYouTubeCaptionJson3() (+4 more)

### Community 77 - "Community 77"
Cohesion: 0.19
Nodes (9): analyzeLocalVideoVisuals(), assertValidFile(), clampInteger(), copyFingerprint(), emitProgress(), eraseFingerprints(), LocalVideoVisualAnalysisAdapters, normalizeTimeout() (+1 more)

### Community 78 - "Community 78"
Cohesion: 0.15
Nodes (10): candidateMap, candidates, chapters, context, parentLead, ranked, refinement, result (+2 more)

### Community 79 - "Community 79"
Cohesion: 0.26
Nodes (9): boundedRepresentativeText(), compactBroadcastContextChapters(), COMPACTED_SUMMARY_LENGTH, compactGroup(), chapter(), BroadcastContextChapterInput, createBroadcastTranscriptChapters(), mergeBroadcastTranscriptChapters() (+1 more)

### Community 80 - "Community 80"
Cohesion: 0.22
Nodes (9): BroadcastContextCandidateAnnotation, buildBroadcastContextEligibilityById(), CandidateAiProjectionById, CandidateAiProjectionDisposition, CandidateAiQueueItem, ContextQualifiedFinalSelection, finalizeContextQualifiedCandidates(), isContextExcludedProgramMaterial() (+1 more)

### Community 81 - "Community 81"
Cohesion: 0.26
Nodes (10): BROADCAST_TRANSCRIPT_QWEN_SCHEMA_VERSION, isBroadcastTranscriptModelId(), BROADCAST_TRANSCRIPT_PROXY_ENDPOINT, BroadcastTranscriptQwenClientError, FetchImplementation, isRecord(), optionalLabel(), parseResult() (+2 more)

### Community 82 - "Community 82"
Cohesion: 0.28
Nodes (11): ChatAnalysisWorkerFactory, hasFiniteNumberFields(), isChatCandidate(), isFenceEnvelope(), isFiniteNumber(), isHighlightSelectionResult(), isNonNegativeInteger(), isRecord() (+3 more)

### Community 83 - "Community 83"
Cohesion: 0.22
Nodes (8): SelectableCandidate, approximateErf(), calculateTemporalEventDensity(), clampProbability(), poissonUpperTail(), TemporalEventDensityBin, TemporalEventDensityDiagnostics, TemporalEventDensityResult

### Community 84 - "Community 84"
Cohesion: 0.24
Nodes (7): keyPathFor(), normalizeStoreFailure(), requestError(), storeClosedError(), terminalConflictError(), terminalRecordsAreEquivalent(), validateAndCloneTerminalRecord()

### Community 85 - "Community 85"
Cohesion: 0.17
Nodes (12): scripts, build, check, cloudflare:deploy, cloudflare:dev, dev, evaluate:live-context, lint (+4 more)

### Community 86 - "Community 86"
Cohesion: 0.18
Nodes (10): boundedText(), captions, discoveredLeads, events, lead, parent, refineWindow(), result (+2 more)

### Community 87 - "Community 87"
Cohesion: 0.24
Nodes (11): CandidatePassBBasisLabel, CandidatePassBCuePhase, basePresentation(), buildCandidatePassBPresentation(), CandidatePassBCuePhaseLabel, CandidatePassBPresentation, CandidatePassBPresentationCue, CandidatePassBPresentationErrorCode (+3 more)

### Community 88 - "Community 88"
Cohesion: 0.23
Nodes (8): CandidateReviewState, DECISION_BY_REVIEW_STATE, decisionForReviewState(), REVIEW_STATE_BY_DECISION, reviewStateForDecision(), nextUnreviewedCandidateId(), ReviewableCandidate, reviewDecisionAdvances()

### Community 90 - "Community 90"
Cohesion: 0.18
Nodes (7): candidates, captions, chapters, events, fastPass, result, sourceDurationMs

### Community 91 - "Community 91"
Cohesion: 0.29
Nodes (7): ANALYSIS_BUDGET_POLICY_VERSION, AnalysisBudgetEnvelope, createAnalysisBudgetEnvelope(), CandidatePassBCostEstimate, clampInteger(), estimateCandidatePassBCost(), formatEstimatedUsd()

### Community 92 - "Community 92"
Cohesion: 0.25
Nodes (8): byteCount(), CandidatePassBModelDownloadAggregate, CandidatePassBModelDownloadTracker, DownloadFileState, isRecord(), nonEmptyBoundedString(), safeSum(), event()

### Community 93 - "Community 93"
Cohesion: 0.29
Nodes (9): AnalysisDurationRangeMs, clampToMonotonic(), estimateAnalysisDurationRangeMs(), estimateRemainingMs(), formatRemainingLabel(), RemainingEstimate, RemainingEstimateBasis, RemainingEstimateInput (+1 more)

### Community 94 - "Community 94"
Cohesion: 0.22
Nodes (8): CandidateReviewFeatureAvailability, CandidateReviewFeatureAvailabilityErrorCode, CandidateReviewFeatureAvailabilityInputError, deriveCandidateReviewFeatureAvailability(), MULTIPLE_CANDIDATE_FEATURES, MULTIPLE_CANDIDATE_FEATURES_WITHOUT_RANKING, NO_CANDIDATE_FEATURES, SINGLE_CANDIDATE_FEATURES

### Community 95 - "Community 95"
Cohesion: 0.20
Nodes (8): durationMs, endpoint, extraction, file, requestedDurationSeconds, sampleCount, startSeconds, wav

### Community 96 - "Community 96"
Cohesion: 0.38
Nodes (8): createDistributedOrder(), createDistributedTimelineRevealOrder(), createDistributedTranscriptExplorationOrder(), prioritizeAdjacentTranscriptChunks(), rangeCenter(), chunks(), TimelineRange, validateTranscriptChunks()

### Community 97 - "Community 97"
Cohesion: 0.36
Nodes (8): BroadcastSummaryCitationCandidate, BroadcastSummaryCitationPart, BroadcastSummaryCitationPresentation, buildBroadcastSummaryCitationPresentation(), normalizeText(), overlapScore(), sentences(), tokens()

### Community 98 - "Community 98"
Cohesion: 0.33
Nodes (8): RefinedDiscoveredLeadRange, boundedText(), createSemanticLeadCandidate(), isRecord(), parseSemanticLeadCandidates(), SEMANTIC_CATEGORIES, SEMANTIC_LEAD_CANDIDATE_RECORD_VERSION, serializeSemanticLeadCandidates()

### Community 99 - "Community 99"
Cohesion: 0.31
Nodes (7): AnalysisControlState, AnalysisControlStateInput, AnalysisRunStatus, BUSY_RUN_STATUSES, CANCELLABLE_RUN_STATUSES, deriveAnalysisControlState(), AnalysisRunState

### Community 100 - "Community 100"
Cohesion: 0.33
Nodes (7): assessClipSubtitleCoverage(), buildClipSrt(), clampCueToRange(), ClipSubtitleAvailability, ClipSubtitleRange, coveredDurationMs(), srtTimestamp()

### Community 101 - "Community 101"
Cohesion: 0.22
Nodes (7): assertNonNegativeFinite(), formatBytes(), formatDuration(), Harness, ProbeEventType, ProbeListener, trimTrailingZeroes()

### Community 103 - "Community 103"
Cohesion: 0.40
Nodes (8): assertBroadcastContextSessionRecord(), boundedString(), BROADCAST_CONTEXT_SESSION_SCHEMA_VERSION, BroadcastContextSessionRecord, cloneBroadcastContextSessionRecord(), hasExactKeys(), isRecord(), record

### Community 104 - "Community 104"
Cohesion: 0.22
Nodes (9): @huggingface/transformers, mediabunny, dependencies, @huggingface/transformers, mediabunny, react, react-dom, react (+1 more)

### Community 105 - "Community 105"
Cohesion: 0.22
Nodes (8): expectedInsightKeys, extraction, insight, insightKeys, offsetSeconds, result, videoFrames, wav

### Community 106 - "Community 106"
Cohesion: 0.22
Nodes (8): BROADCAST_SELECTION_SCHEMA_VERSION, BroadcastSelectionCandidateInput, BroadcastSelectionCandidateRelation, BroadcastSelectionChapterInput, BroadcastSelectionCoverageGap, BroadcastSelectionRelationType, BroadcastSelectionRequest, BroadcastSelectionResult

### Community 107 - "Community 107"
Cohesion: 0.28
Nodes (6): CandidatePassBRuntimeCapabilitySnapshot, CandidatePassBRuntimeSelectionOptions, LegacyCandidatePassBDevice, NavigatorWithOptionalGpu, selectCandidatePassBRuntimeDevice(), PreferredPreflightRuntimeTier

### Community 108 - "Community 108"
Cohesion: 0.25
Nodes (4): AppErrorBoundary, AppErrorBoundaryProps, AppErrorBoundaryState, rootElement

### Community 110 - "Community 110"
Cohesion: 0.36
Nodes (6): CandidateEvidenceExplanationInput, CandidatePassBEvidence, evidenceQualityRank(), mergeCandidatePassBEvidence(), fallback, provisional

### Community 111 - "Community 111"
Cohesion: 0.39
Nodes (6): CandidateFinalVerificationGap, FinalVerificationGapCount, GAP_ORDER, GAP_PRESENTATION, isPipelineGap(), summarizeFinalVerificationGaps()

### Community 112 - "Community 112"
Cohesion: 0.46
Nodes (6): CHZZK_VIDEO_CHANNEL_PROXY_ENDPOINT, chzzkVideoNoFromSourceName(), FetchImplementation, isRecord(), parseChzzkVideoChannelResult(), requestChzzkVideoChannel()

### Community 114 - "Community 114"
Cohesion: 0.25
Nodes (3): createDefaultObjectURL(), LocalMediaPreflightAdapters, revokeDefaultObjectURL()

### Community 115 - "Community 115"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 116 - "Community 116"
Cohesion: 0.29
Nodes (4): CandidatePassBInputError, CandidatePassBSourceCandidate, CandidatePassBTarget, target

### Community 117 - "Community 117"
Cohesion: 0.43
Nodes (5): canStartTranscriptRun(), transcriptOperationKey(), TranscriptPhase, transcriptPhaseFor(), TranscriptStartInput

### Community 118 - "Community 118"
Cohesion: 0.33
Nodes (5): endSeconds, matches, pattern, payload, startSeconds

### Community 119 - "Community 119"
Cohesion: 0.40
Nodes (6): assertCandidate(), assertMaxCandidates(), assertSourceDuration(), assertTarget(), compareCandidateSelection(), selectCandidatePassBTargets()

### Community 120 - "Community 120"
Cohesion: 0.33
Nodes (4): NamedPositiveMoment, SAMPLE_EVALUATION_CONTRACT_VERSION, SampleEvaluationContract, SampleGroundTruthMode

### Community 121 - "Community 121"
Cohesion: 0.40
Nodes (3): css, here, SIZES

### Community 122 - "Community 122"
Cohesion: 0.60
Nodes (3): buildSourceReadyTimelineTicks(), labelStrideForDuration(), SourceReadyTimelineTick

### Community 123 - "Community 123"
Cohesion: 0.83
Nodes (3): addCollectiveSpike(), message(), quietBaseline()

## Knowledge Gaps
- **625 isolated node(s):** `here`, `IMG`, `here`, `css`, `SIZES` (+620 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IndexedDbAnalysisResultStore` connect `Community 17` to `Community 2`, `Community 14`, `Community 84`, `Community 22`, `Community 23`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `LocalAudioReactionAnalysisProgress` connect `Community 31` to `Community 2`, `Community 37`, `Community 54`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `App()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 5`, `Community 6`, `Community 9`, `Community 12`, `Community 14`, `Community 15`, `Community 16`, `Community 21`, `Community 23`, `Community 24`, `Community 27`, `Community 28`, `Community 32`, `Community 33`, `Community 34`, `Community 35`, `Community 36`, `Community 37`, `Community 38`, `Community 40`, `Community 42`, `Community 44`, `Community 46`, `Community 49`, `Community 53`, `Community 60`, `Community 61`, `Community 62`, `Community 63`, `Community 65`, `Community 67`, `Community 68`, `Community 69`, `Community 73`, `Community 75`, `Community 76`, `Community 77`, `Community 79`, `Community 80`, `Community 83`, `Community 87`, `Community 88`, `Community 91`, `Community 92`, `Community 93`, `Community 94`, `Community 96`, `Community 97`, `Community 98`, `Community 99`, `Community 100`, `Community 101`, `Community 110`, `Community 111`, `Community 112`, `Community 117`, `Community 119`, `Community 122`, `Community 124`, `Community 126`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `App()` (e.g. with `chunks()` and `event()`) actually correct?**
  _`App()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `here`, `IMG`, `here` to the rest of the system?**
  _625 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.055246913580246915 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0624048706240487 - nodes in this community are weakly interconnected._