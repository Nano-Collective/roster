import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { findWorkspace, loadComposer, readOrg } from "../src/lib/workspace.js";
import { buildExport } from "../src/lib/export.js";

/**
 * The portal has no build step and no browser in CI, so a runtime error in a render
 * function would ship silently: the server still answers 200 and the page is blank.
 *
 * This runs the page's own script against the real export, in a DOM shim thin enough to
 * be honest about what it proves — that every view renders without throwing, and produces
 * elements. It is not a substitute for looking at it.
 */

const ROOT = join(import.meta.dirname, "..");
const HTML = readFileSync(join(ROOT, "templates", "portal", "index.html"), "utf8");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(HTML)![1]!;
// Built from the live workspace rather than a fixture, so the test breaks when the real
// data grows a shape the portal cannot render — which is the failure worth catching.
const ws = findWorkspace(join(ROOT, ".."));
const { parseYaml } = await loadComposer(ws.opsDir);
const ORG = JSON.parse(JSON.stringify(buildExport(ws, readOrg(ws.opsDir, parseYaml) as any, parseYaml)));

function makeNode(tag: string): any {
  const node: any = {
    tagName: tag,
    children: [] as any[],
    style: {},
    dataset: {},
    // Real enough to be worth asserting on: classList.add used to be a no-op, so a test
    // could not tell a highlighted diff row from an ordinary one.
    classList: {
      add(...cs: string[]) {
        node.className = [node.className, ...cs].filter(Boolean).join(" ");
      },
      remove(...cs: string[]) {
        node.className = String(node.className ?? "").split(/\s+/).filter((c) => c && !cs.includes(c)).join(" ");
      },
      contains(c: string) {
        return String(node.className ?? "").split(/\s+/).includes(c);
      },
      toggle() {},
    },
    attributes: {} as Record<string, string>,
    _text: "",
    set textContent(v: string) {
      node._text = v;
      node.children.length = 0;
    },
    get textContent() {
      return node._text + node.children.map((c: any) => (typeof c === "string" ? c : c.textContent)).join("");
    },
    set innerHTML(v: string) {
      node._html = v;
    },
    get innerHTML() {
      return node._html ?? "";
    },
    append(...kids: any[]) {
      node.children.push(...kids);
    },
    replaceChildren(...kids: any[]) {
      node.children = kids;
    },
    insertAdjacentHTML(_pos: string, html: string) {
      node._html = (node._html ?? "") + html;
    },
    setAttribute(k: string, v: string) {
      node.attributes[k] = v;
    },
    getAttribute(k: string) {
      return node.attributes[k] ?? null;
    },
    removeAttribute(k: string) {
      delete node.attributes[k];
    },
    addEventListener() {},
    querySelector: () => makeNode("div"),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 900, height: 600, left: 0, top: 0 }),
    getContext: () => new Proxy({}, { get: () => () => ({}) }),
    focus() {},
    remove() {},
  };
  return node;
}

