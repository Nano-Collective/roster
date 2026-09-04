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
    classList: { add() {}, remove() {} },
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

function harness() {
  const saved: Array<[string, string]> = [];
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
    fetch: async () => ({ json: async () => ORG, text: async () => "sample" }),
    requestAnimationFrame: () => 0,
    addEventListener() {},
    devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
    localStorage: { getItem: () => null, setItem: (k: string, v: string) => saved.push([k, v]) },
    Math,
    Date,
    JSON,
    console,
    encodeURIComponent,
    setTimeout,
    _byId: byId,
    _saved: saved,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

async function renderAll() {
  const sandbox = harness();
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: "portal.js" });
  // boot() is async and kicked off at load; wait for the fetch microtasks to settle.
  await new Promise((r) => setTimeout(r, 30));
  return sandbox;
}

test("boot renders without throwing and populates the sidebar", async () => {
  const s = await renderAll();
  assert.ok(s._byId.stafflist.children.length >= 2, "expected a nav entry per staff member");
  assert.ok(s._byId.viewlist.children.length >= 4, "expected the view switcher");
  assert.match(s._byId.orgname.textContent, /staff/);
});

test("every view renders and produces content", async () => {
  const s = await renderAll();
  for (const view of ["memory", "graph", "brain", "changed", "health", "roster"]) {
    s.view = view;
    assert.doesNotThrow(() => s.render(), `${view} threw`);
    assert.ok(s._byId.main.children.length > 0, `${view} rendered nothing`);
  }
});

test("every view renders for every staff member", async () => {
  const s = await renderAll();
  for (const staff of ORG.staff) {
    s.staffHandle = staff.handle;
    for (const view of ["memory", "graph", "brain", "changed", "health"]) {
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

test("inline() escapes markup before formatting it", async () => {
  const s = await renderAll();
  const out = s.inline('<img src=x onerror=alert(1)> **bold** `code` [[a-slug]]');
  assert.ok(!out.includes("<img"), "raw HTML must not survive");
  assert.ok(out.includes("&lt;img"), "it should be escaped");
  assert.ok(out.includes("<b>bold</b>"));
  assert.ok(out.includes('data-goto="a-slug"'));
});
