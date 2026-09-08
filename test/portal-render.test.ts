import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { buildExport } from "../src/lib/export.js";
import { findWorkspace, loadComposer, readOrg } from "../src/lib/workspace.js";

/**
 * The portal has no build step and no browser in CI, so a runtime error in a render
 * function would ship silently: the server still answers 200 and the page is blank.
 *
 * This runs the page's own modules against the real export, in a DOM shim thin enough to
 * be honest about what it proves — that every view renders without throwing, and produces
 * elements. It is not a substitute for looking at it.
 *
 * The UI used to be one HTML file, and this used to extract its `<script>` with a regex and
 * run it in a `vm` context. It is now a shell plus a dozen ES modules, so the shim is
 * installed on `globalThis` and the modules are imported for real. `sandbox` keeps the
 * property names the old harness used — `s.view`, `s.DATA`, `s.INBOX` — mapped onto the
 * state object the modules share, so what these tests assert did not have to move with it.
 */

const ROOT = join(import.meta.dirname, "..");
// Built from the live workspace rather than a fixture, so the test breaks when the real
// data grows a shape the portal cannot render — which is the failure worth catching.
const ws = findWorkspace(join(ROOT, ".."));
const { parseYaml } = await loadComposer(ws.opsDir);
const ORG = JSON.parse(
  JSON.stringify(buildExport(ws, readOrg(ws.opsDir, parseYaml) as any, parseYaml)),
);

