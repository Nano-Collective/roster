#!/usr/bin/env node
// Composes the runtime prompt for one staff member, for one kind of run.
//
// This file is VENDORED into every tenant's ops repo on purpose: the workflow that runs an agent
// must not depend on npm, on a network call, or on an org the tenant does not control. It is also
// the single source of truth for composition - `roster prompt` imports this exact file, so what you
// see locally is byte-for-byte what the agent is sent.
//
// Dependency-free by design, including the YAML parsing. Manifests are deliberately simple enough
// for the subset below; `roster lint` enforces that.
//
// Usage:  node compose.mjs --staff cmo --kind daily [--ops .] [--brains ..]

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// A strict, tiny YAML subset: nested maps, lists of scalars, lists of inline
// maps ({a: 1, b: 2}), and scalars. Anything else is an error rather than a
// silent misparse - a manifest that needs more than this is a manifest that has
// outgrown being a manifest.
// ---------------------------------------------------------------------------

export function parseYaml(text, file = "<yaml>") {
  const lines = [];
  text.split("\n").forEach((raw, i) => {
    const noComment = stripComment(raw);
    if (!noComment.trim()) return;
    if (noComment.trim() === "---") return;
    lines.push({ n: i + 1, indent: raw.match(/^ */)[0].length, text: noComment.trimEnd() });
  });

  let pos = 0;
  const fail = (msg, line) => {
    throw new Error(`${file}:${line?.n ?? "?"} ${msg}`);
  };

  function parseBlock(indent) {
    const first = lines[pos];
    if (!first) return null;
    if (first.text.trim().startsWith("- ")) return parseList(indent);
    return parseMap(indent);
  }

  function parseMap(indent) {
    const out = {};
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent < indent) break;
      if (line.indent > indent) fail("unexpected indentation", line);
      const body = line.text.trim();
      if (body.startsWith("- ")) break;
      const m = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (!m) fail(`expected "key: value", got ${JSON.stringify(body)}`, line);
      const [, key, rest] = m;
      pos++;
      if (rest === "") {
        const next = lines[pos];
        if (next && next.indent > indent) out[key] = parseBlock(next.indent);
        else out[key] = null;
      } else {
        out[key] = parseScalar(rest, line);
      }
    }
    return out;
  }

  function parseList(indent) {
    const out = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent < indent) break;
      const body = line.text.trim();
      if (!body.startsWith("- ")) break;
      if (line.indent > indent) fail("unexpected indentation in list", line);
      const item = body.slice(2).trim();
      pos++;
      if (item.startsWith("{") && item.endsWith("}")) {
        out.push(parseInlineMap(item, line));
      } else if (/^[A-Za-z0-9_.-]+:/.test(item)) {
        // "- key: value" then possibly more keys indented under it
        const sub = { ...parseInlinePair(item, line) };
        while (pos < lines.length && lines[pos].indent > indent) {
          const c = lines[pos];
          const cm = c.text.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
          if (!cm) fail(`expected "key: value" in list item, got ${JSON.stringify(c.text.trim())}`, c);
          pos++;
          if (cm[2] === "") {
            const next = lines[pos];
            sub[cm[1]] = next && next.indent > c.indent ? parseBlock(next.indent) : null;
          } else {
            sub[cm[1]] = parseScalar(cm[2], c);
          }
        }
        out.push(sub);
      } else {
        out.push(parseScalar(item, line));
      }
    }
    return out;
  }

  function parseInlinePair(item, line) {
    const m = item.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) fail("bad list item", line);
    return { [m[1]]: m[2] === "" ? null : parseScalar(m[2], line) };
  }

  function parseInlineMap(item, line) {
    const out = {};
    for (const part of splitTopLevel(item.slice(1, -1))) {
      if (!part.trim()) continue;
      const m = part.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (!m) fail(`bad inline map entry ${JSON.stringify(part)}`, line);
      out[m[1]] = parseScalar(m[2].trim(), line);
    }
    return out;
  }

  const root = parseBlock(lines.length ? lines[0].indent : 0);
  if (pos < lines.length) fail("could not parse to end of file", lines[pos]);
  return root ?? {};
}

