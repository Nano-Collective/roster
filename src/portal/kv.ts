/**
 * Somewhere to keep things that never change once written: a blob by its sha, a commit's file
 * dates, a finished run's record. Content-addressed or immutable, so nothing here is ever stale
 * and nothing ever needs invalidating.
 *
 * On your machine it is a directory under ~/.cache/roster (`kv-disk.ts`); on a Worker it is the
 * edge cache. Losing it costs API calls, never correctness.
 */
export interface KeyValue {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

/** For the life of the process only. The default, and what tests use. */
export function memoryKV(limit = 20_000): KeyValue {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value!);
    },
  };
}

/** Memory in front of something slower, so a hot read never leaves the process. */
export function layeredKV(slow: KeyValue, fast = memoryKV()): KeyValue {
  return {
    async get(key) {
      const hit = await fast.get(key);
      if (hit !== undefined) return hit;
      const found = await slow.get(key).catch(() => undefined);
      if (found !== undefined) await fast.put(key, found);
      return found;
    },
    async put(key, value) {
      await fast.put(key, value);
      await slow.put(key, value).catch(() => {});
    },
  };
}