function harness(hash = "") {
  const saved: Array<[string, string]> = [];
  const pushes: string[] = [];
  const replaces: string[] = [];
  const byId: Record<string, any> = {};
  for (const id of ["orgname", "stafflist", "viewlist", "main"]) byId[id] = makeNode("div");
  const navs: any[] = [];

  const document: any = {
    createElement: (t: string) => makeNode(t),
    querySelector(sel: string) {
      if (sel.startsWith("#")) return (byId[sel.slice(1)] ??= makeNode("div"));
      return makeNode("div");
    },
    querySelectorAll: (sel: string) => (sel === ".nav" ? navs : []),
    documentElement: makeNode("html"),
    addEventListener() {},
  };

  const sandbox: any = {
    document,
    fetch: async (u: string) => ({
      ok: true,
      json: async () =>
        String(u).startsWith("/api/inbox")
          ? {
              repos: [{ name: "product", owner: "acme", role: "product" }],
              fetchedAt: new Date().toISOString(),
              errors: [],
              items: [
                { repo: "acme/product", role: "product", kind: "pr", number: 7, title: "An older pull request",
                  labels: ["build"], assignees: [], author: "bot", updatedAt: "2026-01-01T00:00:00Z",
                  url: "https://example.invalid/7", checks: "passing", state: "OPEN",
                  createdAt: "2026-01-01T00:00:00Z", body: "PR body", comments: [] },
                { repo: "acme/brain", role: "brain", kind: "issue", number: 3, title: "Needs a ruling",
                  labels: ["decision"], assignees: [String(ORG.human.github)], author: "bot",
                  updatedAt: "2026-06-01T00:00:00Z", url: "https://example.invalid/3", state: "OPEN",
                  createdAt: "2026-05-01T00:00:00Z", body: "| | ask |\n|---|---|\n| a | b |",
                  comments: [{ author: "cmo", createdAt: "2026-05-02T00:00:00Z", body: "a reply" }] },
              ],
            }
          : String(u).startsWith("/api/thread")
            ? { title: "Needs a ruling", body: "# Head\n\n- a point\n\n`code` and **bold**",
                author: "bot", createdAt: new Date().toISOString(), url: "https://example.invalid/3",
                state: "OPEN", comments: [{ author: "will", createdAt: new Date().toISOString(), body: "ok" }] }
            : ORG,
      text: async () => "sample",
    }),
    requestAnimationFrame: () => 0,
    confirm: () => true,
    addEventListener() {},
    setInterval: () => 0,
    devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
    localStorage: { getItem: () => null, setItem: (k: string, v: string) => saved.push([k, v]) },
    location: { hash },
    history: {
      pushState(_a: unknown, _b: unknown, url: string) { sandbox.location.hash = url; pushes.push(url); },
      replaceState(_a: unknown, _b: unknown, url: string) { sandbox.location.hash = url; replaces.push(url); },
    },
    URLSearchParams,
    Math,
    Date,
    JSON,
    console,
    encodeURIComponent,
    setTimeout,
    _byId: byId,
    _saved: saved,
    _pushes: pushes,
    _replaces: replaces,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

async function renderAll(hash = "") {
  const sandbox = harness(hash);
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: "portal.js" });
  // boot() is async and kicked off at load; wait for the fetch microtasks to settle.
  await new Promise((r) => setTimeout(r, 30));
  return sandbox;
}

test("boot renders without throwing and populates the sidebar", async () => {
  const s = await renderAll();
  assert.equal(s._byId.stafflist.children.length, 1, "the staff picker is one select, not a tab per staff member");
  assert.equal(s._byId.stafflist.children[0].children.length, ORG.staff.length, "one option per staff member");
  assert.ok(s._byId.viewlist.children.length >= 4, "expected the view switcher");
  assert.match(s._byId.orgname.textContent, /staff/);
});

test("every view renders and produces content", async () => {
  const s = await renderAll();
  for (const view of ["brain", "graph", "changed", "health", "roster"]) {
    s.view = view;
    assert.doesNotThrow(() => s.render(), `${view} threw`);
    assert.equal(s.view, view, "the harness must actually be driving the page's state");
    assert.ok(s._byId.main.children.length > 0, `${view} rendered nothing`);
  }
});

test("every view renders for every staff member", async () => {
  const s = await renderAll();
  for (const staff of ORG.staff) {
    s.staffHandle = staff.handle;
    for (const view of ["brain", "graph", "changed", "health"]) {
      s.view = view;
      assert.doesNotThrow(() => s.render(), `${staff.handle}/${view} threw`);
    }
  }
});

test("the theme toggle cycles system → light → dark and persists", async () => {
  const s = await renderAll();
  const root = s.document.documentElement;
  const btn = s._byId.theme;
  assert.equal(root.getAttribute("data-theme"), null, "system uses the media query, not an attribute");
  btn.onclick(); assert.equal(root.getAttribute("data-theme"), "light");
  btn.onclick(); assert.equal(root.getAttribute("data-theme"), "dark");
  btn.onclick(); assert.equal(root.getAttribute("data-theme"), null, "system must be reachable again");
  assert.deepEqual(s._saved, [["roster.theme", "light"], ["roster.theme", "dark"], ["roster.theme", "system"]]);
});

