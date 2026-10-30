import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { orgSpecOf } from "../src/commands/routine.js";
import { planBrains } from "../src/commands/upgrade.js";
import { planSchedule, readSchedule } from "../src/lib/routineplan.js";
import {
  checkRoutines,
  describeCron,
  parseRoutineFile,
  routineExpression,
  routineFile,
  routineId,
  setRoutinesInManifest,
  validCron,
} from "../src/lib/routines.js";
import { loadComposer, readOrg } from "../src/lib/workspace.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * Routines: the times a staff member wakes beyond the daily round. The schedule is compiled
 * into the daily caller, so these hold the three files (staff.yaml, routines/<id>.md and the
 * caller) to one another, and the prompt to the routine that fired.
 */

const root = mkdtempSync(join(tmpdir(), "roster-routines-"));
const ws = await makeTenant(root, { org: "acme" });
const { parseYaml, compose } = await loadComposer(ws.opsDir);
const org = readOrg(ws.opsDir, parseYaml);
const brain = join(root, "cto");
const read = (rel: string) => {
  try {
    return readFileSync(join(brain, rel), "utf8");
  } catch {
    return undefined;
  }
};
const session = readFileSync(join(ws.opsDir, ".github", "workflows", "session.yaml"), "utf8");

after(() => rmSync(root, { recursive: true, force: true }));

const monday = {
  id: "monday-plan",
  title: "Monday plan",
  body: "Plan the week: what ships, and what is parked.",
  schedule: "0 9 * * 1",
};

test("ids come from the name and never collide", () => {
  assert.equal(routineId("Monday plan!"), "monday-plan");
  assert.equal(routineId("Monday plan", ["monday-plan"]), "monday-plan-2");
  assert.equal(routineId("???"), "routine");
});

test("only five numeric cron fields are accepted", () => {
  assert.ok(validCron("0 9 * * 1"));
  assert.ok(validCron("*/30 8-18 * * 1-5"));
  assert.ok(!validCron("0 9 * *"));
  assert.ok(!validCron("@daily"));
  assert.ok(!validCron("0 9 * * MON"));
});

test("two schedules at the same minute are refused, because GitHub fires once", () => {
  const errors = checkRoutines("0 9 * * 1", [monday]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /same time as the daily round/);
  assert.deepEqual(checkRoutines("0 8 * * 1-5", [monday]), []);
});

test("a schedule reads as words where the picker could have written it", () => {
  assert.equal(describeCron("0 8 * * 1-5"), "Weekdays at 08:00 UTC");
  assert.equal(describeCron("30 9 * * 1,3"), "Mondays and Wednesdays at 09:30 UTC");
  assert.equal(describeCron("0 7 1 * *"), "On the 1st of each month at 07:00 UTC");
  assert.equal(describeCron("0 7 12 * *"), "On the 12th of each month at 07:00 UTC");
  assert.equal(describeCron("*/15 * * * *"), "*/15 * * * *");
});

test("a routine file round-trips its name and its words", () => {
  assert.deepEqual(parseRoutineFile(routineFile(monday), "x"), {
    title: monday.title,
    body: monday.body,
  });
});

test("the routines block replaces itself and leaves the rest of staff.yaml alone", () => {
  const before = read("staff.yaml")!;
  const one = setRoutinesInManifest(before, [monday]);
  const back = setRoutinesInManifest(one, []);
  assert.equal(back, before, "adding then removing is no change");
  assert.deepEqual((parseYaml(one, "staff.yaml") as any).routines, [
    { id: "monday-plan", schedule: "0 9 * * 1" },
  ]);
});

test("the scheduled run says which routine fired, and the daily round says none", () => {
  const expr = routineExpression([monday]);
  assert.equal(expr, "((github.event.schedule == '0 9 * * 1' && 'monday-plan') || '')");
  assert.equal(routineExpression([]), "''");
});

test("adding a routine writes staff.yaml, its file and the caller, and upgrade agrees", () => {
  const now = readSchedule(parseYaml(read("staff.yaml")!, "staff.yaml"), read);
  assert.deepEqual(now.routines, []);
  const plan = planSchedule({
    manifest: read("staff.yaml")!,
    parseYaml,
    dir: "cto",
    org: orgSpecOf(org, ws.opsName),
    next: { ...now, routines: [monday] },
    current: read,
    session,
  });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.changes.map((c) => c.path).sort(), [
    ".github/workflows/cto-daily.yaml",
    "routines/monday-plan.md",
    "staff.yaml",
  ]);
  const caller = plan.changes.find((c) => c.path.endsWith("daily.yaml"))!.text!;
  assert.match(caller, /- cron: "0 9 \* \* 1" # monday-plan/);
  assert.match(
    caller,
    /routine: \$\{\{ github\.event_name == 'schedule' && \(\(github\.event\.schedule == '0 9 \* \* 1'/,
  );
  assert.doesNotMatch(caller, /%%/);

  for (const c of plan.changes) {
    mkdirSync(join(brain, c.path, ".."), { recursive: true });
    writeFileSync(join(brain, c.path), c.text!);
  }
  /* The caller is generated, so upgrade renders it too: if the two disagreed, every routine
     edit would come back as drift to revert. */
  const cto = planBrains(ws, parseYaml).find((b) => b.handle === "cto")!;
  const daily = cto.files.find((f) => f.rel === ".github/workflows/cto-daily.yaml");
  assert.equal(daily?.verdict, "same");
});

test("a routine run's prompt carries the routine, in the person's words", () => {
  const text = compose({
    opsDir: ws.opsDir,
    brainsDir: root,
    staff: "cto",
    kind: "daily",
    context: JSON.stringify({ trigger: "routine", routine: "monday-plan" }),
  } as never);
  assert.match(text, /This run is a routine: Monday plan/);
  assert.match(text, /<routine>\nPlan the week: what ships, and what is parked\.\n<\/routine>/);

  const daily = compose({
    opsDir: ws.opsDir,
    brainsDir: root,
    staff: "cto",
    kind: "daily",
    context: JSON.stringify({ trigger: "daily", routine: "" }),
  } as never);
  assert.doesNotMatch(daily, /This run is a routine/);
});

test("a routine whose file has gone says so rather than inventing a job", () => {
  const text = compose({
    opsDir: ws.opsDir,
    brainsDir: root,
    staff: "cto",
    kind: "daily",
    context: JSON.stringify({ trigger: "routine", routine: "gone" }),
  } as never);
  assert.match(text, /routines\/gone\.md` is missing/);
});

test("an ops repo too old for routines is refused, not broken", () => {
  const plan = planSchedule({
    manifest: read("staff.yaml")!,
    parseYaml,
    dir: "cto",
    org: orgSpecOf(org, ws.opsName),
    next: { daily: "0 8 * * 1-5", routines: [{ ...monday, id: "other" }] },
    current: read,
    session: session.replace(/^\s+routine:\s*$/m, ""),
  });
  assert.match(plan.errors.join(), /roster upgrade/);
});
