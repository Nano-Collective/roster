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
  opts: {
    org?: string;
    staff?: Array<{ handle: string; name: string; dir?: string; schedule?: string }>;
  } = {},
): Promise<Workspace> {
  const org = opts.org ?? "acme";
  const opsName = "roster-ops";
  const opsDir = join(root, opsName);

  for (const [rel, text] of await initFiles({
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
        /* Explicit, because the next hire's slot is staggered off these. Left to default,
           a scaffolded org drifts from the shape the scheduling tests were written against. */
        schedule: person.schedule,
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

    /* A scaffold's memory is empty by design, and an empty memory renders as nothing: the
       brain, graph and search tests all need at least one fact to have something to draw.
       Deliberately small. This is here to exercise rendering, not to stand in for real data,
       which is why the live workspace still wins when there is one. */
    write(join(root, dir, "memory", "INDEX.md"), memoryIndex(person.name));
    write(join(root, dir, "memory", "notes", "one-plan-pricing.md"), NOTE);
  }

  return ws;
}

/** A memory index that satisfies the grammar `roster lint` enforces. */
function memoryIndex(name: string): string {
  return [
    "# Memory index",
    "",
    `**This is ${name}'s memory. Read it at every boot, in full.**`,
    "",
    "## What we have tried",
    "",
    "- **`one-plan-pricing`** · [boss] One plan, one price, and pricing is not ours to change. **So:** raise packaging as a decision rather than testing it. · [note](notes/one-plan-pricing.md)",
    "- **`setup-step-drop-off`** · [measured] 38% of accounts never finish the setup step (n=212, Jun to Aug). **So:** nothing upstream of it is worth spending on until it moves.",
    "",
    "## Constraints",
    "",
    "- **`approve-outbound`** · [boss] Nothing goes out under the company name unread. **So:** finished work waits in `drafts/`; never schedule a send.",
    "",
  ].join("\n");
}

const NOTE = [
  "# Why pricing is not ours",
  "",
  "The fact is one line in `INDEX.md`. This is the argument, so it is not re-derived every",
  "time somebody proposes a test.",
  "",
  "Pricing moves revenue and expectations at the same time, and only one person here can weigh",
  "the second. Propose it as a decision issue and wait.",
  "",
].join("\n");

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
