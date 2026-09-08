import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collect,
  doctorCommand,
  inferredCeiling,
  isTimeout,
  type Run,
  runMinutes,
  timeoutOf,
} from "../src/commands/doctor.js";
import { testWorkspace } from "./helpers/workspace.js";

/**
 * Doctor's job is to be believed, so the tests here are mostly about not crying wolf. Every
 * one of these cases was a wrong verdict on the first run against the real org: a skipped
 * mention reported as a failure, a peer label looked for on the wrong repo, and a timeout
 * reported as a mysterious cancellation.
 */

const run = (over: Partial<Run>): Run => ({
  conclusion: "success",
  status: "completed",
  createdAt: "2026-09-04T11:00:00Z",
  updatedAt: "2026-09-04T11:20:00Z",
  ...over,
});

test("the timeout comes from the caller, not from a guess", () => {
  assert.equal(timeoutOf("    with:\n      timeout_minutes: 30\n"), 30);
  assert.equal(timeoutOf("timeout_minutes:    90"), 90);
  // session.yaml's own default, for a caller that does not override it.
  assert.equal(timeoutOf("with:\n  staff: cto\n"), 90);
});

test("a job killed by its timeout is named as one, not left as 'cancelled'", () => {
  /* GitHub reports both a manual cancel and a timeout kill as "cancelled". The CTO's daily
     run hit this: five of ten runs ended at exactly 60 minutes, which reads as somebody
     pressing a button until you look at the durations. */
  const killed = run({
    conclusion: "cancelled",
    createdAt: "2026-09-04T11:00:00Z",
    updatedAt: "2026-09-04T12:00:22Z",
  });
  assert.equal(isTimeout(killed, 60), true);

  const stopped = run({
    conclusion: "cancelled",
    createdAt: "2026-09-04T11:00:00Z",
    updatedAt: "2026-09-04T11:04:00Z",
  });
  assert.equal(
    isTimeout(stopped, 60),
    false,
    "a run cancelled after four minutes is not a timeout",
  );

  const fine = run({ createdAt: "2026-09-04T11:00:00Z", updatedAt: "2026-09-04T12:10:00Z" });
  assert.equal(isTimeout(fine, 60), false, "a success is never a timeout, however long it took");
});

test("a run one minute short of the ceiling still counts as a timeout", () => {
  // Scheduling overhead means the wall clock rarely lands exactly on the limit.
  const near = run({
    conclusion: "cancelled",
    createdAt: "2026-09-04T11:00:00Z",
    updatedAt: "2026-09-04T11:59:20Z",
  });
  assert.equal(isTimeout(near, 60), true);
});

const OPS = (await testWorkspace()).opsDir;

test("doctor runs offline against the real workspace and finds it healthy", async () => {
  /* The same bet as the portal tests: built from the live workspace, so it breaks when the
     real data grows a shape doctor cannot read. Offline, so it needs no network and no auth. */
  const r = (await collect({ offline: true, ops: OPS }))!;
  assert.ok(r, "the workspace should resolve");
  assert.equal(r.online, false);

  const ids = new Set(r.findings.map((f) => f.id));
  /* The id carries the outcome — `upgrade` when in sync, `upgrade.stale` when behind — so
     asserting one of them asserts the state of the tenant rather than that the check ran.
     This broke the first time a template changed, which is the ordinary case. */
  assert.ok(
    [...ids].some((id) => id === "upgrade" || id.startsWith("upgrade.")),
    "the drift check must run offline, whatever it concludes",
  );
  assert.ok(
    ids.has("compose"),
    "mention prompts need trigger context; composing them without it proves only that they are strict",
  );
  assert.ok(ids.has("callers"));

  const bad = r.findings.filter((f) => f.level === "fail");
  assert.deepEqual(
    bad.map((f) => f.title),
    [],
    "the live workspace should have no offline failures",
  );
});

test("every finding carries a scope, a stable id and a level", async () => {
  const r = (await collect({ offline: true, ops: OPS }))!;
  assert.ok(r.findings.length > 5);
  for (const f of r.findings) {
    assert.ok(["ok", "warn", "fail"].includes(f.level), `bad level ${f.level}`);
    assert.ok(f.id, "an id is what makes a finding referable in an issue");
    assert.ok(f.scope, "a scope says whose problem it is");
    assert.ok(f.title.trim(), "and a finding with no title says nothing");
  }
});

test("anything that is not ok explains what to do about it", async () => {
  const r = (await collect({ offline: true, ops: OPS }))!;
  // A checker that reports a problem without a next step just moves the work.
  for (const f of r.findings.filter((x) => x.level !== "ok")) {
    assert.ok(f.fix, `${f.id} reports a problem with no fix: ${f.title}`);
  }
});

