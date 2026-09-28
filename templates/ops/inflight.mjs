#!/usr/bin/env node
// Finds the pull requests people have open on a staff member's product repos, before the prompt
// is composed, so the agent knows what a human is in the middle of changing.
//
// Written because nothing told them. While a person had a long branch open rewriting a product's
// copy, the staff opened five pull requests and nine issues chasing that same copy, and four of
// those pull requests were overtaken by the branch. Each one was reasonable on its own; none of
// them could see the branch.
//
// Vendored alongside compose.mjs for the same reason: it runs on the runner, and must not depend
// on npm. It asks GitHub through `gh`, which every runner has, and it never fails a run: with no
// answer the prompt simply has no section about it.
//
// Usage:  node roster-ops/inflight.mjs --staff cto --ops roster-ops --brains . --out .roster-run/inflight.md

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./compose.mjs";

/** Enough to see an overlap without reading a 37,000-line branch into the prompt. */
const MAX_PRS = 10;
const MAX_FILES = 20;
const MAX_DIRS = 6;

/**
 * A person, rather than one of this org's Apps or anybody else's automation.
 *
 * `gh` marks an App author as a bot and names it `app/<slug>`; a bot's own login ends `[bot]`.
 * A machine user is none of those, which is why the org's own bot logins are passed in too.
 */
export function isHuman(author, bots = []) {
  if (!author) return false;
  const login = String(author.login ?? "");
  if (!login || author.is_bot) return false;
  if (login.startsWith("app/") || /\[bot\]$/i.test(login)) return false;
  const bare = (s) => String(s).toLowerCase().replace(/\[bot\]$/, "").replace(/^app\//, "");
  return !bots.some((b) => bare(b) === bare(login));
}

/** The repos a staff member works in: their own `works_in`, or else every product repo. */
export function productRepos(org, manifest) {
  const own = (manifest?.works_in ?? []).map((w) => String(w?.repo ?? "")).filter(Boolean);
  if (own.length) return own;
  return (org.repos ?? []).filter((r) => r.role === "product").map((r) => `${org.org}/${r.name}`);
}

/** The top directories a change touches, so a wide one reads as "the copy" rather than a list. */
function directories(paths) {
  const counts = new Map();
  for (const p of paths) {
    const parts = p.split("/");
    const dir = parts.length === 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/") + "/";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_DIRS);
}

function days(iso, now) {
  const d = Math.floor((now - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

/**
 * The markdown the prompt carries, or "" for nothing in flight.
 *
 * Titles are a person's words and go in as data: compose.mjs substitutes this file as a value,
 * never renders it as a template, so a `{{` in a title cannot break a run.
 */
export function describe(found, now = Date.now()) {
  const lines = [];
  for (const { repo, prs } of found) {
    for (const pr of prs.slice(0, MAX_PRS)) {
      const paths = (pr.files ?? []).map((f) => f.path).filter(Boolean);
      const total = Math.max(pr.changedFiles ?? 0, paths.length);
      const title = String(pr.title ?? "").replace(/\s+/g, " ").trim();
      lines.push(
        `- **${repo}#${pr.number}** "${title}" by @${pr.author.login}, open ${days(pr.createdAt, now)}` +
          `, branch \`${pr.headRefName}\`${pr.isDraft ? ", draft" : ""}, ${total} file${total === 1 ? "" : "s"}`,
      );
      if (!paths.length) continue;
      if (total > MAX_FILES) {
        lines.push(`  - mostly under ${directories(paths).map(([d, n]) => `\`${d}\` (${n})`).join(", ")}`);
      }
      const shown = paths.slice(0, MAX_FILES).map((p) => `\`${p}\``).join(", ");
      const more = total - Math.min(paths.length, MAX_FILES);
      lines.push(`  - ${shown}${more > 0 ? `, and ${more} more` : ""}`);
    }
    if (prs.length > MAX_PRS) lines.push(`- and ${prs.length - MAX_PRS} more open on ${repo}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Everything open by a person, per repo. `gh` is passed in so a test never needs the network. */
export function gather({ org, manifest, gh }) {
  const bots = [manifest?.bot, manifest?.public_bot].filter(Boolean);
  const out = [];
  for (const repo of productRepos(org, manifest)) {
    let raw;
    try {
      raw = gh([
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,author,createdAt,headRefName,isDraft,changedFiles,files",
      ]);
    } catch (err) {
      // One unreadable repo is not a reason to say nothing about the others.
      console.error(`::warning::inflight: ${repo}: ${String(err.message).split("\n")[0]}`);
      continue;
    }
    const prs = JSON.parse(raw || "[]")
      .filter((pr) => isHuman(pr.author, bots))
      // Oldest first: the long-lived branch is the one most likely to be overtaking everybody.
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (prs.length) out.push({ repo, prs });
  }
  return out;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.staff) throw new Error("--staff is required");
  const opsDir = resolve(args.ops ?? ".");
  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");
  const entry = (org.staff ?? []).find((s) => s.handle === args.staff);
  if (!entry) throw new Error(`org.yaml has no staff member "${args.staff}"`);
  const manifestPath = join(resolve(args.brains ?? ".."), entry.dir ?? entry.handle, "staff.yaml");
  const manifest = existsSync(manifestPath)
    ? parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml")
    : {};

  const gh = (a) => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const text = describe(gather({ org, manifest, gh }));
  const out = resolve(args.out ?? ".roster-run/inflight.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  process.stdout.write(text || "no human pull requests open on the product repos\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    // Never the reason a run fails. Without it the prompt has no section, which is how every
    // run went before this existed.
    console.error(`::warning::inflight: ${err.message}`);
  }
}
