// IndexedDB is the primary durable store for critical operational writes.
// localStorage is retained only as a legacy migration source and as an explicit
// fallback where IndexedDB does not exist. A future native/SQLite backend can
// implement this repository without changing entry pages or the sync engine.

export const OFFLINE_DB_NAME = 'gridvision-offline';
export const OFFLINE_DB_VERSION = 1;
export const OPERATIONS_STORE = 'operations';
export const METADATA_STORE = 'metadata';
export const LEGACY_QUEUE_KEY = 'gv_pending_queue';
export const LEGACY_MIGRATION_KEY = 'legacy-queue-migrated-v1';
export const LAST_DURABLE_WRITE_KEY = 'storage:last-successful-durable-write-at';

export type StoredOperation = Record<string, unknown> & { id: string };

export interface OfflineStorage {
  readonly backend: 'indexeddb' | 'localstorage-fallback';
  getAllOperations(): Promise<StoredOperation[]>;
  getOperation(id: string): Promise<StoredOperation | null>;
  putOperation(operation: StoredOperation): Promise<void>;
  putOperations(operations: StoredOperation[]): Promise<void>;
  deleteOperation(id: string): Promise<void>;
  clearOperations(): Promise<void>;
  countOperations(): Promise<number>;
  countOperationsByOwner(ownerUserId: string): Promise<number>;
  mutateOperations(mutator: (operations: StoredOperation[]) => StoredOperation[]): Promise<StoredOperation[]>;
  getMetadata<T>(key: string): Promise<T | null>;
  setMetadata<T>(key: string, value: T): Promise<void>;
  deleteMetadata(key: string): Promise<void>;
  listMetadata(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}

export class OfflineStorageError extends Error {
  constructor(message = 'Offline operational storage is unavailable.', readonly cause?: unknown) {
    super(message);
    this.name = 'OfflineStorageError';
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new OfflineStorageError(undefined, request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new OfflineStorageError(undefined, transaction.error));
    transaction.onerror = () => reject(new OfflineStorageError(undefined, transaction.error));
  });
}

class IndexedDbOfflineStorage implements OfflineStorage {
  readonly backend = 'indexeddb' as const;
  private databasePromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
          const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
          operations.createIndex('clientOperationId', 'clientOperationId', { unique: false });
          operations.createIndex('ownerUserId', 'ownerUserId', { unique: false });
          operations.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(new OfflineStorageError('Could not open offline operational storage.', request.error));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new OfflineStorageError('Offline operational storage upgrade is blocked. Close other GridVision tabs and retry.'));
      };
    });
    return this.databasePromise;
  }

  async getAllOperations(): Promise<StoredOperation[]> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    return requestResult(transaction.objectStore(OPERATIONS_STORE).getAll()) as Promise<StoredOperation[]>;
  }

  async getOperation(id: string): Promise<StoredOperation | null> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(OPERATIONS_STORE).get(id)) as StoredOperation | undefined) ?? null;
  }

  async putOperation(operation: StoredOperation): Promise<void> {
    await this.putOperations([operation]);
  }

  async putOperations(operations: StoredOperation[]): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(OPERATIONS_STORE);
    operations.forEach((operation) => store.put(operation));
    transaction.objectStore(METADATA_STORE).put(Date.now(), LAST_DURABLE_WRITE_KEY);
    await transactionDone(transaction);
  }

  async deleteOperation(id: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    transaction.objectStore(OPERATIONS_STORE).delete(id);
    await transactionDone(transaction);
  }

  async clearOperations(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    transaction.objectStore(OPERATIONS_STORE).clear();
    await transactionDone(transaction);
  }

  async countOperations(): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    return requestResult(transaction.objectStore(OPERATIONS_STORE).count());
  }

  async countOperationsByOwner(ownerUserId: string): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    return requestResult(transaction.objectStore(OPERATIONS_STORE).index('ownerUserId').count(IDBKeyRange.only(ownerUserId)));
  }

  async mutateOperations(mutator: (operations: StoredOperation[]) => StoredOperation[]): Promise<StoredOperation[]> {
    const database = await this.open();
    const transaction = database.transaction([OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(OPERATIONS_STORE);
    const current = await requestResult(store.getAll()) as StoredOperation[];
    const next = mutator(current);
    store.clear();
    next.forEach((operation) => store.put(operation));
    transaction.objectStore(METADATA_STORE).put(Date.now(), LAST_DURABLE_WRITE_KEY);
    await transactionDone(transaction);
    return next;
  }

  async getMetadata<T>(key: string): Promise<T | null> {
    const database = await this.open();
    const transaction = database.transaction(METADATA_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(METADATA_STORE).get(key)) as T | undefined) ?? null;
  }

  async setMetadata<T>(key: string, value: T): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(METADATA_STORE, 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    store.put(value, key);
    if (key !== LAST_DURABLE_WRITE_KEY) store.put(Date.now(), LAST_DURABLE_WRITE_KEY);
    await transactionDone(transaction);
  }

  async deleteMetadata(key: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(METADATA_STORE, 'readwrite');
    transaction.objectStore(METADATA_STORE).delete(key);
    await transactionDone(transaction);
  }

  async listMetadata(prefix = ''): Promise<Array<{ key: string; value: unknown }>> {
    const database = await this.open();
    const transaction = database.transaction(METADATA_STORE, 'readonly');
    const store = transaction.objectStore(METADATA_STORE);
    const [keys, values] = await Promise.all([requestResult(store.getAllKeys()), requestResult(store.getAll())]);
    return keys.flatMap((key, index) => typeof key === 'string' && key.startsWith(prefix) ? [{ key, value: values[index] }] : []);
  }
}