test("an unknown handle is an error, not an empty pass", async () => {
  const err: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string) => {
    err.push(String(s));
    return true;
  }) as typeof process.stderr.write;
  let code: number;
  try {
    code = await doctorCommand(["nobody", "--offline", "--ops", OPS]);
  } finally {
    process.stderr.write = write;
  }
  assert.equal(code, 2);
  assert.match(err.join(""), /no staff member/);
});

test("a broken workspace produces failures, and every one says what to do", async () => {
  /* The healthy org exercises almost none of the failure paths, so the invariant above was
     passing vacuously. This builds a workspace that is wrong in several ways at once — which
     is also the shape of a half-finished `roster hire` — and checks the findings hold up. */
  const root = mkdtempSync(join(tmpdir(), "roster-doctor-"));
  try {
    const ops = join(root, "roster-ops");
    mkdirSync(ops, { recursive: true });
    // The composer is vendored into every tenant, so a real one is copied rather than faked.
    copyFileSync(
      join(import.meta.dirname, "..", "templates", "ops", "compose.mjs"),
      join(ops, "compose.mjs"),
    );
    writeFileSync(
      join(ops, "org.yaml"),
      [
        "org: acme",
        "name: Acme",
        "human:",
        "  name: Someone",
        "staff:",
        "  - { handle: cfo, dir: finance, name: Chief Financial Officer }",
        "  - { handle: ghost, dir: nowhere, name: Never Cloned }",
        "repos:",
        "  - { name: finance, visibility: private, role: brain }",
      ].join("\n") + "\n",
    );

    // One staff member checked out but empty; the other not checked out at all.
    mkdirSync(join(root, "finance"), { recursive: true });

    const r = (await collect({ offline: true, ops }))!;
    const by = (id: string) => r.findings.filter((f) => f.id === id);

    assert.ok(by("human").length, "a missing human.github must be caught: the callers gate on it");
    assert.ok(
      by("checkout").length,
      "a staff member with no checkout must be reported, not skipped",
    );
    assert.ok(by("manifest").length, "no staff.yaml");
    assert.ok(by("charter").length, "no CHARTER.md");
    assert.ok(by("memory").length, "no memory/INDEX.md");
    assert.ok(by("callers").length, "no caller workflows");

    const bad = r.findings.filter((f) => f.level !== "ok");
    assert.ok(bad.length >= 6, `expected several problems, got ${bad.length}`);
    for (const f of bad) {
      assert.ok(f.fix, `${f.id} reports a problem with no fix: ${f.title}`);
      assert.ok(
        !/\n/.test(f.title),
        `${f.id} title spans lines, which wrecks the report: ${f.title}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raising a ceiling does not rewrite the history of runs that hit the old one", () => {
  /* A regression caught the moment the CTO's ceiling went 60 -> 90: five genuine timeouts were
     instantly reclassified as ordinary cancellations, because they were being compared against
     today's setting rather than the one in force when they ran. The runs themselves say what
     the ceiling was — several stopping at the same minute is not a coincidence. */
  const at60 = (day: string) =>
    run({
      conclusion: "cancelled",
      createdAt: `2026-09-0${day}T11:00:00Z`,
      updatedAt: `2026-09-0${day}T12:00:20Z`,
    });
  const killed = [at60("1"), at60("2"), at60("3")];

  assert.equal(inferredCeiling(killed), 60);
  // Still recognised as timeouts even though the caller now allows 90.
  for (const r of killed) {
    assert.equal(
      isTimeout(r, 90),
      false,
      "against the new ceiling alone it looks like a cancellation",
    );
    assert.ok(
      Math.abs(runMinutes(r) - inferredCeiling(killed)!) < 1,
      "but the runs still agree on 60",
    );
  }
});

test("one cancelled run is not a ceiling", () => {
  const once = run({
    conclusion: "cancelled",
    createdAt: "2026-09-01T11:00:00Z",
    updatedAt: "2026-09-01T11:12:00Z",
  });
  assert.equal(inferredCeiling([once]), null, "somebody pressing stop is not a pattern");
  assert.equal(inferredCeiling([]), null);
});

test("the ceiling is the duration the most runs agree on", () => {
  const c = (from: string, to: string) =>
    run({ conclusion: "cancelled", createdAt: from, updatedAt: to });
  const runs = [
    c("2026-09-01T11:00:00Z", "2026-09-01T12:00:00Z"),
    c("2026-09-02T11:00:00Z", "2026-09-02T12:00:00Z"),
    c("2026-09-03T11:00:00Z", "2026-09-03T11:07:00Z"), // a real cancellation, on its own
  ];
  assert.equal(inferredCeiling(runs), 60);
});

test("runMinutes measures the wall clock the run was allowed", () => {
  assert.equal(
    runMinutes(run({ createdAt: "2026-09-01T11:00:00Z", updatedAt: "2026-09-01T11:30:00Z" })),
    30,
  );
});
