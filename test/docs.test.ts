import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { docPages, searchDocs } from "../src/lib/docs.js";
import { testWorkspace } from "./helpers/workspace.js";

/**
 * Documentation rots quietly. These tests hold it to the code: every command it mentions has to
 * exist, every flag has to be one the parser accepts, and every link has to go somewhere.
 *
 * What they cannot check is whether the prose is true. That part is still on whoever writes it.
 */

const ROOT = join(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs");
const pages = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
const read = (f: string) => readFileSync(join(DOCS, f), "utf8");

/** Prose only. A grammar shown inside a fence is an example, not a link to follow. */
const prose = (body: string) => body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
const cli = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");

/** Headings, as GitHub would slugify them, for checking #anchors. */
function anchors(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    out.add(
      m[1]!
        .toLowerCase()
        .replace(/`/g, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-"),
    );
  }
  return out;
}

test("there is documentation, and the index links to all of it", () => {
  assert.ok(pages.length >= 8, `expected a docs site, found ${pages.length} pages`);
  const index = read("README.md");
  for (const page of pages) {
    if (page === "README.md") continue;
    assert.ok(index.includes(`(${page})`), `${page} is not linked from the index`);
  }
});

test("every link between pages goes somewhere", () => {
  for (const page of pages) {
    for (const m of prose(read(page)).matchAll(/\]\(([^)]+)\)/g)) {
      const href = m[1]!;
      if (/^(https?:|mailto:)/.test(href)) continue;

      const [file, anchor] = href.split("#");
      const target = file ? file : page;
      if (file) {
        assert.ok(existsSync(join(DOCS, file)), `${page} links to ${file}, which does not exist`);
      }
      if (anchor) {
        assert.ok(
          anchors(read(target)).has(anchor),
          `${page} links to ${href}, but ${target} has no such heading`,
        );
      }
    }
  }
});

test("every command the docs mention is one the CLI has", () => {
  const known = new Set([...cli.matchAll(/^\s{2}(\w+): \w+Command,$/gm)].map((m) => m[1]!));
  assert.ok(known.size >= 8, `expected to find the command table in cli.ts, found ${known.size}`);

  for (const page of pages) {
    for (const m of read(page).matchAll(/`roster (\w+)/g)) {
      const cmd = m[1]!;
      if (cmd === "help") continue;
      assert.ok(known.has(cmd), `${page} documents "roster ${cmd}", which the CLI does not have`);
    }
  }
});

test("every command the CLI has is documented", () => {
  const commands = readFileSync(join(ROOT, "docs", "commands.md"), "utf8");
  for (const m of cli.matchAll(/^\s{2}(\w+): \w+Command,$/gm)) {
    assert.match(
      commands,
      new RegExp(`## \`roster ${m[1]}`),
      `roster ${m[1]} exists but commands.md does not cover it`,
    );
  }
});

