import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorkspace, type Workspace } from "../../src/lib/workspace.js";
import { makeTenant } from "./tenant.js";

/**
 * The workspace these tests run against.
 *
 * Several of them are deliberately built from the workspace beside the framework rather than
 * from a fixture, so they break when real data grows a shape the code cannot handle. That is
 * the failure worth catching, and a fixture cannot catch it.
 *
 * It also meant the whole suite threw at import for anybody who did not happen to have a tenant
 * checked out next door, which is everybody who clones this repo. So: use the real one when it
 * is there, and stand up a synthetic one when it is not. Same tests, and on a maintainer's
 * machine the same live data as before.
 */
let cached: Promise<Workspace> | null = null;

export function testWorkspace(): Promise<Workspace> {
  cached ??= resolve();
  return cached;
}

async function resolve(): Promise<Workspace> {
  const beside = join(import.meta.dirname, "..", "..", "..");
  try {
    return findWorkspace(beside);
  } catch {
    /* No tenant next door. Build one, shaped like the org these tests were written against:
       two staff who are peers, so the peer wiring and app-slug inference have something real
       to read. */
    const root = mkdtempSync(join(tmpdir(), "roster-testws-"));
    return makeTenant(root, {
      org: "acme",
      staff: [
        {
          handle: "cto",
          name: "Chief Technology Officer",
          dir: "technology",
          schedule: "0 7 * * 1-5",
        },
        {
          handle: "cmo",
          name: "Chief Marketing Officer",
          dir: "marketing",
          schedule: "40 7 * * 1-5",
        },
      ],
    });
  }
}

/** Whether these tests are looking at somebody's real org or at a scaffold. */
export async function isSynthetic(): Promise<boolean> {
  const ws = await testWorkspace();
  return ws.root.includes("roster-testws-");
}
