import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The memory index is markdown on purpose: agents write prose well and structured data badly,
 * and a YAML memory produces diffs nobody reads. The cost is that the grammar has to be
 * enforced rather than assumed, which is what this parser and `roster lint` are for.
 *
 *   - **`slug`** · [source] fact, one line. **So:** what it changes. · [note](notes/slug.md)
 *
 * Provenance and the note link are optional; the slug, the fact and the `So:` are not.
 */
export interface Fact {
  slug: string;
  section: string;
  /** Where the fact came from. Absent until a staff member starts marking them. */
  provenance?: "will" | "measured" | "derived" | string;
  /** The claim itself, without the `So:` clause. */
  statement: string;
  /** What the fact changes. A fact without one is trivia and lint says so. */
  consequence: string;
  note?: string;
  line: number;
  raw: string;
}

export interface MemoryDoc {
  facts: Fact[];
  sections: string[];
  /** Notes on disk, whether or not any fact links to them. */
  notes: string[];
  preamble: string;
  links: Link[];
}

/**
 * An edge in the brain graph. `wikilink` is deliberate authoring ([[slug]]); the rest are
 * inferred, so the graph is useful before anyone has written a single link by hand.
 */
export interface Link {
  from: string;
  to: string;
  kind: "note" | "wikilink" | "mention" | "issue" | "path";
  /** Inferred edges are weaker evidence than authored ones, and the portal draws them fainter. */
  inferred: boolean;
}

