import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commitAndPush } from "../lib/commit.js";
import { readOrgSecret, shareOrgSecret } from "../lib/credential.js";
import { api, ghJson, ghReady } from "../lib/gh.js";
import { readHumans } from "../lib/humans.js";
import {
  brainTemplateDir,
  briefCommands,
  nextSlot,
  type OrgSpec,
  render,
  renderTree,
  type StaffSpec,
  tokensFor,
  toolsOf,
} from "../lib/render.js";
import { addGate, judgeGate, readGate } from "../lib/reviewgate.js";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";

export const hireHelp = `
roster hire <handle> [--name "Chief Financial Officer"] [--apply]

  Scaffold a new staff member: their brain repo, the two caller workflows, a manifest, a
  memory index, a charter stub, labels, a pinned status issue, and the peer wiring in both
  directions.

  It does not write the charter. That is the personality, it decides everything else, and a
  generated one produces exactly the generic agent this arrangement exists to avoid. What you
  get is a stub, and \`roster brief charter <handle>\` prints the brief to write it with
  whichever agent you use.

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
  --public-app <slug>    the shared public identity. Defaults to whatever the peers use.
  --no-review-gate       leave the product repos' branch rules alone
  --apply                actually do it

  With --apply it also commits and pushes, as you, what it changed in repos that already
  exist: each peer's staff.yaml, org.yaml in the ops repo, and the new staff.yaml once the
  status issue has a number. The plan lists every one of those commits first.

  If the agent credential is an org secret (\`roster credential\`), the new brain is added to
  its list of repos, so the credential is never asked for again.

  What it cannot do for you: create the GitHub App. \`roster app <handle>\` does that next.
`;

export interface Plan {
  org: OrgSpec;
  staff: StaffSpec;
  dir: string;
  files: Map<string, string>;
  /** Existing staff who gain a peer entry and a from-<handle> label. */
  peers: Array<{ handle: string; dir: string; brain: string; label: string }>;
  labels: string[];
  secrets: string[];
  warnings: string[];
  /** --no-review-gate: leave the product repos' branch rules as they are. */
  skipGate: boolean;
  /** Commits into repos that already exist, made as the person running roster. */
  commits: Array<{ repo: string; dir: string; file: string; why: string; message: string }>;
  /**
   * The agent credential as an org secret, read from GitHub before the plan is shown. `null`
   * is none, so the new brain needs `roster credential`; absent is not looked up yet.
   */
  orgSecret?: { visibility: string } | null;
}

export async function hireCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write("roster: hire needs a handle, e.g. `roster hire cfo`\n");
    return 2;
  }
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(handle)) {
    process.stderr.write(
      `roster: "${handle}" is not a usable handle. Lowercase letters, digits and dashes.\n`,
    );
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
  plan.orgSecret = await readOrgSecret(org.org, plan.staff.agentSecret);
  printPlan(plan, ws);

  if (!opts.apply) {
    process.stdout.write("  Nothing was created. Re-run with --apply.\n\n");
    return 0;
  }
  return applyPlan(ws, plan, opts);
}

export interface OrgYaml {
  org: string;
  name: string;
  human?: { github?: string; marker?: string };
  /** The plural spelling. Both are read; see lib/humans.ts. */
  humans?: Array<{ github?: string; name?: string; marker?: string; role?: string }>;
  defaults?: { model?: string; timeout_minutes?: number; mention_timeout_minutes?: number };
  staff?: Array<{ handle: string; dir?: string; name?: string; schedule?: string }>;
  repos?: Array<{ name: string; visibility?: string; role?: string }>;
}

