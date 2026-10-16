import assert from "node:assert/strict";
import { test } from "node:test";
import { readHumans as readHumansTs } from "../src/lib/humans.js";
import { signed } from "../src/lib/inbox.js";
// @ts-expect-error - plain JS, no types by design
import { handlesList, readHumans } from "../templates/ops/compose.mjs";

const dir = new URL("../templates/portal/js/", import.meta.url).href;
const { parseReport } = (await import(dir + "report.js")) as { parseReport(body: string): any };
const { whoFor, isFor } = (await import(dir + "homesort.js")) as {
  whoFor(item: any, humans: any[]): string[];
  isFor(entry: any, login: string | null): boolean;
};
const { mdlite } = (await import(dir + "md.js")) as { mdlite(src: string, opts?: any): string };

/* ------------------------------- reports -------------------------------- */

test("a report in the new shape comes apart into status, line and sections", () => {
  const r = parseReport(
    [
      "Updated 2026-10-16 09:00 UTC.",
      "",
      "**Status: needs you.** Sign-ups are up; two changes wait on a merge.",
      "",
      "## Done",
      "- Sign-up works on phones again",
      "- The pricing page shows local prices",
      "",
      "## Working on",
      "1. **Grow memberships:** 0 paid.",
      "",
      "## Needs you",
      "- #12: press Merge",
      "",
      "## Next",
      "- Nothing.",
    ].join("\n"),
  );
  assert.equal(r.status, "needs you");
  assert.equal(r.headline, "Sign-ups are up; two changes wait on a merge.");
  assert.deepEqual(r.sections.done, [
    "Sign-up works on phones again",
    "The pricing page shows local prices",
  ]);
  assert.deepEqual(r.sections.working, ["**Grow memberships:** 0 paid."]);
  assert.deepEqual(r.sections.needs, ["#12: press Merge"]);
  assert.deepEqual(r.sections.next, [], "an empty section is no section");
});

test("a report in the old shape still gives a headline and its sections", () => {
  const r = parseReport(
    "Updated 2026-10-15 12:26 UTC.\n\nLive is v1.27.24.\n\n## On you, oldest first\n\n- #228\n\n## Next from me\n\nFix win %.",
  );
  assert.equal(r.status, "");
  assert.equal(r.headline, "Live is v1.27.24.");
  assert.deepEqual(r.sections.needs, ["#228"]);
  assert.deepEqual(r.sections.next, ["Fix win %."]);
});

/* ------------------------------ who it is for ----------------------------- */

const humans = [
  { github: "ada", marker: "ada" },
  { github: "bo", marker: "bo" },
];

test("an ask is for whoever it is assigned to or labelled for, else everybody", () => {
  assert.deepEqual(whoFor({ assignees: ["Bo"], labels: [] }, humans), ["bo"]);
  assert.deepEqual(whoFor({ assignees: [], labels: ["ada", "decision"] }, humans), ["ada"]);
  assert.deepEqual(whoFor({ assignees: [], labels: [] }, humans), []);
  assert.equal(isFor({ for: ["bo"] }, "ada"), false);
  assert.equal(isFor({ for: ["bo"] }, "BO"), true);
  assert.equal(isFor({ for: [] }, "ada"), true, "nobody in particular is everybody's");
  assert.equal(isFor({ for: ["bo"] }, null), true, "with nobody signed in, everything shows");
});

test("handles is read from a list or a string, the same in both readers", () => {
  const org = {
    humans: [
      { name: "Ada", github: "ada", handles: ["code", "deploys"] },
      { name: "Bo", github: "bo", handles: "marketing, social" },
    ],
  };
  assert.deepEqual(readHumans(org)[1].handles, ["marketing", "social"]);
  assert.deepEqual(readHumansTs(org)[0]!.handles, ["code", "deploys"]);
  const list = handlesList(readHumans(org));
  assert.match(list, /\*\*Ada\*\* \(@ada, label `ada`\): code, deploys/);
  assert.match(list, /\*\*Bo\*\* \(@bo, label `bo`\): marketing, social/);
  assert.equal(
    handlesList(readHumans({ humans: [org.humans[0]] })),
    "",
    "one person needs no routing",
  );
});

/* --------------------------------- images --------------------------------- */

test("a private repo's attachment links are swapped for GitHub's signed copies", () => {
  const id = "25833cae-612e-4529-8a98-dbfcb5c96e7b";
  const body = `See:\n\n<img alt="Image" src="https://github.com/user-attachments/assets/${id}" />`;
  const html = `<a href="x"><img alt="Image" src="https://private-user-images.githubusercontent.com/1/2-${id}.png?jwt=a.b&amp;c=d"></a>`;
  const out = signed(body, html);
  assert.ok(
    out.includes(`https://private-user-images.githubusercontent.com/1/2-${id}.png?jwt=a.b&c=d`),
  );
  assert.ok(!out.includes("user-attachments"));
  assert.equal(signed(body, "<p>public</p>"), body, "nothing signed, nothing changed");
});

test("an <img> tag in a comment renders as an image, not its alt text", () => {
  const html = mdlite('Look <img width="300" alt="Image" src="https://example.com/a.png" />');
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="Image"/);
  assert.ok(!mdlite('<img src="javascript:alert(1)">').includes("<img"), "only http(s)");
});
