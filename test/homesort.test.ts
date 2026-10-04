import assert from "node:assert/strict";
import { test } from "node:test";

const dir = new URL("../templates/portal/js/", import.meta.url).href;
const { sortHome, daysUntil } = (await import(dir + "homesort.js")) as {
  sortHome(items: any[], staff: any[], humans: any[], live?: any[], now?: Date): any;
  daysUntil(date: string, now?: Date): number;
};

/* Not the author's own org: a staff member called ops and a person called ada. */
const staff = [
  { handle: "ops", name: "Operations", brain: "acme/ops", statusIssue: 1, mention: "@ops" },
  { handle: "qa", name: "Quality", brain: "acme/qa", statusIssue: 2, mention: "@qa" },
];
const humans = [{ github: "ada", marker: "ada" }];
const NOW = new Date(2026, 9, 4, 15, 0);

let n = 100;
const item = (over: Record<string, unknown>) => ({
  repo: "acme/ops",
  role: "brain",
  kind: "issue",
  number: n++,
  title: "t",
  labels: [],
  assignees: [],
  author: "acme-ops",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-02T09:00:00Z",
  state: "OPEN",
  ...over,
});

const ITEMS = [
  item({ number: 1, labels: ["keep-open"] }), // status
  item({ title: "decide", labels: ["ada", "decision"], assignees: ["ada"] }),
  item({ title: "old chore", labels: ["ada", "setup"], createdAt: "2026-09-01T00:00:00Z" }),
  item({ title: "unkinded", assignees: ["ada"] }),
  item({ title: "asked", author: "ada" }),
  item({ title: "answered", author: "ada", lastComment: { author: "acme-ops", body: "done" } }),
  item({ title: "being worked", author: "ada", number: 55 }),
  item({ repo: "acme/qa", title: "peer ask", author: "acme-ops", labels: ["from-ops"] }),
  item({ title: "own work" }),
  item({ repo: "acme/web", role: "product", title: "contributor" }),
  item({ repo: "acme/web", role: "product", kind: "pr", title: "pr" }),
  item({ repo: "acme/web", role: "product", kind: "pr", title: "draft", draft: true }),
  item({
    title: "closed by staff",
    state: "CLOSED",
    closedAt: "2026-10-04T10:00:00Z",
    closedBy: "acme-ops",
    lastComment: { author: "acme-ops", body: "Closed by acme/web#9.\nmore" },
  }),
  item({
    title: "closed by ada",
    state: "CLOSED",
    closedAt: "2026-10-04T10:00:00Z",
    closedBy: "ada",
  }),
  item({
    title: "closed before",
    state: "CLOSED",
    closedAt: "2026-10-01T10:00:00Z",
    closedBy: "acme-ops",
  }),
];
const LIVE = [{ handle: "ops", running: [{ issue: 55, trigger: "mention" }] }];

test("every open item has exactly one place on Home", () => {
  const h = sortHome(ITEMS, staff, humans, LIVE, NOW);
  const open = ITEMS.filter((i) => i.state === "OPEN");
  const placed = [...h.needs, ...h.requests, ...h.staff, ...h.elsewhere].map((e: any) => e.item);
  assert.equal(placed.length, open.length, "an item was dropped or shown twice");
  assert.equal(new Set(placed).size, open.length);
});

test("what needs a person, oldest first, with its kind", () => {
  const h = sortHome(ITEMS, staff, humans, LIVE, NOW);
  assert.deepEqual(
    h.needs.map((e: any) => [e.item.title, e.kind]),
    [
      ["old chore", "chore"],
      ["decide", "decision"],
      ["unkinded", "ask"],
      ["pr", "merge"],
    ],
  );
});

test("a person's requests carry their state", () => {
  const h = sortHome(ITEMS, staff, humans, LIVE, NOW);
  const state = Object.fromEntries(h.requests.map((e: any) => [e.item.title, e.status]));
  assert.deepEqual(state, { asked: "waiting", answered: "answered", "being worked": "working" });
});

test("the rest is a staff member's own, or elsewhere", () => {
  const h = sortHome(ITEMS, staff, humans, LIVE, NOW);
  assert.deepEqual(
    h.staff.map((e: any) => [e.item.title, e.why]),
    [
      ["t", "status"],
      ["peer ask", "peer"],
      ["own work", "own"],
    ],
  );
  assert.deepEqual(
    h.elsewhere.map((e: any) => e.item.title),
    ["contributor", "draft"],
  );
});

test("closed today means a staff member closed it today, with their reason", () => {
  const h = sortHome(ITEMS, staff, humans, LIVE, NOW);
  assert.deepEqual(
    h.closedToday.map((e: any) => [e.item.title, e.reason]),
    [["closed by staff", "Closed by acme/web#9."]],
  );
});

test("days until a default, in the viewer's own calendar", () => {
  assert.equal(daysUntil("2026-10-04", NOW), 0);
  assert.equal(daysUntil("2026-10-07", NOW), 3);
  assert.equal(daysUntil("2026-10-02", NOW), -2);
});

test("each staff member's latest run report, from their status issue, if it is recent", () => {
  const status = (lastComment: unknown) => item({ number: 1, labels: ["keep-open"], lastComment });
  const recent = sortHome(
    [
      status({
        author: "acme-ops",
        createdAt: "2026-10-04T07:40:00Z",
        body: "@ada Shipped the fix.\nOn you: #4.\nNext: tests.",
      }),
    ],
    staff,
    humans,
    [],
    NOW,
  );
  assert.deepEqual(recent.reports[0].lines, ["Shipped the fix.", "On you: #4.", "Next: tests."]);
  assert.equal(recent.staff.length, 1, "and the status issue still has its one place");

  const old = sortHome(
    [status({ author: "acme-ops", createdAt: "2026-10-02T07:40:00Z", body: "x" })],
    staff,
    humans,
    [],
    NOW,
  );
  assert.equal(old.reports.length, 0, "a report from two days ago is not this morning's");
  const mine = sortHome(
    [status({ author: "ada", createdAt: "2026-10-04T08:00:00Z", body: "x" })],
    staff,
    humans,
    [],
    NOW,
  );
  assert.equal(mine.reports.length, 0, "a person's comment is not a report");
});

test("unread activity off Home's main lists still shows, newest first", () => {
  const h = sortHome(
    [
      item({
        title: "peer ask",
        repo: "acme/qa",
        labels: ["from-ops"],
        unread: { thread: "1" },
        updatedAt: "2026-10-03T00:00:00Z",
      }),
      item({ title: "own, read" }),
      item({
        title: "status",
        number: 1,
        labels: ["keep-open"],
        unread: { thread: "2" },
        updatedAt: "2026-10-04T00:00:00Z",
      }),
      item({ title: "decide", assignees: ["ada"], labels: ["decision"], unread: { thread: "3" } }),
    ],
    staff,
    humans,
    [],
    NOW,
  );
  assert.deepEqual(
    h.unread.map((e: any) => e.item.title),
    ["status", "peer ask"],
  );
  assert.equal(
    h.needs[0].item.unread.thread,
    "3",
    "an ask keeps its own mark, and is not listed twice",
  );
});