function makeNode(tag: string): any {
  const node: any = {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    style: {},
    dataset: {},
    hidden: false,
    // Real enough to be worth asserting on: classList.add used to be a no-op, so a test
    // could not tell a highlighted diff row from an ordinary one.
    classList: {
      add(...cs: string[]) {
        node.className = [node.className, ...cs].filter(Boolean).join(" ");
      },
      remove(...cs: string[]) {
        node.className = String(node.className ?? "")
          .split(/\s+/)
          .filter((c) => c && !cs.includes(c))
          .join(" ");
      },
      contains(c: string) {
        return String(node.className ?? "")
          .split(/\s+/)
          .includes(c);
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
      return (
        node._text +
        node.children.map((c: any) => (typeof c === "string" ? c : c.textContent)).join("")
      );
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
    isConnected: true,
  };
  return node;
}

/** The fixture inbox. Threads are timelines now, not just comments. */
const INBOX_FIXTURE = {
  repos: [{ name: "product", owner: "acme", role: "product" }],
  fetchedAt: new Date().toISOString(),
  errors: [],
  items: [
    {
      repo: "acme/product",
      role: "product",
      kind: "pr",
      number: 7,
      title: "An older pull request",
      labels: ["build"],
      assignees: [],
      author: "bot",
      updatedAt: "2026-01-01T00:00:00Z",
      url: "https://example.invalid/7",
      checks: "passing",
      state: "OPEN",
      createdAt: "2026-01-01T00:00:00Z",
      body: "PR body",
      comments: [],
      events: [],
    },
    {
      repo: "acme/brain",
      role: "brain",
      kind: "issue",
      number: 3,
      title: "Needs a ruling",
      labels: ["decision"],
      assignees: [],
      author: "bot",
      updatedAt: "2026-06-01T00:00:00Z",
      url: "https://example.invalid/3",
      state: "OPEN",
      createdAt: "2026-05-01T00:00:00Z",
      body: "| | ask |\n|---|---|\n| a | b |",
      comments: [{ author: "cmo", createdAt: "2026-05-02T00:00:00Z", body: "a reply" }],
      events: [
        { type: "labeled", actor: "cmo", createdAt: "2026-05-02T00:00:00Z", label: "decision" },
        { type: "assigned", actor: "cmo", createdAt: "2026-05-02T00:00:00Z", assignee: "will" },
        { type: "comment", actor: "cmo", createdAt: "2026-05-02T00:00:00Z", body: "a reply" },
        {
          type: "referenced",
          actor: "cto",
          createdAt: "2026-05-03T00:00:00Z",
          commit: {
            sha: "ac2f197",
            subject: "ruling: it is a mode, not a kind",
            url: "https://example.invalid/c",
          },
        },
        {
          type: "cross-referenced",
          actor: "cto",
          createdAt: "2026-05-04T00:00:00Z",
          source: {
            repo: "acme/product",
            number: 7,
            title: "An older pull request",
            url: "https://example.invalid/7",
            state: "OPEN",
            kind: "pr",
          },
        },
      ],
    },
    {
      repo: "acme/brain",
      role: "brain",
      kind: "issue",
      number: 2,
      title: "Something already settled",
      labels: [],
      assignees: [],
      author: "bot",
      updatedAt: "2026-05-20T00:00:00Z",
      url: "https://example.invalid/2",
      state: "CLOSED",
      createdAt: "2026-04-01T00:00:00Z",
      body: "done",
      comments: [],
      events: [],
    },
    {
      repo: "acme/product",
      role: "product",
      kind: "pr",
      number: 6,
      title: "A pull request that landed",
      labels: [],
      assignees: [],
      author: "bot",
      updatedAt: "2026-05-19T00:00:00Z",
      url: "https://example.invalid/6",
      state: "MERGED",
      createdAt: "2026-04-01T00:00:00Z",
      body: "shipped",
      comments: [],
      events: [],
    },
  ],
};

/** A composed prompt and the layers behind it, as /api/prompt shapes them. */
const PROMPT_FIXTURE = {
  staff: "cto",
  kind: "daily",
  composed: "# You are the CTO\n\nDo a day's work, then hand off.\n",
  layers: [
    {
      rel: "prompts/daily.md",
      path: "roster-ops/prompts/daily.md",
      repo: "roster-ops",
      bytes: 4598,
      optional: false,
      missing: false,
      editable: true,
    },
    {
      rel: "org/voice.md",
      path: "roster-ops/org/voice.md",
      repo: "roster-ops",
      bytes: 3170,
      optional: false,
      missing: false,
      editable: true,
    },
    {
      rel: "staff:prompts/boot.md",
      path: "technology/prompts/boot.md",
      repo: "technology",
      bytes: 0,
      optional: true,
      missing: true,
      editable: false,
    },
  ],
  runtime: [
    {
      rel: "CHARTER.md",
      path: "technology/CHARTER.md",
      repo: "technology",
      bytes: 5802,
      optional: false,
      missing: false,
      editable: true,
    },
    {
      rel: "memory/INDEX.md",
      path: "technology/memory/INDEX.md",
      repo: "technology",
      bytes: 35148,
      optional: false,
      missing: false,
      editable: false,
    },
  ],
  /* An empty list here is how a ReferenceError in the problem renderer shipped: the code path
     never ran, so every view test passed and the screen was blank in a browser. */
  problems: [
    {
      id: "stub",
      level: "error",
      title: "business.md is still the scaffold",
      detail: "Every run is composed on top of it.",
      path: "roster-ops/org/business.md",
      want: "`roster-ops/org/business.md` is still the scaffold. Interview me and write it.",
    },
    {
      id: "echo",
      level: "warning",
      title: "2 lines said in more than one layer",
      detail: "The same rule is stated twice on every run.",
      want: "These lines appear in more than one layer. Decide where each belongs.",
    },
  ],
};

/** Whatever the URL asks for, out of fixtures. Overridable per test via `s.fetch`. */
function fixtureFetch(u: string) {
  const url = String(u);
  return {
    ok: true,
    json: async () =>
      url.startsWith("/api/inbox")
        ? INBOX_FIXTURE
        : url.startsWith("/api/docs")
          ? [
              { file: "README.md", title: "Overview" },
              { file: "agents.md", title: "Choosing a coding agent" },
            ]
          : url.startsWith("/api/staff/plan")
            ? url.includes("action=retire")
              ? {
                  action: "retire",
                  plan: {
                    handle: "cmo",
                    name: "Chief Marketing Officer",
                    dir: "marketing",
                    brain: "acme/marketing",
                    workflows: ["cmo-daily.yaml", "cmo-mention.yaml"],
                    peers: [
                      {
                        handle: "cto",
                        dir: "technology",
                        brain: "acme/technology",
                        label: "from-cmo",
                      },
                    ],
                    keeps: [
                      "acme/marketing is untouched",
                      "103 facts and everything in memory/notes/",
                    ],
                    warnings: [],
                  },
                }
              : {
                  action: "hire",
                  plan: {
                    dir: "finance",
                    files: ["CHARTER.md", "staff.yaml"],
                    labels: ["will", "cfo"],
                    secrets: ["CFO_APP_ID"],
                    peers: [
                      {
                        handle: "cto",
                        dir: "technology",
                        brain: "acme/technology",
                        label: "from-cfo",
                      },
                    ],
                    warnings: ["schedule was chosen to sit clear of everyone else's"],
                    staff: {
                      handle: "cfo",
                      name: "Chief Financial Officer",
                      brain: "acme/finance",
                      schedule: "0 9 * * 1-5",
                      model: "a-model",
                    },
                  },
                }
            : url.startsWith("/api/prompt")
              ? PROMPT_FIXTURE
              : url.startsWith("/api/thread")
                ? INBOX_FIXTURE.items[1]
                : url.startsWith("/api/sync")
                  ? { results: [] }
                  : ORG,
    text: async () =>
      url.startsWith("/api/doc?")
        ? "# Choosing a coding agent\n\nSee [manual steps](manual-steps.md).\n"
        : "sample",
  };
}

/** Put a DOM under the modules. Returns the handles the assertions poke at. */
function install(hash: string) {
  const asked: string[] = [];
  const saved: Array<[string, string]> = [];
  const pushes: string[] = [];
  const replaces: string[] = [];
  const byId: Record<string, any> = {};
  const navs: any[] = [];

  const document: any = {
    createElement: (t: string) => makeNode(t),
    querySelector(sel: string) {
      // Lazily creating the node on lookup is the shim's whole behaviour here.
      // biome-ignore lint/suspicious/noAssignInExpressions: a temporary would only spell it out longer
      if (sel.startsWith("#")) return (byId[sel.slice(1)] ??= makeNode("div"));
      return makeNode("div");
    },
    querySelectorAll: (sel: string) => (sel === ".nav" ? navs : []),
    documentElement: makeNode("html"),
    addEventListener() {},
  };

  const g = globalThis as any;
  g.document = document;
  g.fetch = async (u: string) => fixtureFetch(u);
  g.requestAnimationFrame = () => 0;
  g.confirm = () => true;
  /* No <dialog> in the shim, so askText falls back to prompt(). Recording what it was asked
     is how the pre-filled value gets checked. */
  g.prompt = (_title: string, value: string) => {
    asked.push(value ?? "");
    return "make it shorter";
  };
  g.open = () => null;
  g.addEventListener = () => {};
  // boot() starts a clock to keep the "data 4m ago" stamp honest. Left real, it holds the
  // event loop open and the test run never exits.
  g.setInterval = () => 0;
  g.devicePixelRatio = 1;
  g.getComputedStyle = () => ({ getPropertyValue: () => "#000" });
  g.localStorage = { getItem: () => null, setItem: (k: string, v: string) => saved.push([k, v]) };
  g.location = { hash };
  g.history = {
    pushState(_a: unknown, _b: unknown, url: string) {
      g.location.hash = url;
      pushes.push(url);
    },
    replaceState(_a: unknown, _b: unknown, url: string) {
      g.location.hash = url;
      replaces.push(url);
    },
  };
  return { document, byId, saved, pushes, replaces, asked };
}

/* The old harness put every top-level `var` on one sandbox object. The state now lives in
   `S`, and these are the names 900 lines of assertions already use for it. */
const ALIAS: Record<string, string> = {
  DATA: "data",
  INBOX: "inbox",
  DOCS: "docs",
  view: "view",
  staffHandle: "staffHandle",
  openFile: "openFile",
  fileQuery: "fileQuery",
  changedQuery: "changedQuery",
  changedFilter: "changedFilter",
  inboxOpen: "inboxOpen",
  inboxFilter: "inboxFilter",
  inboxStaff: "inboxStaff",
  inboxState: "inboxState",
  query: "query",
  openDoc: "openDoc",
  openSurfaces: "openSurfaces",
  promptKind: "promptKind",
  promptOpen: "promptOpen",
  orgOpen: "orgOpen",
  sync: "sync",
  loadedAt: "loadedAt",
};

let mods: any = null;

async function load() {
  if (mods) return mods;
  const dir = "../templates/portal/js/";
  const [app, state, dom, md, inbox, changed, health, files, brain, refresh] = await Promise.all([
    import(dir + "app.js"),
    import(dir + "state.js"),
    import(dir + "dom.js"),
    import(dir + "md.js"),
    import(dir + "views/inbox.js"),
    import(dir + "views/changed.js"),
    import(dir + "views/health.js"),
    import(dir + "views/files.js"),
    import(dir + "views/brain.js"),
    import(dir + "refresh.js"),
  ]);
  mods = { app, state, dom, md, inbox, changed, health, files, brain, refresh };
  return mods;
}

/** Put every state field back to its declared default, so one test cannot leak into another. */
const DEFAULTS = {
  data: null,
  docs: null,
  inbox: null,
  sync: null,
  loadedAt: null,
  staffHandle: null,
  view: "brain",
  query: "",
  openFile: null,
  fileQuery: "",
  openSurfaces: null,
  changedQuery: "",
  changedFilter: "",
  openDoc: null,
  inboxFilter: "",
  inboxStaff: "",
  inboxOpen: null,
  applyingHash: false,
};

async function renderAll(hash = "") {
  const shim = install(hash);
  const m = await load();
  Object.assign(m.state.S, DEFAULTS);
  await m.app.boot();
  // boot() finishes synchronously after its one await, but a view may still have a fetch
  // in flight — the docs and the inbox both load themselves.
  await new Promise((r) => setTimeout(r, 30));

  const target: any = {
    render: m.app.render,
    refreshAll: m.refresh.refreshAll,
    mdlite: m.md.mdlite,
    inline: m.md.inline,
    markCurrent: m.dom.markCurrent,
    belongsTo: m.inbox.belongsTo,
    renderDiff: m.changed.renderDiff,
    cronText: m.health.cronText,
    askToFix: m.health.askToFix,
    show: m.files.showFile,
    document: shim.document,
    _state: m.state.S,
    _byId: shim.byId,
    _saved: shim.saved,
    _asked: shim.asked,
    _pushes: shim.pushes,
    _replaces: shim.replaces,
  };

  return new Proxy(target, {
    get(t, k: string) {
      if (k === "location" || k === "fetch") return (globalThis as any)[k];
      if (k in ALIAS) return m.state.S[ALIAS[k]!];
      return t[k];
    },
    set(t, k: string, v) {
      if (k === "fetch") {
        (globalThis as any).fetch = v;
        return true;
      }
      if (k in ALIAS) {
        m.state.S[ALIAS[k]!] = v;
        return true;
      }
      t[k] = v;
      return true;
    },
  });
}

test("boot renders without throwing and populates the sidebar", async () => {
  const s = await renderAll();
  // Two rows per staff member: the name, and the box of their four views under it. The old
  // shape was one <select> plus a separate view list you had to connect for yourself.
  assert.equal(
    s._byId.stafflist.children.length,
    ORG.staff.length * 2,
    "a row and a view box per staff member",
  );
  const [head, views] = s._byId.stafflist.children;
  assert.ok(String(head.className).includes("staffrow"));
  assert.equal(views.children.length, 5, "Brain, Prompt, Graph, What changed, Health");
  assert.equal(
    views.children.map((b: any) => b.dataset.view).join(" "),
    "brain prompt graph changed health",
  );
  // `sub` is the page-subtitle class and carries a 24px bottom margin. Naming the nested nav
  // rows "nav sub" inherited it as a gap four times the row height. The shim has no CSS, so
  // what is pinned here is the class name, which is what collided.
  assert.ok(
    views.children.every((b: any) => !String(b.className).split(/\s+/).includes("sub")),
    "a nav row must not borrow the page-subtitle class",
  );
  assert.equal(head.getAttribute("aria-expanded"), "true", "the selected staff member unfolds");
  assert.equal(s._byId.stafflist.children[3].hidden, true, "and everyone else stays folded away");
  assert.match(s._byId.orgname.textContent, /staff/);
});

test("every view renders and produces content", async () => {
  const s = await renderAll();
  for (const view of ["brain", "prompt", "graph", "changed", "health", "roster"]) {
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
    for (const view of ["brain", "prompt", "graph", "changed", "health"]) {
      s.view = view;
      assert.doesNotThrow(() => s.render(), `${staff.handle}/${view} threw`);
    }
  }
});

test("the theme toggle cycles system → light → dark and persists", async () => {
  const s = await renderAll();
  const root = s.document.documentElement;
  const btn = s._byId.theme;
  assert.equal(
    root.getAttribute("data-theme"),
    null,
    "system uses the media query, not an attribute",
  );
  btn.onclick();
  assert.equal(root.getAttribute("data-theme"), "light");
  btn.onclick();
  assert.equal(root.getAttribute("data-theme"), "dark");
  btn.onclick();
  assert.equal(root.getAttribute("data-theme"), null, "system must be reachable again");
  assert.deepEqual(s._saved, [
    ["roster.theme", "light"],
    ["roster.theme", "dark"],
    ["roster.theme", "system"],
  ]);
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

test("the inbox renders and holds every open item", async () => {
  const s = await renderAll("#/x/inbox");
  assert.equal(s.view, "inbox");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(s._byId.main.children.length > 0, "inbox rendered nothing");
  assert.equal(s.INBOX.items.length, 4, "two open, one closed, one merged");
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
  const list = {
    querySelectorAll: (sel: string) =>
      sel === '[aria-current="true"]'
        ? rows.filter((r) => r.getAttribute("aria-current") === "true")
        : [],
  };
  s.markCurrent(list, rows[0]);
  s.markCurrent(list, rows[1]);
  s.markCurrent(list, rows[2]);
  assert.deepEqual(
    rows.map((r) => r.getAttribute("aria-current")),
    ["false", "false", "true"],
  );
});

test("the inbox renders newest first", async () => {
  // The fixture is deliberately supplied oldest-first, so a list that just echoes the API
  // order would fail this.
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));

  const rows: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.innerHTML === "string" && n.innerHTML.includes('class="ititle"'))
      rows.push(n.innerHTML);
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
  s.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({}), text: async () => "" };
  };

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
    return {
      ok: true,
      json: async () => ({ ...first, generatedAt: "2030-01-01T00:00:00Z" }),
      text: async () => "",
    };
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
  const out = s.mdlite(
    [
      "| | The ask |",
      "|---|---|",
      "| [#113](https://example.invalid/113) | **Merge first.** The `fast-uri` pin. |",
      "| #114 | Merge. Second row. |",
    ].join("\n"),
  );
  assert.ok(out.includes("<table>"), "no table produced");
  assert.equal((out.match(/<tr>/g) ?? []).length, 3, "header plus two rows");
  assert.ok(out.includes("<b>Merge first.</b>"), "inline formatting inside a cell");
  assert.ok(out.includes("<code>fast-uri</code>"));
  assert.ok(out.includes('href="https://example.invalid/113"'));
  assert.ok(!/^\s*\|/m.test(out), "no raw pipes should survive");
});

