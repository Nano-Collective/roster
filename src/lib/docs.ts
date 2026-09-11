import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DocPage {
  file: string;
  title: string;
}

/** The framework's docs, resolved the same way its templates are. */
export function docsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "..", "docs"), join(here, "..", "docs")];
  for (const path of candidates) if (existsSync(path)) return path;
  throw new Error(`docs not found. Looked in:\n  ${candidates.join("\n  ")}`);
}

/**
 * Every page, in reading order.
 *
 * The order comes from the index's own link list rather than from the filesystem: the docs are
 * written to be read in a particular sequence, and alphabetical would open on "agents".
 */
export function docPages(): DocPage[] {
  const dir = docsDir();
  const all = readdirSync(dir).filter((f) => f.endsWith(".md"));

  const index = readFileSync(join(dir, "README.md"), "utf8");
  const ordered = [...index.matchAll(/\[([^\]]+)\]\(([\w.-]+\.md)\)/g)]
    .map((m) => ({ title: m[1]!, file: m[2]! }))
    .filter((d, i, xs) => all.includes(d.file) && xs.findIndex((x) => x.file === d.file) === i);

  const listed = new Set(ordered.map((d) => d.file));
  const rest = all
    .filter((f) => f !== "README.md" && !listed.has(f))
    .map((file) => ({ file, title: titleOf(join(dir, file)) }));

  return [{ file: "README.md", title: "Overview" }, ...ordered, ...rest];
}

export interface DocHit extends DocPage {
  /** Higher is a better answer. Ordering only; the number itself means nothing. */
  score: number;
  /** Where the words actually appear, as lines, for showing under the row. */
  matches: Array<{ line: number; text: string }>;
}

/**
 * Search every page, not just their titles.
 *
 * The docs are twenty-odd pages: too many to scan by eye, few enough to read in full on every
 * keystroke. Which is the point — the thing you are usually looking for ("which page explains
 * the mention gate") is a phrase in a paragraph, and a title filter cannot find it.
 *
 * A page matches when it contains **every** word asked for, anywhere. Ranking then prefers a
 * title hit, then a heading hit, then sheer frequency, because the page *about* prompts beats
 * the four pages that mention them once.
 */
export function searchDocs(query: string, snippets = 3): DocHit[] {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return [];

  const dir = docsDir();
  const out: DocHit[] = [];

  for (const page of docPages()) {
    const text = readFileSync(join(dir, page.file), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
    const haystack = (page.title + "\n" + text).toLowerCase();
    if (!terms.every((t) => haystack.includes(t))) continue;

    const title = page.title.toLowerCase();
    const matches: DocHit["matches"] = [];
    let body = 0;

    text.split("\n").forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const hits = terms.filter((t) => line.toLowerCase().includes(t)).length;
      if (!hits) return;
      // A line carrying all of them is worth more than three lines carrying one each, and a
      // heading is worth more than either: it is the page saying that is what it is about.
      body += hits === terms.length ? 2 : 1;
      if (line.startsWith("#")) body += 8;
      if (matches.length < snippets) {
        matches.push({ line: i + 1, text: snippet(line, terms) });
      }
    });

    /* The title wins, and frequency is capped. Uncapped, the reference page that mentions
       `org.yaml` on every line beats the page *called* "org.yaml reference", which is the
       wrong answer to "where is org.yaml documented" every single time. */
    out.push({
      ...page,
      score: terms.filter((t) => title.includes(t)).length * 100 + Math.min(body, 60),
      matches,
    });
  }

  // Stable within a score: docPages() is reading order, which is a better tiebreak than a name.
  return out.sort((a, b) => b.score - a.score);
}

/** A readable window around the first word that matched, rather than the head of the line. */
function snippet(line: string, terms: string[], width = 150): string {
  const clean = line.replace(/^#+\s*/, "").replace(/^[-*|]\s*/, "");
  if (clean.length <= width) return clean;
  const at = Math.min(
    ...terms.map((t) => clean.toLowerCase().indexOf(t)).filter((n) => n >= 0),
    clean.length,
  );
  const from = Math.max(0, at - 40);
  return (from ? "…" : "") + clean.slice(from, from + width).trim() + "…";
}

function titleOf(path: string): string {
  const first = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("# "));
  return first ? first.slice(2).trim() : path.split("/").pop()!;
}
