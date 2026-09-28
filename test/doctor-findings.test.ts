import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { collect, doctorCommand, type Report } from "../src/commands/doctor.js";
import { opsTemplateDir } from "../src/lib/templates.js";
import { fakeGh, quietly, type Route } from "./helpers/fakegh.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * Which findings fire, and at what level.
 *
 * doctor.test.ts covers its judgement about runs in isolation and a workspace that is broken
 * everywhere at once. This file breaks a healthy generated tenant one thing at a time, so
 * each finding is shown to fire for its own cause and not merely alongside others, and it
 * drives the online half through a `gh` that answers from a table.
 */

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function tenant() {
  const root = mkdtempSync(join(tmpdir(), "roster-findings-"));
  roots.push(root);
  const ws = await makeTenant(root, {
    org: "acme",
    staff: [
      { handle: "cto", name: "Chief Technology Officer", dir: "technology" },
      { handle: "cmo", name: "Chief Marketing Officer", dir: "marketing" },
    ],
  });
  const at = (...p: string[]) => join(root, ...p);
  return {
    ws,
    at,
    ops: (...p: string[]) => at("roster-ops", ...p),
    edit: (path: string, fn: (s: string) => string) =>
      writeFileSync(path, fn(readFileSync(path, "utf8"))),
    /** What `roster init --apply` records, and what upgrade merges against. */
    seed() {
      cpSync(opsTemplateDir(), at("roster-ops", ".roster", "seed"), { recursive: true });
    },
  };
}

const findings = (r: Report | null, id: string, scope?: string) =>
  r!.findings.filter((f) => f.id === id && (!scope || f.scope === scope));
const fails = (r: Report | null) => r!.findings.filter((f) => f.level === "fail");

/* ------------------------------- offline ------------------------------- */

test("a freshly generated tenant fails nothing, and says which stubs are still stubs", async () => {
  const t = await tenant();
  t.seed();
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.deepEqual(fails(r), []);
  assert.equal(findings(r, "upgrade")[0]?.level, "ok", "a tenant straight from init is in sync");
  assert.equal(findings(r, "business.stub").length, 1, "business.md is still questions");
  assert.equal(findings(r, "charter.stub").length, 2, "one per staff member");
  assert.equal(findings(r, "compose", "cto")[0]?.level, "ok");
  assert.equal(findings(r, "callers", "cmo")[0]?.level, "ok");
});

test("a human listed without a login is a warning that names them", async () => {
  const t = await tenant();
  t.edit(t.ops("org.yaml"), (s) =>
    s.replace(
      /human:\n(?: {2}.*\n)+/,
      "humans:\n  - { name: someone, github: someone, marker: boss }\n  - { name: Sam, marker: sam }\n",
    ),
  );
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [f] = findings(r, "human.login");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /^Sam has no github login/);
  assert.equal(findings(r, "human").length, 0, "one login is enough to wake somebody");
});

test("an edited framework-owned file fails, even though nothing has collided yet", async () => {
  /* The lost-fix failure: a change made to a generated file in the tenant, which survives only
     until the framework next touches that file. */
  const t = await tenant();
  t.seed();
  appendFileSync(t.ops("runner-plan.mjs"), "\n// a local fix\n");
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [f] = findings(r, "upgrade.owned");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /runner-plan\.mjs is the framework's file/);
  assert.equal(findings(r, "upgrade").length, 0, "and it is not also reported as in sync");
});

test("the same edit to a seeded file is the tenant's business", async () => {
  const t = await tenant();
  t.seed();
  appendFileSync(t.ops("org", "voice.md"), "\nOur own rule.\n");
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.equal(findings(r, "upgrade.owned").length, 0);
  assert.equal(findings(r, "upgrade")[0]?.level, "ok");
});