test("every flag the docs promise is one the parser accepts", () => {
  /* The failure this catches is a flag renamed in code and left in the docs, which reads as a
     bug in the tool rather than a stale sentence. */
  const sources: Record<string, string> = {};
  for (const f of readdirSync(join(ROOT, "src", "commands"))) {
    sources[f.replace(".ts", "")] = readFileSync(join(ROOT, "src", "commands", f), "utf8");
  }

  const commands = read("commands.md");
  // Each "## `roster <cmd>" section owns the flags until the next one.
  const sections = commands.split(/^## /m).slice(1);
  for (const section of sections) {
    const name = /^`roster (\w+)/.exec(section)?.[1];
    if (!name) continue;
    const src = sources[name];
    if (!src) continue;

    for (const m of section.matchAll(/^(--[a-z-]+)/gm)) {
      const flag = m[1]!;
      if (flag === "--ops") continue; // common to all, parsed everywhere
      assert.ok(
        src.includes(`"${flag}"`),
        `commands.md promises ${flag} for "roster ${name}", but its parser does not accept it`,
      );
    }
  }
});

test("the agent presets the docs describe are the ones that ship", async () => {
  const { PRESETS } = (await import(`file://${join(ROOT, "templates", "ops", "agents.mjs")}`)) as {
    PRESETS: Record<string, any>;
  };
  const body = read("agents.md");

  for (const id of Object.keys(PRESETS)) {
    assert.ok(body.includes(`\`${id}\``), `agents.md does not mention the "${id}" preset`);
  }
  // And the install lines quoted in the docs are the ones actually used.
  for (const [id, p] of Object.entries(PRESETS)) {
    if (p.kind !== "cli") continue;
    assert.ok(
      body.includes(p.install),
      `agents.md quotes an install command for ${id} that is not the one in agents.mjs`,
    );
  }
});

test("the docs do not use em-dashes", () => {
  // org/voice.md rules them out, and these pages are prose written for the same reader.
  for (const page of pages) {
    const body = read(page);
    const line = body.split("\n").findIndex((l) => l.includes("—"));
    assert.equal(line, -1, `${page}:${line + 1} uses an em-dash`);
  }
});

test("every finding doctor can emit is in the codes reference", () => {
  /* A reference page is exactly the kind that goes stale invisibly: a new check ships, nobody
     documents it, and the id in someone's --json output means nothing to them. */
  const src = readFileSync(join(ROOT, "src", "commands", "doctor.ts"), "utf8");
  const ids = new Set<string>();
  for (const m of src.matchAll(/\bid:\s*"([\w.-]+)"/g)) ids.add(m[1]!);
  assert.ok(ids.size >= 20, `expected doctor to have many findings, found ${ids.size}`);

  const page = read("doctor-codes.md");
  const undocumented = [...ids].filter((id) => !page.includes(`\`${id}\``)).sort();
  assert.deepEqual(
    undocumented,
    [],
    "doctor emits these ids and doctor-codes.md does not list them",
  );
});

test("the codes reference does not invent findings that do not exist", () => {
  const src = readFileSync(join(ROOT, "src", "commands", "doctor.ts"), "utf8");
  const ids = new Set([...src.matchAll(/\bid:\s*"([\w.-]+)"/g)].map((m) => m[1]!));
  // Ids appear in the reference as `code` in the first column of a table row.
  const claimed = [...read("doctor-codes.md").matchAll(/^\| `([\w.-]+)` \|/gm)].map((m) => m[1]!);
  const invented = claimed.filter((id) => !ids.has(id));
  assert.deepEqual(invented, [], "doctor-codes.md documents findings doctor cannot produce");
});

test("every session.yaml input and secret is in the workflow reference", () => {
  const yaml = readFileSync(
    join(ROOT, "templates", "ops", ".github", "workflows", "session.yaml"),
    "utf8",
  );
  const block = (name: string) => {
    const at = yaml.indexOf(`    ${name}:\n`);
    const end = name === "inputs" ? yaml.indexOf("    secrets:") : yaml.indexOf("permissions:");
    return yaml.slice(at, end);
  };
  const names = (name: string) =>
    [...block(name).matchAll(/^ {6}([a-z_A-Z]+):$/gm)].map((m) => m[1]!);

  const page = read("session-workflow.md");
  for (const input of names("inputs")) {
    assert.ok(
      page.includes(`\`${input}\``),
      `session.yaml takes "${input}" and the reference omits it`,
    );
  }
  for (const secret of names("secrets")) {
    assert.ok(
      page.includes(`\`${secret}\``),
      `session.yaml declares secret "${secret}" and the reference omits it`,
    );
  }
});

test("every manifest field the code reads is in the staff.yaml reference", () => {
  /* The reference is only worth having if it is complete. A field added to the renderer and
     left undocumented is a field nobody knows they can set. */
  const src = readFileSync(join(ROOT, "src", "lib", "render.ts"), "utf8");
  const fields = new Set(
    [...src.matchAll(/\bm\.([a-z_]+)\b/g)].map((m) => m[1]!).filter((f) => f !== "identities"),
  );
  assert.ok(
    fields.size >= 10,
    `expected specFromManifest to read many fields, found ${fields.size}`,
  );

  const page = read("staff-yaml.md");
  const missing = [...fields].filter((f) => !page.includes(`\`${f}\``)).sort();
  assert.deepEqual(
    missing,
    [],
    "specFromManifest reads these and staff-yaml.md does not document them",
  );
});

test("the export reference matches the shape the exporter actually produces", async () => {
  const { buildExport } = await import("../src/lib/export.js");
  const { loadComposer, readOrg } = await import("../src/lib/workspace.js");
  const ws = await testWorkspace();
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = buildExport(ws, readOrg(ws.opsDir, parseYaml) as never, parseYaml);

  const page = read("export.md");
  // A list is documented as `name[]`, a scalar as `name`. Either spelling counts.
  const documented = (key: string) => page.includes(`\`${key}\``) || page.includes(`\`${key}[]\``);

  for (const key of Object.keys(org)) {
    assert.ok(documented(key), `export produces "${key}" and export.md does not mention it`);
  }
  const staff = org.staff[0];
  if (!staff) return;
  for (const key of Object.keys(staff)) {
    assert.ok(documented(key), `a staff member has "${key}" and export.md does not mention it`);
  }
  for (const key of Object.keys(staff.rig)) {
    assert.ok(documented(key), `rig has "${key}" and export.md does not mention it`);
  }
});

test("portal.md names every screen the router can show", () => {
  /* `portal.md` is titled "every view and every action" and spent this whole build describing
     a portal that no longer existed, with the docs gate passing throughout. That gate checks
     command names, flags and doctor ids; nothing checked prose. This is the cheapest thing
     that would have caught it. */
  const app = readFileSync(join(ROOT, "templates", "portal", "js", "app.js"), "utf8");
  const screens = [...app.matchAll(/^\s{2}(\w+): view\w+,$/gm)].map((m) => m[1]!);
  assert.ok(
    screens.length >= 8,
    `expected the router to register screens, found ${screens.length}`,
  );

  /* A screen id is code and its heading is prose, so the two are allowed to differ. Where
     they do, say so here rather than renaming a heading to satisfy a test. */
  const HEADING: Record<string, string> = {
    changed: "what changed",
    memory: "brain",
    // The screen is `prs` in the router and "Pending work" on the page: what is behind it is
    // finished work waiting on you, and the word for how it arrives is not the word for what
    // it is.
    prs: "pending work",
  };
  const page = read("portal.md").toLowerCase();
  const missing = screens
    .map((s) => HEADING[s] ?? s)
    .filter((h, i, all) => all.indexOf(h) === i)
    .filter((h) => !new RegExp(`^## ${h}\\b`, "m").test(page));
  assert.deepEqual(missing, [], `portal.md documents no section for: ${missing.join(", ")}`);

  // Setup is not in the router — it replaces the whole shell — so it is checked by name.
  assert.match(read("portal.md"), /^## Setup$/m, "portal.md must cover the setup screen");
});

/* ------------------------------ searching them ----------------------------- */

/**
 * The portal's docs screen filtered titles, which cannot find the thing you are usually
 * after: a sentence in a paragraph. These hold the search to the two properties that make it
 * worth having — it reads the bodies, and the page *about* a thing outranks the four that
 * mention it once.
 */

test("search finds a phrase in a body, not just in a title", () => {
  const hits = searchDocs("mention gate");
  assert.ok(hits.length, "nothing matched a phrase that is certainly in the docs");
  assert.ok(
    hits.every((h) => h.matches.length),
    "every hit should carry the lines it matched, or the result is unreadable",
  );
  assert.ok(
    hits.some((h) => !h.title.toLowerCase().includes("mention")),
    "a title filter would have found none of these",
  );
});

test("every word has to appear, so two words narrow rather than widen", () => {
  const one = searchDocs("upgrade");
  const two = searchDocs("upgrade conflict");
  assert.ok(one.length >= two.length, "adding a word should never add pages");
  assert.equal(searchDocs("upgrade zzzzunfindable").length, 0);
});

test("the page about a thing outranks the pages that mention it", () => {
  const hits = searchDocs("org.yaml");
  assert.equal(hits[0]!.file, "org-yaml.md", "ranked: " + hits.map((h) => h.file).join(", "));
});

test("an empty query is not a search", () => {
  assert.deepEqual(searchDocs(""), []);
  assert.deepEqual(searchDocs("   "), []);
});

test("a hit is a page the portal will actually serve", () => {
  // /api/doc only serves what /api/docs listed, so a result that is not in that list is a
  // row you can click and get a 404 from.
  const listed = new Set(docPages().map((d) => d.file));
  for (const hit of searchDocs("agent")) assert.ok(listed.has(hit.file), hit.file);
});
