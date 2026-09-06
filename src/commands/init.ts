import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { opsTemplateDir, templateFiles } from "../lib/templates.js";
import { api, ghReady } from "../lib/gh.js";

export const initHelp = `
roster init --org <github-org> [--name "Acme"] [--human <login>] [--apply]

  Stand up a new tenant: the ops repo that holds the org layer and the runner machinery, and
  the recorded base that makes every later \`roster upgrade\` a merge rather than a copy.

  What it deliberately does not do is write org/business.md. That file is what stops the
  agents producing generic slop, and it is the one thing here that has to come from someone
  who knows the business. You get a stub with the questions in it, and a /discover command to
  answer them with your own AI.

  Nothing happens without --apply. On its own this prints the plan.

  --org <name>      the GitHub organisation. Required.
  --name <text>     what the business is called. Defaults to the org.
  --human <login>   the person the agents answer to. Defaults to your gh login.
  --marker <tag>    provenance tag on a fact they ruled on. Defaults to the login's first part.
  --dir <path>      where to create the workspace. Defaults to the current directory.
  --ops <name>      ops repo name. Defaults to roster-ops.
  --agent <id>      coding agent: claude-code-action (default), claude, codex, nanocoder,
                    or any id you describe yourself in org.yaml.
  --apply           actually create it

  After this: \`roster hire <handle>\` for the first staff member, then \`roster app <handle>\`.
`;

export async function initCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  if (!opts.org) {
    process.stderr.write("roster: init needs --org <github-org>\n");
    return 2;
  }

  const ready = await ghReady();
  if (!ready.ok) {
    process.stderr.write(`roster: ${ready.error}\n`);
    return 1;
  }

  const human = opts.human ?? ready.data!.login;
  const name = opts.name ?? opts.org;
  const opsName = opts.ops ?? "roster-ops";
  const root = resolve(opts.dir ?? process.cwd());
  const opsDir = join(root, opsName);
  const marker = opts.marker ?? human.split("-")[0]!;

  if (existsSync(opsDir)) {
    process.stderr.write(`roster: ${opsDir} already exists. This org is already initialised.\n`);
    return 2;
  }

  const files = initFiles({ org: opts.org, name, human, marker, opsName, agent: opts.agent });

  process.stdout.write(`\n  roster init — ${name} (${opts.org})\n\n`);
  process.stdout.write(`    ops repo    ${opts.org}/${opsName}\n`);
  process.stdout.write(`    directory   ${opsDir}\n`);
  process.stdout.write(`    human       ${human}, tagged [${marker}] on facts they rule on\n`);
  process.stdout.write(`\n  ${files.size} files, plus .roster/seed as the merge base\n`);
  for (const rel of [...files.keys()].sort()) process.stdout.write(`    + ${rel}\n`);

  process.stdout.write(
    `\n  then, in order\n` +
    `    1. Settings → Actions → General on ${opsName}: allow access from repositories in\n` +
    `       this organisation. Callers cannot see the reusable workflow until you do, and the\n` +
    `       failure reads as "workflow not found" rather than as a permission.\n` +
    `    2. Put CLAUDE_CODE_OAUTH_TOKEN on each brain repo as you create it.\n` +
    `    3. Write org/business.md. Everything the agents say is downstream of it.\n` +
    `    4. roster hire <handle>   then   roster app <handle>\n\n`,
  );

  if (!opts.apply) {
    process.stdout.write("  Nothing was created. Re-run with --apply.\n\n");
    return 0;
  }

  mkdirSync(opsDir, { recursive: true });
  for (const [rel, text] of files) {
    const dest = join(opsDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  // The base is recorded at birth, which is the whole point: a tenant seeded without one can
  // only ever be upgraded by copying over it, and playpip needed archaeology to get one back.
  for (const rel of templateFiles(opsTemplateDir())) {
    const dest = join(opsDir, ".roster", "seed", rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(opsTemplateDir(), rel), "utf8"));
  }
  process.stdout.write(`  wrote ${files.size} files and the recorded base\n`);

  const created = await api(`orgs/${opts.org}/repos`, [
    "-X", "POST", "-f", `name=${opsName}`, "-F", "private=true",
    "-f", `description=${name}'s org layer and runner machinery, managed by roster`,
  ]);
  if (!created.ok) {
    process.stderr.write(`roster: could not create ${opts.org}/${opsName}: ${created.error}\n`);
    process.stderr.write(`  The files are still in ${opsDir}.\n`);
    return 1;
  }

  git(opsDir, ["init", "-q", "-b", "main"]);
  git(opsDir, ["add", "-A"]);
  git(opsDir, ["commit", "-q", "-m", "roster: the org layer and the runner machinery"]);
  git(opsDir, ["remote", "add", "origin", `https://github.com/${opts.org}/${opsName}.git`]);
  git(opsDir, ["push", "-q", "-u", "origin", "main"]);
  process.stdout.write(`  created and pushed ${opts.org}/${opsName}\n\n`);
  process.stdout.write(`  Now do the four things above, starting with the Actions setting.\n\n`);
  return 0;
}

