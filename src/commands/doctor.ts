import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";
import { parseMemory } from "../lib/memory.js";
import { planAll } from "./upgrade.js";
import { opsTemplateDir } from "../lib/templates.js";
import { api, ghJson, ghReady, graphql } from "../lib/gh.js";

export const doctorHelp = `
roster doctor [handle] [--offline] [--json]

  Check that this org is actually wired up: manifests, prompts, callers, secrets, labels,
  pinned issues, Actions access, and whether the agents have in fact been running.

  What it will not do is tell you an app is installed because the API says the app exists.
  GitHub reports an app's *declaration* separately from an installation's *grant*, and the
  two disagree in exactly the case you care about. The only thing that proves the whole
  chain — app installed, granted, secrets right, workflow reachable — is a run that
  finished. So a window of recent runs is read for every workflow, and one that has never
  run is reported as unproven rather than as fine.

  Two things it reads that GitHub does not say plainly: a skipped run is the job's own
  condition gating it out, not a failure, and a job killed by timeout-minutes is reported
  as "cancelled" — recognised here by its duration and named as the timeout it was.

  Everything goes through your own gh, so it sees what you see.

  --offline   skip every check that needs the network
  --json      machine-readable findings
  --ops <dir> ops repo directory (default: found by walking up)

  Exit code is 1 if anything failed, 0 otherwise. Warnings do not fail.
`;

type Level = "ok" | "warn" | "fail";

interface Finding {
  scope: string;
  level: Level;
  id: string;
  title: string;
  fix?: string;
}

export interface Report {
  org: OrgFile;
  findings: Finding[];
  online: boolean;
}

/**
 * Every check, with nothing printed. Kept separate from the command so the findings can be
 * asserted on directly — capturing stdout to test them fights the test runner for the stream.
 */
export async function collect(opts: Flags & { only?: string }): Promise<Report | null> {
  const ws = findWorkspace(opts.ops);
  const composer = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, composer.parseYaml) as OrgFile;

  const staff = (org.staff ?? []).filter((s) => !opts.only || s.handle === opts.only);
  if (!staff.length) return null;

  const findings: Finding[] = [];
  const online = !opts.offline && (await gate(findings));

  findings.push(...checkWorkspace(ws, org));
  if (online) findings.push(...(await checkOrgOnline(ws, org)));

  // Staff members are independent, so they are checked at the same time rather than in turn.
  const perStaff = await Promise.all(staff.map((s) => checkStaff(ws, org, s, composer, online)));
  for (const f of perStaff) findings.push(...f);

  return { org, findings, online };
}

export async function doctorCommand(argv: string[]): Promise<number> {
  const only = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;
  const opts = parseFlags(argv.slice(only ? 1 : 0));

  const result = await collect({ ...opts, only });
  if (!result) {
    process.stderr.write(`roster: no staff member "${only}" in org.yaml\n`);
    return 2;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ org: result.org.org, findings: result.findings }, null, 2) + "\n");
  } else {
    report(result.org, result.findings, result.online, opts.offline === true);
  }
  return result.findings.some((f) => f.level === "fail") ? 1 : 0;
}

async function gate(found: Finding[]): Promise<boolean> {
  const who = await ghReady();
  if (!who.ok) {
    found.push({
      scope: "workspace", level: "warn", id: "gh",
      title: who.error ?? "gh is unavailable",
      fix: "Everything needing the network was skipped. Re-run with --offline to hide this.",
    });
    return false;
  }
  found.push({ scope: "workspace", level: "ok", id: "gh", title: `gh authenticated as ${who.data!.login}` });
  return true;
}

/* ------------------------------- offline ------------------------------ */

interface OrgFile {
  org: string;
  name: string;
  staff?: Array<{ handle: string; dir?: string; name?: string; schedule?: string }>;
  repos?: Array<{ name: string; role?: string; visibility?: string }>;
  human?: { github?: string };
}