test("the URL carries the state, so a refresh lands where you were", async () => {
  const s = await renderAll();
  assert.match(s.location.hash, /^#\/[a-z]+\/brain$/, "boot should record staff and view");

  s.view = "graph";
  s.render();
  assert.match(s.location.hash, /\/graph$/);
  assert.ok(s._pushes.length >= 2, "a view change belongs in history");
});

test("a hash restores staff, view and filter on load", async () => {
  const handle = (ORG.staff[1] ?? ORG.staff[0]).handle;
  const s = await renderAll("#/" + handle + "/changed?q=drills");
  assert.equal(s.staffHandle, handle);
  assert.equal(s.view, "changed");
  assert.equal(s.changedQuery, "drills");
});

test("an unknown handle in the hash does not strand the page", async () => {
  const s = await renderAll("#/nobody/memory");
  assert.equal(s.staffHandle, ORG.staff[0].handle, "should fall back to the first staff member");
  assert.ok(s._byId.main.children.length > 0, "and still render");
});

test("the inbox renders, groups by repo and counts what is on the human", async () => {
  const s = await renderAll("#/x/inbox");
  assert.equal(s.view, "inbox");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(s._byId.main.children.length > 0, "inbox rendered nothing");
  assert.equal(s.INBOX.items.length, 2);
});

test("selecting a row deselects the previous one", async () => {
  // The screenshot bug: markCurrent cleared .tfile while the inbox rows are .irow, so every
  // row that had ever been clicked stayed highlighted.
  const s = await renderAll();
  const rows = [0, 1, 2].map(() => {
    const b = s.document.createElement("button");
    b.setAttribute("aria-current", "false");
    return b;
  });
  const list = { querySelectorAll: (sel: string) => (sel === '[aria-current="true"]' ? rows.filter((r) => r.getAttribute("aria-current") === "true") : []) };
  s.markCurrent(list, rows[0]);
  s.markCurrent(list, rows[1]);
  s.markCurrent(list, rows[2]);
  assert.deepEqual(rows.map((r) => r.getAttribute("aria-current")), ["false", "false", "true"]);
});

test("the inbox renders newest first", async () => {
  // The fixture is deliberately supplied oldest-first, so a list that just echoes the API
  // order would fail this.
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));

  const rows: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.innerHTML === "string" && n.innerHTML.includes("class=\"ititle\"")) rows.push(n.innerHTML);
    for (const c of n.children ?? []) walk(c);
  };
  walk(s._byId.main);

  assert.equal(rows.length, 2, "expected both fixture rows to render");
  const [first, second] = rows as [string, string];
  assert.ok(first.includes("Needs a ruling"), "the newer item must come first");
  assert.ok(second.includes("An older pull request"));
  assert.ok(first.includes("brain"), "each row should name its project");
});

test("a thread opens from data already loaded, with no extra request", async () => {
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));
  let calls = 0;
  s.fetch = async () => { calls++; return { ok: true, json: async () => ({}), text: async () => "" }; };

  // Rendering the whole view is what a click does; the point is that it costs no fetch.
  s.view = "inbox";
  s.inboxOpen = { repo: "acme/brain", number: 3, kind: "issue" };
  s.render();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0, "opening a thread must not hit the network");

  const html = JSON.stringify(s._byId.main);
  assert.ok(html.includes("a reply"), "the comment should already be there");
});

