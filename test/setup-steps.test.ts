import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Facts, type StaffFacts, steps } from "../src/commands/setup.js";
import { installSkill, skillText } from "../src/commands/skill.js";

/**
 * The order `roster setup --json` hands an agent. The SKILL.md install does whatever `next`
 * is, so a step out of order here is a stranger's setup going wrong in front of them.
 */

const signedIn = { ok: true, login: "will" };
const next = (f: Facts) => steps(f).find((s) => !s.done);

const staff = (over: Partial<StaffFacts> = {}): StaffFacts => ({
  handle: "cto",
  dir: "cto",
  charter: true,
  app: true,
  ran: true,
  ...over,
});

const tenant = (over: Partial<NonNullable<Facts["tenant"]>> = {}): Facts => ({
  gh: signedIn,
  orgs: [],
  tenant: {
    org: "acme",
    products: ["web"],
    business: true,
    priorities: true,
    staff: [staff()],
    credential: true,
    tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
    ...over,
  },
});

test("signing in to gh comes first, and nothing is offered after it", () => {
  const list = steps({ gh: { ok: false }, orgs: [], tenant: null });
  assert.equal(list.length, 1);
  assert.equal(list[0]!.who, "human");
});

test("no org at all sends the person to GitHub to make one", () => {
  assert.equal(next({ gh: signedIn, orgs: [], tenant: null })?.id, "org");
});

test("an org that already runs roster is joined, not set up twice", () => {
  const step = next({
    gh: signedIn,
    orgs: [
      { login: "acme", tenant: true },
      { login: "other", tenant: false },
    ],
    tenant: null,
  });
  assert.equal(step?.id, "join");
  assert.match(step!.command!, /--join acme/);
});

test("with orgs and no tenant, init is next and asks first", () => {
  const step = next({ gh: signedIn, orgs: [{ login: "acme", tenant: false }], tenant: null });
  assert.equal(step?.id, "init");
  assert.equal(step?.confirm, true);
});

test("the business is written before anybody is hired", () => {
  assert.equal(next(tenant({ business: false, staff: [] }))?.id, "business");
  assert.equal(next(tenant({ staff: [] }))?.id, "hire");
});

test("a hire's charter and App come before the credential, and the first run is last", () => {
  assert.equal(next(tenant({ staff: [staff({ charter: false, app: false })] }))?.id, "charter.cto");
  assert.equal(next(tenant({ staff: [staff({ app: false, ran: false })] }))?.id, "app.cto");
  assert.equal(
    next(tenant({ credential: false, staff: [staff({ ran: false })] }))?.id,
    "credential",
  );
  const run = next(tenant({ staff: [staff({ ran: false })] }));
  assert.equal(run?.id, "run.cto");
  assert.equal(run?.confirm, true, "a real run costs money, so the agent asks");
});

test("an App GitHub could not answer about is not reported as done", () => {
  assert.equal(next(tenant({ staff: [staff({ app: null })] }))?.id, "app.cto");
});

test("everything done is ready", () => {
  assert.equal(next(tenant()), undefined);
});

const home = mkdtempSync(join(tmpdir(), "roster-skill-"));
after(() => rmSync(home, { recursive: true, force: true }));

test("the skill is saved for each agent that is installed, and only those", () => {
  mkdirSync(join(home, ".claude"));
  assert.deepEqual(installSkill(home), ["Claude Code"]);
  const saved = join(home, ".claude", "skills", "roster", "SKILL.md");
  assert.equal(readFileSync(saved, "utf8"), skillText());
  assert.equal(existsSync(join(home, ".codex")), false, "no agent home is created");
});

test("the skill names itself and follows roster setup", () => {
  const text = skillText();
  assert.match(text, /^---\nname: roster\n/);
  assert.match(text, /roster setup --json/);
});
