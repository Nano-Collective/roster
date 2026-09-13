import assert from "node:assert/strict";
import { test } from "node:test";

/* Built rather than written: the portal ships plain ES modules with no types, so a literal
   specifier makes tsc resolve declarations that do not exist. */
const dir = new URL("../templates/portal/js/", import.meta.url).href;
const { queryAt, matches, mentionable } = (await import(dir + "mention.js")) as {
  queryAt(text: string, caret: number): { query: string; start: number } | null;
  matches(query: string, all?: any[]): any[];
  mentionable(): any[];
};
const { S } = (await import(dir + "state.js")) as { S: Record<string, any> };

/**
 * A mention is not decoration: a staff member's workflow gates on their `@handle`, so a reply
 * that misspells one is a reply nobody is woken by, and one that uses a bot's login where a
 * handle belongs looks right and does nothing. Both fail silently, which is why the list is
 * offered rather than remembered — and why these tests care most about what it refuses to
 * offer and what each row claims.
 */

/* Deliberately not a C-suite, and deliberately not the org this was written in. Nothing in the
   portal may assume an org has a "cto": roster scaffolds whatever the org.yaml says, and a
   fixture that looks like the author's own tenant is how that assumption gets made by accident
   and never noticed. */
S.data = {
  org: "acme",
  name: "Acme Robotics",
  opsName: "roster-ops",
  humans: [
    { github: "ada-l", name: "Ada", marker: "ada", role: "founder" },
    { github: "grace-h", name: "Grace", marker: "grace" },
  ],
  staff: [
    {
      handle: "ops",
      name: "Head of Operations",
      mention: "@ops",
      brain: "acme/operations",
      bots: ["acme-ops", "acme-robot"],
      soloBots: ["acme-ops"],
      sharedBots: ["acme-robot"],
    },
    {
      handle: "design",
      name: "Design Lead",
      mention: "@design",
      brain: "acme/design",
      bots: ["acme-design", "acme-robot"],
      soloBots: ["acme-design"],
      sharedBots: ["acme-robot"],
    },
  ],
};

/** The default roster, for the tests that swap it out and put it back. */
const STAFF = S.data.staff;

/* ------------------------------- what is being typed ------------------------------ */

test("an @ at a word boundary opens the list, with or without anything after it", () => {
  assert.deepEqual(queryAt("@", 1), { query: "", start: 0 });
  assert.deepEqual(queryAt("ping @op", 8), { query: "op", start: 5 });
  assert.deepEqual(queryAt("(@design", 8), { query: "design", start: 1 });
});

test("an email address is not a mention", () => {
  // The one thing that would make this actively annoying: a popup over every address typed.
  assert.equal(queryAt("ada@example.com", 15), null);
  assert.equal(queryAt("ping ada@ex", 11), null);
});

test("the list is for the word the caret is in, not the last one on the line", () => {
  assert.equal(queryAt("@ops said yes", 13), null, "the mention is finished and behind us");
  assert.deepEqual(queryAt("@ops and @de", 12), { query: "de", start: 9 });
  // Caret in the middle of an earlier mention is still that mention.
  assert.deepEqual(queryAt("@ops and @design", 4), { query: "ops", start: 0 });
});

/* ------------------------------- who is offered ------------------------------ */

test("only what a mention reaches: the staff and the humans", () => {
  /* The Apps are the point of this one. `@acme-ops` is a login, not an inbox: GitHub delivers
     nothing for mentioning an App, and an agent wakes on its own handle rather than on the
     identity it posts as. Offering them put four dead entries above the live ones. */
  assert.deepEqual(
    mentionable().map((c) => c.text),
    ["@ops", "@design", "@ada-l", "@grace-h"],
  );
  const logins = mentionable().map((c) => c.text);
  for (const bot of ["@acme-ops", "@acme-design", "@acme-robot"]) {
    assert.ok(!logins.includes(bot), bot + " notifies nobody and must not be offered");
  }
});

test("staff come first, because waking one is the point", () => {
  assert.deepEqual(
    mentionable().map((c) => c.kind),
    ["staff", "staff", "human", "human"],
  );
});

test("every human is offered, not just the first", () => {
  // An org can answer to more than one person; a list that stops at the first is the same
  // silent failure the mention gate used to have.
  const humans = mentionable().filter((c) => c.kind === "human");
  assert.deepEqual(
    humans.map((c) => c.text),
    ["@ada-l", "@grace-h"],
  );
});

test("every row says what mentioning it actually does", () => {
  const by = (text: string) => mentionable().find((c) => c.text === text)!;
  assert.match(by("@ops").note, /wakes them/);
  assert.match(by("@ada-l").note, /founder · notifies them/);
  assert.match(by("@grace-h").note, /notifies them/, "a role is optional; the effect is not");
});

test("nothing here knows what a staff member is called", () => {
  /* The roster is whatever org.yaml says. This org has a head of ops and a designer, the next
     has something else, and no part of this file may care. */
  S.data.staff = [{ handle: "chef", name: "Head Chef", mention: "@chef", brain: "acme/kitchen" }];
  assert.deepEqual(
    mentionable()
      .filter((c) => c.kind === "staff")
      .map((c) => c.text),
    ["@chef"],
  );
  assert.equal(matches("chef")[0].text, "@chef");
  S.data.staff = STAFF;
});

test("a handle, a name or a login all find the same person", () => {
  assert.equal(matches("op")[0].text, "@ops");
  // Their title, not just their handle: "who is the design one" is the question you have when
  // you cannot remember the handle.
  assert.equal(matches("design lead")[0].text, "@design");
  assert.equal(matches("ada")[0].text, "@ada-l");
});

test("a prefix beats a substring, so typing a handle offers that handle first", () => {
  S.data.staff = [
    { handle: "ops", name: "Head of Operations", mention: "@ops", brain: "acme/operations" },
    { handle: "devops", name: "Platform", mention: "@devops", brain: "acme/platform" },
  ];
  assert.deepEqual(
    matches("ops")
      .filter((c) => c.kind === "staff")
      .map((c) => c.text),
    ["@ops", "@devops"],
  );
  S.data.staff = STAFF;
});

test("nothing matching offers nothing, rather than the whole roster", () => {
  assert.deepEqual(matches("zzz"), []);
});
