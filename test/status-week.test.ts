import assert from "node:assert/strict";
import { test } from "node:test";
import { statusTitle } from "../src/commands/hire.js";
import {
  isCurrent,
  rollWeek,
  weekStart,
  weekTitle,
  withStatusIssue,
  // @ts-expect-error: vendored plain JS, with no types on purpose
} from "../templates/ops/status-week.mjs";

/**
 * One status issue that lasted from August to October became forty-odd run reports in one
 * thread, and stopped being read. These hold the week: a new issue on the first run of a week,
 * last week's left for its summary, and nothing opened twice.
 */

const TUE = Date.UTC(2026, 9, 13, 7); // Tuesday 13 Oct 2026, 07:00 UTC
const MON = Date.UTC(2026, 9, 12);

type Issue = {
  number: number;
  state: string;
  created_at: string;
  body: string;
  node_id: string;
  labels: string[];
};

/** A brain's issues behind the handful of `gh` calls the roll makes, recording each one. */
function fakeGh(issues: Issue[]) {
  const calls: string[][] = [];
  let next = Math.max(0, ...issues.map((i) => i.number)) + 1;
  const gh = (a: string[]) => {
    calls.push(a);
    const path = a[1] ?? "";
    if (a[0] === "label") throw new Error("already exists");
    if (a[0] === "api" && path === "graphql") return "{}";
    let m = path.match(/issues\/(\d+)$/);
    if (m && !a.includes("-X")) {
      return JSON.stringify(issues.find((i) => i.number === Number(m![1])) ?? null);
    }
    if (/\/issues$/.test(path) && a.includes("POST")) {
      const field = (k: string) =>
        a.filter((x) => x.startsWith(`${k}=`)).map((x) => x.slice(k.length + 1));
      const issue: Issue = {
        number: next++,
        state: "open",
        created_at: new Date(TUE).toISOString(),
        body: field("body")[0] ?? "",
        node_id: "N_new",
        labels: field("labels[]"),
      };
      issues.push(issue);
      return JSON.stringify(issue);
    }
    m = path.match(/issues\/(\d+)\/labels\/(.+)$/);
    if (m) {
      const i = issues.find((x) => x.number === Number(m![1]))!;
      i.labels = i.labels.filter((l) => l !== m![2]);
      return "";
    }
    m = path.match(/issues\/(\d+)\/labels$/);
    if (m) {
      issues.find((x) => x.number === Number(m![1]))!.labels.push("status");
      return "";
    }
    if (path.includes("labels=status")) {
      return JSON.stringify(
        issues.filter((i) => i.state === "open" && i.labels.includes("status")),
      );
    }
    throw new Error(`unexpected gh ${a.join(" ")}`);
  };
  return { gh, calls };
}

const old = (over: Partial<Issue> = {}): Issue => ({
  number: 15,
  state: "open",
  created_at: "2026-08-03T12:38:56Z",
  body: "## Situation\nLive is v1.27.12.",
  node_id: "N_15",
  labels: ["keep-open"],
  ...over,
});

test("a week starts on Monday, in UTC", () => {
  assert.equal(weekStart(TUE).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(weekStart(MON).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(weekStart(Date.UTC(2026, 9, 18, 23)).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(weekTitle(TUE), "📍 Where we are: week of 12 Oct");
});

test("hire titles the first issue the way every later week is titled", () => {
  for (const day of [TUE, Date.UTC(2026, 8, 7), Date.UTC(2027, 0, 3)]) {
    assert.equal(statusTitle(new Date(day)), weekTitle(day));
  }
});

test("this week's open issue is left alone", () => {
  const issues = [old({ created_at: "2026-10-12T07:01:00Z", labels: ["keep-open", "status"] })];
  const { gh, calls } = fakeGh(issues);
  const week = rollWeek({ repo: "o/cto", current: 15, gh, now: TUE });
  assert.deepEqual(week, { current: 15, rolled: false, previous: [] });
  assert.ok(
    !calls.some((c) => c.includes("POST") && /\/issues$/.test(c[1] ?? "")),
    "nothing opened",
  );
});

test("an earlier week's issue rolls: a new one carries its body, and the old one waits for its summary", () => {
  const issues = [old()];
  const { gh, calls } = fakeGh(issues);
  const week = rollWeek({ repo: "o/cto", current: 15, gh, now: TUE });

  assert.equal(week.rolled, true);
  assert.equal(week.current, 16);
  assert.deepEqual(week.previous, [15]);
  const opened = issues.find((i) => i.number === 16)!;
  assert.equal(opened.body, "## Situation\nLive is v1.27.12.");
  assert.deepEqual(opened.labels.sort(), ["keep-open", "status"]);
  assert.deepEqual(issues[0]?.labels.sort(), ["status"], "the old one can be closed now");

  const [unpin = "", pin = ""] = calls.filter((c) => c[1] === "graphql").map((c) => c.join(" "));
  assert.ok(
    unpin.includes("unpinIssue") && unpin.includes("N_15"),
    "unpinned first: three can be pinned",
  );
  assert.ok(pin.includes("pinIssue") && pin.includes("N_new"));
});

test("a week whose summary never got written is still handed over", () => {
  const issues = [
    old({ number: 15, state: "open", labels: ["status"] }),
    old({
      number: 31,
      created_at: "2026-10-12T07:00:00Z",
      labels: ["keep-open", "status"],
      node_id: "N_31",
    }),
  ];
  const { gh } = fakeGh(issues);
  assert.deepEqual(rollWeek({ repo: "o/cto", current: 31, gh, now: TUE }).previous, [15]);
});

test("a closed status issue rolls to a fresh one, with no summary to write", () => {
  const issues = [old({ state: "closed" })];
  const { gh } = fakeGh(issues);
  const week = rollWeek({ repo: "o/cto", current: 15, gh, now: TUE });
  assert.equal(week.rolled, true);
  assert.deepEqual(week.previous, []);
  assert.match(issues[1]?.body ?? "", /Nothing yet/);
  assert.ok(!isCurrent(issues[0], TUE));
});

test("staff.yaml moves on by one line and nothing else", () => {
  const yaml = 'handle: cto\nbrain: o/cto\nstatus_issue: 15\n\nschedule: "0 7 * * 1-5"\n';
  assert.equal(withStatusIssue(yaml, 42), yaml.replace("status_issue: 15", "status_issue: 42"));
  assert.match(
    withStatusIssue("handle: cto\nbrain: o/cto\n", 7),
    /^brain: o\/cto\nstatus_issue: 7$/m,
  );
});
