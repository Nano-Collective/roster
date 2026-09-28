import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withExample } from "../src/commands/brief.js";
import { buildPlan, type OrgYaml } from "../src/commands/hire.js";
import { setOrgSecret, setSecret } from "../src/lib/appmanifest.js";
import { allowOrgCallers } from "../src/lib/callable.js";
import { commitAndPush } from "../src/lib/commit.js";
import { planCredential, shareOrgSecret, writeCredential } from "../src/lib/credential.js";
import { matchExample } from "../src/lib/examples.js";
import type { GhResult } from "../src/lib/gh.js";
import { installUrl, preselectedInstall } from "../src/lib/install.js";
import { brainTemplateDir } from "../src/lib/render.js";
import {
  dailyWorkflow,
  failedSteps,
  findDispatched,
  follow,
  pickRun,
  type RunInfo,
} from "../src/lib/runonce.js";
import { AGENTS } from "../src/lib/setup.js";
import { loadComposer, readOrg } from "../src/lib/workspace.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * The shorter road to a first run: the credential once, the Actions setting by API, an install
 * page with the repos already ticked, peer wiring committed, one run followed, and a charter
 * brief with an example to model. Everything that talks to GitHub takes its `gh` as a
 * parameter, so these drive the decisions with a fake one and never reach the network.
 */

/** A fake `gh api`: canned answers by path, and a record of every call made. */
function fakeApi(answers: Record<string, GhResult<any>>) {
  const calls: Array<{ path: string; extra: string[] }> = [];
  const gh = async (path: string, extra: string[] = []) => {
    calls.push({ path, extra });
    const key = extra.includes("PUT") ? `PUT ${path}` : path;
    return answers[key] ?? { ok: false, error: "Not Found", status: 404 };
  };
  return { gh, calls };
}

const ok = (data: unknown): GhResult<any> => ({ ok: true, data });

/* ------------------------------ the install page ------------------------------ */

test("the install page pre-selects the org and the repos when their ids are known", () => {
  assert.equal(installUrl("acme-cfo"), "https://github.com/apps/acme-cfo/installations/new");
  assert.equal(
    installUrl("acme-cfo", 7, [11, 12]),
    "https://github.com/apps/acme-cfo/installations/new/permissions" +
      "?suggested_target_id=7&repository_ids[]=11&repository_ids[]=12",
  );
});

test("a repo whose id cannot be read is named, and the rest are still pre-selected", async () => {
  const { gh } = fakeApi({
    "orgs/acme": ok({ id: 7 }),
    "repos/acme/finance": ok({ id: 11 }),
    "repos/acme/technology": ok({ id: 12 }),
  });
  const r = await preselectedInstall(
    "acme-cfo",
    "acme",
    ["acme/finance", "acme/technology", "acme/gone"],
    gh,
  );
  assert.match(r.url, /suggested_target_id=7&repository_ids\[\]=11&repository_ids\[\]=12$/);
  assert.deepEqual(r.preselected, ["acme/finance", "acme/technology"]);
  assert.deepEqual(r.missing, ["acme/gone"]);
});

test("without the org's id it degrades to the plain install page, which still works", async () => {
  const { gh } = fakeApi({});
  const r = await preselectedInstall("acme-cfo", "acme", ["acme/finance"], gh);
  assert.equal(r.url, "https://github.com/apps/acme-cfo/installations/new");
  assert.deepEqual(r.missing, ["acme/finance"]);
});

/* ------------------------------ the Actions setting ------------------------------ */

test("the Actions access is read first, so setting it twice writes nothing", async () => {
  const { gh, calls } = fakeApi({
    "repos/acme/roster-ops/actions/permissions/access": ok({ access_level: "organization" }),
  });
  const r = await allowOrgCallers("acme", "roster-ops", gh);
  assert.equal(r.ok, true);
  assert.equal(r.already, true);
  assert.equal(calls.filter((c) => c.extra.includes("PUT")).length, 0);
});

