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

function titleOf(path: string): string {
  const first = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("# "));
  return first ? first.slice(2).trim() : path.split("/").pop()!;
}
