import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadComposer, readOrg, type Workspace } from "../src/lib/workspace.js";
import { testWorkspace } from "./helpers/workspace.js";

/* Built rather than written, for the same reason textdiff's is: the portal ships plain ES
   modules with no types, so a literal specifier makes tsc resolve declarations that do not
   exist. */
const { yamlHTML, yamlHTMLFromEscaped } = (await import(
  new URL("../templates/portal/js/yaml.js", import.meta.url).href
)) as {
  yamlHTML(text: string): string;
  yamlHTMLFromEscaped(escaped: string): string;
};

/**
 * `org.yaml` and `staff.yaml` are the two files in the portal anybody reads closely, and they
 * were served as one flat grey wall.
 *
 * The highlighter is a tokeniser rather than a parser, so the thing worth testing is not that
 * it understands YAML — it does not — but that it never lies about a file and never puts
 * markup on the page. The last one matters: it writes `innerHTML`, and a manifest is a file
 * anybody can edit.
 */

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

test("the source survives: strip the markup and the file is back", () => {
  const src = [
    "# who and what",
    "org: acme",
    "human:",
    "  name: Will",
    "  marker: will   # the tag on a ruling",
    "staff:",
    '  - { handle: cto, name: "Chief, Technology", schedule: "0 7 * * 1-5" }',
    "defaults:",
    "  allowed_tools: [Bash, Read]",
    "  timeout_minutes: 90",
    "  experiment_private: true",
  ].join("\n");
  assert.equal(text(yamlHTML(src)), src);
});

test("keys, values, comments and numbers are told apart", () => {
  const html = yamlHTML("org: acme   # the github org\ntimeout_minutes: 90\nfirst: true");
  assert.match(html, /<span class="yk">org<\/span>/, "keys");
  assert.match(html, /<span class="yc"># the github org<\/span>/, "comments");
  assert.match(html, /<span class="yn">90<\/span>/, "numbers");
  assert.match(html, /<span class="yb">true<\/span>/, "keywords");
});

test("a key inside an inline map is a key", () => {
  // The staff registry is written this way, so a list of inline maps is the common case.
  const html = yamlHTML("staff:\n  - { handle: cto, dir: technology }");
  assert.match(html, /<span class="yk">handle<\/span>/);
  assert.match(html, /<span class="yk">dir<\/span>/);
});

test("a # inside a string is not a comment", () => {
  const html = yamlHTML('name: "acme #1"   # but this is');
  assert.match(html, /<span class="ys">&quot;acme #1&quot;<\/span>/);
  assert.equal((html.match(/class="yc"/g) ?? []).length, 1);
});

test("nothing in a file can put markup on the page", () => {
  /* It writes innerHTML, and a manifest is a file anybody can edit. This is the one failure
     here that is not cosmetic. */
  const html = yamlHTML('name: <img src=x onerror="alert(1)">\n# <script>alert(2)</script>');
  assert.ok(!/<img|<script/.test(html), html);
  assert.match(html, /&lt;img/);
});

test("markdown hands it text that is already escaped, and gets it back intact", () => {
  const html = yamlHTMLFromEscaped("name: &quot;a &lt;b&gt;&quot;");
  assert.equal(text(html), 'name: "a <b>"');
  assert.ok(!/<b>/.test(html), "the un-escape must not leak a tag back onto the page");
});

test("the real org.yaml comes back unchanged, character for character", async () => {
  // A fixture cannot catch a construction this tenant actually uses and the tokeniser eats.
  const ws: Workspace = await testWorkspace();
  const src = readFileSync(join(ws.opsDir, "org.yaml"), "utf8");
  assert.equal(text(yamlHTML(src)), src);

  // And the highlighting is about the file it is looking at: every key it found is a real one.
  const org = readOrg(ws.opsDir, (await loadComposer(ws.opsDir)).parseYaml) as Record<
    string,
    unknown
  >;
  const html = yamlHTML(src);
  for (const key of Object.keys(org)) {
    assert.match(html, new RegExp(`<span class="yk">${key}</span>`), `${key} was not marked`);
  }
});