test("the Actions access is set to organization when it is not", async () => {
  const { gh, calls } = fakeApi({
    "repos/acme/roster-ops/actions/permissions/access": ok({ access_level: "none" }),
    "PUT repos/acme/roster-ops/actions/permissions/access": ok(undefined),
  });
  const r = await allowOrgCallers("acme", "roster-ops", gh);
  assert.equal(r.ok, true);
  const put = calls.find((c) => c.extra.includes("PUT"))!;
  assert.ok(put.extra.includes("access_level=organization"));
});

test("a refusal says why and hands back the page to click", async () => {
  const { gh } = fakeApi({
    "repos/acme/roster-ops/actions/permissions/access": ok({ access_level: "none" }),
    "PUT repos/acme/roster-ops/actions/permissions/access": {
      ok: false,
      error: "Must have admin rights to Repository.",
      status: 403,
    },
  });
  const r = await allowOrgCallers("acme", "roster-ops", gh);
  assert.equal(r.ok, false);
  assert.match(r.error!, /admin rights.*needs admin/);
  assert.equal(r.link, "https://github.com/acme/roster-ops/settings/actions");
});

/* ------------------------------ the agent credential ------------------------------ */

const BRAINS = ["acme/technology", "acme/marketing"];

test("the credential is one org secret on a paid plan", async () => {
  const { gh } = fakeApi({ "orgs/acme": ok({ plan: { name: "team" } }) });
  const plan = await planCredential("acme", "CLAUDE_CODE_OAUTH_TOKEN", BRAINS, {}, gh);
  assert.equal(plan.mode, "org");
});

test("on GitHub Free it goes on each repo, because an org secret would never arrive", async () => {
  const { gh } = fakeApi({ "orgs/acme": ok({ plan: { name: "free" } }) });
  const plan = await planCredential("acme", "X", BRAINS, {}, gh);
  assert.equal(plan.mode, "repo");
  assert.match(plan.reason, /Free/);
});

test("a gh that cannot read the plan is not an owner, so it gets repo secrets and a reason", async () => {
  const { gh } = fakeApi({ "orgs/acme": ok({ login: "acme" }) });
  const plan = await planCredential("acme", "X", BRAINS, {}, gh);
  assert.equal(plan.mode, "repo");
  assert.match(plan.reason, /owner/);
});

test("--repo-secrets is honoured without asking GitHub anything", async () => {
  const { gh, calls } = fakeApi({});
  const plan = await planCredential("acme", "X", BRAINS, { repoSecrets: true }, gh);
  assert.equal(plan.mode, "repo");
  assert.equal(calls.length, 0);
});

test("an org secret is set with repo names, and a refusal falls back to each repo, saying why", async () => {
  const plan = { name: "X", org: "acme", brains: BRAINS, mode: "org" as const, reason: "" };
  const orgCalls: unknown[][] = [];
  const repoCalls: unknown[][] = [];
  const good = await writeCredential(plan, " tok \n", {
    org: async (...a: unknown[]) => void orgCalls.push(a),
    repo: async (...a: unknown[]) => void repoCalls.push(a),
  });
  assert.equal(good.mode, "org");
  assert.deepEqual(orgCalls[0], ["acme", "X", ["technology", "marketing"], "tok"]);
  assert.equal(repoCalls.length, 0);

  const refused = await writeCredential(plan, "tok", {
    org: async () => {
      throw new Error("HTTP 403");
    },
    repo: async (...a: unknown[]) => void repoCalls.push(a),
  });
  assert.equal(refused.mode, "repo");
  assert.match(refused.fellBack!, /admin:org/);
  assert.deepEqual(
    repoCalls.map((c) => c[0]),
    BRAINS,
  );
});

test("an empty credential, or nobody to give it to, is refused before anything is written", async () => {
  const plan = { name: "X", org: "acme", brains: BRAINS, mode: "repo" as const, reason: "" };
  const never = { org: async () => assert.fail(), repo: async () => assert.fail() };
  await assert.rejects(writeCredential(plan, "   ", never), /empty/);
  await assert.rejects(writeCredential({ ...plan, brains: [] }, "tok", never), /Hire someone/);
});

/**
 * The invariant this whole area rests on: the value reaches gh on stdin and never on argv.
 * A `gh` on PATH that writes down what it was given is the only way to see what gh saw.
 */