test("a file behind the framework is a warning, counted, with the command that fixes it", async () => {
  const t = await tenant();
  t.seed();
  // The framework has moved since this tenant was seeded, and the tenant never touched it.
  const old = "# Voice\n\nAn older voice.\n";
  writeFileSync(t.ops(".roster", "seed", "org", "voice.md"), old);
  writeFileSync(t.ops("org", "voice.md"), old);
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [f] = findings(r, "upgrade.stale");
  assert.equal(f?.level, "warn");
  assert.equal(f!.title, "1 generated file is behind the framework");
  assert.equal(f!.fix, "roster upgrade --apply");
});

test("a conflict and a missing base are both blocked, each with its own way out", async () => {
  const t = await tenant();
  t.seed();
  const voice = readFileSync(t.ops("org", "voice.md"), "utf8");
  const lines = voice.split("\n");
  const at = lines.findIndex((l) => l.trim().length > 0 && !l.startsWith("#"));
  // Base and tenant both rewrite the same line the framework has, differently.
  lines[at] = "What the framework used to say here.";
  writeFileSync(t.ops(".roster", "seed", "org", "voice.md"), lines.join("\n"));
  lines[at] = "What the tenant says here instead.";
  writeFileSync(t.ops("org", "voice.md"), lines.join("\n"));
  // And a file with no base at all.
  unlinkSync(t.ops(".roster", "seed", "org", "guardrails.md"));
  appendFileSync(t.ops("org", "guardrails.md"), "\nA local rule.\n");

  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const blocked = findings(r, "upgrade.blocked");
  const voiceF = blocked.find((f) => f.title.startsWith("org/voice.md"));
  const guardF = blocked.find((f) => f.title.startsWith("org/guardrails.md"));
  assert.match(voiceF?.fix ?? "", /\.roster-merge/, JSON.stringify(blocked));
  assert.match(guardF?.fix ?? "", /--baseline/);
  assert.ok(blocked.every((f) => f.level === "warn"));
});

test("a blank left in org.yaml is a failure, not a default", async () => {
  const t = await tenant();
  t.edit(t.ops("org.yaml"), (s) =>
    s.replace(/model: .*/, 'model: "FILL IN: a model the provider below serves"'),
  );
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [f] = findings(r, "agent.config");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /org\.yaml still has a blank/);
});

test("an agent this tenant's agents.mjs does not know fails before anything else is believed", async () => {
  const t = await tenant();
  t.edit(t.ops("org.yaml"), (s) => s.replace("id: claude-code-action", "id: no-such-agent"));
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [f] = findings(r, "agent");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /^no runner resolves/);
});

test("an agent that needs a config file fails without one, and fails on a blank in it", async () => {
  const t = await tenant();
  t.edit(t.ops("org.yaml"), (s) => s.replace("id: claude-code-action", "id: nanocoder"));
  let r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.match(findings(r, "agent")[0]!.title, /runs on nanocoder/);
  let [f] = findings(r, "agent.config");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /nanocoder needs agents\.config\.json and there is none/);

  writeFileSync(t.ops("agents.config.json"), '{ "model": "FILL IN" }\n');
  r = await collect({ offline: true, ops: t.ws.opsDir });
  [f] = findings(r, "agent.config");
  assert.match(f!.title, /agents\.config\.json still has a blank/);

  writeFileSync(t.ops("agents.config.json"), '{ "model": "some-model" }\n');
  r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.equal(findings(r, "agent.config").length, 0, "a filled-in config is no finding");
});

test("business.md: missing fails, a stub warns, written prose passes", async () => {
  const t = await tenant();
  unlinkSync(t.ops("org", "business.md"));
  let r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.equal(findings(r, "business")[0]?.level, "fail");

  writeFileSync(
    t.ops("org", "business.md"),
    "# What Acme is\n\nAcme sells scheduling software to independent bakeries. Two hundred " +
      "accounts, one plan, one price. The owner decides pricing.\n",
  );
  r = await collect({ offline: true, ops: t.ws.opsDir });
  assert.equal(findings(r, "business")[0]?.level, "ok");
  assert.equal(findings(r, "business.stub").length, 0);
});

