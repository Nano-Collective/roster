import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * A workspace is a directory holding the ops repo and every brain repo side by side —
 * the same shape the CI runner checks out, so what you see locally is what runs.
 */
export interface Workspace {
  root: string;
  opsDir: string;
  opsName: string;
}

/**
 * Walk up from `start` looking for a directory containing an ops repo. Falls back to
 * treating `start` itself as the workspace root, which is what you want when the ops
 * repo is a sibling rather than an ancestor.
 */
export function findWorkspace(start = process.cwd()): Workspace {
  let dir = resolve(start);
  for (;;) {
    const found = opsInside(dir);
    if (found) return { root: dir, opsDir: join(dir, found), opsName: found };

    // Also handle being *inside* the ops repo or a brain repo.
    if (existsSync(join(dir, "org.yaml"))) {
      return { root: dirname(dir), opsDir: dir, opsName: dir.split("/").pop()! };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "no roster workspace found.\n" +
      "Expected an ops repo (a directory containing org.yaml) here or in a parent.\n" +
      "Run this from your workspace root, or pass --ops <dir>.",
  );
}

/**
 * The same walk, but a missing workspace is an answer rather than an error.
 *
 * `roster portal` used to be unable to start without a tenant, which made the surface that
 * should run your setup depend on the output of your setup. Everything else still uses
 * `findWorkspace`: not finding a workspace is a real error for every command that needs one.
 */
export function tryWorkspace(start = process.cwd()): Workspace | null {
  try {
    return findWorkspace(start);
  } catch {
    return null;
  }
}

function opsInside(dir: string): string | null {
  for (const name of ["roster-ops", "ops", ".roster"]) {
    if (existsSync(join(dir, name, "org.yaml"))) return name;
  }
  return null;
}

/** The tenant vendors compose.mjs, so we import theirs rather than shipping a second copy. */
export async function loadComposer(opsDir: string) {
  const path = join(opsDir, "compose.mjs");
  if (!existsSync(path)) {
    throw new Error(`no compose.mjs in ${opsDir}. Run \`roster upgrade\` to restore it.`);
  }
  return (await import(`file://${path}`)) as {
    compose(o: { opsDir: string; brainsDir: string; staff: string; kind: string }): string;
    parseYaml(text: string, file?: string): Record<string, unknown>;
  };
}

export function readOrg(
  opsDir: string,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
) {
  return parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml") as {
    org: string;
    name: string;
    staff?: Array<{ handle: string; dir?: string; name: string; schedule?: string }>;
    [k: string]: unknown;
  };
}