function checkWorkspace(ws: Workspace, org: OrgFile): Finding[] {
  const out: Finding[] = [];
  const scope = "workspace";

  out.push({
    scope, level: "ok", id: "org.yaml",
    title: `org.yaml names ${org.repos?.length ?? 0} repos and ${org.staff?.length ?? 0} staff`,
  });

  if (!org.human?.github) {
    out.push({
      scope, level: "fail", id: "human",
      title: "org.yaml has no human.github",
      fix: "The mention callers gate on this login. Without it nothing can wake an agent.",
    });
  }

  // The tenant drifting from the framework is the failure that cost a lost fix, so it is a
  // first-class check rather than something you have to remember to run separately.
  try {
    const plans = planAll(opsTemplateDir(), join(ws.opsDir, ".roster", "seed"), ws.opsDir);
    const edited = plans.filter((p) => p.verdict === "edited-managed");
    const stale = plans.filter((p) => p.next !== undefined);
    const unmergeable = plans.filter((p) => p.verdict === "conflict" || p.verdict === "no-base");

    for (const p of edited) {
      out.push({
        scope, level: "fail", id: "upgrade.owned",
        title: `${p.rel} is the framework's file but was edited here`,
        fix: "Move the change into roster's templates/ops, or the next upgrade reverts it.",
      });
    }
    if (stale.length) {
      out.push({
        scope, level: "warn", id: "upgrade.stale",
        title: `${stale.length} generated file${stale.length === 1 ? " is" : "s are"} behind the framework`,
        fix: "roster upgrade --apply",
      });
    }
    for (const p of unmergeable) {
      out.push({
        scope, level: "warn", id: "upgrade.blocked",
        title: `${p.rel} cannot be merged: ${p.note}`,
        fix: p.verdict === "no-base" ? "roster upgrade --baseline <git-ref>" : "Resolve the .roster-merge beside it.",
      });
    }
    if (!edited.length && !stale.length && !unmergeable.length) {
      out.push({ scope, level: "ok", id: "upgrade", title: "in sync with the framework" });
    }
  } catch (err) {
    out.push({
      scope, level: "warn", id: "upgrade",
      title: `could not compare against the framework: ${firstLine(err)}`,
      fix: "roster upgrade",
    });
  }

  return out;
}

interface Manifest {
  handle?: string;
  name?: string;
  brain?: string;
  mention?: string;
  status_issue?: number;
  identities?: Array<{ secret_prefix?: string }>;
  peers?: Array<{ handle: string; brain?: string; label?: string }>;
  surfaces?: Array<{ path: string }>;
  labels?: Record<string, string[]>;
}