test("a manifest that disagrees with org.yaml, or names no brain, fails for that staff member only", async () => {
  const t = await tenant();
  t.edit(t.at("technology", "staff.yaml"), (s) =>
    s.replace("handle: cto", "handle: cfo").replace(/^brain: .*\n/m, ""),
  );
  const r = await collect({ offline: true, ops: t.ws.opsDir });
  const [h] = findings(r, "manifest.handle", "cto");
  assert.equal(h?.level, "fail");
  assert.match(h!.title, /says handle "cfo", org\.yaml says "cto"/);
  assert.equal(findings(r, "manifest.brain", "cto")[0]?.level, "fail");
  assert.equal(findings(r, "manifest.handle", "cmo").length, 0, "the peer is not implicated");
});

test("a manifest the composer cannot parse is reported as that, not as a crash", async () => {
  const t = await tenant();
  writeFileSync(t.at("technology", "staff.yaml"), "handle: cto\n  broken: [\n");
  const r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  const bad = findings(r, "manifest", "cto");
  assert.ok(
    bad.some((f) => f.level === "fail" && /does not parse/.test(f.title)),
    JSON.stringify(bad),
  );
});

test("a prompt that cannot compose names the kind that broke", async () => {
  const t = await tenant();
  writeFileSync(t.ops("prompts", "daily.md"), "{{> prompts/no-such-fragment.md}}\n");
  const r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  const [f] = findings(r, "compose.daily", "cto");
  assert.equal(f?.level, "fail");
  assert.equal(f!.fix, "roster prompt cto --kind daily");
  assert.equal(findings(r, "compose.mention").length, 0, "mention still composes");
  assert.equal(findings(r, "compose").length, 0, "and there is no blanket ok beside a failure");
  assert.equal(process.env.ROSTER_CONTEXT, undefined, "the stand-in context does not leak");
});

test("callers: one missing warns, one pointing outside the org fails, a missing target fails", async () => {
  const t = await tenant();
  const wf = (h: string, dir: string, k: string) =>
    t.at(dir, ".github", "workflows", `${h}-${k}.yaml`);

  unlinkSync(wf("cto", "technology", "mention"));
  t.edit(wf("cmo", "marketing", "daily"), (s) =>
    s.replaceAll("acme/roster-ops/", "someone-else/roster-ops/"),
  );
  let r = await collect({ offline: true, ops: t.ws.opsDir });

  const [count] = findings(r, "callers", "cto");
  assert.equal(count?.level, "warn");
  assert.match(count!.title, /^1 caller workflow, expected 2/);

  const uses = findings(r, "callers.uses", "cmo");
  assert.equal(uses[0]?.level, "fail");
  assert.match(
    uses[0]!.title,
    /calls someone-else\/roster-ops\/.*this org's ops repo is acme\/roster-ops/,
  );

  // The reusable workflow itself gone from the ops repo: every caller now points at nothing.
  unlinkSync(t.ops(".github", "workflows", "session.yaml"));
  r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  const [target] = findings(r, "callers.target", "cto");
  assert.equal(target?.level, "fail");
  assert.match(target!.title, /cto-daily\.yaml calls acme\/roster-ops\/.*which does not exist/);
});

test("a caller with no uses: is a failure, and no callers at all is worse than one", async () => {
  const t = await tenant();
  writeFileSync(t.at("technology", ".github", "workflows", "cto-daily.yaml"), "name: nothing\n");
  let r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  assert.match(findings(r, "callers.uses", "cto")[0]!.title, /calls no reusable workflow/);

  rmSync(t.at("technology", ".github"), { recursive: true });
  r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  assert.equal(findings(r, "callers", "cto")[0]?.level, "fail");
});

test("a declared surface missing from disk is a warning naming it", async () => {
  const t = await tenant();
  rmSync(t.at("technology", "strategy"), { recursive: true, force: true });
  const r = await collect({ offline: true, ops: t.ws.opsDir, only: "cto" });
  const [f] = findings(r, "surfaces", "cto");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /strategy\//);
});