const FACT_RE = /^- \*\*`([^`]+)`\*\*\s*·\s*(.*)$/;
const PROVENANCE_RE = /^\[([a-z][a-z0-9-]*)\]\s*/;
const NOTE_RE = /\s*·?\s*\[note\]\(([^)]+)\)\s*$/;
const SO_RE = /\*\*So:\*\*\s*/;

export function parseMemory(dir: string): MemoryDoc {
  const indexPath = join(dir, "INDEX.md");
  if (!existsSync(indexPath)) throw new Error(`no memory index at ${indexPath}`);

  const lines = readFileSync(indexPath, "utf8").split("\n");
  const facts: Fact[] = [];
  const sections: string[] = [];
  const preamble: string[] = [];
  let section = "";
  let seenFirstFact = false;

  lines.forEach((raw, i) => {
    const heading = raw.match(/^##\s+(.*)$/);
    if (heading) {
      section = heading[1]!.trim();
      sections.push(section);
      return;
    }

    const m = raw.match(FACT_RE);
    if (!m) {
      if (!seenFirstFact) preamble.push(raw);
      return;
    }
    seenFirstFact = true;

    const [, slug, restRaw] = m;
    let rest = restRaw!;

    let note: string | undefined;
    const noteMatch = rest.match(NOTE_RE);
    if (noteMatch) {
      note = noteMatch[1];
      rest = rest.slice(0, noteMatch.index).trimEnd();
    }

    let provenance: string | undefined;
    const prov = rest.match(PROVENANCE_RE);
    if (prov) {
      provenance = prov[1];
      rest = rest.slice(prov[0].length);
    }

    // Split on the `So:` marker. A fact without one still parses, so the portal can show it
    // and lint can complain about it, rather than the line vanishing.
    const so = rest.split(SO_RE);
    facts.push({
      slug: slug!,
      section,
      provenance,
      statement: so[0]!.trim().replace(/\s+/g, " "),
      consequence: (so[1] ?? "").trim().replace(/\s+/g, " "),
      note,
      line: i + 1,
      raw,
    });
  });

  const notesDir = join(dir, "notes");
  const notes = existsSync(notesDir)
    ? readdirSync(notesDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];

  return {
    facts,
    sections,
    notes,
    preamble: preamble.join("\n").trim(),
    links: extractLinks(facts, notes, dir),
  };
}

const WIKILINK_RE = /\[\[([a-z0-9-]+)\]\]/g;
const ISSUE_RE = /(?:^|[\s(])#(\d{1,4})\b/g;
const PATH_RE = /`([a-zA-Z0-9_./-]+\.(?:ts|tsx|mjs|js|md|yaml|yml|json|sql))`/g;

/**
 * Build the graph. Authored edges come from [[slug]] and note links; the rest are inferred
 * from what agents already write anyway, so the graph is worth looking at on day one rather
 * than only after someone has hand-linked a hundred facts.
 */
function extractLinks(facts: Fact[], notes: string[], dir: string): Link[] {
  const links: Link[] = [];
  const bySlug = new Set(facts.map((f) => f.slug));
  const push = (from: string, to: string, kind: Link["kind"], inferred: boolean) => {
    if (from === to) return;
    if (links.some((l) => l.from === from && l.to === to && l.kind === kind)) return;
    links.push({ from, to, kind, inferred });
  };

  const scan = (from: string, text: string) => {
    for (const m of text.matchAll(WIKILINK_RE)) push(from, m[1]!, "wikilink", false);
    for (const m of text.matchAll(ISSUE_RE)) push(from, `#${m[1]}`, "issue", true);
    for (const m of text.matchAll(PATH_RE)) push(from, m[1]!, "path", true);
    // A slug in backticks is how agents already cross-reference before wikilinks exist.
    for (const slug of bySlug) {
      if (from !== slug && text.includes("`" + slug + "`")) push(from, slug, "mention", true);
    }
  };

  for (const f of facts) {
    if (f.note) push(f.slug, f.note.replace(/^notes\//, ""), "note", false);
    scan(f.slug, f.raw);
  }

  for (const note of notes) {
    const path = join(dir, "notes", note);
    if (!existsSync(path)) continue;
    scan(note, readFileSync(path, "utf8"));
  }

  return links;
}

export interface LintProblem {
  level: "error" | "warning";
  rule: string;
  message: string;
  line?: number;
  slug?: string;
}

/** The line length beyond which "one line per fact" has stopped being true. */
const MAX_FACT_CHARS = 400;

export function lintMemory(doc: MemoryDoc, dir: string): LintProblem[] {
  const problems: LintProblem[] = [];
  const seen = new Map<string, number>();
  const linked = new Set<string>();

  for (const f of doc.facts) {
    const at = { line: f.line, slug: f.slug };

    if (!f.consequence) {
      problems.push({
        level: "error",
        rule: "no-consequence",
        message: `\`${f.slug}\` has no **So:** clause. If you cannot say what it changes, it is not memory.`,
        ...at,
      });
    }

    const first = seen.get(f.slug);
    if (first !== undefined) {
      problems.push({
        level: "error",
        rule: "duplicate-slug",
        message: `\`${f.slug}\` is already defined on line ${first}. Correct that one in place.`,
        ...at,
      });
    } else {
      seen.set(f.slug, f.line);
    }

    if (f.note) {
      linked.add(f.note.replace(/^notes\//, ""));
      if (!existsSync(join(dir, f.note))) {
        problems.push({
          level: "error",
          rule: "dangling-note",
          message: `\`${f.slug}\` links ${f.note}, which does not exist.`,
          ...at,
        });
      }
    }

    if (/\bupdated:/i.test(f.raw)) {
      problems.push({
        level: "error",
        rule: "update-chain",
        message: `\`${f.slug}\` appends an update. Correct the fact in place; that chain is how one fact became six paragraphs.`,
        ...at,
      });
    }

    if (f.raw.length > MAX_FACT_CHARS) {
      problems.push({
        level: "warning",
        rule: "too-long",
        message: `\`${f.slug}\` is ${f.raw.length} characters. Move the argument to notes/${f.slug}.md and keep the line one line.`,
        ...at,
      });
    }

    // A measurement without a denominator is the failure this whole discipline exists to stop.
    if (f.provenance === "measured" && !/\bn\s*=|\bn of\b|\d+\s*of\s*\d+/i.test(f.raw)) {
      problems.push({
        level: "warning",
        rule: "measurement-without-n",
        message: `\`${f.slug}\` is marked [measured] but shows no sample size.`,
        ...at,
      });
    }
  }

  for (const note of doc.notes) {
    if (!linked.has(note)) {
      problems.push({
        level: "warning",
        rule: "orphaned-note",
        message: `notes/${note} is linked from no fact. Either link it or delete it.`,
      });
    }
  }

  // A [[slug]] pointing at nothing is a broken cross-reference, and the graph would draw a
  // node for a fact that does not exist.
  const known = new Set(doc.facts.map((f) => f.slug));
  for (const link of doc.links) {
    if (link.kind !== "wikilink" || known.has(link.to)) continue;
    const source = doc.facts.find((f) => f.slug === link.from);
    problems.push({
      level: "error",
      rule: "dangling-wikilink",
      message: `[[${link.to}]] does not match any fact. Fix the slug or write the fact.`,
      line: source?.line,
      slug: link.from,
    });
  }

  return problems;
}