test("mdlite handles the rest of an issue body without leaking pipes or markers", async () => {
  const s = await renderAll();
  const out = s.mdlite(
    [
      "## Heading",
      "",
      "> a quote",
      "",
      "- [ ] unticked",
      "- [x] ticked",
      "1. first",
      "",
      "```",
      "code | with | pipes",
      "```",
      "",
      "---",
      "",
      "a paragraph that",
      "wraps over two source lines",
    ].join("\n"),
  );
  assert.ok(out.includes("<h2>Heading</h2>"));
  assert.ok(out.includes("<blockquote>"));
  // The boxes are icons now, not characters, so what is asserted is that a ticked and an
  // unticked item render differently at all.
  assert.ok(out.includes('class="box"'), "task items get a box");
  assert.equal((out.match(/class="box"/g) ?? []).length, 2);
  const [unticked, ticked] = out.split('class="box"').slice(1, 3);
  assert.notEqual(unticked.slice(0, 200), ticked.slice(0, 200), "ticked must not look unticked");
  assert.ok(out.includes("<hr>"));
  assert.ok(out.includes("code | with | pipes"), "pipes inside a fence are content, not a table");
  assert.ok(out.includes("a paragraph that wraps over two source lines"), "hard wraps should join");
});

test("inline() escapes markup before formatting it", async () => {
  const s = await renderAll();
  const out = s.inline("<img src=x onerror=alert(1)> **bold** `code` [[a-slug]]");
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
    for (const l of s.links) {
      ids.add(l.from);
      ids.add(l.to);
    }

    const groups = new Set([...ids].map(groupOf));
    assert.ok(groups.size >= 3, `${s.handle}: too few groups to be useful`);
    assert.ok(groups.size <= 20, `${s.handle}: ${groups.size} groups is not a readable top level`);
    assert.ok(
      ids.size / groups.size > 4,
      `${s.handle}: groups are not actually collapsing anything`,
    );

    const bundled = new Set<string>();
    for (const l of s.links) {
      const [a, b] = [groupOf(l.from), groupOf(l.to)].sort();
      if (a !== b) bundled.add(a + " ~ " + b);
    }
    assert.ok(bundled.size < s.links.length, `${s.handle}: bundling reduced nothing`);
    for (const f of s.facts)
      assert.ok(groups.has(f.section || "Ungrouped"), "every fact needs a group");
  }
});