class LocalStorageFallback implements OfflineStorage {
  readonly backend = 'localstorage-fallback' as const;
  private read(): StoredOperation[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) throw new Error('Invalid fallback queue.');
      return parsed.filter((value): value is StoredOperation => Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string');
    } catch (cause) {
      throw new OfflineStorageError('Could not read the offline operational queue.', cause);
    }
  }
  private write(operations: StoredOperation[]): void {
    try { localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(operations)); }
    catch (cause) { throw new OfflineStorageError('Could not save the offline operational queue.', cause); }
    try { localStorage.setItem(`gv_offline_meta:${LAST_DURABLE_WRITE_KEY}`, JSON.stringify(Date.now())); } catch { /* diagnostic failure cannot invalidate a durable write */ }
  }
  async getAllOperations() { return this.read(); }
  async getOperation(id: string) { return this.read().find((op) => op.id === id) ?? null; }
  async putOperation(operation: StoredOperation) { await this.mutateOperations((ops) => [...ops.filter((op) => op.id !== operation.id), operation]); }
  async putOperations(operations: StoredOperation[]) { await this.mutateOperations((current) => [...current.filter((op) => !operations.some((item) => item.id === op.id)), ...operations]); }
  async deleteOperation(id: string) { await this.mutateOperations((ops) => ops.filter((op) => op.id !== id)); }
  async clearOperations() { this.write([]); }
  async countOperations() { return this.read().length; }
  async countOperationsByOwner(ownerUserId: string) { return this.read().filter((op) => op.ownerUserId === ownerUserId).length; }
  async mutateOperations(mutator: (operations: StoredOperation[]) => StoredOperation[]) { const next = mutator(this.read()); this.write(next); return next; }
  async getMetadata<T>(key: string) { try { const value = localStorage.getItem(`gv_offline_meta:${key}`); return value ? JSON.parse(value) as T : null; } catch (cause) { throw new OfflineStorageError(undefined, cause); } }
  async setMetadata<T>(key: string, value: T) { try { localStorage.setItem(`gv_offline_meta:${key}`, JSON.stringify(value)); if (key !== LAST_DURABLE_WRITE_KEY) { try { localStorage.setItem(`gv_offline_meta:${LAST_DURABLE_WRITE_KEY}`, JSON.stringify(Date.now())); } catch { /* best effort diagnostic */ } } } catch (cause) { throw new OfflineStorageError(undefined, cause); } }
  async deleteMetadata(key: string) { try { localStorage.removeItem(`gv_offline_meta:${key}`); } catch (cause) { throw new OfflineStorageError(undefined, cause); } }
  async listMetadata(prefix = '') { try { return Object.keys(localStorage).filter((key) => key.startsWith('gv_offline_meta:')).flatMap((key) => { const metadataKey = key.slice('gv_offline_meta:'.length); if (!metadataKey.startsWith(prefix)) return []; const raw = localStorage.getItem(key); return raw === null ? [] : [{ key: metadataKey, value: JSON.parse(raw) as unknown }]; }); } catch (cause) { throw new OfflineStorageError(undefined, cause); } }
}

let storage: OfflineStorage | null = null;
export function getOfflineStorage(): OfflineStorage {
  if (storage) return storage;
  storage = typeof indexedDB === 'undefined' ? new LocalStorageFallback() : new IndexedDbOfflineStorage();
  return storage;
}
