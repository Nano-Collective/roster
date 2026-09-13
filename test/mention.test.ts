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

S.data = {
  org: "playpip",
  name: "Pip",
  opsName: "roster-ops",
  humans: [{ github: "will-lamerton", name: "Will", marker: "will", role: "founder" }],
  staff: [
    {
      handle: "cto",
      name: "Chief Technology Officer",
      mention: "@cto",
      brain: "playpip/technology",
      bots: ["playpip-cto", "playpip-robot"],
      soloBots: ["playpip-cto"],
      sharedBots: ["playpip-robot"],
    },
    {
      handle: "cmo",
      name: "Chief Marketing Officer",
      mention: "@cmo",
      brain: "playpip/marketing",
      bots: ["playpip-cmo", "playpip-robot"],
      soloBots: ["playpip-cmo"],
      sharedBots: ["playpip-robot"],
    },
  ],
};

/* ------------------------------- what is being typed ------------------------------ */

test("an @ at a word boundary opens the list, with or without anything after it", () => {
  assert.deepEqual(queryAt("@", 1), { query: "", start: 0 });
  assert.deepEqual(queryAt("ping @ct", 8), { query: "ct", start: 5 });
  assert.deepEqual(queryAt("(@cmo", 5), { query: "cmo", start: 1 });
});

test("an email address is not a mention", () => {
  // The one thing that would make this actively annoying: a popup over every address typed.
  assert.equal(queryAt("will@example.com", 16), null);
  assert.equal(queryAt("ping will@ex", 12), null);
});

test("the list is for the word the caret is in, not the last one on the line", () => {
  assert.equal(queryAt("@cto said yes", 13), null, "the mention is finished and behind us");
  assert.deepEqual(queryAt("@cto and @cm", 12), { query: "cm", start: 9 });
  // Caret in the middle of an earlier mention is still that mention.
  assert.deepEqual(queryAt("@cto and @cmo", 4), { query: "cto", start: 0 });
});

/* ------------------------------- who is offered ------------------------------ */

test("everybody is offered, staff first, because waking one is the point", () => {
  const all = mentionable();
  assert.deepEqual(
    all.map((c) => c.text),
    ["@cto", "@cmo", "@will-lamerton", "@playpip-cto", "@playpip-robot", "@playpip-cmo"],
  );
  assert.deepEqual(
    all.map((c) => c.kind),
    ["staff", "staff", "human", "bot", "bot", "bot"],
  );
});

test("the shared robot is listed once, not once per staff member", () => {
  const robots = mentionable().filter((c) => c.text === "@playpip-robot");
  assert.equal(robots.length, 1);
  assert.match(robots[0].note, /shared robot/);
});

test("every row says what mentioning it actually does", () => {
  const by = (text: string) => mentionable().find((c) => c.text === text)!;
  assert.match(by("@cto").note, /wakes them/);
  assert.match(by("@will-lamerton").note, /notifies them/);
  // The honest one: GitHub delivers nothing for mentioning an App, and the name looks exactly
  // as mentionable as the two above.
  assert.match(by("@playpip-cto").note, /notifies nobody/);
});

test("a handle, a name or a login all find the same person", () => {
  assert.equal(matches("ct")[0].text, "@cto");
  // Their title, not just their handle: "who is the marketing one" is the question you have
  // when you cannot remember whether it is @cmo or @marketing.
  assert.equal(matches("marketing")[0].text, "@cmo");
  assert.equal(matches("will")[0].text, "@will-lamerton");
});

test("a prefix beats a substring, so typing a handle offers that handle first", () => {
  // "cto" appears in the handle and inside `playpip-cto`; the one you meant is the staff member.
  assert.deepEqual(
    matches("cto").map((c) => c.text),
    ["@cto", "@playpip-cto"],
  );
});

test("nothing matching offers nothing, rather than the whole roster", () => {
  assert.deepEqual(matches("zzz"), []);
});
