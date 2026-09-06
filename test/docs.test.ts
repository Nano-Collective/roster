import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
const prose = (body: string) =>
  body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
const cli = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");

/** Headings, as GitHub would slugify them, for checking #anchors. */
function anchors(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    out.add(m[1]!.toLowerCase()
      .replace(/`/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-"));
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
        assert.ok(anchors(read(target)).has(anchor),
          `${page} links to ${href}, but ${target} has no such heading`);
      }
    }
  }
});

test("every command the docs mention is one the CLI has", () => {
  const known = new Set(
    [...cli.matchAll(/^\s{2}(\w+): \w+Command,$/gm)].map((m) => m[1]!),
  );
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
    assert.match(commands, new RegExp(`## \`roster ${m[1]}`),
      `roster ${m[1]} exists but commands.md does not cover it`);
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
      assert.ok(src.includes(`"${flag}"`),
        `commands.md promises ${flag} for "roster ${name}", but its parser does not accept it`);
    }
  }
});

test("the agent presets the docs describe are the ones that ship", async () => {
  const { PRESETS } = await import(`file://${join(ROOT, "templates", "ops", "agents.mjs")}`) as
    { PRESETS: Record<string, any> };
  const body = read("agents.md");

  for (const id of Object.keys(PRESETS)) {
    assert.ok(body.includes(`\`${id}\``), `agents.md does not mention the "${id}" preset`);
  }
  // And the install lines quoted in the docs are the ones actually used.
  for (const [id, p] of Object.entries(PRESETS)) {
    if (p.kind !== "cli") continue;
    assert.ok(body.includes(p.install),
      `agents.md quotes an install command for ${id} that is not the one in agents.mjs`);
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
  assert.deepEqual(undocumented, [], "doctor emits these ids and doctor-codes.md does not list them");
});

test("the codes reference does not invent findings that do not exist", () => {
  const src = readFileSync(join(ROOT, "src", "commands", "doctor.ts"), "utf8");
  const ids = new Set([...src.matchAll(/\bid:\s*"([\w.-]+)"/g)].map((m) => m[1]!));
  // Ids appear in the reference as `code` in the first column of a table row.
  const claimed = [...read("doctor-codes.md").matchAll(/^\| `([\w.-]+)` \|/gm)].map((m) => m[1]!);
  const invented = claimed.filter((id) => !ids.has(id));
  assert.deepEqual(invented, [], "doctor-codes.md documents findings doctor cannot produce");
});