test("refreshAll re-fetches and re-renders, so a run that lands is visible", async () => {
  const s = await renderAll();
  let calls = 0;
  const first = s.DATA;
  s.fetch = async (u: string) => {
    if (String(u).startsWith("/api/org")) calls++;
    return { ok: true, json: async () => ({ ...first, generatedAt: "2030-01-01T00:00:00Z" }), text: async () => "" };
  };
  s.INBOX = { items: [], repos: [], errors: [] };
  await s.refreshAll(false);
  assert.equal(calls, 1, "org data must be re-fetched");
  assert.equal(s.DATA.generatedAt, "2030-01-01T00:00:00Z", "state must be replaced");
  assert.equal(s.INBOX, null, "the inbox must be invalidated so it refetches");
  assert.ok(s._byId.main.children.length > 0, "and the view re-rendered");
});

test("mdlite escapes before it formats", async () => {
  const s = await renderAll();
  const out = s.mdlite("<script>alert(1)</script> **b** `c` # Head\n- item");
  assert.ok(!out.includes("<script>"), "raw markup must not survive an issue body");
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("<b>b</b>") && out.includes("<code>c</code>"));
});

test("mdlite renders tables, which is most of what a status issue is", async () => {
  const s = await renderAll();
  // Without this the pinned issues render as a wall of pipes, which is what a screenshot
  // of the first version showed.
  const out = s.mdlite([
    "| | The ask |",
    "|---|---|",
    "| [#113](https://example.invalid/113) | **Merge first.** The `fast-uri` pin. |",
    "| #114 | Merge. Second row. |",
  ].join("\n"));
  assert.ok(out.includes("<table>"), "no table produced");
  assert.equal((out.match(/<tr>/g) ?? []).length, 3, "header plus two rows");
  assert.ok(out.includes("<b>Merge first.</b>"), "inline formatting inside a cell");
  assert.ok(out.includes("<code>fast-uri</code>"));
  assert.ok(out.includes('href="https://example.invalid/113"'));
  assert.ok(!/^\s*\|/m.test(out), "no raw pipes should survive");
});

test("mdlite handles the rest of an issue body without leaking pipes or markers", async () => {
  const s = await renderAll();
  const out = s.mdlite([
    "## Heading", "", "> a quote", "", "- [ ] unticked", "- [x] ticked",
    "1. first", "", "```", "code | with | pipes", "```", "", "---", "",
    "a paragraph that", "wraps over two source lines",
  ].join("\n"));
  assert.ok(out.includes("<h2>Heading</h2>"));
  assert.ok(out.includes("<blockquote>"));
  assert.ok(out.includes("☐") && out.includes("☑"));
  assert.ok(out.includes("<hr>"));
  assert.ok(out.includes("code | with | pipes"), "pipes inside a fence are content, not a table");
  assert.ok(out.includes("a paragraph that wraps over two source lines"), "hard wraps should join");
});

test("inline() escapes markup before formatting it", async () => {
  const s = await renderAll();
  const out = s.inline('<img src=x onerror=alert(1)> **bold** `code` [[a-slug]]');
  assert.ok(!out.includes("<img"), "raw HTML must not survive");
  assert.ok(out.includes("&lt;img"), "it should be escaped");
  assert.ok(out.includes("<b>bold</b>"));
  assert.ok(out.includes('data-goto="a-slug"'));
});

test("the graph collapses to a readable number of groups", () => {
  // The complaint the hierarchy exists to fix: 100+ loose nodes is not a picture. Every
  // node must land in exactly one group, and bundling must genuinely reduce the edges.
  for (const s of ORG.staff as any[]) {
    const bySlug = new Map(s.facts.map((f: any) => [f.slug, f]));
    const groupOf = (id: string) => {
      const f: any = bySlug.get(id);
      if (f) return f.section || "Ungrouped";
      return id.startsWith("#") ? "Issues" : s.notes.includes(id) ? "Notes" : "Files";
    };
    const ids = new Set<string>(s.facts.map((f: any) => f.slug));
    for (const l of s.links) { ids.add(l.from); ids.add(l.to); }

    const groups = new Set([...ids].map(groupOf));
    assert.ok(groups.size >= 3, `${s.handle}: too few groups to be useful`);
    assert.ok(groups.size <= 20, `${s.handle}: ${groups.size} groups is not a readable top level`);
    assert.ok(ids.size / groups.size > 4, `${s.handle}: groups are not actually collapsing anything`);

    const bundled = new Set<string>();
    for (const l of s.links) {
      const [a, b] = [groupOf(l.from), groupOf(l.to)].sort();
      if (a !== b) bundled.add(a + " ~ " + b);
    }
    assert.ok(bundled.size < s.links.length, `${s.handle}: bundling reduced nothing`);
    for (const f of s.facts) assert.ok(groups.has(f.section || "Ungrouped"), "every fact needs a group");
  }
});