test("naming one staff member checks only them", async () => {
  const t = await tenant();
  const r = await collect({ offline: true, ops: t.ws.opsDir, only: "cmo" });
  const scopes = new Set(r!.findings.map((f) => f.scope));
  assert.deepEqual([...scopes].sort(), ["cmo", "workspace"]);
});

test("the exit code is 1 on a failure and 0 on warnings alone, and --json is the findings", async () => {
  const t = await tenant();
  let run = await quietly(() => doctorCommand(["--offline", "--json", "--ops", t.ws.opsDir]));
  assert.equal(run.value, 0, "a fresh tenant has warnings (stubs) and no failures");
  const parsed = JSON.parse(run.out) as { org: string; findings: unknown[] };
  assert.equal(parsed.org, "acme");
  assert.ok(parsed.findings.length > 5);

  unlinkSync(t.ops("org", "business.md"));
  run = await quietly(() => doctorCommand(["--offline", "--ops", t.ws.opsDir]));
  assert.equal(run.value, 1);
  assert.match(run.out, /✗ no org\/business\.md\n\s+Every prompt is composed on top of it/);
  assert.match(run.out, /offline: local checks only/);

  await assert.rejects(() => doctorCommand(["--frobnicate"]), /unknown flag --frobnicate/);
});

/* ------------------------------- online -------------------------------- */

const SECRETS = [
  "CTO_APP_ID",
  "CTO_APP_PRIVATE_KEY",
  "BOT_APP_ID",
  "BOT_APP_PRIVATE_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
];
const LABELS = ["boss", "cto", "decision", "setup", "build", "blocked", "from-cto", "from-cmo"];

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
/** A finished run that started `startedAgo` minutes ago and lasted `lasted` minutes. */
const ran = (conclusion: string, startedAgo: number, lasted = 20) => ({
  conclusion,
  status: "completed",
  createdAt: iso(startedAgo),
  updatedAt: iso(startedAgo - lasted),
});

/** A healthy org, with anything in `over` answered first. */
function world(over: Route[] = []): Route[] {
  return [
    ...over,
    { match: /^api user /, stdout: { login: "someone" } },
    { match: /^api repos\/acme\/[a-z-]+$/, stdout: { full_name: "x", visibility: "private" } },
    { match: /actions\/permissions\/access$/, stdout: { access_level: "organization" } },
    { match: /actions\/secrets$/, stdout: { secrets: SECRETS.map((name) => ({ name })) } },
    { match: /\/labels\?per_page=100$/, stdout: LABELS.map((name) => ({ name })) },
    {
      match: /^api graphql /,
      stdout: { data: { repository: { pinnedIssues: { nodes: [{ issue: { number: 1 } }] } } } },
    },
    { match: /^run list /, stdout: [ran("success", 60), ran("success", 1500)] },
  ];
}

async function online(over: Route[] = [], edit?: (t: Awaited<ReturnType<typeof tenant>>) => void) {
  const t = await tenant();
  edit?.(t);
  const gh = fakeGh(world(over));
  try {
    const r = await collect({ ops: t.ws.opsDir, only: "cto" });
    return { r, calls: gh.calls() };
  } finally {
    gh.restore();
  }
}

test("online against a healthy org: nothing fails, and every check actually ran", async () => {
  const { r } = await online();
  assert.equal(r!.online, true);
  assert.deepEqual(fails(r), []);
  for (const id of [
    "gh",
    "repo",
    "actions-access",
    "secrets",
    "labels",
    "peer-labels",
    "status-issue",
  ]) {
    assert.equal(findings(r, id)[0]?.level, "ok", `${id}: ${JSON.stringify(findings(r, id))}`);
  }
  assert.match(findings(r, "secrets")[0]!.title, /all 5 referenced secrets present/);
  assert.equal(findings(r, "runs", "cto").length, 2, "one verdict per caller");
});

