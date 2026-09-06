import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";
import { brainTemplateDir, nextSlot, render, renderTree, tokensFor, type OrgSpec, type StaffSpec } from "../lib/render.js";
import { api, ghJson, ghReady } from "../lib/gh.js";

export const hireHelp = `
roster hire <handle> [--name "Chief Financial Officer"] [--apply]

  Scaffold a new staff member: their brain repo, the three caller workflows, a manifest, a
  memory index, a charter stub, labels, a pinned status issue, and the peer wiring in both
  directions.

  It does not write the charter. That is the personality, it decides everything else, and a
  generated one produces exactly the generic agent this arrangement exists to avoid. What you
  get is a stub and a /charter command to write it with your own AI.

  Nothing happens without --apply. On its own this prints the plan: every file, every repo,
  every label, and every existing staff member it would edit.

  --name <text>          role name. Defaults to the handle, uppercased.
  --dir <name>           workspace directory and repo name. Defaults to the handle.
  --schedule <cron>      daily run. Defaults to a slot staggered after the last one.
  --model <id>           defaults to org.yaml's
  --timeout <n>          daily run ceiling, minutes
  --mention-timeout <n>  mention run ceiling, minutes
  --secret-prefix <X>    secrets are <X>_APP_ID and <X>_APP_PRIVATE_KEY. Defaults to HANDLE.
  --app <slug>           this staff member's GitHub App. Defaults to the pattern its peers use.
  --private             create the repo private (default)
  --apply                actually do it

  What it cannot do for you: create the GitHub App, or put its id and private key into the
  new repo's secrets. Those are the manual steps, and the plan lists them.
`;

interface Plan {
  org: OrgSpec;
  staff: StaffSpec;
  dir: string;
  files: Map<string, string>;
  /** Existing staff who gain a peer entry and a from-<handle> label. */
  peers: Array<{ handle: string; dir: string; brain: string; label: string }>;
  labels: string[];
  secrets: string[];
  warnings: string[];
}

export async function hireCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write("roster: hire needs a handle, e.g. `roster hire cfo`\n");
    return 2;
  }
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(handle)) {
    process.stderr.write(`roster: "${handle}" is not a usable handle. Lowercase letters, digits and dashes.\n`);
    return 2;
  }

  const opts = parseFlags(argv.slice(1));
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as OrgYaml;

  if ((org.staff ?? []).some((s) => s.handle === handle)) {
    process.stderr.write(`roster: "${handle}" is already in org.yaml\n`);
    return 2;
  }

  const plan = buildPlan(ws, org, handle, opts, parseYaml);
  printPlan(plan, ws);

  if (!opts.apply) {
    process.stdout.write("  Nothing was created. Re-run with --apply.\n\n");
    return 0;
  }
  return applyPlan(ws, plan, opts);
}

interface OrgYaml {
  org: string;
  name: string;
  human?: { github?: string; marker?: string };
  defaults?: { model?: string; timeout_minutes?: number };
  staff?: Array<{ handle: string; dir?: string; name?: string; schedule?: string }>;
  repos?: Array<{ name: string; visibility?: string; role?: string }>;
}

