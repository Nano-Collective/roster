import assert from "node:assert/strict";
import { test } from "node:test";

const dir = new URL("../templates/portal/js/", import.meta.url).href;
const { index, rank } = (await import(dir + "search.js")) as {
  index(state: any): any[];
  rank(entries: any[], q: string): Array<{ group: string; entries: any[]; more: number }>;
};

/* Not the author's own org. */
const STATE = {
  data: {
    staff: [
      {
        handle: "ops",
        name: "Head of Operations",
        brain: "acme/ops",
        facts: [
          {
            slug: "refunds-need-a-ticket",
            section: "Money",
            statement: "Every refund needs a ticket.",
            consequence: "never refund from chat",
          },
        ],
        surfaces: [
          {
            files: [
              { path: "memory/notes/refunds-need-a-ticket.md" },
              { path: "strategy/pricing.md" },
            ],
          },
        ],
      },
    ],
  },
  inbox: {
    items: [
      {
        repo: "acme/ops",
        kind: "issue",
        number: 4,
        title: "Refund policy for annual plans",
        state: "OPEN",
        labels: [],
        author: "ada",
        updatedAt: "2026-10-01T00:00:00Z",
      },
      {
        repo: "acme/web",
        kind: "pr",
        number: 9,
        title: "Refunds page copy",
        state: "MERGED",
        labels: [],
        author: "acme-robot",
        updatedAt: "2026-10-01T00:00:00Z",
      },
      {
        repo: "acme/ops",
        kind: "issue",
        number: 2,
        title: "Old refund thread",
        state: "CLOSED",
        labels: [],
        author: "ada",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ],
  },
  orgFiles: [{ path: "roster-ops/org/business.md" }],
  runs: {
    staff: [
      {
        handle: "ops",
        name: "Head of Operations",
        runs: [
          {
            id: 7,
            kind: "daily",
            conclusion: "failure",
            status: "completed",
            createdAt: "2026-10-01T00:00:00Z",
            url: "u",
          },
        ],
      },
    ],
  },
};

const groups = (q: string) =>
  Object.fromEntries(rank(index(STATE), q).map((g) => [g.group, g.entries.map((e) => e.title)]));

test("one query finds it wherever it is: issues, pull requests, memory, notes and files", () => {
  const g = groups("refund");
  assert.deepEqual(
    g.Issues,
    ["Refund policy for annual plans", "Old refund thread"],
    "open work before closed",
  );
  assert.deepEqual(g["Pull requests"], ["Refunds page copy"]);
  // A title that starts with the word outranks one where it comes later.
  assert.deepEqual(g.Memory, ["refunds-need-a-ticket.md", "Every refund needs a ticket."]);
});

test("every word has to match, in the title or what is behind it", () => {
  assert.deepEqual(groups("refund annual").Issues, ["Refund policy for annual plans"]);
  assert.deepEqual(
    groups("chat").Memory,
    ["Every refund needs a ticket."],
    "the consequence counts",
  );
  assert.equal(groups("refund zebra").Issues, undefined);
});

test("runs, org files and screens are found too", () => {
  assert.deepEqual(groups("failure").Runs, ["Head of Operations · daily run · failure"]);
  assert.deepEqual(groups("business").Org, ["business.md"]);
  assert.ok(groups("health").Screens?.includes("Head of Operations · Health"));
});

test("an empty query offers somewhere to go: screens and staff, nothing else", () => {
  assert.deepEqual(
    rank(index(STATE), "").map((g) => g.group),
    ["Screens", "Staff"],
  );
});

test("'more' counts only what is not shown", () => {
  for (const g of rank(index(STATE), "")) assert.equal(g.more, 0, g.group);
});