test("gh not signed in is one warning, and nothing else touches the network", async () => {
  const { r, calls } = await online([{ match: /^api user /, stderr: "HTTP 401: Bad credentials" }]);
  assert.equal(r!.online, false);
  const [f] = findings(r, "gh");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /not authenticated/);
  assert.deepEqual(calls, [["api", "user", "--jq", "{login: .login}"]]);
});

test("an unreachable repo fails, a visibility that differs from org.yaml warns", async () => {
  const { r } = await online([
    { match: /^api repos\/acme\/marketing$/, stderr: '{"message":"Not Found"} (HTTP 404)' },
    { match: /^api repos\/acme\/roster-ops$/, stdout: { visibility: "public" } },
  ]);
  const repo = findings(r, "repo");
  assert.equal(repo.length, 1);
  assert.equal(repo[0]!.level, "fail");
  assert.match(repo[0]!.title, /acme\/marketing is unreachable: Not Found/);
  const [vis] = findings(r, "repo.visibility");
  assert.equal(vis?.level, "warn");
  assert.match(vis!.title, /roster-ops is public, org\.yaml says private/);
});

test("Actions access: not shared with the org fails, unreadable only warns", async () => {
  let { r } = await online([
    { match: /actions\/permissions\/access$/, stdout: { access_level: "none" } },
  ]);
  let [f] = findings(r, "actions-access");
  assert.equal(f?.level, "fail");
  assert.match(f!.fix!, /workflow not found/);

  ({ r } = await online([
    { match: /actions\/permissions\/access$/, stderr: '{"message":"Must have admin rights"}' },
  ]));
  [f] = findings(r, "actions-access");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /Must have admin rights/);
});

test("secrets are the ones the callers reference, and a missing one fails by name", async () => {
  const { r } = await online([
    {
      match: /actions\/secrets$/,
      stdout: {
        secrets: SECRETS.filter((s) => s !== "BOT_APP_PRIVATE_KEY").map((name) => ({ name })),
      },
    },
  ]);
  const [f] = findings(r, "secrets", "cto");
  assert.equal(f?.level, "fail");
  assert.equal(f!.title, "missing on acme/technology: BOT_APP_PRIVATE_KEY");
});

test("a peer label is looked for on the peer's tracker, not on this one", async () => {
  /* `from-cto` marks the CTO's asks on the CMO's board. Missing from the CTO's own repo is
     correct; missing from the CMO's is the finding. */
  const { r, calls } = await online([
    {
      match: /^api repos\/acme\/marketing\/labels/,
      stdout: LABELS.filter((l) => l !== "from-cto").map((name) => ({ name })),
    },
    {
      match: /^api repos\/acme\/technology\/labels/,
      stdout: LABELS.filter((l) => l !== "from-cto").map((name) => ({ name })),
    },
  ]);
  assert.ok(calls.some((c) => c.join(" ") === "api repos/acme/marketing/labels?per_page=100"));
  const [peer] = findings(r, "peer-labels", "cto");
  assert.equal(peer?.level, "warn");
  assert.equal(peer!.title, '"from-cto" is missing from acme/marketing');
  assert.equal(findings(r, "labels", "cto")[0]?.level, "ok", "and not reported against its own");
});

test("a declared label missing from the tracker warns; an unpinned status issue warns", async () => {
  const { r } = await online([
    { match: /^api repos\/acme\/technology\/labels/, stdout: [{ name: "boss" }] },
    { match: /^api graphql /, stdout: { data: { repository: { pinnedIssues: { nodes: [] } } } } },
  ]);
  const [labels] = findings(r, "labels", "cto");
  assert.equal(labels?.level, "warn");
  assert.match(labels!.title, /not on acme\/technology: cto, decision, setup, build, blocked/);
  const [pin] = findings(r, "status-issue", "cto");
  assert.equal(pin?.level, "warn");
  assert.match(pin!.title, /#1 is declared as the status issue but is not pinned/);
});

/* The run window is the headline, so each verdict gets its own case. */

const runs = (daily: unknown[], mention: unknown[]): Route[] => [
  { match: /^run list .*--workflow cto-daily\.yaml/, stdout: daily },
  { match: /^run list .*--workflow cto-mention\.yaml/, stdout: mention },
];
const runFinding = (r: Report | null, id: string, wf: string) =>
  findings(r, id, "cto").filter((f) => f.title.startsWith(wf));

test("a workflow that has never run is unproven, not fine", async () => {
  const { r } = await online(runs([], [ran("success", 60)]));
  const [f] = runFinding(r, "runs", "cto-daily.yaml");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /has never run/);
});