test("an opened group fans outwards, clear of every other group", () => {
  // The complaint this answers: opened members landing in among the other group nodes.
  // Mirrors the fan geometry in drawGraph, so the numbers here move if that does.
  for (const s of ORG.staff as any[]) {
    const bySlug = new Map(s.facts.map((f: any) => [f.slug, f]));
    const groupOf = (id: string) => {
      const f: any = bySlug.get(id);
      return f
        ? f.section || "Ungrouped"
        : id.startsWith("#")
          ? "Issues"
          : s.notes.includes(id)
            ? "Notes"
            : "Files";
    };
    const ids = new Set<string>(s.facts.map((f: any) => f.slug));
    for (const l of s.links) {
      ids.add(l.from);
      ids.add(l.to);
    }
    const members = new Map<string, string[]>();
    for (const id of ids) members.set(groupOf(id), [...(members.get(groupOf(id)) ?? []), id]);
    const groups = [...members.keys()].sort(
      (a, b) => members.get(b)!.length - members.get(a)!.length,
    );

    const RING = Math.max(340, groups.length * 84);
    const SECTOR = (Math.PI * 2) / groups.length;
    const gr = (n: number) => 16 + Math.sqrt(n) * 3.6;
    const gnode = new Map(
      groups.map((g, i) => {
        const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
        return [
          g,
          {
            angle,
            x: Math.cos(angle) * RING,
            y: Math.sin(angle) * RING,
            n: members.get(g)!.length,
          },
        ];
      }),
    );

    for (const g of groups) {
      const gn = gnode.get(g)!;
      const n = gn.n;
      const perShell = Math.max(4, Math.ceil(Math.sqrt(n) * 1.15));
      for (let i = 0; i < n; i++) {
        const shell = Math.floor(i / perShell),
          inShell = i % perShell;
        const count = Math.min(perShell, n - shell * perShell);
        const spread = SECTOR * 0.66;
        const t = count === 1 ? 0 : (inShell / (count - 1) - 0.5) * spread;
        const a = gn.angle + t,
          r = RING + gr(n) + 210 + shell * 96;
        const x = Math.cos(a) * r,
          y = Math.sin(a) * r;

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

/* A wrapper div's textContent is its children joined, so a search by text finds the row
   before the button inside it. Ask for the button. */
function button(root: any, label: string): any {
  const found = walkNodes(root).find(
    (n) => n.tagName === "BUTTON" && String(n.textContent).trim() === label,
  );
  if (!found) throw new Error(`no button called "${label}"`);
  return found;
}

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
  const cls = (c: string) =>
    nodes.filter((n) =>
      String(n.className ?? "")
        .split(/\s+/)
        .includes(c),
    );
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
  assert.deepEqual(
    added.children.map((c: any) => c.textContent),
    ["", "11", "- **`new-fact`** · it arrived"],
    "an addition numbers the new side only, and the leading + is the gutter's job",
  );
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
  assert.ok(
    out.includes("<ul><li>top<ul><li>under</li></ul></li><li>second</li></ul>"),
    "a sub-point should be a nested list, not a div with a left margin: " + out,
  );
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
  const out = s.mdlite("blocked by #113, and acme/acme-web#7", { repo: "acme/technology" });
  assert.ok(out.includes('href="https://github.com/acme/technology/issues/113"'), out);
  assert.ok(out.includes('href="https://github.com/acme/acme-web/issues/7"'), out);
  assert.equal((out.match(/class="ref"/g) ?? []).length, 2);
});

test("a bare github URL collapses to a chip that says which PR it is", async () => {
  const s = await renderAll();
  const out = s.mdlite("see https://github.com/acme/acme-web/pull/98", {
    repo: "acme/acme-web",
  });
  assert.ok(out.includes('class="ref pr"'), out);
  assert.ok(out.includes(">#98</a>"), "the repo is redundant when it is the one you are reading");
});

test("a reference inside a link does not become a link inside a link", async () => {
  // [#113](url) is how the status issues write these, and chipping the text first would
  // have produced an anchor nested in an anchor.
  const s = await renderAll();
  const out = s.mdlite("[#113](https://example.invalid/113)", { repo: "acme/technology" });
  assert.equal((out.match(/<a\s/g) ?? []).length, 1, out);
  assert.ok(out.includes('href="https://example.invalid/113"'));
});

test("a relative image in a brain file resolves against the file, not the repo root", async () => {
  const s = await renderAll();
  const out = s.mdlite("![shot](../assets/x.png)", {
    file: { dir: "drafts/", staffDir: "marketing" },
  });
  assert.ok(out.includes("assets%2Fx.png"), out);
  assert.ok(out.includes("marketing"), "and it must be fetched from that staff member's checkout");
});

test("a markdown file in the brain renders as a document rather than as source", async () => {
  const s = await renderAll();
  s.fetch = async () => ({
    ok: true,
    text: async () => "# Title\n\n- a\n  - b\n",
    json: async () => ({}),
  });
  const viewer = s.document.createElement("div");
  await s.show(
    viewer,
    { dir: "technology", brain: "acme/technology" },
    { path: "strategy/plan.md", ext: "md", bytes: 20, modified: new Date().toISOString() },
  );
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

  const keys = walkNodes(s._byId.main)
    .filter((n) => n.dataset?.key)
    .map((n) => n.dataset.key);
  assert.ok(keys.includes("mem:*"), "memory should be in the tree: " + keys.slice(0, 8));
  assert.ok(
    keys.some((k: string) => k.startsWith("mem:") && k !== "mem:*"),
    "one row per section",
  );
  assert.ok(
    keys.some((k: string) => k.endsWith(".md")),
    "and the files are in the same tree",
  );
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

  const lit = walkNodes(s._byId.main).filter((n) =>
    String(n.className ?? "")
      .split(/\s+/)
      .includes("lit"),
  );
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

  const keys = walkNodes(s._byId.main)
    .filter((n) => n.dataset?.key)
    .map((n) => n.dataset.key);
  assert.ok(
    keys.includes("fact:" + who.facts[0].slug),
    "a matching fact should be offered directly",
  );
  assert.ok(!keys.includes("mem:*"), "the section list gives way to the matches");
});

test("an old #/handle/memory link still lands somewhere", async () => {
  const s = await renderAll("#/" + ORG.staff[0].handle + "/memory");
  assert.equal(s.view, "brain", "memory is a surface of the brain now");
  assert.ok(s._byId.main.children.length > 0);
});

test("the inbox can be scoped to one staff member", async () => {
  const s = await renderAll();
  const cto = {
    handle: "cto",
    brain: "acme/brain",
    soloBots: ["cto-app"],
    sharedBots: ["robot"],
    worksIn: ["acme/product"],
  };
  const item = (over: any) => ({
    repo: "acme/product",
    author: "someone",
    labels: [],
    assignees: [],
    ...over,
  });

  assert.equal(s.belongsTo(item({ repo: "acme/brain" }), cto), true, "their own brain");
  assert.equal(s.belongsTo(item({ author: "cto-app" }), cto), true, "anything their own app wrote");
  assert.equal(
    s.belongsTo(item({ labels: ["from-cto"] }), cto),
    true,
    "anything a peer addressed to them",
  );
  assert.equal(
    s.belongsTo(item({ assignees: ["cto-app"] }), cto),
    true,
    "anything assigned to them",
  );
  assert.equal(
    s.belongsTo(item({ author: "robot" }), cto),
    true,
    "the shared robot, in a repo they work in",
  );
  assert.equal(
    s.belongsTo(item({ author: "robot", repo: "acme/elsewhere" }), cto),
    false,
    "but not the shared robot somewhere they have no business",
  );
  assert.equal(s.belongsTo(item({}), cto), false, "and nothing else");
  assert.equal(s.belongsTo(item({}), null), true, "Everyone is not a filter");
});

test("a bot identity is matched however the manifest spells it", async () => {
  // staff.yaml says acme-cto[bot]; GitHub reports the author as acme-cto. Getting this wrong
  // silently disabled the whole author rule.
  for (const who of ORG.staff) {
    for (const b of who.bots)
      assert.ok(!b.endsWith("[bot]"), b + " should be normalised in the export");
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
    return {
      ok: true,
      json: async () => ({ url: "https://github.com/acme/technology/issues/9" }),
    };
  };
  const btn = s.document.createElement("button");
  const status = s.document.createElement("span");
  await s.askToFix(
    { brain: "acme/technology", handle: "cto" },
    [
      {
        level: "warning",
        rule: "too-long",
        message: "`a-fact` is 550 characters.",
        line: 12,
        slug: "a-fact",
      },
      {
        level: "error",
        rule: "dangling-note",
        message: "`b` links notes/b.md, which does not exist.",
        line: 30,
      },
    ],
    btn,
    status,
  );

  assert.equal(sent.length, 1, "one issue, not one per problem");
  assert.equal(sent[0].u, "/api/act");
  assert.equal(sent[0].body.action, "create");
  assert.equal(sent[0].body.repo, "acme/technology", "it goes to their brain, not the ops repo");
  assert.match(sent[0].body.title, /2 problems/);
  assert.match(sent[0].body.body, /INDEX.md:12/);
  assert.match(sent[0].body.body, /dangling-note/);
});

test("a staff member with no brain repo cannot have an issue opened against nothing", async () => {
  const s = await renderAll();
  let called = false;
  s.fetch = async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  };
  const status = s.document.createElement("span");
  await s.askToFix(
    { handle: "cto" },
    [{ level: "error", rule: "x", message: "y" }],
    s.document.createElement("button"),
    status,
  );
  assert.equal(called, false);
  assert.match(status.textContent, /no brain repo/);
});

test("the docs render in the portal, and a link between pages stays inside it", async () => {
  /* The docs ship with the framework, so they are read where you already are rather than by
     remembering a path. A relative .md link has to navigate the portal, not 404 the browser. */
  const s = await renderAll("#/-/docs");
  assert.equal(s.view, "docs");
  await new Promise((r) => setTimeout(r, 30));

  const nodes = walkNodes(s._byId.main);
  const keys = nodes.filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.deepEqual(keys, ["README.md", "agents.md"], "one entry per page, in reading order");

  const html = nodes.map((n) => String(n.innerHTML ?? "")).join("");
  assert.ok(
    html.includes("<h1>Choosing a coding agent</h1>"),
    "the page should render as a document",
  );
  assert.match(
    html,
    /data-doc="manual-steps\.md"/,
    "a link to another page must be handled in the portal, not followed by the browser",
  );
  assert.ok(!html.includes('href="manual-steps.md"'), "and not left as a plain href");
});

test("docs work without a staff member selected", async () => {
  // Every other view belongs to somebody; this one does not, and the URL must not demand one.
  const s = await renderAll("#/-/docs");
  assert.equal(s.view, "docs");
  assert.ok(s._byId.main.children.length > 0);
});

test("a doc page's frontmatter is metadata, not content", async () => {
  // The pages carry YAML frontmatter for the collective's docs site. Rendered, it would show
  // as a horizontal rule and a stray paragraph above the heading.
  const s = await renderAll("#/-/docs");
  s.fetch = async () => ({
    ok: true,
    text: async () =>
      '---\ntitle: "X"\ndescription: "Y"\nsidebar_order: 1\n---\n\n# Real heading\n',
    json: async () => [{ file: "a.md", title: "X" }],
  });
  s.DOCS = null;
  s.render();
  await new Promise((r) => setTimeout(r, 30));

  const html = walkNodes(s._byId.main)
    .map((n) => String(n.innerHTML ?? ""))
    .join("");
  assert.ok(html.includes("<h1>Real heading</h1>"), html.slice(0, 200));
  assert.ok(!html.includes("sidebar_order"), "frontmatter must not reach the page");
  assert.ok(!html.includes("<hr>"), "and it must not leave the rule behind");
});

/* ------------------------------------------------------------------------- *
 * The three amendments: a thread that shows its whole timeline, a brain
 * navigator that separates memory from files, and a focused fact you can let
 * go of again.
 * ------------------------------------------------------------------------- */

function openInbox(s: any) {
  s.view = "inbox";
  s.inboxOpen = { repo: "acme/brain", number: 3, kind: "issue" };
  s.render();
  return walkNodes(s._byId.main);
}

test("a thread shows references and commits, not just comments", async () => {
  /* The complaint: GitHub's own timeline carries "added a commit that references this" and
     "mentioned this in #55", and the portal showed neither, so a conversation read as if it
     had skipped a step. */
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));
  const nodes = openInbox(s);

  const cls = (c: string) =>
    nodes.filter((n) =>
      String(n.className ?? "")
        .split(/\s+/)
        .includes(c),
    );
  const text = nodes.map((n) => String(n.innerHTML ?? "") + String(n._text ?? "")).join(" ");

  assert.equal(cls("referenced").length, 1, "the referencing commit should be on the timeline");
  assert.equal(cls("cross-referenced").length, 1, "and so should the cross-reference");
  assert.ok(text.includes("added a commit that references this"));
  assert.ok(text.includes("ruling: it is a mode, not a kind"), "with the commit subject");
  assert.ok(text.includes("mentioned this in"));
  assert.equal(cls("xref").length, 1, "what it points at is a row you can open");
  assert.ok(text.includes("An older pull request"), "named by its title, not just its number");
});

