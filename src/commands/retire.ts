import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, ghJson } from "../lib/gh.js";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";

export const retireHelp = `
roster retire <handle>

  Stop a staff member without destroying anything.

  Their brain repo is their entire memory, and there is no undo for deleting one. So this
  does not touch it: it stops the runs and takes the wiring out, and everything they ever
  knew stays exactly where it is, readable in the portal and on GitHub.

  What it does:
    - disables their three workflows, through the API rather than by editing files
    - removes them from org.yaml, both the staff list and the repos list
    - removes them from every peer's staff.yaml
    - deletes the from-<handle> labels their peers carried for them

  What it deliberately does not do: delete or archive the repo, close their issues, or
  unpin their status issue. All of those are one click on GitHub, having thought about it.

  Nothing happens without --apply. On its own this prints the plan.

  --apply         actually do it
  --ops <dir>     ops repo directory (default: found by walking up)
`;

export interface RetirePlan {
  handle: string;
  name: string;
  dir: string;
  brain?: string;
  /** Workflow files in their repo, which is what gets disabled. */
  workflows: string[];
  /** Peers who carry an entry for them, and the label they would lose. */
  peers: Array<{ handle: string; dir: string; brain?: string; label: string }>;
  /** What is being kept, said out loud, because that is the point of retiring. */
  keeps: string[];
  warnings: string[];
}

export async function retireCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write("roster: retire needs a handle, e.g. `roster retire cmo`\n");
    return 2;
  }
  const opts = parseFlags(argv.slice(1));
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);

  if (!(org.staff ?? []).some((s) => s.handle === handle)) {
    const known = (org.staff ?? []).map((s) => s.handle).join(", ") || "nobody";
    process.stderr.write(`roster: "${handle}" is not in org.yaml. It knows: ${known}\n`);
    return 2;
  }

  const plan = buildRetirePlan(ws, org, handle, parseYaml);
  printPlan(plan);

  if (!opts.apply) {
    process.stdout.write("  Nothing was changed. Re-run with --apply.\n\n");
    return 0;
  }
  return applyRetirePlan(ws, plan);
}

export function buildRetirePlan(
  ws: Workspace,
  org: ReturnType<typeof readOrg>,
  handle: string,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
): RetirePlan {
  const entry = (org.staff ?? []).find((s) => s.handle === handle)!;
  const dir = entry.dir ?? entry.handle;
  const root = join(ws.root, dir);
  const warnings: string[] = [];

  const manifest = readManifest(root, parseYaml);
  const brain = manifest?.brain as string | undefined;
  if (!existsSync(root)) warnings.push(`${dir}/ is not checked out, so its files cannot be read`);

  const wfDir = join(root, ".github", "workflows");
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
    : [];
  if (!workflows.length) warnings.push("no workflows found, so nothing to disable");

  /* Whoever carries an entry for them, and the label that dies with them.
     The direction is easy to get backwards, and I did: `from-cmo` lives on the *CTO's* repo,
     because it marks work the CMO filed on the CTO's tracker. So retiring the CMO deletes
     `from-<retiree>` from each *peer's* repo, and leaves `from-<peer>` on the retiree's own
     repo alone — that one is on a repo this command does not touch. */
  const peers: RetirePlan["peers"] = [];
  for (const other of org.staff ?? []) {
    if (other.handle === handle) continue;
    const otherDir = other.dir ?? other.handle;
    const path = join(ws.root, otherDir, "staff.yaml");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (!new RegExp(`handle: ${handle}[,\\s}]`).test(text)) continue;
    const theirs = readManifest(join(ws.root, otherDir), parseYaml);
    peers.push({
      handle: other.handle,
      dir: otherDir,
      brain: theirs?.brain as string | undefined,
      label: `from-${handle}`,
    });
  }

  const facts = countFacts(join(root, "memory", "INDEX.md"));
  return {
    handle,
    name: entry.name ?? handle,
    dir,
    brain,
    workflows,
    peers,
    keeps: [
      brain ? `${brain} — the repo, untouched` : `${dir}/ — the repo, untouched`,
      facts ? `${facts} facts and everything in memory/notes/` : "their memory, whatever is in it",
      "their issues, open and closed, and their pinned status issue",
    ],
    warnings,
  };
}