test("a mention workflow that is all skips is normal once another run proved the grant", async () => {
  const skipped = [1, 2, 3].map((n) => ({ ...ran("skipped", n * 30, 0) }));
  let { r } = await online(runs([ran("success", 60)], skipped));
  let [f] = runFinding(r, "runs", "cto-mention.yaml");
  assert.equal(f?.level, "ok");
  assert.match(f!.title, /3 recent triggers, all gated out, which is its normal state/);

  // Nothing in the repo has finished: the skips prove only the trigger.
  ({ r } = await online(runs([ran("failure", 60)], skipped)));
  [f] = runFinding(r, "runs", "cto-mention.yaml");
  assert.equal(f?.level, "warn");
  assert.match(f!.title, /all gated out before doing anything/);
});

test("runs killed at the caller's ceiling fail as timeouts, not as cancellations", async () => {
  const { r } = await online(
    runs([ran("cancelled", 100, 90), ran("cancelled", 1600, 90), ran("success", 3000)], []),
  );
  const [f] = runFinding(r, "runs.timeout", "cto-daily.yaml");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /2 of the last 3 ran to a 90m ceiling and were killed/);
  assert.match(f!.fix!, /Raise timeout_minutes/);
  assert.equal(runFinding(r, "runs.cancelled", "cto-daily.yaml").length, 0);
});

test("an old ceiling already raised, with a clean run since, is history rather than a failure", async () => {
  // Two runs killed at 60 minutes last week; the caller now allows 90; one has finished since.
  const { r } = await online(
    runs([ran("success", 60), ran("cancelled", 5000, 60), ran("cancelled", 6500, 60)], []),
  );
  const [f] = runFinding(r, "runs.timeout", "cto-daily.yaml");
  assert.equal(f?.level, "ok", JSON.stringify(findings(r, "runs.timeout")));
  assert.match(f!.title, /the 60m ceiling that killed 2 of the last 3 was raised to 90m/);
});

test("an old ceiling raised with nothing finished since is still a failure, and says so", async () => {
  const { r } = await online(runs([ran("cancelled", 5000, 60), ran("cancelled", 6500, 60)], []));
  const [f] = runFinding(r, "runs.timeout", "cto-daily.yaml");
  assert.equal(f?.level, "fail");
  assert.match(f!.title, /the caller now allows 90m/);
  assert.match(f!.fix!, /Already raised to 90m/);
});

test("a failed run fails, a short cancellation only warns, and each is counted", async () => {
  const { r } = await online(
    runs([ran("failure", 60), ran("cancelled", 1500, 4), ran("success", 3000)], []),
  );
  const [failed] = runFinding(r, "runs", "cto-daily.yaml");
  assert.equal(failed?.level, "fail");
  assert.match(failed!.title, /1 of the last 3 run failed \(most recent 60m ago\)/);
  const [cancelled] = runFinding(r, "runs.cancelled", "cto-daily.yaml");
  assert.equal(cancelled?.level, "warn");
  assert.match(cancelled!.title, /1 of the last 3 were cancelled \(4m\)/);
  assert.equal(runFinding(r, "runs.timeout", "cto-daily.yaml").length, 0);
});

test("run history that cannot be read is a warning, not a silent pass", async () => {
  const { r } = await online([
    { match: /^run list .*cto-daily/, stderr: "HTTP 403: Resource not accessible" },
  ]);
  const [f] = runFinding(r, "runs", "cannot read runs for cto-daily.yaml");
  assert.equal(f?.level, "warn");
});