test("bookkeeping folds away, and the events that matter do not", async () => {
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));
  const nodes = openInbox(s);

  const more = nodes.find((n) => String(n.className ?? "").includes("tevmore"));
  assert.ok(more, "a run of label/assign events should collapse behind a disclosure");
  assert.match(more.textContent, /2 more events/);
  assert.equal(more.getAttribute("aria-expanded"), "false", "and start closed");

  const quiet = nodes.find((n) => String(n.className ?? "").includes("tevquiet"));
  assert.equal(quiet.hidden, true, "the folded events are present but hidden");
  more.onclick();
  assert.equal(quiet.hidden, false, "and the disclosure opens them");
  assert.equal(more.getAttribute("aria-expanded"), "true");
});

test("the thread keeps GitHub's order: body, then events, then the reply box", async () => {
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 20));
  openInbox(s);

  const viewer = walkNodes(s._byId.main).find((n) => String(n.className ?? "") === "viewer");
  const kinds = viewer.children.map((c: any) => String(c.className ?? "").split(" ")[0]);
  assert.equal(kinds[0], "thead", "the title block first");
  assert.equal(kinds[1], "cmt", "then the opening post");
  assert.equal(kinds[kinds.length - 1], "reply", "and the reply box last");
  assert.ok(kinds.includes("tev"), "with timeline events in between");
});

test("@cto in a comment is told apart from @a-stranger", async () => {
  const s = await renderAll();
  const handle = ORG.staff[0].handle;
  const out = s.mdlite("Go with your recommendation @" + handle + " and cc @a-stranger");
  assert.ok(out.includes('class="at you"'), "someone on this roster is marked: " + out);
  assert.ok(
    out.includes('<a class="at" href="https://github.com/a-stranger"'),
    "anyone else is still a link, just to GitHub",
  );
});

test("a mention inside a link does not become a link inside a link", async () => {
  const s = await renderAll();
  const out = s.mdlite("[ask @" + ORG.staff[0].handle + "](https://example.invalid/1)");
  assert.equal((out.match(/<a\s/g) ?? []).length, 1, out);
});