test("an opened group fans outwards, clear of every other group", () => {
  // The complaint this answers: opened members landing in among the other group nodes.
  // Mirrors the fan geometry in drawGraph, so the numbers here move if that does.
  for (const s of ORG.staff as any[]) {
    const bySlug = new Map(s.facts.map((f: any) => [f.slug, f]));
    const groupOf = (id: string) => {
      const f: any = bySlug.get(id);
      return f ? (f.section || "Ungrouped") : id.startsWith("#") ? "Issues" : s.notes.includes(id) ? "Notes" : "Files";
    };
    const ids = new Set<string>(s.facts.map((f: any) => f.slug));
    for (const l of s.links) { ids.add(l.from); ids.add(l.to); }
    const members = new Map<string, string[]>();
    for (const id of ids) members.set(groupOf(id), [...(members.get(groupOf(id)) ?? []), id]);
    const groups = [...members.keys()].sort((a, b) => members.get(b)!.length - members.get(a)!.length);

    const RING = Math.max(340, groups.length * 84);
    const SECTOR = (Math.PI * 2) / groups.length;
    const gr = (n: number) => 16 + Math.sqrt(n) * 3.6;
    const gnode = new Map(groups.map((g, i) => {
      const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
      return [g, { angle, x: Math.cos(angle) * RING, y: Math.sin(angle) * RING, n: members.get(g)!.length }];
    }));

    for (const g of groups) {
      const gn = gnode.get(g)!;
      const n = gn.n;
      const perShell = Math.max(4, Math.ceil(Math.sqrt(n) * 1.15));
      for (let i = 0; i < n; i++) {
        const shell = Math.floor(i / perShell), inShell = i % perShell;
        const count = Math.min(perShell, n - shell * perShell);
        const spread = SECTOR * 0.66;
        const t = count === 1 ? 0 : (inShell / (count - 1) - 0.5) * spread;
        const a = gn.angle + t, r = RING + gr(n) + 210 + shell * 96;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;

        assert.ok(Math.hypot(x, y) > RING + 120, `${g}: a member did not clear the ring`);

        // The bug a screenshot caught: with 11 groups the slices are 33 degrees apart, and
        // the fan was up to 66 wide, so every fan swept across its neighbours. A fan must
        // stay inside its own slice.
        let off = Math.abs(a - gn.angle) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        assert.ok(off <= SECTOR / 2, `${g}: fan reaches into the neighbouring slice`);

        for (const other of groups) {
          if (other === g) continue;
          const o = gnode.get(other)!;
          assert.ok(
            Math.hypot(x - o.x, y - o.y) - gr(o.n) > 120,
            `${g}: a member landed too close to "${other}"`,
          );
        }
      }
    }
  }
});

/* Everything below covers the amendments: a readable diff, real markdown, one brain view,
   a health screen you can act on, and an inbox you can scope to one staff member. */

function walkNodes(n: any, out: any[] = []): any[] {
  if (!n || typeof n !== "object") return out;
  out.push(n);
  for (const c of n.children ?? []) walkNodes(c, out);
  return out;
}

const DIFF = [
  "diff --git a/memory/INDEX.md b/memory/INDEX.md",
  "index 1111111..2222222 100644",
  "--- a/memory/INDEX.md",
  "+++ b/memory/INDEX.md",
  "@@ -10,3 +10,3 @@ Coaching",
  " context line",
  "-- **`old-fact`** · it went",
  "+- **`new-fact`** · it arrived",
].join("\n");

