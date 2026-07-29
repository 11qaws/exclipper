/**
 * Where the pointer to the user's video file is kept between visits.
 *
 * `<input type="file">` hands over a `File` snapshot that dies with the page —
 * after a reload there is no way back to that file, and the user has to go find
 * it in a file browser again. That walk is the entire friction of a `blocked`
 * job. A `FileSystemFileHandle` survives because it is structured-cloneable, so
 * IndexedDB can hold it and `getFile()` reopens the same file later.
 *
 * This is a **separate database from the analysis results on purpose.** That
 * store validates everything through a JSON-only path, which a handle cannot
 * pass; widening it would weaken a guarantee that guards every other record. A
 * handle is a tiny path reference rather than data, so keeping it apart costs
 * almost nothing — and an orphan left behind by a failed delete is swept by
 * `deleteOrphans` instead of needing one atomic transaction.
 */

export const DEFAULT_SOURCE_HANDLE_DB_NAME = "exclipper-source-handles-v1";
export const SOURCE_HANDLE_DB_VERSION = 1;
export const SOURCE_HANDLE_OBJECT_STORE = "sourceHandles";

export interface StoredSourceHandle {
  readonly jobId: string;
  readonly handle: FileSystemFileHandle;
  /** 저장 시점의 표시용 이름. 핸들이 죽었을 때 "어떤 파일이었는지" 를 말해 준다. */
  readonly fileName: string;
  readonly storedAt: string;
}

export interface SourceHandleStore {
  put(record: StoredSourceHandle): Promise<void>;
  get(jobId: string): Promise<StoredSourceHandle | null>;
  delete(jobId: string): Promise<void>;
  listJobIds(): Promise<readonly string[]>;
  /** 대응하는 작업이 사라진 핸들을 치운다. 삭제가 반쯤 실패했을 때의 청소부. */
  deleteOrphans(liveJobIds: Iterable<string>): Promise<number>;
  close(): void;
}

function assertRecord(record: StoredSourceHandle): void {
  if (typeof record.jobId !== "string" || record.jobId.length === 0) {
    throw new TypeError("sourceHandle.jobId must be a non-empty string.");
  }
  // 핸들 자체는 브라우저가 주는 불투명한 객체다. 우리가 검사할 수 있는 것은
  // `getFile` 이 있는지 정도이며, 실제 유효성은 열어 봐야만 안다.
  if (typeof (record.handle as { getFile?: unknown })?.getFile !== "function") {
    throw new TypeError("sourceHandle.handle must expose getFile().");
  }
}

export class InMemorySourceHandleStore implements SourceHandleStore {
  private readonly records = new Map<string, StoredSourceHandle>();
  private closed = false;

  public put(record: StoredSourceHandle): Promise<void> {
    return this.guard(() => {
      assertRecord(record);
      this.records.set(record.jobId, { ...record });
    });
  }

  public get(jobId: string): Promise<StoredSourceHandle | null> {
    return this.guard(() => {
      const record = this.records.get(jobId);
      return record === undefined ? null : { ...record };
    });
  }

  public delete(jobId: string): Promise<void> {
    return this.guard(() => {
      this.records.delete(jobId);
    });
  }

  public listJobIds(): Promise<readonly string[]> {
    return this.guard(() => [...this.records.keys()]);
  }

  public deleteOrphans(liveJobIds: Iterable<string>): Promise<number> {
    return this.guard(() => {
      const live = new Set(liveJobIds);
      let removed = 0;
      for (const jobId of [...this.records.keys()]) {
        if (live.has(jobId)) continue;
        this.records.delete(jobId);
        removed += 1;
      }
      return removed;
    });
  }

  public close(): void {
    this.closed = true;
    this.records.clear();
  }

  /** 실패를 예외가 아니라 거부된 약속으로 돌려준다 — 호출부가 전부 비동기다. */
  private guard<T>(operation: () => T): Promise<T> {
    try {
      if (this.closed) throw new Error("SourceHandleStore is closed.");
      return Promise.resolve(operation());
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDbSourceHandleStore implements SourceHandleStore {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private closed = false;

  public constructor(private readonly databaseName: string = DEFAULT_SOURCE_HANDLE_DB_NAME) {}

  public async put(record: StoredSourceHandle): Promise<void> {
    assertRecord(record);
    const store = await this.objectStore("readwrite");
    await promisify(store.put({ ...record }));
  }

  public async get(jobId: string): Promise<StoredSourceHandle | null> {
    const store = await this.objectStore("readonly");
    const value: unknown = await promisify(store.get(jobId));
    return (value as StoredSourceHandle | undefined) ?? null;
  }

  public async delete(jobId: string): Promise<void> {
    const store = await this.objectStore("readwrite");
    await promisify(store.delete(jobId));
  }

  public async listJobIds(): Promise<readonly string[]> {
    const store = await this.objectStore("readonly");
    const keys = await promisify(store.getAllKeys());
    return keys.filter((key): key is string => typeof key === "string");
  }

  public async deleteOrphans(liveJobIds: Iterable<string>): Promise<number> {
    const live = new Set(liveJobIds);
    const store = await this.objectStore("readwrite");
    const keys = await promisify(store.getAllKeys());
    let removed = 0;
    for (const key of keys) {
      if (typeof key !== "string" || live.has(key)) continue;
      await promisify(store.delete(key));
      removed += 1;
    }
    return removed;
  }

  public close(): void {
    this.closed = true;
    this.database?.close();
    this.database = null;
    this.opening = null;
  }

  private async objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const database = await this.open();
    return database
      .transaction(SOURCE_HANDLE_OBJECT_STORE, mode)
      .objectStore(SOURCE_HANDLE_OBJECT_STORE);
  }

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error("SourceHandleStore is closed."));
    if (this.database !== null) return Promise.resolve(this.database);
    if (this.opening !== null) return this.opening;

    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = indexedDB.open(this.databaseName, SOURCE_HANDLE_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SOURCE_HANDLE_OBJECT_STORE)) {
          request.result.createObjectStore(SOURCE_HANDLE_OBJECT_STORE, { keyPath: "jobId" });
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open the source handle database."));
    });
    return this.opening;
  }
}