test("an email address is not four people being mentioned", async () => {
  const s = await renderAll();
  const out = s.mdlite("write to will@example.com about it");
  assert.ok(!out.includes('class="at'), "a bare @ after a word is not a mention: " + out);
});

test("the brain navigator separates what is known from what is held", async () => {
  const s = await renderAll();
  s.view = "brain";
  s.openFile = null;
  s.fileQuery = "";
  s.render();

  const nodes = walkNodes(s._byId.main);
  const heads = nodes
    .filter((n) => String(n.className ?? "") === "ghead")
    .map((n) => String(n._text ?? ""));
  assert.deepEqual(
    heads,
    ["Memory", "Identity", "Files"],
    "three named boxes: what it knows, who it is, what it holds. Got: " + heads,
  );

  const keys = nodes.filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.ok(keys.includes("mem:*"), "memory leads");
  assert.ok(
    keys.some((k: string) => k.startsWith("mem:") && k !== "mem:*"),
    "one row per section",
  );
});

test("a note and the raw index live under memory, not among the files", async () => {
  // They used to appear in both places: INDEX.md is literally what "All facts" renders, and
  // a note is the argument behind a fact. Two entries for one thing was most of the confusion.
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.notes.length) ?? ORG.staff[0];
  s.staffHandle = who.handle;
  s.view = "brain";
  s.openFile = "mem:*";
  s.fileQuery = "";
  s.render();

  const nodes = walkNodes(s._byId.main);
  const groups = nodes.filter((n) => String(n.className ?? "") === "navgroup");
  const keysIn = (g: any) =>
    walkNodes(g)
      .filter((n) => n.dataset?.key)
      .map((n) => n.dataset.key);

  const [memory, , files] = groups;
  assert.ok(keysIn(memory).includes("memory/INDEX.md"), "the raw index is offered under memory");
  assert.ok(!keysIn(files ?? { children: [] }).includes("memory/INDEX.md"), "and only there");
  if (who.notes.length) {
    assert.ok(
      keysIn(memory).some((k: string) => k.startsWith("memory/notes/")),
      "notes belong to memory",
    );
    assert.ok(
      !keysIn(files ?? { children: [] }).some((k: string) => k.startsWith("memory/notes/")),
      "and not to files",
    );
  }
});

test("a surface folds, and a placeholder file is not offered as a file", async () => {
  const s = await renderAll();
  s.view = "brain";
  s.openFile = "mem:*";
  s.fileQuery = "";
  s.render();

  const nodes = walkNodes(s._byId.main);
  const folders = nodes.filter((n) => String(n.className ?? "").includes("tsurface"));
  assert.ok(folders.length, "surfaces are folders now");
  assert.ok(
    folders.every((f: any) => ["true", "false"].includes(String(f.getAttribute("aria-expanded")))),
    "each says whether it is open",
  );

  const keys = nodes.filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.ok(
    !keys.some((k: string) => k.endsWith(".gitkeep")),
    "a file that only holds a directory open is noise",
  );
});

test("a focused fact says where you are and offers a way out", async () => {
  /* Clicking a fact's name narrowed 111 cards to a dozen and lit one, with nothing saying so
     and no way back. That was the complaint. */
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.facts.length) ?? ORG.staff[0];
  const fact = who.facts[0];
  s.staffHandle = who.handle;
  s.view = "brain";
  s.fileQuery = "";
  s.openFile = "fact:" + fact.slug;
  s.render();

  const nodes = walkNodes(s._byId.main);
  const bar = nodes.find((n) => String(n.className ?? "") === "focusbar");
  assert.ok(bar, "a focused fact needs a crumb saying so");
  assert.ok(bar.textContent.includes(fact.slug), "naming the fact");
  assert.ok(bar.textContent.includes(fact.section), "and the section it came from");

  const out = walkNodes(bar).find((n) => String(n.className ?? "") === "x");
  assert.ok(out, "and a way out");
  out.onclick();
  assert.equal(s.openFile, "mem:" + fact.section, "which widens to the whole section");

  // And from there, back to everything.
  s.render();
  const crumb = walkNodes(s._byId.main).filter((n) => String(n.className ?? "") === "crumb")[0];
  crumb.onclick();
  assert.equal(s.openFile, "mem:*");
});

test("the section holding a focused fact stays lit in the navigator", async () => {
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.facts.length) ?? ORG.staff[0];
  const fact = who.facts[0];
  s.staffHandle = who.handle;
  s.view = "brain";
  s.fileQuery = "";
  s.openFile = "fact:" + fact.slug;
  s.render();

  const rows = walkNodes(s._byId.main).filter((n) => n.dataset?.key);
  const section = rows.find((n) => n.dataset.key === "mem:" + fact.section);
  assert.ok(section, "the section row should still be in the tree");
  assert.equal(section.dataset.within, "true", "and marked, so you do not lose your place");
});

test("a ?t= in the URL opens that thread, which it never used to", async () => {
  // The state was read out of the hash and then never acted on, because only the
  // already-loaded branch opened a thread and a cold load never is.
  const s = await renderAll("#/x/inbox?t=acme/brain%233:issue");
  await new Promise((r) => setTimeout(r, 30));
  const text = walkNodes(s._byId.main)
    .map((n) => String(n.innerHTML ?? "") + String(n._text ?? ""))
    .join(" ");
  assert.ok(
    text.includes("Needs a ruling"),
    "the linked thread should be open: " + text.slice(0, 200),
  );
});

/* --------------------------- the prompt screen --------------------------- */

test("the prompt screen shows the text, the layers, and which repo each came from", async () => {
  const s = await renderAll("#/cto/prompt");
  assert.equal(s.view, "prompt");
  await new Promise((r) => setTimeout(r, 30));

  const nodes = walkNodes(s._byId.main);
  const heads = nodes
    .filter((n) => String(n.className ?? "") === "ghead")
    .map((n) => String(n._text ?? ""));
  assert.deepEqual(
    heads,
    ["The prompt", "Inlined, in order", "Problems", "Named, not inlined"],
    String(heads),
  );

  const keys = nodes.filter((n) => n.dataset?.key).map((n) => n.dataset.key);
  assert.ok(keys.includes("composed"), "the composed text is the first thing offered");
  assert.ok(keys.includes("roster-ops/org/voice.md"), "and every layer behind it");
  assert.ok(
    keys.includes("technology/CHARTER.md"),
    "including the files it names rather than contains",
  );

  // The repo is on the row because it is the difference between editing one agent and all
  // of them, and that is worth knowing before you click Edit.
  const repos = nodes
    .filter((n) => String(n.className ?? "") === "lrepo")
    .map((n) => n.textContent);
  assert.ok(repos.includes("roster-ops") && repos.includes("technology"), String(repos));
});

test("a missing optional layer is shown as absent rather than hidden", async () => {
  // `{{>? staff:prompts/boot.md}}` renders empty when the file is not there. Hiding the row
  // would leave you wondering whether the fragment exists at all.
  const s = await renderAll("#/cto/prompt");
  await new Promise((r) => setTimeout(r, 30));
  const row = walkNodes(s._byId.main).find((n) => n.dataset?.key === "technology/prompts/boot.md");
  assert.ok(row, "an absent optional layer still gets a row");
  assert.ok(String(row.className).includes("dim"));
  assert.match(row.textContent, /absent/);
});