/**
 * Everything a new ops repo contains, without writing any of it.
 *
 * Separate from the command so the whole chain — init, then hire, then doctor — can be run in
 * a temp directory. That end-to-end run is the plan's own acceptance test for this phase, and
 * it is the only thing that proves a brand new org is coherent rather than merely plausible.
 */
export function initFiles(o: { org: string; name: string; human: string; marker: string; opsName: string; agent?: string }): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of templateFiles(opsTemplateDir())) {
    files.set(rel, readFileSync(join(opsTemplateDir(), rel), "utf8"));
  }
  files.set("org.yaml", orgYaml({ ...o, agent: o.agent ?? "claude-code-action" }));
  files.set("org/business.md", businessStub(o.name, o.org));
  files.set(".roster-version", stamp() + "\n");
  return files;
}

function orgYaml(o: { org: string; name: string; human: string; marker: string; opsName: string; agent: string }): string {
  return `# The org manifest. Read at the top of every composed prompt.
# Kept deliberately simple: compose.mjs parses a small, strict YAML subset, and a manifest
# that needs more than this has outgrown being a manifest.

org: ${o.org}
name: ${o.name}
ops_dir: ${o.opsName}

human:
  name: ${o.human}
  github: ${o.human}
  marker: ${o.marker}          # the provenance tag on a fact they ruled on
  role: founder

experiment_private: true

# Which coding agent runs a session. roster knows nothing about any particular one: a runner is
# an install command, a run command, and the env var carrying its credential. Presets ship for
# claude-code-action (this one, the reference), claude, codex and nanocoder — and anything else
# works by writing the three fields out longhand. See agents.mjs.
agent:
  id: ${o.agent}

defaults:
  model: claude-opus-5
  timeout_minutes: 60
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch]

# Every staff member, and where their brain lands in the runner checkout.
# Written by \`roster hire\`.
staff: []

repos:
  - { name: ${o.opsName}, visibility: private, role: ops }
`;
}

/**
 * The one file nothing can generate.
 *
 * An agent that does not know the business writes plausible, generic work, which is the exact
 * failure the whole arrangement exists to avoid. So this ships as questions rather than as
 * prose, and says plainly that it is the most important file here.
 */
function businessStub(name: string, org: string): string {
  return `# What ${name} is

**This file is a stub, and everything the staff say is downstream of it.**

It is composed into the top of every prompt, every run. An agent that cannot answer these
questions writes work that is plausible and generic — which is worse than no work, because it
takes longer to notice.

Write it with your own AI, which can read the site, the README and the recent commits:

    claude
    /discover

Or answer these by hand. Short is better than complete.

## What this business does, in one line

## Who the customers are, specifically

Not a segment. The person, what they were doing ten minutes before they arrived, and what
they were trying to get done.

## The one fact everything else follows from

The thing that, if it changed, would make most of the strategy wrong.

## What is already true

What has been built, what has been measured, what has been tried and did not work. Facts with
numbers where there are numbers.

## What is not ours to decide

Where the business ends and someone else's judgement begins — pricing, legal, anything that
touches money or a real person's data.

---

Guardrails and house voice are not here: they are in \`org/guardrails.md\` and \`org/voice.md\`,
and every staff member inherits both. This file is only what the business *is*.

The org is \`${org}\`.
`;
}

function stamp(): string {
  try {
    return execFileSync("git", ["-C", join(opsTemplateDir(), "..", ".."), "rev-parse", "--short", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

interface Flags {
  org?: string; name?: string; human?: string; marker?: string;
  dir?: string; ops?: string; agent?: string; apply?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") { out.apply = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--org") out.org = value;
    else if (flag === "--name") out.name = value;
    else if (flag === "--human") out.human = value;
    else if (flag === "--marker") out.marker = value;
    else if (flag === "--dir") out.dir = value;
    else if (flag === "--ops") out.ops = value;
    else if (flag === "--agent") out.agent = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

export { orgYaml, businessStub };