test("a secret's value goes to gh on stdin, never on its command line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-fakegh-"));
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${dir}/argv"\ncat >> "${dir}/stdin"\n`);
  chmodSync(gh, 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  try {
    await setOrgSecret("acme", "TOKEN", ["technology", "marketing"], "s3cret-value");
    await setSecret("acme/technology", "TOKEN", "s3cret-value");
  } finally {
    process.env.PATH = before;
  }
  const argv = readFileSync(join(dir, "argv"), "utf8");
  assert.doesNotMatch(argv, /s3cret-value/);
  assert.match(argv, /--org\nacme\n--visibility\nselected\n--repos\ntechnology,marketing/);
  assert.equal(readFileSync(join(dir, "stdin"), "utf8"), "s3cret-values3cret-value");
});

test("a hire adds its brain to a selected org secret, and leaves a wider one alone", async () => {
  const selected = fakeApi({
    "orgs/acme/actions/secrets/X": ok({ visibility: "selected" }),
    "repos/acme/finance": ok({ id: 42 }),
    "PUT orgs/acme/actions/secrets/X/repositories/42": ok(undefined),
  });
  const r = await shareOrgSecret("acme", "X", "acme/finance", selected.gh);
  assert.equal(r.ok, true);
  assert.ok(selected.calls.some((c) => c.path === "orgs/acme/actions/secrets/X/repositories/42"));

  const all = fakeApi({ "orgs/acme/actions/secrets/X": ok({ visibility: "all" }) });
  assert.equal((await shareOrgSecret("acme", "X", "acme/finance", all.gh)).ok, true);
  assert.equal(all.calls.filter((c) => c.extra.includes("PUT")).length, 0);

  const none = fakeApi({});
  assert.equal((await shareOrgSecret("acme", "X", "acme/finance", none.gh)).ok, false);
});

test("every agent in setup says where its credential comes from", () => {
  for (const a of AGENTS) assert.ok(a.howTo.length > 20, `${a.id} has no howTo`);
  assert.match(AGENTS.find((a) => a.id === "claude-code-action")!.howTo, /claude setup-token/);
});

/* ------------------------------ peer wiring, committed ------------------------------ */

test("a hire plan lists every commit it will make into repos that already exist", async () => {
  const ws = await makeTenant(mkdtempSync(join(tmpdir(), "roster-onboard-")), {
    staff: [
      { handle: "cto", name: "CTO", dir: "technology" },
      { handle: "cmo", name: "CMO", dir: "marketing" },
    ],
  });
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as OrgYaml;
  const plan = buildPlan(ws, org, "cfo", { name: "CFO", dir: "finance" } as never, parseYaml);
  const where = plan.commits.map((c) => `${c.dir}/${c.file}`).sort();
  assert.deepEqual(where, [
    "finance/staff.yaml",
    "marketing/staff.yaml",
    "roster-ops/org.yaml",
    "technology/staff.yaml",
  ]);
  for (const c of plan.commits) assert.match(c.message, /^roster: /);
});