async function checkStaff(
  ws: Workspace,
  org: OrgFile,
  entry: { handle: string; dir?: string; name?: string },
  composer: Awaited<ReturnType<typeof loadComposer>>,
  online: boolean,
): Promise<Finding[]> {
  const scope = entry.handle;
  const out: Finding[] = [];
  const dir = entry.dir ?? entry.handle;
  const root = join(ws.root, dir);

  if (!existsSync(root)) {
    return [{
      scope, level: "fail", id: "checkout",
      title: `${dir}/ is not checked out beside the ops repo`,
      fix: `git clone the brain repo into ${ws.root}`,
    }];
  }

  const manifestPath = join(root, "staff.yaml");
  let manifest: Manifest = {};
  if (!existsSync(manifestPath)) {
    out.push({ scope, level: "fail", id: "manifest", title: "no staff.yaml", fix: "The manifest is the machine-readable half of the charter." });
  } else {
    try {
      manifest = composer.parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as Manifest;
      if (manifest.handle !== entry.handle) {
        out.push({
          scope, level: "fail", id: "manifest.handle",
          title: `staff.yaml says handle "${manifest.handle}", org.yaml says "${entry.handle}"`,
          fix: "The composer looks the staff member up by the org.yaml handle; a mismatch composes the wrong brain.",
        });
      }
      if (!manifest.brain) {
        out.push({
          scope, level: "fail", id: "manifest.brain", title: "staff.yaml has no brain repo",
          fix: "Nothing can find their tracker without it: no secrets check, no labels, no runs.",
        });
      }
    } catch (err) {
      out.push({
        scope, level: "fail", id: "manifest", title: `staff.yaml does not parse: ${firstLine(err)}`,
        fix: "compose.mjs parses a small strict YAML subset; a manifest needing more has outgrown being one.",
      });
    }
  }

  out.push(existsSync(join(root, "CHARTER.md"))
    ? { scope, level: "ok", id: "charter", title: "CHARTER.md present" }
    : { scope, level: "fail", id: "charter", title: "no CHARTER.md", fix: "The charter is the personality; nothing else supplies it." });

  // Memory
  const memDir = join(root, "memory");
  if (!existsSync(join(memDir, "INDEX.md"))) {
    out.push({
      scope, level: "fail", id: "memory", title: "no memory/INDEX.md",
      fix: "This is the file read at every boot. Without it the agent starts each day blank.",
    });
  } else {
    try {
      const doc = parseMemory(memDir);
      out.push({ scope, level: "ok", id: "memory", title: `memory reads: ${doc.facts.length} facts, ${doc.notes.length} notes` });
    } catch (err) {
      out.push({
        scope, level: "fail", id: "memory", title: `memory/INDEX.md does not parse: ${firstLine(err)}`,
        fix: "roster lint",
      });
    }
  }

  /* The prompt is what actually runs, so a template that throws is a run that dies at 07:00.
     `mention` and `pr-mention` are written for the comment that woke them and refuse to
     compose without one, which is correct — so they are given a stand-in, exactly as the
     workflow supplies the real thing. Composing them with no context proves nothing except
     that they are strict. */
  const CONTEXT = JSON.stringify({ issue_number: "1", comment_id: "1", pr_number: "1", repo: `${org.org}/example` });
  const before = process.env.ROSTER_CONTEXT;
  for (const kind of ["daily", "mention", "pr-mention"]) {
    try {
      if (kind === "daily") delete process.env.ROSTER_CONTEXT;
      else process.env.ROSTER_CONTEXT = CONTEXT;
      const text = composer.compose({ opsDir: ws.opsDir, brainsDir: ws.root, staff: entry.handle, kind });
      if (!text.trim()) throw new Error("composed to nothing");
    } catch (err) {
      out.push({
        scope, level: "fail", id: `compose.${kind}`,
        title: `the ${kind} prompt does not compose: ${firstLine(err)}`,
        fix: `roster prompt ${entry.handle} --kind ${kind}`,
      });
    }
  }
  if (before === undefined) delete process.env.ROSTER_CONTEXT;
  else process.env.ROSTER_CONTEXT = before;
  if (!out.some((f) => f.id.startsWith("compose."))) {
    out.push({ scope, level: "ok", id: "compose", title: "prompts compose for daily, mention and pr-mention" });
  }

  // Callers, and whether they point at a reusable workflow that exists.
  const callers = readCallers(root);
  if (callers.length !== 3) {
    out.push({
      scope, level: callers.length ? "warn" : "fail", id: "callers",
      title: `${callers.length} caller workflow${callers.length === 1 ? "" : "s"}, expected 3 (daily, mention, pr-mention)`,
      fix: "A missing caller is a route that silently never fires. Compare against roster's templates/brain.",
    });
  }
  const opsRepo = `${org.org}/${ws.opsName}`;
  for (const c of callers) {
    const used = /uses:\s*([^\s@]+)@(\S+)/.exec(c.text);
    if (!used) {
      out.push({
        scope, level: "fail", id: "callers.uses", title: `${c.name} calls no reusable workflow`,
        fix: "A caller with no `uses:` does nothing at all.",
      });
      continue;
    }
    const [, ref, at] = used;
    if (!ref!.startsWith(opsRepo + "/")) {
      out.push({
        scope, level: "fail", id: "callers.uses",
        title: `${c.name} calls ${ref}, but this org's ops repo is ${opsRepo}`,
        fix: "A private reusable workflow is only callable inside its own org, so this can never resolve.",
      });
    }
    const local = join(ws.opsDir, ref!.slice(opsRepo.length + 1));
    if (!existsSync(local)) {
      out.push({
        scope, level: "fail", id: "callers.target",
        title: `${c.name} calls ${ref}@${at}, which does not exist in the ops repo`,
        fix: "This fails at run time as a confusing \"workflow not found\".",
      });
    }
  }
  if (callers.length === 3 && !out.some((f) => f.id.startsWith("callers"))) {
    out.push({ scope, level: "ok", id: "callers", title: `3 callers, all pointing at ${opsRepo}` });
  }

  // Surfaces the portal and the agent both expect to be able to open.
  const missing = (manifest.surfaces ?? []).map((s) => s.path).filter((p) => p && !existsSync(join(root, p)));
  if (missing.length) {
    out.push({
      scope, level: "warn", id: "surfaces",
      title: `declared but not on disk: ${missing.join(", ")}`,
      fix: "Create them or drop them from staff.yaml; the portal renders nothing for a missing surface.",
    });
  }

  if (online && manifest.brain) {
    out.push(...(await checkStaffOnline(scope, manifest, callers, org)));
  }

  return out;
}