export function buildPlan(
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
  const siblings = (org.staff ?? [])
    .map((s) => ({
      entry: s,
      manifest: readManifest(join(ws.root, s.dir ?? s.handle), parseYaml),
    }))
    .filter((s) => s.manifest);

  const model = opts.model ?? org.defaults?.model ?? "claude-opus-5-5";
  const schedule =
    opts.schedule ??
    nextSlot(
      siblings.map((s) => String(s.manifest!.schedule ?? s.entry.schedule ?? "")).filter(Boolean),
    ) ??
    "0 8 * * 1-5";
  if (!opts.schedule)
    warnings.push(`schedule ${schedule} was chosen to sit clear of everyone else's`);

  const sample = siblings[0]?.manifest;
  const publicIdentity = (sample?.identities ?? []).find((i: any) => i?.scope === "public");
  const privateIdentity = (sample?.identities ?? []).find((i: any) => i?.scope === "private");

  const app = opts.app ?? inferAppSlug(privateIdentity?.app, siblings[0]?.entry.handle, handle);
  if (!opts.app && privateIdentity?.app) {
    warnings.push(`app slug "${app}" follows the pattern "${privateIdentity.app}" uses`);
  }
  if (!app) warnings.push("no app slug could be inferred; pass --app");

  const publicApp = opts.publicApp ?? publicIdentity?.app ?? "";
  if (!publicApp) {
    // The first hire in a fresh org has nobody to copy it from, and a made-up name would be
    // worse than an empty one: it would reach a workflow and fail at token-minting time.
    warnings.push(
      "no shared public identity yet — pass --public-app, or the product-repo lane will not work",
    );
  }

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
    worksIn: (org.repos ?? [])
      .filter((r) => r.role === "product")
      .map((r) => `${org.org}/${r.name}`),
    schedule,
    model,
    timeout: opts.timeout ?? org.defaults?.timeout_minutes ?? 90,
    // A mention that ends in a build needs a session's room: the product repo's gate alone
    // can outlast a short ceiling, and a hire that has to discover that costs a run. An org
    // that wants them split says so; absent that, one number governs both.
    mentionTimeout:
      opts.mentionTimeout ??
      org.defaults?.mention_timeout_minutes ??
      org.defaults?.timeout_minutes ??
      90,
    secretPrefix: opts.secretPrefix ?? handle.toUpperCase(),
    publicSecretPrefix: publicIdentity?.secret_prefix ?? "BOT",
    app: app ?? `${handle}`,
    publicApp: publicApp || `${org.org}-robot`,
    publicTokenEnv: String(sample?.public_token_env ?? "PUBLIC_TOKEN"),
    agentSecret: opts.agentSecret ?? agentTokenEnv(org),
  };
  if (!opts.name) warnings.push(`no --name given, so the role is called "${staff.name}"`);
  if (staff.worksIn.length) {
    warnings.push(`works_in was set to ${staff.worksIn.join(", ")}, the product repos in org.yaml`);
  }
  if (!staff.statusIssue) {
    warnings.push(
      "status_issue is 0 until --apply opens the pinned issue; prompts will not compose before then",
    );
  }

  const humans = readHumans(org);
  const orgSpec: OrgSpec = {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${ws.opsName}`,
    opsDirName: ws.opsName,
    human: humans[0]?.github ?? "",
    humanMarker: humans[0]?.marker ?? "human",
    humanLogins: humans.map((h) => h.github).filter(Boolean),
    allowedTools: toolsOf(org),
  };
  if (!orgSpec.human)
    warnings.push("org.yaml has no human.github, so the mention gate will never match");
  if (humans.length > 1) {
    warnings.push(
      `the mention gate accepts ${humans.map((h) => h.github).join(", ")} — everyone in org.yaml`,
    );
  }

  const tokens = tokensFor(orgSpec, staff);
  const files = renderTree(brainTemplateDir(), tokens);
  // /charter is generated from templates/briefs/charter.md, the same text `roster brief`
  // prints for any other agent.
  for (const [rel, text] of briefCommands(["charter"], tokens)) files.set(rel, text);

  const peers = siblings.map((s) => ({
    handle: s.entry.handle,
    dir: s.entry.dir ?? s.entry.handle,
    brain: String(s.manifest!.brain ?? `${org.org}/${s.entry.dir ?? s.entry.handle}`),
    label: `from-${handle}`,
  }));

  const labels = [
    ...new Set([
      orgSpec.humanMarker,
      handle,
      "decision",
      "setup",
      "build",
      "blocked",
      ...peers.map((p) => `from-${p.handle}`),
    ]),
  ];

  const secrets = [
    `${staff.secretPrefix}_APP_ID`,
    `${staff.secretPrefix}_APP_PRIVATE_KEY`,
    `${staff.publicSecretPrefix}_APP_ID`,
    `${staff.publicSecretPrefix}_APP_PRIVATE_KEY`,
    staff.agentSecret,
  ];

  /* Written after the new repo is pushed, into repos that already exist, so they are committed
     as their own step and listed here first. Left on disk, they were the part of a hire that
     looked finished and was not: a peer that does not know the new name, an org.yaml the
     runner never sees. */
  const commits = [
    ...peers.map((p) => ({
      repo: p.brain,
      dir: p.dir,
      file: "staff.yaml",
      why: `a peers: entry for ${handle}`,
      message: `roster: ${handle} joins as a peer`,
    })),
    {
      repo: staff.brain,
      dir,
      file: "staff.yaml",
      why: "the status issue's number, once it is opened",
      message: "roster: the pinned status issue",
    },
    {
      repo: orgSpec.opsRepo,
      dir: ws.opsName,
      file: "org.yaml",
      why: `a staff entry and a repos entry for ${handle}`,
      message: `roster: hire ${handle}`,
    },
  ];

  return {
    org: orgSpec,
    staff,
    dir,
    files,
    peers,
    labels,
    secrets,
    warnings,
    skipGate: opts.reviewGate === false,
    commits,
  };
}

/** Which repo secret the agent's credential lives in, named after the credential itself. */
export function agentTokenEnv(org: OrgYaml): string {
  const asked = (org as any).agent;
  const spec = typeof asked === "string" ? { id: asked } : (asked ?? {});
  if (spec.token_env) return String(spec.token_env);
  const known: Record<string, string> = {
    "claude-code-action": "CLAUDE_CODE_OAUTH_TOKEN",
    claude: "CLAUDE_CODE_OAUTH_TOKEN",
    codex: "CODEX_API_KEY",
    nanocoder: "NANOCODER_API_KEY",
  };
  return known[spec.id ?? "claude-code-action"] ?? "AGENT_TOKEN";
}

/** `acme-cto` for handle `cto` implies `acme-cfo` for handle `cfo`. Anything less obvious is asked for. */
function inferAppSlug(
  sampleApp: string | undefined,
  sampleHandle: string | undefined,
  handle: string,
): string | undefined {
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
  process.stdout.write(
    `    identities  ${staff.app}[bot] private, ${staff.publicApp}[bot] shared\n`,
  );

  process.stdout.write(`\n  ${plan.files.size} files\n`);
  for (const rel of [...plan.files.keys()].sort()) process.stdout.write(`    + ${rel}\n`);

  process.stdout.write(
    `\n  ${plan.labels.length} labels on ${staff.brain}\n    ${plan.labels.join(", ")}\n`,
  );

  if (plan.peers.length) {
    process.stdout.write(`\n  peer wiring, both ways\n`);
    for (const p of plan.peers) {
      process.stdout.write(
        `    ${p.brain}: add label "${p.label}", and a peers: entry for ${staff.handle}\n`,
      );
    }
  }

  /* The gate is what makes "you prepare, they publish" true rather than a promise, and a
     hire is the moment a new account starts opening PRs on the product. */
  if (staff.worksIn.length && !plan.skipGate) {
    process.stdout.write(
      `\n  review gate, where a product repo does not already require an approving review\n`,
    );
    for (const repo of staff.worksIn) {
      process.stdout.write(
        `    ${repo}: a ruleset requiring one approving review on the default branch\n`,
      );
    }
  }

  process.stdout.write(
    `\n  a pinned status issue is opened, and its number written into staff.yaml\n`,
  );

  process.stdout.write(`\n  commits, pushed as you\n`);
  for (const c of plan.commits) process.stdout.write(`    ${c.repo}: ${c.file}, ${c.why}\n`);

  const cred = staff.agentSecret;
  process.stdout.write(`\n  the agent credential\n`);
  if (plan.orgSecret?.visibility === "selected") {
    process.stdout.write(
      `    ${staff.brain} is added to the repos that can read the org secret ${cred}\n`,
    );
  } else if (plan.orgSecret) {
    process.stdout.write(
      `    the org secret ${cred} already reaches ${plan.orgSecret.visibility} repos\n`,
    );
  } else {
    process.stdout.write(
      `    no org secret ${cred} your gh can see: roster credential --apply after this, once for the org\n`,
    );
  }

  if (plan.warnings.length) {
    process.stdout.write(`\n  assumptions\n`);
    for (const w of plan.warnings) process.stdout.write(`    · ${w}\n`);
  }

  /* The manual steps are the part people lose a day to, so they are printed with the plan
     rather than left for the docs. An App's id and key cannot be created from here. */
  process.stdout.write(
    `\n  then, yourself\n` +
      `    1. roster app ${staff.handle} --apply   creates "${staff.app}", sets its secrets, and\n` +
      `       links to an install page with ${staff.brain} and its peers already ticked.\n` +
      (plan.orgSecret
        ? ""
        : `    ·  roster credential --apply   if the agent credential is not stored yet\n`) +
      `    2. Write the charter:  roster brief charter ${staff.handle}, pasted into your agent\n` +
      `    3. roster run ${staff.handle} --apply   one run, which is what proves the wiring\n\n`,
  );
}

export async function applyPlan(ws: Workspace, plan: Plan, opts: Flags): Promise<number> {
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
    "-X",
    "POST",
    "-f",
    `name=${plan.dir}`,
    "-F",
    // A brain is a staff member's whole memory, and org.yaml records it as private.
    "private=true",
    "-f",
    `description=${staff.name} — an agent-run brain, managed by roster`,
  ]);
  if (!created.ok) {
    process.stderr.write(`roster: could not create ${staff.brain}: ${created.error}\n`);
    process.stderr.write(`  The local files are still in ${root}.\n`);
    return 1;
  }
  process.stdout.write(`  created ${staff.brain}\n`);

  const orgSecret =
    plan.orgSecret === undefined
      ? await readOrgSecret(plan.org.org, staff.agentSecret)
      : plan.orgSecret;
  if (orgSecret) {
    const shared = await shareOrgSecret(plan.org.org, staff.agentSecret, staff.brain);
    process.stdout.write(`  ${shared.note}\n`);
  }

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
    await ghJson([
      "label",
      "create",
      p.label,
      "--repo",
      p.brain,
      "--force",
      "--description",
      `A brief or ask from ${staff.name}`,
    ]);
  }
  if (plan.peers.length) process.stdout.write(`  labelled ${plan.peers.length} peer trackers\n`);

  wirePeers(ws, plan, root);
  if (plan.peers.length) process.stdout.write(`  wired ${plan.peers.length} peers, both ways\n`);

  const issue = await ghJson<{ number: number }>([
    "api",
    `repos/${staff.brain}/issues`,
    "-X",
    "POST",
    "-f",
    "title=📍 Where we are (living status - always current)",
    "-f",
    `body=${statusBody(staff)}`,
  ]);
  if (issue.ok && issue.data?.number) {
    await ghJson([
      "api",
      `repos/${staff.brain}/issues/${issue.data.number}/pin`,
      "-X",
      "PUT",
      "-H",
      "Accept: application/vnd.github+json",
    ]).catch(() => undefined);
    // Re-rendered rather than patched: the manifest is generated, so the generator owns it.
    const withIssue = { ...plan.staff, statusIssue: issue.data.number };
    writeFileSync(
      join(root, "staff.yaml"),
      render(
        readFileSync(join(brainTemplateDir(), "staff.yaml"), "utf8"),
        tokensFor(plan.org, withIssue),
        "staff.yaml",
      ),
    );
    process.stdout.write(`  opened status issue #${issue.data.number}\n`);
  } else {
    process.stdout.write(`  could not open the status issue: ${issue.error}\n`);
  }

  addToOrgYaml(ws, plan);
  process.stdout.write(`  added ${staff.handle} to org.yaml\n`);

  for (const c of plan.commits) {
    const done = commitAndPush(join(ws.root, c.dir), [c.file], c.message);
    process.stdout.write(
      done.pushed
        ? `  pushed ${c.repo}: ${c.file} (${done.sha})\n`
        : done.committed
          ? `  committed ${c.repo}: ${c.file} but could not push: ${done.note}. Push it yourself.\n`
          : `  left ${c.repo}: ${c.file} uncommitted: ${done.note}\n`,
    );
  }

  if (!plan.skipGate) {
    for (const repo of staff.worksIn) {
      process.stdout.write(`  ${await ensureGate(repo, [staff.app, staff.publicApp])}\n`);
    }
  }

  process.stdout.write(
    `\n  ${staff.name} exists but cannot run yet.\n` +
      `  Next: roster app ${staff.handle} --apply, the charter, then roster run ${staff.handle} --apply\n\n`,
  );
  return 0;
}