test("a diff renders as coloured rows with line numbers, not as raw git output", async () => {
  const s = await renderAll();
  const blocks = s.renderDiff(DIFF, "new-fact");
  assert.equal(blocks.length, 1, "one block per file");

  const nodes = walkNodes(blocks[0]);
  const cls = (c: string) => nodes.filter((n) => String(n.className ?? "").split(/\s+/).includes(c));
  assert.equal(cls("dadd").length, 1, "the added line should be tagged as an addition");
  assert.equal(cls("ddel").length, 1, "and the removed line as a removal");
  assert.equal(cls("dhunk").length, 1);
  assert.equal(cls("dline").length, 4, "hunk, context, removal, addition");

  // The header lines git emits between files are noise once the filename is a heading.
  const text = nodes.map((n) => String(n._text ?? "")).join("\n");
  assert.ok(!text.includes("index 1111111"), "index lines should not survive");
  assert.ok(!text.includes("+++ b/memory"), "nor the +++/--- pair");
  const heading = nodes.filter((n) => String(n.className ?? "") === "dfile")[0];
  assert.ok(heading, "each file gets a heading");
  assert.ok(heading.innerHTML.includes("memory/INDEX.md"), "named after the file");
  assert.match(heading.innerHTML, /\+1/, "with what it added");
  assert.match(heading.innerHTML, /−1/, "and what it removed");

  const added = cls("dadd")[0];
  assert.deepEqual(added.children.map((c: any) => c.textContent), ["", "11", "- **`new-fact`** · it arrived"],
    "an addition numbers the new side only, and the leading + is the gutter's job");
  assert.ok(String(added.className).includes("dfocus"), "the fact you clicked should be marked");
});

test("a diff that touches nothing says so rather than rendering an empty box", async () => {
  const s = await renderAll();
  const out = s.renderDiff("", null);
  assert.equal(out.length, 1);
  assert.match(out[0].textContent, /changed nothing/);
});

test("mdlite nests a sub-list inside the bullet it belongs to", async () => {
  const s = await renderAll();
  const out = s.mdlite(["- top", "  - under", "- second"].join("\n"));
  assert.ok(out.includes("<ul><li>top<ul><li>under</li></ul></li><li>second</li></ul>"),
    "a sub-point should be a nested list, not a div with a left margin: " + out);
});

test("mdlite renders headings and fences as real elements", async () => {
  const s = await renderAll();
  const out = s.mdlite("## Heading\n\n```\ncode\n```\n\n1. one\n2. two");
  assert.ok(out.includes("<h2>Heading</h2>"));
  assert.ok(out.includes("<pre><code>code</code></pre>"));
  assert.ok(out.includes("<ol><li>one</li><li>two</li></ol>"));
});

test("issue and PR references become links you can click through to GitHub", async () => {
  const s = await renderAll();
  const out = s.mdlite("blocked by #113, and playpip/pip-web#7", { repo: "playpip/technology" });
  assert.ok(out.includes('href="https://github.com/playpip/technology/issues/113"'), out);
  assert.ok(out.includes('href="https://github.com/playpip/pip-web/issues/7"'), out);
  assert.equal((out.match(/class="ref"/g) ?? []).length, 2);
});

test("a bare github URL collapses to a chip that says which PR it is", async () => {
  const s = await renderAll();
  const out = s.mdlite("see https://github.com/playpip/pip-web/pull/98", { repo: "playpip/pip-web" });
  assert.ok(out.includes('class="ref pr"'), out);
  assert.ok(out.includes(">#98</a>"), "the repo is redundant when it is the one you are reading");
});

test("a reference inside a link does not become a link inside a link", async () => {
  // [#113](url) is how the status issues write these, and chipping the text first would
  // have produced an anchor nested in an anchor.
  const s = await renderAll();
  const out = s.mdlite("[#113](https://example.invalid/113)", { repo: "playpip/technology" });
  assert.equal((out.match(/<a\s/g) ?? []).length, 1, out);
  assert.ok(out.includes('href="https://example.invalid/113"'));
});