function stripComment(raw) {
  let out = "";
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      out += c;
      if (c === quote && raw[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) break;
    out += c;
  }
  return out;
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseScalar(raw, line) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner === "" ? [] : splitTopLevel(inner).map((s) => parseScalar(s, line));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

// ---------------------------------------------------------------------------
// Templating: {{ path.to.value }}, {{> partial.md }}, {{#if path}}…{{/if}}
// ---------------------------------------------------------------------------

const MAX_INCLUDE_DEPTH = 8;

export function render(template, ctx, readPartial, depth = 0) {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error("include depth exceeded; a partial probably includes itself");

  // Conditionals first, so an excluded block's includes are never read.
  let out = template.replace(
    /\{\{#if\s+([A-Za-z0-9_.]+)\s*\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g,
    (_, path, body) => (truthy(lookup(ctx, path)) ? body : ""),
  );

  // {{> path}} is required; {{>? path}} renders empty when absent, which is how a
  // staff member opts out of an override the org offers.
  out = out.replace(/\{\{>(\??)\s*([^}\s]+)\s*\}\}/g, (_, optional, rel) => {
    const partial = readPartial(rel);
    if (partial === null) {
      if (optional) return "";
      throw new Error(`partial not found: ${rel}`);
    }
    return render(partial, ctx, readPartial, depth + 1).replace(/\n+$/, "");
  });

  out = out.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, path) => {
    const v = lookup(ctx, path);
    if (v === undefined || v === null) throw new Error(`unknown or empty placeholder: {{${path}}}`);
    return String(v);
  });

  return out;
}

function lookup(ctx, path) {
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), ctx);
}

function truthy(v) {
  return !(v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0));
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function compose({ opsDir, brainsDir, staff, kind }) {
  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");

  const entry = (org.staff ?? []).find((s) => s.handle === staff);
  if (!entry) {
    const known = (org.staff ?? []).map((s) => s.handle).join(", ") || "none";
    throw new Error(`unknown staff handle "${staff}". org.yaml knows: ${known}`);
  }

  const brainDir = resolve(brainsDir, entry.dir ?? entry.handle);
  const staffFile = join(brainDir, "staff.yaml");
  if (!existsSync(staffFile)) throw new Error(`no staff.yaml at ${staffFile}`);
  const self = parseYaml(readFileSync(staffFile, "utf8"), `${entry.handle}/staff.yaml`);

  const peers = (org.staff ?? [])
    .filter((s) => s.handle !== staff)
    .map((s) => ({ ...s, ...(s.dir ? {} : { dir: s.handle }) }));

  const ctx = {
    org,
    human: org.human,
    ops: { dir: org.ops_dir ?? "roster-ops" },
    // `dir` lives in the org registry (it is where the checkout lands), everything
    // else lives in the staff member's own manifest.
    staff: {
      ...self,
      dir: entry.dir ?? entry.handle,
      // The repo this role contributes to but does not own. Named explicitly in the
      // prompt because "a repo you do not own" is vaguer than an agent needs.
      product: (self.works_in ?? [])[0] ?? null,
    },
    peers,
    peer: peers[0] ?? null,
    kind,
    // Convenience strings the fragments lean on, computed once here so a
    // fragment never has to do string work.
    peer_list: peers.map((p) => `- \`${p.dir}/\` - the ${p.name}'s brain`).join("\n"),
  };

  // "staff:foo.md" resolves inside the staff member's own brain repo, which is how a
  // role overrides or extends an org fragment without forking it.
  const readPartial = (rel) => {
    const p = rel.startsWith("staff:") ? join(brainDir, rel.slice(6)) : join(opsDir, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };

  const kindFile = join(opsDir, "prompts", `${kind}.md`);
  if (!existsSync(kindFile)) throw new Error(`no prompt for kind "${kind}" at ${kindFile}`);

  const body = render(readFileSync(kindFile, "utf8"), ctx, readPartial);
  return body.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.staff || !args.kind) {
    console.error("usage: node compose.mjs --staff <handle> --kind <daily|mention|pr-mention> [--ops DIR] [--brains DIR]");
    process.exit(2);
  }
  const opsDir = resolve(args.ops ?? HERE);
  const brainsDir = resolve(args.brains ?? join(opsDir, ".."));
  process.stdout.write(compose({ opsDir, brainsDir, staff: args.staff, kind: args.kind }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`compose: ${err.message}`);
    process.exit(1);
  }
}
