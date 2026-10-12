import type { RecordStore } from "../lib/runs.js";
import type { KeyValue } from "./kv.js";

/**
 * The portal's cache on a Worker.
 *
 * A Workers KV namespace when one is bound, which is global and survives everything; otherwise
 * the edge cache, which costs nothing to set up and is kept per data centre. Everything put here
 * is immutable (a blob by its sha, a commit's dates, a finished run), so either is correct and
 * the only difference is how often a cold isolate has to ask GitHub again.
 */
interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const MONTH = 30 * 86_400;

export function cloudflareKV(namespace?: KVNamespaceLike): KeyValue {
  if (namespace) {
    return {
      async get(key) {
        return (await namespace.get(key)) ?? undefined;
      },
      async put(key, value) {
        await namespace.put(key, value, { expirationTtl: MONTH });
      },
    };
  }
  const url = (key: string) => `https://roster-cache.invalid/${encodeURIComponent(key)}`;
  const cache = () =>
    (
      globalThis as unknown as {
        caches: {
          default: {
            match(url: string): Promise<Response | undefined>;
            put(url: string, res: Response): Promise<void>;
          };
        };
      }
    ).caches.default;
  return {
    async get(key) {
      const hit = await cache().match(url(key));
      return hit ? await hit.text() : undefined;
    },
    async put(key, value) {
      await cache().put(
        url(key),
        new Response(value, { headers: { "cache-control": `public, max-age=${MONTH}` } }),
      );
    },
  };
}

/** Finished runs' records, kept in the same place. */
export function recordStore(kv: KeyValue): RecordStore {
  return {
    async get(brain, id) {
      const hit = await kv.get(`run:${brain}#${id}`);
      return hit ? JSON.parse(hit) : undefined;
    },
    async put(brain, id, value) {
      await kv.put(`run:${brain}#${id}`, JSON.stringify(value));
    },
  };
}
