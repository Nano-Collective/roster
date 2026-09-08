import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addToOrgYaml, buildPlan, type OrgYaml, wirePeers } from "../../src/commands/hire.js";
import { initFiles } from "../../src/commands/init.js";
import { loadComposer, readOrg, type Workspace } from "../../src/lib/workspace.js";

/**
 * A whole tenant on disk, without touching GitHub.
 *
 * Through the same functions the real commands use — `initFiles`, `buildPlan`, `wirePeers` —
 * rather than hand-written fixture files, so a template change breaks the tests that depend on
 * it instead of quietly leaving them testing something the product no longer does.
 *
 * Lives in test/ because that is the only thing that needs it. This used to be a shipped
 * command, which meant maintaining an invented business as a product surface.
 */
export async function makeTenant(
  root: string,
  opts: { org?: string; staff?: Array<{ handle: string; name: string; dir?: string }> } = {},
): Promise<Workspace> {
  const org = opts.org ?? "acme";
  const opsName = "roster-ops";
  const opsDir = join(root, opsName);

  for (const [rel, text] of initFiles({
    org,
    name: org,
    human: "someone",
    marker: "boss",
    opsName,
  })) {
    write(join(opsDir, rel), text);
  }

  const ws: Workspace = { root, opsDir, opsName };
  const { parseYaml } = await loadComposer(opsDir);

  for (const person of opts.staff ?? [{ handle: "cto", name: "Chief Technology Officer" }]) {
    const dir = person.dir ?? person.handle;
    const plan = buildPlan(
      ws,
      readOrg(opsDir, parseYaml) as OrgYaml,
      person.handle,
      {
        name: person.name,
        dir,
        // Non-zero, or the prompts cannot compose and every test downstream fails for that
        // reason rather than for its own.
        statusIssue: 1,
        app: `${org}-${person.handle}`,
        publicApp: `${org}-robot`,
      } as never,
      parseYaml,
    );

    for (const [rel, text] of plan.files) write(join(root, dir, rel), text);
    wirePeers(ws, plan, join(root, dir));
    addToOrgYaml(ws, plan);
  }

  return ws;
}

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
