import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../../src/lib/workspace.js";
import { makeTenant } from "./tenant.js";

/**
 * The workspace these tests run against: a tenant generated into a temp directory, the way
 * `init` and `hire` would write one.
 *
 * It used to be the workspace beside the framework when there was one, so the suite meant one
 * thing on a maintainer's machine and another on a fresh clone or in CI, and a test could only
 * be understood by knowing whose org happened to be checked out next door. The default is now
 * the same everywhere.
 *
 * Running against real data still catches the failure a fixture cannot: real data growing a
 * shape the code cannot handle. That is now asked for rather than inherited:
 *
 *   ROSTER_TEST_WORKSPACE=/path/to/workspace pnpm test
 */
let cached: Promise<Workspace> | null = null;

export function testWorkspace(): Promise<Workspace> {
  cached ??= resolve();
  return cached;
}

const MEMORY_FIXTURE = join(import.meta.dirname, "..", "fixtures", "memory");

async function resolve(): Promise<Workspace> {
  const live = process.env.ROSTER_TEST_WORKSPACE;
  if (live) return findWorkspace(live);

  /* Shaped like the org these tests were written against: two staff who are peers, so the
     peer wiring and app-slug inference have something to read, and whose handles differ from
     their directories, so a test that confuses the two fails here. */
  const root = mkdtempSync(join(tmpdir(), "roster-testws-"));
  process.once("exit", () => rmSync(root, { recursive: true, force: true }));
  const ws = await makeTenant(root, {
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

  /* makeTenant's memory is two facts, enough to render. The graph tests ask whether a worked
     memory collapses into readable groups, which two facts cannot answer, so each brain gets
     a checked-in memory with the shape months of use produce: sections, cross-citing facts,
     notes, issues and paths. */
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as { staff?: Array<{ handle: string; dir?: string }> };
  for (const s of org.staff ?? []) {
    const memory = join(root, s.dir ?? s.handle, "memory");
    rmSync(memory, { recursive: true, force: true });
    cpSync(MEMORY_FIXTURE, memory, { recursive: true });
  }
  return ws;
}
