import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RecordStore } from "./runs.js";

/**
 * Run records on disk, between starts: `~/.cache/roster/runs/<owner>__<repo>/<id>.json`, or
 * under `ROSTER_CACHE_DIR`. A finished run's record never changes, so a file here is never stale.
 */
export function diskRecordStore(dir = defaultDir()): RecordStore {
  const file = (brain: string, id: number) => join(dir, brain.replace("/", "__"), `${id}.json`);
  return {
    async get(brain, id) {
      const path = file(brain, id);
      if (!existsSync(path)) return undefined;
      return JSON.parse(readFileSync(path, "utf8"));
    },
    async put(brain, id, value) {
      mkdirSync(join(dir, brain.replace("/", "__")), { recursive: true });
      writeFileSync(file(brain, id), JSON.stringify(value));
    },
  };
}

function defaultDir(): string {
  return process.env.ROSTER_CACHE_DIR ?? join(homedir(), ".cache", "roster", "runs");
}
