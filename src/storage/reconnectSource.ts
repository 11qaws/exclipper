import type { SourceHandleStore } from "./sourceHandleStore";

/**
 * Getting the original video back after a reload.
 *
 * Two things make this more than a lookup.
 *
 * The browser will not re-grant file permission without a user gesture — a page
 * cannot quietly reopen a file on load, by design. So the flow has to know
 * whether it is running inside a gesture: asking outside one does not merely
 * fail, it spends the prompt. `withUserGesture` carries that fact, and the
 * caller sets it only from a real click.
 *
 * And a handle points at a location, not at contents. The same path can hold a
 * different video now — re-encoded, replaced, a different broadcast entirely.
 * Attaching an old analysis to a new file would silently show the user evidence
 * that does not match what they are watching, so the fingerprint is checked
 * again on open and a mismatch refuses rather than guesses.
 */

export type ReconnectFailureReason =
  | "no_stored_handle"
  | "permission_denied"
  | "file_missing"
  | "different_file";

export type ReconnectOutcome =
  | { readonly kind: "connected"; readonly file: File }
  /** 권한을 물어야 한다. **클릭 안에서** 다시 부르라는 뜻이다. */
  | { readonly kind: "needsPermission" }
  | { readonly kind: "unavailable"; readonly reason: ReconnectFailureReason };

export interface ReconnectDependencies {
  readonly store: Pick<SourceHandleStore, "get">;
  /** 연 파일의 지문을 다시 계산한다. */
  readonly fingerprint: (file: File) => Promise<string>;
  /** 이 클릭이 사용자 제스처 안에서 일어났는가. */
  readonly withUserGesture: boolean;
}

/** 표준 타입에 아직 실려 있지 않은 권한 메서드. */
interface PermissionCapableHandle extends FileSystemFileHandle {
  queryPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
}

async function ensureReadPermission(
  handle: PermissionCapableHandle,
  withUserGesture: boolean,
): Promise<"granted" | "needsGesture" | "denied"> {
  // 권한 API 가 없는 브라우저는 핸들을 줬다면 이미 읽을 수 있다는 뜻이다.
  if (typeof handle.queryPermission !== "function") return "granted";

  const current = await handle.queryPermission({ mode: "read" });
  if (current === "granted") return "granted";

  // 제스처 밖에서 요청하면 실패할 뿐 아니라 프롬프트를 소진한다. 되돌려 보내
  // 사용자가 직접 누르게 한다.
  if (!withUserGesture) return "needsGesture";
  if (typeof handle.requestPermission !== "function") return "denied";

  const granted = await handle.requestPermission({ mode: "read" });
  return granted === "granted" ? "granted" : "denied";
}

export async function reconnectSource(
  jobId: string,
  expectedFingerprint: string,
  dependencies: ReconnectDependencies,
): Promise<ReconnectOutcome> {
  const stored = await dependencies.store.get(jobId);
  // 핸들이 없는 것은 고장이 아니다 — 파일 선택창으로 들어온 작업이거나, 핸들을
  // 지원하지 않는 브라우저다. 호출자는 파일 고르기로 넘긴다.
  if (stored === null) return { kind: "unavailable", reason: "no_stored_handle" };

  const handle = stored.handle as PermissionCapableHandle;
  const permission = await ensureReadPermission(handle, dependencies.withUserGesture);
  if (permission === "needsGesture") return { kind: "needsPermission" };
  if (permission === "denied") return { kind: "unavailable", reason: "permission_denied" };

  let file: File;
  try {
    file = await handle.getFile();
  } catch {
    // 옮겼거나 이름을 바꿨거나 지웠다. 핸들은 살아 있어도 가리키는 것이 없다.
    return { kind: "unavailable", reason: "file_missing" };
  }

  const actual = await dependencies.fingerprint(file);
  if (actual !== expectedFingerprint) {
    return { kind: "unavailable", reason: "different_file" };
  }

  return { kind: "connected", file };
}

/**
 * 실패를 사용자에게 어떻게 말할지. 원인마다 **다음에 할 일이 다르다**.
 */
export function reconnectMessage(reason: ReconnectFailureReason): {
  readonly title: string;
  readonly action: string;
} {
  switch (reason) {
    case "no_stored_handle":
      return { title: "원본 영상을 다시 선택해 주세요.", action: "영상 고르기" };
    case "permission_denied":
      return { title: "파일 접근이 허용되지 않았습니다.", action: "영상 고르기" };
    case "file_missing":
      return {
        title: "저장해 둔 위치에 영상이 없습니다. 옮기거나 이름이 바뀐 것 같습니다.",
        action: "영상 다시 찾기",
      };
    case "different_file":
      return {
        title: "같은 위치에 다른 영상이 있습니다. 이 분석과 맞지 않습니다.",
        action: "원래 영상 찾기",
      };
  }
}