interface Caller { name: string; text: string }

export interface Run {
  conclusion: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** The ceiling the caller hands to the reusable workflow; session.yaml defaults to 60. */
export function timeoutOf(callerText: string): number {
  const m = /timeout_minutes:\s*(\d+)/.exec(callerText);
  return m ? Number(m[1]) : 60;
}

/** GitHub reports a job killed by `timeout-minutes` as "cancelled", so it is recognised by
 *  running for as long as it was allowed to. One minute of slack for scheduling overhead. */
export function isTimeout(run: Run, timeout: number): boolean {
  if (run.conclusion !== "cancelled") return false;
  const mins = (new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime()) / 60000;
  return mins >= timeout - 1;
}

function readCallers(root: string): Caller[] {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

/* ------------------------------- online ------------------------------- */

async function checkOrgOnline(ws: Workspace, org: OrgFile): Promise<Finding[]> {
  const out: Finding[] = [];
  const scope = "workspace";

  const repos = org.repos ?? [];
  const seen = await Promise.all(
    repos.map((r) => api<{ full_name: string; visibility: string }>(`repos/${org.org}/${r.name}`)),
  );
  seen.forEach((res, i) => {
    const r = repos[i]!;
    if (!res.ok) {
      out.push({ scope, level: "fail", id: "repo", title: `${org.org}/${r.name} is unreachable: ${res.error}`, fix: "Either it does not exist, or your gh cannot see it." });
      return;
    }
    if (r.visibility && res.data!.visibility !== r.visibility) {
      out.push({
        scope, level: "warn", id: "repo.visibility",
        title: `${r.name} is ${res.data!.visibility}, org.yaml says ${r.visibility}`,
        fix: "Correct org.yaml, or the visibility posture it records is fiction.",
      });
    }
  });
  if (!out.some((f) => f.id.startsWith("repo"))) {
    out.push({ scope, level: "ok", id: "repo", title: `all ${repos.length} repos reachable` });
  }

  /* The failure mode this prevents is a caller reporting "workflow not found", which reads
     like a typo and is actually a permission. Worth an explicit check for that reason alone. */
  const access = await api<{ access_level: string }>(
    `repos/${org.org}/${ws.opsName}/actions/permissions/access`,
  );
  if (!access.ok) {
    out.push({
      scope, level: "warn", id: "actions-access",
      title: `could not read Actions access on ${ws.opsName}: ${access.error}`,
      fix: "This needs admin on the ops repo. Until it is read, \"workflow not found\" stays unexplained.",
    });
  } else if (access.data!.access_level !== "organization") {
    out.push({
      scope, level: "fail", id: "actions-access",
      title: `${ws.opsName} Actions access is "${access.data!.access_level}", not "organization"`,
      fix: `Settings → Actions → General → allow access from repositories in this organisation. ` +
           `Until then every caller fails with "workflow not found".`,
    });
  } else {
    out.push({ scope, level: "ok", id: "actions-access", title: `${ws.opsName} is callable from the whole org` });
  }

  return out;
}

async function checkStaffOnline(
  scope: string,
  manifest: Manifest,
  callers: Caller[],
  org: OrgFile,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const repo = manifest.brain!;

  // What the callers actually reference, rather than a list someone has to keep updated.
  const needed = new Set<string>();
  for (const c of callers) {
    for (const m of c.text.matchAll(/secrets\.([A-Z0-9_]+)/g)) needed.add(m[1]!);
  }

  const [secrets, labels, runs, pinned] = await Promise.all([
    api<{ secrets: Array<{ name: string }> }>(`repos/${repo}/actions/secrets`),
    api<Array<{ name: string }>>(`repos/${repo}/labels?per_page=100`),
    Promise.all(callers.map((c) =>
      ghJson<Run[]>([
        "run", "list", "--repo", repo, "--workflow", c.name, "--limit", "10",
        "--json", "conclusion,status,createdAt,updatedAt",
      ]).then((r) => ({ name: c.name, res: r })))),
    manifest.status_issue
      ? graphql<{ data: { repository: { pinnedIssues: { nodes: Array<{ issue: { number: number } }> } } } }>(
          "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
          "pinnedIssues(first:3){nodes{issue{number state}}}}}",
          { owner: repo.split("/")[0]!, name: repo.split("/")[1]! },
        )
      : Promise.resolve(null),
  ]);

  if (!secrets.ok) {
    out.push({ scope, level: "warn", id: "secrets", title: `cannot read secrets on ${repo}: ${secrets.error}`,
      fix: "Secrets need admin on the repo; without it this check cannot run." });
  } else {
    const have = new Set(secrets.data!.secrets.map((s) => s.name));
    const gone = [...needed].filter((n) => !have.has(n));
    out.push(gone.length
      ? {
          scope, level: "fail", id: "secrets",
          title: `missing on ${repo}: ${gone.join(", ")}`,
          fix: "The callers reference these by name; a run dies at the token step without them.",
        }
      : { scope, level: "ok", id: "secrets", title: `all ${needed.size} referenced secrets present` });
  }

  if (!labels.ok) {
    out.push({ scope, level: "warn", id: "labels", title: `cannot read labels on ${repo}: ${labels.error}`, fix: "Check your access to the repo." });
  } else {
    const have = new Set(labels.data!.map((l) => l.name));
    const declared = Object.values(manifest.labels ?? {}).flat();
    const gone = [...new Set(declared)].filter((l) => !have.has(l));
    out.push(gone.length
      ? {
          scope, level: "warn", id: "labels",
          title: `declared in staff.yaml but not on ${repo}: ${gone.join(", ")}`,
          fix: "An agent applying a label that does not exist gets an API error mid-run.",
        }
      : { scope, level: "ok", id: "labels", title: "every declared label exists" });
  }

  /* A peer label lives on the *peer's* tracker, not here: `from-cto` is how the CTO marks an
     ask it files on the CMO's board. Checking it against the wrong repo reports both of a
     correctly wired pair as missing, which is worse than not checking at all. */
  const peers = (manifest.peers ?? []).filter((p) => p.label && p.brain);
  const peerLabels = await Promise.all(
    peers.map((p) => api<Array<{ name: string }>>(`repos/${p.brain}/labels?per_page=100`)
      .then((res) => ({ peer: p, res }))),
  );
  for (const { peer, res } of peerLabels) {
    if (!res.ok) {
      out.push({ scope, level: "warn", id: "peer-labels", title: `cannot read labels on ${peer.brain}: ${res.error}`, fix: "Check your access to the peer repo." });
      continue;
    }
    const has = res.data!.some((l) => l.name === peer.label);
    out.push(has
      ? { scope, level: "ok", id: "peer-labels", title: `"${peer.label}" exists on ${peer.brain}` }
      : {
          scope, level: "warn", id: "peer-labels",
          title: `"${peer.label}" is missing from ${peer.brain}`,
          fix: `${scope} labels its asks to ${peer.handle} with this; without it the write fails mid-run.`,
        });
  }

  if (manifest.status_issue) {
    const nodes = (pinned as { ok: boolean; data?: any } | null)?.data?.data?.repository?.pinnedIssues?.nodes ?? [];
    const isPinned = nodes.some((n: any) => n?.issue?.number === manifest.status_issue);
    out.push(isPinned
      ? { scope, level: "ok", id: "status-issue", title: `#${manifest.status_issue} is pinned` }
      : {
          scope, level: "warn", id: "status-issue",
          title: `#${manifest.status_issue} is declared as the status issue but is not pinned on ${repo}`,
          fix: "Pin it, or the one place the human looks is not the one the agent maintains.",
        });
  }

  /* The headline. Nothing else here proves the app is installed *and* granted — that pair is
     only observable from a run that finished, so a window of recent runs is read rather than
     just the last one. One bad run is noise; four in ten is the thing you wanted to know. */
  for (const { name, res } of runs) {
    if (!res.ok) {
      out.push({ scope, level: "warn", id: "runs", title: `cannot read runs for ${name}: ${res.error}`, fix: "Without run history nothing here proves the app grant." });
      continue;
    }
    const all = res.data ?? [];
    // A skipped run is the job-level `if` doing its job: every comment that is not a mention
    // produces one. Counting those as failures would bury the real ones.
    const real = all.filter((r) => r.status === "completed" && r.conclusion !== "skipped");

    if (!all.length) {
      out.push({
        scope, level: "warn", id: "runs",
        title: `${name} has never run, so nothing has proved its app grant or secrets`,
        fix: "Trigger it once by hand before trusting it.",
      });
      continue;
    }
    if (!real.length) {
      out.push({
        scope, level: "warn", id: "runs",
        title: `${name}: ${all.length} recent triggers, all gated out before doing anything`,
        fix: "Nothing here has exercised the app grant. A skipped run proves only the trigger.",
      });
      continue;
    }

    const timeout = timeoutOf(callers.find((c) => c.name === name)?.text ?? "");
    const timedOut = real.filter((r) => isTimeout(r, timeout));
    const failed = real.filter((r) => !isTimeout(r, timeout) &&
      r.conclusion !== "success" && r.conclusion !== "cancelled");
    const cancelled = real.filter((r) => !isTimeout(r, timeout) && r.conclusion === "cancelled");
    const ok = real.filter((r) => r.conclusion === "success");

    /* A job killed by `timeout-minutes` is reported by GitHub as "cancelled", which reads like
       somebody pressed a button. Recognising it by its duration is the difference between
       "cancelled, no idea why" and "the session no longer fits in its hour". */
    if (timedOut.length) {
      out.push({
        scope, level: "fail", id: "runs.timeout",
        title: `${name}: ${timedOut.length} of the last ${real.length} hit the ${timeout}m timeout ` +
               `(most recent ${ago(timedOut[0]!.createdAt)})`,
        fix: `Those runs produced nothing. Raise timeout_minutes in the caller, or shorten the work.`,
      });
    }
    if (failed.length) {
      out.push({
        scope, level: "fail", id: "runs",
        title: `${name}: ${failed.length} of the last ${real.length} ${failed.length === 1 ? "run" : "runs"} failed ` +
               `(most recent ${ago(failed[0]!.createdAt)})`,
        fix: `gh run list --repo ${repo} --workflow ${name}`,
      });
    }
    if (cancelled.length) {
      out.push({
        scope, level: "warn", id: "runs.cancelled",
        title: `${name}: ${cancelled.length} of the last ${real.length} were cancelled short of the timeout`,
        fix: `gh run list --repo ${repo} --workflow ${name}`,
      });
    }
    if (!timedOut.length && !failed.length && !cancelled.length) {
      out.push({
        scope, level: "ok", id: "runs",
        title: `${name}: ${ok.length}/${real.length} recent runs succeeded, last ${ago(real[0]!.createdAt)}`,
      });
    }
  }

  return out;
}

/* ------------------------------- output ------------------------------- */

const GLYPH: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

function report(org: OrgFile, found: Finding[], online: boolean, asked: boolean) {
  process.stdout.write(`\n  roster doctor — ${org.name} (${org.org})\n`);
  if (!online) {
    process.stdout.write(asked ? "  offline: local checks only\n" : "  network checks skipped\n");
  }

  const scopes = [...new Set(found.map((f) => f.scope))];
  for (const scope of scopes) {
    const mine = found.filter((f) => f.scope === scope);
    const who = org.staff?.find((s) => s.handle === scope);
    process.stdout.write(`\n  ${who ? `${scope} — ${who.name ?? scope}` : scope}\n`);
    for (const f of mine) {
      process.stdout.write(`    ${GLYPH[f.level]} ${f.title}\n`);
      if (f.fix && f.level !== "ok") process.stdout.write(`        ${f.fix}\n`);
    }
  }

  const fails = found.filter((f) => f.level === "fail").length;
  const warns = found.filter((f) => f.level === "warn").length;
  process.stdout.write(`\n  ${fails} failing, ${warns} to look at\n\n`);
}

/** Multi-line errors wreck a one-line-per-finding report; the first line is the finding. */
function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0]!.trim();
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export interface Flags { ops?: string; offline?: boolean; json?: boolean }

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offline") out.offline = true;
    else if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--ops") out.ops = argv[++i];
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}
