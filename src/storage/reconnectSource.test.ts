import { describe, expect, it, vi } from "vitest";

import {
  reconnectMessage,
  reconnectSource,
  type ReconnectFailureReason,
} from "./reconnectSource";
import { InMemorySourceHandleStore } from "./sourceHandleStore";

const FINGERPRINT = "sha256:the-original-broadcast";

interface FakeHandleOptions {
  readonly permission?: PermissionState;
  readonly grantsOnRequest?: PermissionState;
  readonly file?: File | null;
  readonly hasPermissionApi?: boolean;
}

function fakeHandle(options: FakeHandleOptions = {}) {
  const requestPermission = vi.fn(() =>
    Promise.resolve<PermissionState>(options.grantsOnRequest ?? "granted"),
  );
  const handle = {
    getFile: () =>
      options.file === null
        ? Promise.reject(new DOMException("not found", "NotFoundError"))
        : Promise.resolve(options.file ?? (new Blob(["v"]) as unknown as File)),
    ...(options.hasPermissionApi === false
      ? {}
      : {
          queryPermission: () =>
            Promise.resolve<PermissionState>(options.permission ?? "granted"),
          requestPermission,
        }),
  };
  return { handle: handle as unknown as FileSystemFileHandle, requestPermission };
}

async function storeWith(handle: FileSystemFileHandle) {
  const store = new InMemorySourceHandleStore();
  await store.put({
    jobId: "job-1",
    handle,
    fileName: "broadcast.mp4",
    storedAt: "2026-07-25T00:00:00.000Z",
  });
  return store;
}

function reconnect(
  store: InMemorySourceHandleStore,
  overrides: { fingerprint?: string; withUserGesture?: boolean } = {},
) {
  return reconnectSource("job-1", FINGERPRINT, {
    store,
    fingerprint: () => Promise.resolve(overrides.fingerprint ?? FINGERPRINT),
    withUserGesture: overrides.withUserGesture ?? true,
  });
}

describe("reconnecting the original video", () => {
  it("returns the file when permission is already granted", async () => {
    const { handle } = fakeHandle({ permission: "granted" });
    const outcome = await reconnect(await storeWith(handle));
    expect(outcome.kind).toBe("connected");
  });

  describe("permission needs a real click", () => {
    it("asks the user to click instead of prompting outside a gesture", async () => {
      // 제스처 밖에서 요청하면 실패할 뿐 아니라 프롬프트를 소진한다.
      const { handle, requestPermission } = fakeHandle({ permission: "prompt" });
      const outcome = await reconnect(await storeWith(handle), { withUserGesture: false });
      expect(outcome.kind).toBe("needsPermission");
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("prompts when it is inside a gesture", async () => {
      const { handle, requestPermission } = fakeHandle({ permission: "prompt" });
      const outcome = await reconnect(await storeWith(handle), { withUserGesture: true });
      expect(requestPermission).toHaveBeenCalledOnce();
      expect(outcome.kind).toBe("connected");
    });

    it("gives up when the user refuses", async () => {
      const { handle } = fakeHandle({ permission: "prompt", grantsOnRequest: "denied" });
      const outcome = await reconnect(await storeWith(handle));
      expect(outcome).toEqual({ kind: "unavailable", reason: "permission_denied" });
    });

    it("proceeds on browsers without the permission API", async () => {
      // 핸들을 줬다면 이미 읽을 수 있다는 뜻이다.
      const { handle } = fakeHandle({ hasPermissionApi: false });
      const outcome = await reconnect(await storeWith(handle));
      expect(outcome.kind).toBe("connected");
    });
  });

  describe("the handle may point at nothing, or at the wrong thing", () => {
    it("reports a moved or deleted file", async () => {
      const { handle } = fakeHandle({ file: null });
      const outcome = await reconnect(await storeWith(handle));
      expect(outcome).toEqual({ kind: "unavailable", reason: "file_missing" });
    });

    it("refuses a different video sitting at the same path", async () => {
      // 붙여 버리면 지금 보는 영상과 맞지 않는 근거를 조용히 보여 주게 된다.
      const { handle } = fakeHandle();
      const outcome = await reconnect(await storeWith(handle), {
        fingerprint: "sha256:some-other-broadcast",
      });
      expect(outcome).toEqual({ kind: "unavailable", reason: "different_file" });
    });

    it("checks the fingerprint even when permission was already granted", async () => {
      const fingerprint = vi.fn(() => Promise.resolve(FINGERPRINT));
      const { handle } = fakeHandle({ permission: "granted" });
      await reconnectSource("job-1", FINGERPRINT, {
        store: await storeWith(handle),
        fingerprint,
        withUserGesture: true,
      });
      expect(fingerprint).toHaveBeenCalledOnce();
    });
  });

  it("treats a job with no stored handle as ordinary, not broken", async () => {
    // 파일 선택창으로 들어왔거나 핸들을 지원하지 않는 브라우저다.
    const outcome = await reconnect(new InMemorySourceHandleStore());
    expect(outcome).toEqual({ kind: "unavailable", reason: "no_stored_handle" });
  });

  it("tells the user something different for each cause", () => {
    const reasons: readonly ReconnectFailureReason[] = [
      "no_stored_handle",
      "permission_denied",
      "file_missing",
      "different_file",
    ];
    const titles = reasons.map((reason) => reconnectMessage(reason).title);
    // 원인마다 다음에 할 일이 다르므로 같은 문구를 재사용하면 안내가 무의미해진다.
    expect(new Set(titles).size).toBe(reasons.length);
  });
});

describe("the source handle store", () => {
  it("keeps the file name so a dead handle can still say what it was", async () => {
    const { handle } = fakeHandle();
    const store = await storeWith(handle);
    expect((await store.get("job-1"))?.fileName).toBe("broadcast.mp4");
  });

  it("rejects something that is not a handle", async () => {
    const store = new InMemorySourceHandleStore();
    await expect(
      store.put({
        jobId: "job-1",
        handle: { nope: true } as unknown as FileSystemFileHandle,
        fileName: "x.mp4",
        storedAt: "2026-07-25T00:00:00.000Z",
      }),
    ).rejects.toThrow(TypeError);
  });

  it("sweeps handles whose job is gone", async () => {
    // 작업 삭제가 반쯤 실패해도 핸들이 영원히 남지 않게 한다.
    const store = new InMemorySourceHandleStore();
    const { handle } = fakeHandle();
    for (const jobId of ["alive", "deleted-1", "deleted-2"]) {
      await store.put({ jobId, handle, fileName: "x.mp4", storedAt: "2026-07-25T00:00:00.000Z" });
    }
    expect(await store.deleteOrphans(["alive"])).toBe(2);
    expect(await store.listJobIds()).toEqual(["alive"]);
  });
});