function printPlan(plan: RetirePlan) {
  const out: string[] = [`\n  roster retire — ${plan.name} (${plan.handle})\n`];

  out.push("  Stops:");
  for (const w of plan.workflows) out.push(`    ✓ ${plan.dir}/.github/workflows/${w} disabled`);
  out.push("    ✓ removed from org.yaml, staff and repos");
  for (const p of plan.peers) {
    out.push(`    ✓ removed from ${p.dir}/staff.yaml`);
    out.push(`    ✓ "${p.label}" deleted from ${p.brain ?? p.dir}`);
  }

  out.push("\n  Keeps:");
  for (const k of plan.keeps) out.push(`    · ${k}`);

  if (plan.warnings.length) {
    out.push("");
    for (const w of plan.warnings) out.push(`    ! ${w}`);
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

export async function applyRetirePlan(ws: Workspace, plan: RetirePlan): Promise<number> {
  let failed = 0;

  /* Through the API rather than by deleting the files. A disabled workflow is one click to
     re-enable, and the files staying put is what makes this reversible: `roster hire` would
     otherwise have to regenerate them from templates that have moved on since. */
  if (plan.brain) {
    for (const wf of plan.workflows) {
      const r = await ghJson([
        "api",
        "--method",
        "PUT",
        `/repos/${plan.brain}/actions/workflows/${wf}/disable`,
      ]);
      if (r.ok) process.stdout.write(`  disabled ${wf}\n`);
      else {
        failed++;
        process.stderr.write(`  could not disable ${wf}: ${r.error}\n`);
      }
    }
  }

  removeFromOrgYaml(ws, plan);
  process.stdout.write("  removed from org.yaml\n");

  for (const p of plan.peers) {
    const path = join(ws.root, p.dir, "staff.yaml");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, removePeerLine(text, plan.handle));
    process.stdout.write(`  removed from ${p.dir}/staff.yaml\n`);

    if (!p.brain) continue;
    const r = await api(`/repos/${p.brain}/labels/${encodeURIComponent(p.label)}`, [
      "--method",
      "DELETE",
    ]);
    if (r.ok || r.status === 404) process.stdout.write(`  deleted ${p.label} from ${p.brain}\n`);
    else {
      failed++;
      process.stderr.write(`  could not delete ${p.label}: ${r.error}\n`);
    }
  }

  process.stdout.write(
    `\n  ${plan.name} is retired. ${plan.brain ?? plan.dir} is untouched.\n` +
      `  Commit org.yaml and the peer manifests, and push them.\n\n`,
  );
  return failed ? 1 : 0;
}

/**
 * Removed textually, for the same reason hire adds textually: compose.mjs parses a small YAML
 * subset, and a round trip through a generic emitter reformats the file and loses every
 * comment in it.
 */
export function removeFromOrgYaml(ws: Workspace, plan: RetirePlan) {
  const path = join(ws.opsDir, "org.yaml");
  const text = readFileSync(path, "utf8");
  writeFileSync(path, removeOrgLines(text, plan.handle, plan.dir));
}

export function removeOrgLines(text: string, handle: string, dir: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t.startsWith("- ")) return true;
      if (new RegExp(`handle:\\s*${handle}[,\\s}]`).test(t)) return false;
      if (new RegExp(`name:\\s*${dir}[,\\s}]`).test(t) && /role:\s*brain/.test(t)) return false;
      return true;
    })
    .join("\n");
}

export function removePeerLine(text: string, handle: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("- ") && new RegExp(`handle:\\s*${handle}[,\\s}]`).test(t));
    })
    .join("\n");
}

function readManifest(root: string, parseYaml: (t: string, f?: string) => Record<string, unknown>) {
  const path = join(root, "staff.yaml");
  if (!existsSync(path)) return null;
  try {
    return parseYaml(readFileSync(path, "utf8"), "staff.yaml");
  } catch {
    return null;
  }
}

function countFacts(indexPath: string): number {
  if (!existsSync(indexPath)) return 0;
  return (readFileSync(indexPath, "utf8").match(/^- \*\*`/gm) ?? []).length;
}

function parseFlags(argv: string[]) {
  const out: { apply?: boolean; ops?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") {
      out.apply = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
