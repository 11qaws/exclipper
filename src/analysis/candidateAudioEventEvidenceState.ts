import type {
  CandidateAudioEventCandidateResult,
  CandidateAudioEventDetectedResult,
  CandidateAudioEventDetection,
  CandidateAudioEventKind,
} from "./candidateAudioEventWorkerProtocol";

export type CandidateAudioEventEvidenceById = Readonly<
  Record<string, CandidateAudioEventCandidateResult>
>;

const KIND_ORDER = [
  "laughter",
  "shout",
  "scream",
  "applause-or-cheering",
] as const satisfies readonly CandidateAudioEventKind[];

function sameBinding(
  left: CandidateAudioEventCandidateResult,
  right: CandidateAudioEventCandidateResult,
): boolean {
  return (
    left.candidateId === right.candidateId &&
    left.mode === right.mode &&
    left.sourceStartMs === right.sourceStartMs &&
    left.sourceEndMs === right.sourceEndMs &&
    left.reactionPeakMs === right.reactionPeakMs &&
    left.quality === right.quality &&
    left.sampleRateHz === right.sampleRateHz &&
    left.model.id === right.model.id &&
    left.model.revision === right.model.revision &&
    left.model.dtype === right.model.dtype &&
    left.model.device === right.model.device
  );
}

function strengthRank(detection: CandidateAudioEventDetection): number {
  return detection.strength === "strong" ? 2 : 1;
}

function sameDetection(
  left: CandidateAudioEventDetection,
  right: CandidateAudioEventDetection,
): boolean {
  return (
    left.kind === right.kind &&
    left.strength === right.strength &&
    left.sourceStartMs === right.sourceStartMs &&
    left.sourceEndMs === right.sourceEndMs
  );
}

function sameDetectionList(
  left: readonly CandidateAudioEventDetection[],
  right: readonly CandidateAudioEventDetection[],
): boolean {
  return (
    left.length === right.length &&
    left.every((detection, index) => {
      const counterpart = right[index];
      return counterpart !== undefined && sameDetection(detection, counterpart);
    })
  );
}

function chronologicalDetectionOrder(
  left: CandidateAudioEventDetection,
  right: CandidateAudioEventDetection,
): number {
  return (
    left.sourceStartMs - right.sourceStartMs ||
    left.sourceEndMs - right.sourceEndMs ||
    KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
  );
}

/**
 * Keeps every already-found strong kind, admits stronger retry evidence next,
 * and only then fills the product maximum of two cues with possible evidence.
 * Equal-strength retries keep the earlier cue so a retry cannot make a verified
 * location jump without a stronger qualitative signal.
 */
function mergeDetectedResults(
  existing: CandidateAudioEventDetectedResult,
  incoming: CandidateAudioEventDetectedResult,
): CandidateAudioEventDetectedResult {
  const incomingByKind = new Map(
    incoming.detections.map((detection) => [detection.kind, detection]),
  );
  const selected: CandidateAudioEventDetection[] = [];
  const selectedKinds = new Set<CandidateAudioEventKind>();

  const admit = (detection: CandidateAudioEventDetection): void => {
    if (selected.length >= 2 || selectedKinds.has(detection.kind)) {
      return;
    }
    selected.push(detection);
    selectedKinds.add(detection.kind);
  };

  for (const detection of existing.detections) {
    if (detection.strength === "strong") {
      admit(detection);
    }
  }
  for (const detection of incoming.detections) {
    if (detection.strength === "strong") {
      const existingSameKind = existing.detections.find(
        ({ kind }) => kind === detection.kind,
      );
      admit(
        existingSameKind !== undefined &&
          strengthRank(existingSameKind) >= strengthRank(detection)
          ? existingSameKind
          : detection,
      );
    }
  }
  for (const detection of existing.detections) {
    if (detection.strength !== "possible") {
      continue;
    }
    const incomingSameKind = incomingByKind.get(detection.kind);
    admit(
      incomingSameKind !== undefined &&
        strengthRank(incomingSameKind) > strengthRank(detection)
        ? incomingSameKind
        : detection,
    );
  }
  for (const detection of incoming.detections) {
    admit(detection);
  }

  selected.sort(chronologicalDetectionOrder);
  const analyzedWindowCount = Math.max(
    existing.analyzedWindowCount,
    incoming.analyzedWindowCount,
  );
  if (
    sameDetectionList(selected, existing.detections) &&
    analyzedWindowCount === existing.analyzedWindowCount
  ) {
    return existing;
  }
  if (
    sameDetectionList(selected, incoming.detections) &&
    analyzedWindowCount === incoming.analyzedWindowCount
  ) {
    return incoming;
  }
  const [firstDetection, ...remainingDetections] = selected;
  return {
    ...existing,
    analyzedWindowCount,
    detections: [firstDetection!, ...remainingDetections],
  };
}

export function mergeCandidateAudioEventEvidence(
  current: CandidateAudioEventEvidenceById,
  incoming: CandidateAudioEventCandidateResult,
): CandidateAudioEventEvidenceById {
  const existing = current[incoming.candidateId];
  if (existing === undefined) {
    return { ...current, [incoming.candidateId]: incoming };
  }
  if (!sameBinding(existing, incoming)) {
    throw new Error("Audio-event retry evidence has a different source binding.");
  }
  if (incoming.status === "no-clear-event") {
    return current;
  }
  if (existing.status === "no-clear-event") {
    return { ...current, [incoming.candidateId]: incoming };
  }

  const merged = mergeDetectedResults(existing, incoming);
  return merged === existing
    ? current
    : { ...current, [incoming.candidateId]: merged };
}