function buildPlan(
  ws: Workspace,
  org: OrgYaml,
  handle: string,
  opts: Flags,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
): Plan {
  const warnings: string[] = [];
  const dir = opts.dir ?? handle;

  // Everything tenant-shaped is copied from whoever is already here rather than guessed at:
  // app slugs carry a house naming scheme, and the public identity is genuinely shared.
  const siblings = (org.staff ?? []).map((s) => ({
    entry: s,
    manifest: readManifest(join(ws.root, s.dir ?? s.handle), parseYaml),
  })).filter((s) => s.manifest);

  const model = opts.model ?? org.defaults?.model ?? "claude-opus-5";
  const schedule = opts.schedule
    ?? nextSlot(siblings.map((s) => String(s.manifest!.schedule ?? s.entry.schedule ?? "")).filter(Boolean))
    ?? "0 8 * * 1-5";
  if (!opts.schedule) warnings.push(`schedule ${schedule} was chosen to sit clear of everyone else's`);

  const sample = siblings[0]?.manifest;
  const publicIdentity = (sample?.identities ?? []).find((i: any) => i?.scope === "public");
  const privateIdentity = (sample?.identities ?? []).find((i: any) => i?.scope === "private");

  const app = opts.app ?? inferAppSlug(privateIdentity?.app, siblings[0]?.entry.handle, handle);
  if (!opts.app && privateIdentity?.app) {
    warnings.push(`app slug "${app}" follows the pattern "${privateIdentity.app}" uses`);
  }
  if (!app) warnings.push("no app slug could be inferred; pass --app");

  const publicApp = publicIdentity?.app ?? "";
  if (!publicApp) warnings.push("no shared public app found on an existing staff member");

  const staff: StaffSpec = {
    handle,
    name: opts.name ?? handle.toUpperCase(),
    dir,
    brain: `${org.org}/${dir}`,
    mention: `@${handle}`,
    // 0 until --apply opens the pinned issue. The prompts reference it, so a scaffold that
    // has not been applied cannot compose one — which doctor says out loud rather than hiding.
    statusIssue: opts.statusIssue ?? 0,
    // Every staff member so far contributes to the product repo, and the prompts reference it
    // by name. Inferring it from org.yaml beats shipping an empty list the first run trips on.
    worksIn: (org.repos ?? []).filter((r) => r.role === "product").map((r) => `${org.org}/${r.name}`),
    schedule,
    model,
    timeout: opts.timeout ?? org.defaults?.timeout_minutes ?? 60,
    mentionTimeout: opts.mentionTimeout ?? 30,
    secretPrefix: opts.secretPrefix ?? handle.toUpperCase(),
    publicSecretPrefix: publicIdentity?.secret_prefix ?? "BOT",
    app: app ?? `${handle}`,
    publicApp: publicApp || "public-app",
    publicTokenEnv: String(sample?.public_token_env ?? "PUBLIC_TOKEN"),
  };
  if (!opts.name) warnings.push(`no --name given, so the role is called "${staff.name}"`);
  if (staff.worksIn.length) {
    warnings.push(`works_in was set to ${staff.worksIn.join(", ")}, the product repos in org.yaml`);
  }
  if (!staff.statusIssue) {
    warnings.push("status_issue is 0 until --apply opens the pinned issue; prompts will not compose before then");
  }

  const orgSpec: OrgSpec = {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${ws.opsName}`,
    opsDirName: ws.opsName,
    human: org.human?.github ?? "",
    humanMarker: org.human?.marker ?? "human",
  };
  if (!orgSpec.human) warnings.push("org.yaml has no human.github, so the mention gate will never match");

  const files = renderTree(brainTemplateDir(), tokensFor(orgSpec, staff));

  const peers = siblings.map((s) => ({
    handle: s.entry.handle,
    dir: s.entry.dir ?? s.entry.handle,
    brain: String(s.manifest!.brain ?? `${org.org}/${s.entry.dir ?? s.entry.handle}`),
    label: `from-${handle}`,
  }));

  const labels = [
    ...new Set([
      orgSpec.humanMarker, handle,
      "decision", "setup", "build", "blocked",
      ...peers.map((p) => `from-${p.handle}`),
    ]),
  ];

  const secrets = [
    `${staff.secretPrefix}_APP_ID`,
    `${staff.secretPrefix}_APP_PRIVATE_KEY`,
    `${staff.publicSecretPrefix}_APP_ID`,
    `${staff.publicSecretPrefix}_APP_PRIVATE_KEY`,
    "CLAUDE_CODE_OAUTH_TOKEN",
  ];

  return { org: orgSpec, staff, dir, files, peers, labels, secrets, warnings };
}

/** `pip-cto` for handle `cto` implies `pip-cfo` for handle `cfo`. Anything less obvious is asked for. */
function inferAppSlug(sampleApp: string | undefined, sampleHandle: string | undefined, handle: string): string | undefined {
  if (!sampleApp || !sampleHandle) return undefined;
  if (!sampleApp.endsWith(sampleHandle)) return undefined;
  return sampleApp.slice(0, sampleApp.length - sampleHandle.length) + handle;
}

function readManifest(root: string, parseYaml: (t: string, f?: string) => Record<string, unknown>) {
  const path = join(root, "staff.yaml");
  if (!existsSync(path)) return null;
  try {
    return parseYaml(readFileSync(path, "utf8"), "staff.yaml") as Record<string, any>;
  } catch {
    return null;
  }
}

function printPlan(plan: Plan, ws: Workspace) {
  const { staff, org } = plan;
  process.stdout.write(`\n  roster hire — ${staff.name} (${staff.mention}) at ${org.name}\n\n`);

  process.stdout.write(`    repo        ${staff.brain}\n`);
  process.stdout.write(`    directory   ${join(ws.root, plan.dir)}\n`);
  process.stdout.write(`    schedule    ${staff.schedule}   (${staff.timeout}m ceiling)\n`);
  process.stdout.write(`    model       ${staff.model}\n`);
  process.stdout.write(`    identities  ${staff.app}[bot] private, ${staff.publicApp}[bot] shared\n`);

  process.stdout.write(`\n  ${plan.files.size} files\n`);
  for (const rel of [...plan.files.keys()].sort()) process.stdout.write(`    + ${rel}\n`);

  process.stdout.write(`\n  ${plan.labels.length} labels on ${staff.brain}\n    ${plan.labels.join(", ")}\n`);

  if (plan.peers.length) {
    process.stdout.write(`\n  peer wiring, both ways\n`);
    for (const p of plan.peers) {
      process.stdout.write(`    ${p.brain}: add label "${p.label}", and a peers: entry for ${staff.handle}\n`);
    }
  }

  process.stdout.write(`\n  org.yaml gains a staff entry and a repos entry\n`);
  process.stdout.write(`  a pinned status issue is opened, and its number written into staff.yaml\n`);

  if (plan.warnings.length) {
    process.stdout.write(`\n  assumptions\n`);
    for (const w of plan.warnings) process.stdout.write(`    · ${w}\n`);
  }

  /* The manual steps are the part people lose a day to, so they are printed with the plan
     rather than left for the docs. An App's id and key cannot be created from here. */
  process.stdout.write(
    `\n  you will have to do these yourself\n` +
    `    1. Create the GitHub App "${staff.app}", install it on ${staff.brain}\n` +
    `       and on every peer tracker it writes to.\n` +
    `    2. Put these secrets on ${staff.brain}:\n` +
    plan.secrets.map((s) => `         ${s}\n`).join("") +
    `    3. Write the charter:  cd ${plan.dir} && claude  →  /charter\n` +
    `\n  Then: roster doctor ${staff.handle}\n\n`,
  );
}

async function applyPlan(ws: Workspace, plan: Plan, opts: Flags): Promise<number> {
  const { staff } = plan;
  const ready = await ghReady();
  if (!ready.ok) {
    process.stderr.write(`roster: ${ready.error}\n`);
    return 1;
  }

  const root = join(ws.root, plan.dir);
  if (existsSync(root)) {
    process.stderr.write(`roster: ${root} already exists. Move it aside first.\n`);
    return 1;
  }

  // Local files first: everything here is reversible with rm, and it is what the rest needs.
  for (const [rel, text] of plan.files) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  process.stdout.write(`  wrote ${plan.files.size} files to ${root}\n`);

  const created = await api(`orgs/${plan.org.org}/repos`, [
    "-X", "POST", "-f", `name=${plan.dir}`,
    "-F", `private=${opts.visibility !== "public"}`,
    "-f", `description=${staff.name} — an agent-run brain, managed by roster`,
  ]);
  if (!created.ok) {
    process.stderr.write(`roster: could not create ${staff.brain}: ${created.error}\n`);
    process.stderr.write(`  The local files are still in ${root}.\n`);
    return 1;
  }
  process.stdout.write(`  created ${staff.brain}\n`);

  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `roster: scaffold ${staff.name}`]);
  git(root, ["remote", "add", "origin", `https://github.com/${staff.brain}.git`]);
  git(root, ["push", "-q", "-u", "origin", "main"]);
  process.stdout.write(`  pushed the scaffold\n`);

  for (const label of plan.labels) {
    await ghJson(["label", "create", label, "--repo", staff.brain, "--force"]);
  }
  process.stdout.write(`  created ${plan.labels.length} labels\n`);

  for (const p of plan.peers) {
    await ghJson(["label", "create", p.label, "--repo", p.brain, "--force",
      "--description", `A brief or ask from ${staff.name}`]);
  }
  if (plan.peers.length) process.stdout.write(`  labelled ${plan.peers.length} peer trackers\n`);

  wirePeers(ws, plan, root);
  if (plan.peers.length) {
    process.stdout.write(`  wired ${plan.peers.length} peers, both ways\n`);
    process.stdout.write(`  (their staff.yaml files changed locally — commit and push them)\n`);
  }

  const issue = await ghJson<{ number: number }>([
    "api", `repos/${staff.brain}/issues`, "-X", "POST",
    "-f", "title=📍 Where we are (living status - always current)",
    "-f", `body=${statusBody(staff)}`,
  ]);
  if (issue.ok && issue.data?.number) {
    await ghJson(["api", `repos/${staff.brain}/issues/${issue.data.number}/pin`, "-X", "PUT",
      "-H", "Accept: application/vnd.github+json"]).catch(() => undefined);
    // Re-rendered rather than patched: the manifest is generated, so the generator owns it.
    const withIssue = { ...plan.staff, statusIssue: issue.data.number };
    writeFileSync(join(root, "staff.yaml"),
      render(readFileSync(join(brainTemplateDir(), "staff.yaml"), "utf8"),
             tokensFor(plan.org, withIssue), "staff.yaml"));
    process.stdout.write(`  opened status issue #${issue.data.number}\n`);
  } else {
    process.stdout.write(`  could not open the status issue: ${issue.error}\n`);
  }

  addToOrgYaml(ws, plan);
  process.stdout.write(`  added ${staff.handle} to org.yaml\n`);

  process.stdout.write(
    `\n  ${staff.name} exists but cannot run yet.\n` +
    `  Create the app, add the secrets, write the charter — then: roster doctor ${staff.handle}\n\n`,
  );
  return 0;
}

/**
 * Peers know each other by name, in both directions: the new hire learns who is already here,
 * and each of them gains an entry for the new one. The label in an entry is always
 * `from-<the owner of the file>` — it is how *this* staff member marks work it files on
 * *that* tracker, which is why it is not symmetric.
 */
export function wirePeers(ws: Workspace, plan: Plan, root: string) {
  const { staff } = plan;

  const mine = plan.peers
    .map((p) => `  - { handle: ${p.handle}, brain: ${p.brain}, label: from-${staff.handle} }`)
    .join("\n");
  const manifest = join(root, "staff.yaml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(
    /^peers: \[\]$/m,
    mine ? `peers:\n${mine}` : "peers: []",
  ));

  for (const p of plan.peers) {
    const path = join(ws.root, p.dir, "staff.yaml");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (new RegExp(`handle: ${staff.handle}[,\\s}]`).test(text)) continue; // already wired
    const line = `  - { handle: ${staff.handle}, brain: ${staff.brain}, label: from-${p.handle} }`;
    writeFileSync(path, insertUnder(text, /^peers:\s*$/m, line));
  }
}

