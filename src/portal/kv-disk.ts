import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KeyValue } from "./kv.js";

/**
 * The portal's cache on your machine: `~/.cache/roster/kv`, or under `ROSTER_CACHE_DIR`.
 *
 * Keys are hashed into file names, two levels deep so no directory holds tens of thousands of
 * files. Everything in it is immutable, so it can be deleted at any time and only costs a slower
 * first load.
 */
export function diskKV(dir = defaultDir()): KeyValue {
  const path = (key: string) => {
    const h = createHash("sha1").update(key).digest("hex");
    return join(dir, h.slice(0, 2), h.slice(2));
  };
  return {
    async get(key) {
      const p = path(key);
      return existsSync(p) ? readFileSync(p, "utf8") : undefined;
    },
    async put(key, value) {
      const p = path(key);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, value);
    },
  };
}

function defaultDir(): string {
  return join(process.env.ROSTER_CACHE_DIR ?? join(homedir(), ".cache", "roster"), "kv");
}