test("a relative image in a brain file resolves against the file, not the repo root", async () => {
  const s = await renderAll();
  const out = s.mdlite("![shot](../assets/x.png)", { file: { dir: "drafts/", staffDir: "marketing" } });
  assert.ok(out.includes("assets%2Fx.png"), out);
  assert.ok(out.includes("marketing"), "and it must be fetched from that staff member's checkout");
});

test("a markdown file in the brain renders as a document rather than as source", async () => {
  const s = await renderAll();
  s.fetch = async () => ({ ok: true, text: async () => "# Title\n\n- a\n  - b\n", json: async () => ({}) });
  const viewer = s.document.createElement("div");
  await s.show(viewer, { dir: "technology", brain: "playpip/technology" },
    { path: "strategy/plan.md", ext: "md", bytes: 20, modified: new Date().toISOString() });
  const html = viewer.children.map((c: any) => c.innerHTML ?? "").join("");
  assert.ok(html.includes("<h1>Title</h1>"), "the heading should be a heading: " + html);
  assert.ok(html.includes("<ul><li>a<ul><li>b</li></ul></li></ul>"));
});

test("the brain view lists memory beside the files and opens on memory", async () => {
  const s = await renderAll();
  s.view = "brain";
  s.openFile = null;
  s.fileQuery = "";
  s.render();

  const keys = walkNodes(s._byId.main).filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.ok(keys.includes("mem:*"), "memory should be in the tree: " + keys.slice(0, 8));
  assert.ok(keys.some((k: string) => k.startsWith("mem:") && k !== "mem:*"), "one row per section");
  assert.ok(keys.some((k: string) => k.endsWith(".md")), "and the files are in the same tree");
  assert.equal(s.openFile, "mem:*", "a brain opens on what it knows");
});

test("opening a fact shows its section with that fact lit", async () => {
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.facts.length) ?? ORG.staff[0];
  const fact = who.facts[0];
  s.staffHandle = who.handle;
  s.view = "brain";
  s.fileQuery = "";
  s.openFile = "fact:" + fact.slug;
  s.render();

  const lit = walkNodes(s._byId.main).filter((n) => String(n.className ?? "").split(/\s+/).includes("lit"));
  assert.equal(lit.length, 1, "exactly one fact should be marked");
  assert.equal(lit[0].id, "fact-" + fact.slug);
});

test("searching the brain searches facts and files at once", async () => {
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.facts.length) ?? ORG.staff[0];
  s.staffHandle = who.handle;
  s.view = "brain";
  s.openFile = "mem:*";
  s.fileQuery = who.facts[0].slug;
  s.render();

  const keys = walkNodes(s._byId.main).filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.ok(keys.includes("fact:" + who.facts[0].slug), "a matching fact should be offered directly");
  assert.ok(!keys.includes("mem:*"), "the section list gives way to the matches");
});

test("an old #/handle/memory link still lands somewhere", async () => {
  const s = await renderAll("#/" + ORG.staff[0].handle + "/memory");
  assert.equal(s.view, "brain", "memory is a surface of the brain now");
  assert.ok(s._byId.main.children.length > 0);
});

test("the inbox can be scoped to one staff member", async () => {
  const s = await renderAll();
  const cto = { handle: "cto", brain: "acme/brain", soloBots: ["cto-app"],
                sharedBots: ["robot"], worksIn: ["acme/product"] };
  const item = (over: any) => ({ repo: "acme/product", author: "someone", labels: [], assignees: [], ...over });

  assert.equal(s.belongsTo(item({ repo: "acme/brain" }), cto), true, "their own brain");
  assert.equal(s.belongsTo(item({ author: "cto-app" }), cto), true, "anything their own app wrote");
  assert.equal(s.belongsTo(item({ labels: ["from-cto"] }), cto), true, "anything a peer addressed to them");
  assert.equal(s.belongsTo(item({ assignees: ["cto-app"] }), cto), true, "anything assigned to them");
  assert.equal(s.belongsTo(item({ author: "robot" }), cto), true, "the shared robot, in a repo they work in");
  assert.equal(s.belongsTo(item({ author: "robot", repo: "acme/elsewhere" }), cto), false,
    "but not the shared robot somewhere they have no business");
  assert.equal(s.belongsTo(item({}), cto), false, "and nothing else");
  assert.equal(s.belongsTo(item({}), null), true, "Everyone is not a filter");
});