test("the composed prompt is not a summary of itself", async () => {
  const s = await renderAll("#/cto/prompt");
  await new Promise((r) => setTimeout(r, 30));
  const html = walkNodes(s._byId.main)
    .map((n) => String(n.innerHTML ?? ""))
    .join("");
  assert.ok(html.includes("You are the CTO"), "the actual text belongs on the page");
});

test("a prompt that will not compose says so instead of rendering nothing", async () => {
  const s = await renderAll();
  s.fetch = async () => ({
    ok: true,
    json: async () => ({ staff: "cto", kind: "daily", error: 'unknown staff handle "cto"' }),
    text: async () => "",
  });
  s.view = "prompt";
  s.render();
  await new Promise((r) => setTimeout(r, 30));
  const text = walkNodes(s._byId.main)
    .map((n) => String(n.textContent ?? ""))
    .join(" ");
  assert.match(text, /does not compose/);
  assert.match(text, /unknown staff handle/, "and says what compose.mjs actually said");
});

/* ----------------------- open, closed, and the badge ---------------------- */

function inboxTitles(s: any): string[] {
  return walkNodes(s._byId.main)
    .filter((n) => String(n.innerHTML ?? "").includes('class="ititle"'))
    .map((n) => String(n.innerHTML));
}

test("the inbox lists open work by default, and closed only when asked", async () => {
  /* An inbox is what is waiting on somebody. Five months of finished work mixed into that is
     answering a different question, so closed items are fetched but not listed until you
     pick them. */
  const s = await renderAll("#/x/inbox");
  await new Promise((r) => setTimeout(r, 30));

  let titles = inboxTitles(s).join(" ");
  assert.ok(titles.includes("Needs a ruling"), "open work is listed");
  assert.ok(!titles.includes("Something already settled"), "a closed issue is not");
  assert.ok(!titles.includes("A pull request that landed"), "nor a merged PR");

  s.inboxState = "closed";
  s.render();
  await new Promise((r) => setTimeout(r, 20));
  titles = inboxTitles(s).join(" ");
  assert.ok(titles.includes("Something already settled"), "closed shows the closed issue");
  assert.ok(titles.includes("A pull request that landed"), "and the merged PR");
  assert.ok(!titles.includes("Needs a ruling"), "and nothing that is still open");

  s.inboxState = "all";
  s.render();
  await new Promise((r) => setTimeout(r, 20));
  titles = inboxTitles(s).join(" ");
  for (const want of [
    "Needs a ruling",
    "Something already settled",
    "A pull request that landed",
  ]) {
    assert.ok(titles.includes(want), want + " should be listed under open and closed");
  }
});

test("a closed row is marked as closed rather than looking open", async () => {
  const s = await renderAll("#/x/inbox?x=all");
  await new Promise((r) => setTimeout(r, 30));
  const rows = walkNodes(s._byId.main).filter((n) =>
    String(n.className ?? "")
      .split(/\s+/)
      .includes("irow"),
  );
  const shut = rows.filter((r) => String(r.className).includes("shut"));
  assert.equal(shut.length, 2, "the closed issue and the merged PR");
  assert.match(shut[0].innerHTML, /class="ist /, "with a state marker on the row");
  assert.equal(
    rows.filter((r) => !String(r.className).includes("shut")).length,
    2,
    "and the open ones are not marked",
  );
});

test("the sidebar badge counts what is open, not what is loaded", async () => {
  // 135 in a badge when 34 things need you is worse than no badge.
  const s = await renderAll("#/x/inbox?x=all");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.INBOX.items.length, 4, "the fixture holds open and closed");
  assert.equal(s._byId.inboxcount.textContent, "2", "but the badge counts the open ones");
});

test("every state field is reachable through the harness", async () => {
  /* `inboxState` was added to the page and not to ALIAS, so a test that set it wrote to a
     dead object and passed for the wrong reason. That is the exact trap this suite has fallen
     into before, so it is checked rather than remembered. */
  const s = await renderAll();
  // ALIAS is keyed by the name the tests use and valued by the name the page uses, so it is
  // the values that say what is reachable.
  const reachable = new Set(Object.values(ALIAS));
  const missing = Object.keys(s._state).filter((k) => !reachable.has(k) && k !== "applyingHash");
  assert.deepEqual(
    missing,
    [],
    "these state fields cannot be driven from a test: " + missing.join(", "),
  );
});

/* ------------------- HTML in a comment, and where a mention goes ------------------ */

test("an HTML table in a comment renders as a table", async () => {
  /* Not every comment is markdown. The Cloudflare Pages bot posts its deploy status as raw
     `<table>` HTML, GitHub renders it, and this used to show you the tags. */
  const s = await renderAll();
  const out = s.mdlite(
    "Deploying\n\n<table><tr><td><strong>Status:</strong></td><td>&nbsp;Deploy successful!" +
      "</td></tr><tr><td><strong>URL:</strong></td><td><a href='https://x.pages.dev'>" +
      "https://x.pages.dev</a></td></tr></table>\n\n[View logs](https://example.invalid/l)",
  );
  assert.ok(out.includes("<table>"), "no table produced: " + out);
  assert.equal((out.match(/<tr>/g) ?? []).length, 2);
  assert.ok(out.includes("<b>Status:</b>"), "a cell keeps its emphasis");
  assert.ok(out.includes('href="https://x.pages.dev"'), "and its link");
  assert.ok(!out.includes("&lt;table"), "and no tags are left on the page");
  assert.ok(out.includes("Deploy successful!"), "&nbsp; is a space, not four characters");
  assert.ok(out.includes("<p>Deploying</p>"), "the markdown around it still renders");
  assert.ok(out.includes('href="https://example.invalid/l"'), "including after it");
});

test("a th row becomes a header, and a td-only table does not grow a blank one", async () => {
  const s = await renderAll();
  const withHead = s.mdlite(
    "<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>b</td></tr></table>",
  );
  assert.ok(withHead.includes("<thead>") && withHead.includes("<th>Name</th>"));
  const without = s.mdlite("<table><tr><td>a</td><td>b</td></tr></table>");
  assert.ok(!without.includes("<thead>"), "a leading blank strip is worse than no header");
});