/**
 * Appended textually rather than by re-serialising. compose.mjs parses a deliberately small
 * YAML subset, and a round trip through a generic emitter would reformat the whole file and
 * lose every comment in it.
 */
export function addToOrgYaml(ws: Workspace, plan: Plan) {
  const path = join(ws.opsDir, "org.yaml");
  const text = readFileSync(path, "utf8");
  const { staff } = plan;

  const staffLine = `  - { handle: ${staff.handle}, dir: ${plan.dir}, name: ${staff.name}, schedule: "${staff.schedule}" }\n`;
  const repoLine = `  - { name: ${plan.dir}, visibility: private, role: brain }\n`;

  const withStaff = insertUnder(text, /^staff:\s*$/m, staffLine);
  writeFileSync(path, insertUnder(withStaff, /^repos:\s*$/m, repoLine));
}

/** Add a line at the end of the block a heading introduces, keeping the rest untouched. */
export function insertUnder(text: string, heading: RegExp, line: string): string {
  const m = heading.exec(text);
  if (!m) return text.trimEnd() + "\n\n" + heading.source.replace(/[\^$\\s*]/g, "") + "\n" + line;
  const lines = text.split("\n");
  let i = text.slice(0, m.index).split("\n").length;
  while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.trim().startsWith("#"))) i++;
  lines.splice(i, 0, line.trimEnd());
  return lines.join("\n");
}