test("a bot identity is matched however the manifest spells it", async () => {
  // staff.yaml says pip-cto[bot]; GitHub reports the author as pip-cto. Getting this wrong
  // silently disabled the whole author rule.
  for (const who of ORG.staff) {
    for (const b of who.bots) assert.ok(!b.endsWith("[bot]"), b + " should be normalised in the export");
  }
  const shared = ORG.staff.flatMap((x: any) => x.sharedBots);
  const solo = ORG.staff.flatMap((x: any) => x.soloBots);
  assert.ok(solo.length >= ORG.staff.length, "each staff member needs an identity of their own");
  for (const b of shared) assert.ok(!solo.includes(b), b + " cannot be both shared and exclusive");
});

test("a cron line is rendered in words", async () => {
  const s = await renderAll();
  assert.equal(s.cronText("0 7 * * 1-5"), "07:00 UTC · Mon–Fri");
  assert.equal(s.cronText("40 7 * * 0,6"), "07:40 UTC · Sun, Sat");
  assert.equal(s.cronText("*/5 * * * *"), "*/5 * * * *", "an unusual spec is shown as written");
  assert.equal(s.cronText(""), "no schedule");
});

test("health shows the rig, and every problem comes with a way to ask for a fix", async () => {
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.problems.length) ?? ORG.staff[0];
  s.staffHandle = who.handle;
  s.view = "health";
  s.render();

  const nodes = walkNodes(s._byId.main);
  const all = nodes.map((n) => String(n.innerHTML ?? "") + String(n._text ?? "")).join(" ");
  for (const label of ["Runs", "Last commit", "Last thought", "Memory", "Charter"]) {
    assert.ok(all.includes(label), label + " should be on the health screen");
  }
  const asks = nodes.filter((n) => String(n.textContent ?? "").startsWith("Ask "));
  if (who.problems.length) {
    assert.ok(asks.length >= who.problems.length, "one ask per problem, plus a fix-all");
  }
});

test("asking an agent to fix lint opens one issue in its own repo", async () => {
  const s = await renderAll();
  const sent: any[] = [];
  s.fetch = async (u: string, init: any) => {
    sent.push({ u, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ url: "https://github.com/playpip/technology/issues/9" }) };
  };
  const btn = s.document.createElement("button");
  const status = s.document.createElement("span");
  await s.askToFix({ brain: "playpip/technology", handle: "cto" }, [
    { level: "warning", rule: "too-long", message: "`a-fact` is 550 characters.", line: 12, slug: "a-fact" },
    { level: "error", rule: "dangling-note", message: "`b` links notes/b.md, which does not exist.", line: 30 },
  ], btn, status);

  assert.equal(sent.length, 1, "one issue, not one per problem");
  assert.equal(sent[0].u, "/api/act");
  assert.equal(sent[0].body.action, "create");
  assert.equal(sent[0].body.repo, "playpip/technology", "it goes to their brain, not the ops repo");
  assert.match(sent[0].body.title, /2 problems/);
  assert.match(sent[0].body.body, /INDEX.md:12/);
  assert.match(sent[0].body.body, /dangling-note/);
});

test("a staff member with no brain repo cannot have an issue opened against nothing", async () => {
  const s = await renderAll();
  let called = false;
  s.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const status = s.document.createElement("span");
  await s.askToFix({ handle: "cto" }, [{ level: "error", rule: "x", message: "y" }],
    s.document.createElement("button"), status);
  assert.equal(called, false);
  assert.match(status.textContent, /no brain repo/);
});