test("committing peer wiring takes only the named file, and pushes it", () => {
  const root = mkdtempSync(join(tmpdir(), "roster-commit-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "technology");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "staff.yaml"), "peers: []\n");
  writeFileSync(join(repo, "notes.md"), "mine\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "start");
  git(repo, "push", "-q", "-u", "origin", "main");

  writeFileSync(join(repo, "staff.yaml"), "peers:\n  - { handle: cfo }\n");
  writeFileSync(join(repo, "notes.md"), "somebody's half-finished edit\n");
  const done = commitAndPush(repo, ["staff.yaml"], "roster: cfo joins as a peer");

  assert.equal(done.committed, true);
  assert.equal(done.pushed, true);
  assert.equal(git(repo, "status", "--porcelain").trim(), "M notes.md");
  assert.match(git(remote, "log", "-1", "--format=%s", "main"), /cfo joins as a peer/);
  assert.equal(commitAndPush(repo, ["staff.yaml"], "again").note, "nothing to commit");
});

/* ------------------------------ one run, followed ------------------------------ */

test("the daily workflow's name is the one the brain template writes", () => {
  const rendered = dailyWorkflow("%%STAFF%%");
  assert.ok(existsSync(join(brainTemplateDir(), ".github", "workflows", rendered)));
});

const run = (over: Partial<RunInfo>): RunInfo => ({
  databaseId: 1,
  status: "queued",
  conclusion: "",
  url: "https://github.com/acme/technology/actions/runs/1",
  createdAt: "2026-09-28T10:00:00Z",
  event: "workflow_dispatch",
  ...over,
});

test("the dispatched run is the newest manual one since it was asked for", () => {
  const since = Date.parse("2026-09-28T10:00:00Z");
  const runs = [
    run({ databaseId: 1, createdAt: "2026-09-28T09:00:00Z" }),
    run({ databaseId: 2, createdAt: "2026-09-28T10:00:03Z", event: "schedule" }),
    run({ databaseId: 3, createdAt: "2026-09-28T10:00:02Z" }),
  ];
  assert.equal(pickRun(runs, since)?.databaseId, 3);
  assert.equal(pickRun(runs.slice(0, 2), since), undefined);
});

test("finding the run waits for it to be listed, and following it stops when it completes", async () => {
  const since = Date.parse("2026-09-28T10:00:00Z");
  let listed = 0;
  const found = await findDispatched("acme/technology", "cto-daily.yaml", since, {
    sleep: async () => {},
    json: async <T>() => {
      listed++;
      return { ok: true, data: (listed < 3 ? [] : [run({ databaseId: 9 })]) as T };
    },
  });
  assert.equal(found?.databaseId, 9);
  assert.equal(listed, 3);

  const states = ["queued", "in_progress", "in_progress", "completed"];
  const seen: string[] = [];
  const outcome = await follow("acme/technology", 9, {
    timeoutMs: 60_000,
    sleep: async () => {},
    onChange: (s) => seen.push(s),
    json: async <T>() => {
      const status = states.shift()!;
      return {
        ok: true,
        data: run({
          status,
          conclusion: status === "completed" ? "failure" : "",
          jobs: [
            {
              name: "session",
              conclusion: status === "completed" ? "failure" : "",
              steps: [{ name: "Mint the token", conclusion: "failure" }],
            },
          ],
        } as never) as T,
      };
    },
  });
  assert.deepEqual(seen, ["queued", "in_progress", "completed"]);
  assert.equal(outcome?.conclusion, "failure");
  assert.deepEqual(outcome?.failedAt, ["session › Mint the token"]);
});

test("a failed job with no failed step is still named", () => {
  assert.deepEqual(failedSteps([{ name: "session", conclusion: "failure", steps: [] }]), [
    "session",
  ]);
  assert.deepEqual(failedSteps([{ name: "session", conclusion: "success" }]), []);
});

/* ------------------------------ a charter, from an example ------------------------------ */

test("a role is matched to the worked example it most resembles, and only when it does", () => {
  assert.equal(matchExample("cto"), "cto");
  assert.equal(matchExample("eng", "Head of Engineering"), "cto");
  assert.equal(matchExample("growth", "Growth Lead"), "cmo");
  assert.equal(matchExample("help", "Customer Success"), "support");
  assert.equal(matchExample("cfo", "Chief Financial Officer"), undefined);
});

test("the charter brief carries the example as a model, and stays a brief", () => {
  const brief = "Write or revise `CHARTER.md` for CTO.\n\n## Then interview\n";
  const out = withExample(brief, "cto", "CTO");
  assert.ok(out.startsWith(brief.trimEnd()), "the brief itself is unchanged");
  assert.match(out, /## A worked example, to adapt/);
  assert.match(out, /Do not copy its content/);
  assert.match(out, /The interview still comes first/);
  assert.match(out, /Charter — Acme's CTO/);

  assert.equal(withExample(brief, "cto", "CTO", "none"), brief);
  assert.match(withExample(brief, "cfo", "CFO"), /No worked example obviously matches "cfo"/);
  assert.match(withExample(brief, "cfo", "CFO", "support"), /Head of Support/);
  assert.throws(() => withExample(brief, "cfo", "CFO", "cfo"), /no example charter "cfo"/);
});