/**
 * Adds the gate only where there is none, or where a PR is required with no approval. A repo
 * whose rules are stricter, or that a staff App can bypass, is reported and left alone: that
 * is somebody's deliberate configuration, and rewriting it is not a hire's business.
 */
async function ensureGate(repo: string, apps: string[]): Promise<string> {
  const now = await readGate(repo, apps);
  if (now.error || now.bypass.length || (now.approvals ?? 0) >= 1) {
    return `review gate on ${repo}: ${judgeGate(now).title}`;
  }
  const added = await addGate(repo);
  return added.ok
    ? `added a review-before-merge ruleset to ${repo}`
    : `could not add a review gate to ${repo}: ${added.error}. See docs/security.md.`;
}

/**
 * Peers know each other by name, in both directions: the new hire learns who is already here,
 * and each of them gains an entry for the new one. The label in an entry is always
 * `from-<the owner of the file>` — it is how *this* staff member marks work it files on
 * *that* tracker, which is why it is not symmetric.
 */
export function wirePeers(ws: Workspace, plan: Plan, root: string) {
  const { staff } = plan;

  const manifest = join(root, "staff.yaml");
  let mineText = readFileSync(manifest, "utf8");
  for (const p of plan.peers) {
    mineText = insertUnder(
      mineText,
      "peers",
      `  - { handle: ${p.handle}, brain: ${p.brain}, label: from-${staff.handle} }`,
    );
  }
  writeFileSync(manifest, mineText);

  for (const p of plan.peers) {
    const path = join(ws.root, p.dir, "staff.yaml");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (new RegExp(`handle: ${staff.handle}[,\\s}]`).test(text)) continue; // already wired
    const line = `  - { handle: ${staff.handle}, brain: ${staff.brain}, label: from-${p.handle} }`;
    writeFileSync(path, insertUnder(text, "peers", line));
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

  const withStaff = insertUnder(text, "staff", staffLine);
  writeFileSync(path, insertUnder(withStaff, "repos", repoLine));
}

/**
 * Add a line at the end of the block a key introduces, leaving the rest of the file untouched.
 *
 * Three shapes, because all three occur. `key:` with entries under it is the common one. `key: []`
 * is what a fresh org.yaml and a fresh staff.yaml both carry, and it has to become a block list
 * rather than gain a stray line that belongs to nothing — the first end-to-end init found that by
 * producing an org with a staff list nobody could read. A key that is absent is appended.
 */
export function insertUnder(text: string, key: string, line: string): string {
  const empty = new RegExp(`^${key}:\\s*\\[\\]\\s*$`, "m");
  if (empty.test(text)) return text.replace(empty, `${key}:\n${line.trimEnd()}`);

  const heading = new RegExp(`^${key}:\\s*$`, "m");
  const m = heading.exec(text);
  if (!m) return `${text.trimEnd()}\n\n${key}:\n${line.trimEnd()}\n`;

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

export interface Flags {
  ops?: string;
  name?: string;
  dir?: string;
  schedule?: string;
  model?: string;
  timeout?: number;
  mentionTimeout?: number;
  secretPrefix?: string;
  app?: string;
  publicApp?: string;
  statusIssue?: number;
  agentSecret?: string;
  reviewGate?: boolean;
  apply?: boolean;
}

const VALUE_FLAGS = new Set([
  "--ops",
  "--name",
  "--dir",
  "--schedule",
  "--model",
  "--timeout",
  "--mention-timeout",
  "--secret-prefix",
  "--app",
  "--public-app",
]);

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") {
      out.apply = true;
      continue;
    }
    if (flag === "--no-review-gate") {
      out.reviewGate = false;
      continue;
    }
    // Named before its value is taken, so a flag that was removed says so rather than
    // claiming it needs an argument.
    if (!VALUE_FLAGS.has(flag!)) throw new Error(`unknown flag ${flag}`);
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
    else if (flag === "--public-app") out.publicApp = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