function statusBody(staff: StaffSpec): string {
  return [
    `**${staff.name}'s living status. Always current — this issue is rewritten, never appended to.**`,
    "",
    "| | The ask |",
    "|---|---|",
    "| — | Nothing yet. This staff member has just been hired. |",
    "",
    "---",
    "",
    `Before the first unattended run: the GitHub App has to exist and be installed, its`,
    `secrets have to be on this repo, and \`CHARTER.md\` has to be written.`,
    "",
    `Check with: \`roster doctor ${staff.handle}\``,
  ].join("\n");
}

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

interface Flags {
  ops?: string; name?: string; dir?: string; schedule?: string; model?: string;
  timeout?: number; mentionTimeout?: number; secretPrefix?: string; app?: string; statusIssue?: number;
  visibility?: string; apply?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") { out.apply = true; continue; }
    if (flag === "--private") { out.visibility = "private"; continue; }
    if (flag === "--public") { out.visibility = "public"; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else if (flag === "--name") out.name = value;
    else if (flag === "--dir") out.dir = value;
    else if (flag === "--schedule") out.schedule = value;
    else if (flag === "--model") out.model = value;
    else if (flag === "--timeout") out.timeout = Number(value);
    else if (flag === "--mention-timeout") out.mentionTimeout = Number(value);
    else if (flag === "--secret-prefix") out.secretPrefix = value;
    else if (flag === "--app") out.app = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

export { buildPlan, type Plan };
