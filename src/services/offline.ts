// Offline cache + pending sync queue backed by localStorage.
// Acts as the interceptor described in the architecture requirements:
//  - reads hit localStorage first as an immediate cache layer when offline
//  - writes that cannot reach the backend are stored in a pending queue
//  - the queue is flushed automatically when connectivity returns

const CACHE_PREFIX = 'gv_cache:';
const QUEUE_KEY = 'gv_pending_queue';

export const isOnline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine;

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as { value: T; ts: number };
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ value, ts: Date.now() })
    );
  } catch {
    // storage full / unavailable — non-fatal
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // ignore
  }
}

export type QueuedOp = {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  table: string;
  body?: unknown;
  filter?: Record<string, string>; // for PATCH/DELETE (e.g. { id: '...' })
  enqueuedAt: number;
};

export function getQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueuedOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export function enqueueOp(op: Omit<QueuedOp, 'id' | 'enqueuedAt'>): QueuedOp {
  const queue = getQueue();
  const full: QueuedOp = {
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enqueuedAt: Date.now(),
  };
  queue.push(full);
  saveQueue(queue);
  return full;
}

export function dequeueOp(id: string): void {
  const queue = getQueue().filter((q) => q.id !== id);
  saveQueue(queue);
}

export function queueLength(): number {
  return getQueue().length;
}