test("nothing in an HTML table escapes the escaping", async () => {
  /* acme-web is public, so an issue body is attacker-controlled. This path takes raw HTML
     apart rather than passing any of it through, and these are the ways that could go wrong. */
  const s = await renderAll();
  const attacks = [
    "<table><tr><td><script>alert(1)</script></td></tr></table>",
    "<table><tr><td><img src=x onerror=alert(1)></td></tr></table>",
    '<table><tr><td><a href="javascript:alert(1)">click</a></td></tr></table>',
    '<table><tr><td onmouseover="alert(1)">hover</td></tr></table>',
    "<table><tr><td><a href='https://ok.example' onclick='alert(1)'>x</a></td></tr></table>",
    '<table><tr><td><iframe src="https://evil.example"></iframe></td></tr></table>',
  ];
  for (const attack of attacks) {
    const out = s.mdlite(attack);
    assert.ok(!/<script/i.test(out), "script survived: " + out);
    assert.ok(!/<img/i.test(out), "img survived: " + out);
    assert.ok(!/<iframe/i.test(out), "iframe survived: " + out);
    assert.ok(!/\son\w+\s*=/i.test(out), "an event handler survived: " + out);
    assert.ok(!/href=["']javascript:/i.test(out), "a javascript: href survived: " + out);
  }
});

test("a mention of a staff member goes to their repo on GitHub", async () => {
  const s = await renderAll();
  const who = ORG.staff.find((x: any) => x.brain) ?? ORG.staff[0];
  const out = s.mdlite("Please look @" + who.handle);
  assert.ok(out.includes('class="at you"'), "someone on this roster is marked: " + out);
  assert.ok(
    out.includes('href="https://github.com/' + who.brain + '"'),
    "and goes to their repo, not to a screen in here: " + out,
  );
  assert.ok(out.includes('target="_blank"'), "in a new tab, so the thread you are reading stays");
});

test("inline HTML in a comment is reduced, and code spans are left alone", async () => {
  const s = await renderAll();
  const out = s.mdlite(
    '# Deploying with &nbsp;<a href="https://pages.dev"><img alt="Cloudflare" src="x.png"></a>\n\n' +
      'Both emit `<meta name="robots" content="noindex"/>` and nothing else.\n\n' +
      "```\n<div>a fenced block keeps its tags</div>\n```",
  );
  // A linked icon: the image resolves to its alt text first, so the anchor gets a label
  // rather than an empty one and a bare URL.
  assert.ok(out.includes('<a href="https://pages.dev"'), out);
  assert.ok(out.includes(">Cloudflare</a>"), "the alt text is the link label: " + out);
  assert.ok(!out.includes("&lt;img"), "no tags left on the page");

  // The thing this must not break.
  assert.ok(
    out.includes("<code>&lt;meta name=&quot;robots&quot; content=&quot;noindex&quot;/&gt;</code>"),
    "a code span is content, not markup: " + out,
  );
  assert.ok(
    out.includes("&lt;div&gt;a fenced block keeps its tags&lt;/div&gt;"),
    "and so is a fence: " + out,
  );
});

test("a prompt problem is rendered with the fix you can hand to an AI", async () => {
  /* Knowing there is a problem is the hard part. Every finding carries the sentence that goes
     into the amend brief, so the button beside it is the point of the finding. */
  const s = await renderAll("#/cto/prompt");
  await new Promise((r) => setTimeout(r, 30));

  const cards = walkNodes(s._byId.main).filter((n) =>
    String(n.className ?? "").startsWith("prob "),
  );
  assert.equal(cards.length, 2, "one card per finding");
  assert.ok(String(cards[0].className).includes("error"), "the worst one first");
  assert.match(cards[0].textContent, /business\.md is still the scaffold/);
  assert.match(cards[0].textContent, /Copy a prompt to fix this/, "with the fix beside it");

  // A finding that names a file offers to open it; one about the whole prompt does not.
  assert.match(cards[0].textContent, /Open the file/);
  assert.ok(!/Open the file/.test(cards[1].textContent), "nothing to open for a whole-prompt one");
});

test("a prompt with nothing wrong shows no Problems box at all", async () => {
  const s = await renderAll();
  s.fetch = async () => ({
    ok: true,
    json: async () => ({ ...PROMPT_FIXTURE, problems: [] }),
    text: async () => "",
  });
  s.view = "prompt";
  s.render();
  await new Promise((r) => setTimeout(r, 30));
  const heads = walkNodes(s._byId.main)
    .filter((n) => String(n.className ?? "") === "ghead")
    .map((n) => String(n._text ?? ""));
  assert.ok(!heads.includes("Problems"), "an empty findings list is not a section: " + heads);
});

test("asking for a change pre-fills what the finding already worked out", async () => {
  /* A finding carries the sentence that describes the fix. Skipping straight to the clipboard
     would be fewer clicks and worse: "and keep it in operating.md" is exactly the sort of
     thing you want to add before sending it. */
  const s = await renderAll("#/cto/prompt");
  await new Promise((r) => setTimeout(r, 30));

  const card = walkNodes(s._byId.main).find((n) => String(n.className ?? "").startsWith("prob "));
  button(card, "Copy a prompt to fix this").onclick();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(s._asked.length, 1, "it should ask before copying");
  assert.match(
    s._asked[0],
    /business\.md.*scaffold/,
    "pre-filled with the finding's own wording: " + s._asked[0],
  );
});

test("the general ask starts empty rather than guessing", async () => {
  const s = await renderAll("#/cto/prompt");
  await new Promise((r) => setTimeout(r, 30));
  button(s._byId.main, "Copy a brief for changing this").onclick();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(s._asked, [""], "nothing to pre-fill when nothing found it");
});

/* ------------------------- staff, and the org layer ------------------------ */

test("the staff screen lists everyone with somewhere to go", async () => {
  const s = await renderAll("#/-/staff");
  assert.equal(s.view, "staff");
  const nodes = walkNodes(s._byId.main);
  const cards = nodes.filter((n) => String(n.className ?? "").includes("staffcard"));
  assert.equal(cards.length, ORG.staff.length, "one card per staff member");
  assert.match(cards[0].innerHTML, /facts/, "with something about what they hold");
  assert.ok(
    nodes.some((n) => String(n.textContent) === "Hire someone"),
    "and a way to add one",
  );
});

test("a retire plan says what it keeps as loudly as what it stops", async () => {
  /* The promise of retiring rather than deleting is that the memory survives, and somebody
     has to believe that before they click. A plan that only lists what it breaks has not
     earned the click. */
  const s = await renderAll("#/-/staff");
  const card = walkNodes(s._byId.main).find((n) => String(n.className ?? "").includes("staffcard"));
  button(card, "Retire").onclick();
  await new Promise((r) => setTimeout(r, 30));

  const nodes = walkNodes(s._byId.main);
  const heads = nodes
    .filter((n) => String(n.className ?? "").startsWith("planhead"))
    .map((n) => String(n._text ?? ""));
  assert.deepEqual(heads, ["This would stop", "This would keep"], String(heads));

  const kept = nodes.filter((n) => String(n.className ?? "").includes("planline keep"));
  assert.ok(kept.length >= 2, "what survives has to be enumerated");
  assert.match(kept.map((k) => k.textContent).join(" "), /untouched/);
});

test("a hire plan names the repo it would create and what is left to you", async () => {
  const s = await renderAll("#/-/staff");
  button(s._byId.main, "Hire someone").onclick();

  const handle = walkNodes(s._byId.main).find((n) => n.dataset?.field === "handle");
  assert.ok(handle, "the form needs a handle field");
  handle.value = "cfo";
  button(s._byId.main, "Show the plan").onclick();
  await new Promise((r) => setTimeout(r, 30));

  const text = walkNodes(s._byId.main)
    .map((n) => String(n.textContent ?? ""))
    .join(" ");
  assert.match(text, /acme\/finance/, "the repo it would create");
  assert.match(text, /pinned status issue/);
  assert.match(text, /roster app cfo/, "and the manual step it cannot do");
});

test("the org screen offers every file the whole roster inherits", async () => {
  const s = await renderAll("#/-/org");
  assert.equal(s.view, "org");
  const keys = walkNodes(s._byId.main)
    .filter((n) => n.dataset?.key)
    .map((n) => n.dataset.key);
  assert.deepEqual(keys, [
    "org.yaml",
    "org/business.md",
    "org/operating.md",
    "org/guardrails.md",
    "org/voice.md",
  ]);
  // Five filenames tell you nothing about which to open, so each says what it is for.
  const notes = walkNodes(s._byId.main).filter((n) => String(n.className ?? "") === "lrepo");
  assert.equal(notes.length, 5);
  assert.ok(
    notes.every((n) => String(n.textContent).length > 30),
    "and says it properly",
  );
});
