import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The portal UI is a real .html file rather than a template literal, so it can be opened,
 * edited and diffed like a page instead of like an escaped string.
 *
 * Resolved at run time because the bundled entry point lives in dist/ while the templates
 * sit beside it in the published package.
 */
function locate(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates", "portal", "index.html"), // src/portal → package root
    join(here, "..", "templates", "portal", "index.html"), // dist → package root
  ];
  for (const path of candidates) if (existsSync(path)) return path;
  throw new Error(`portal UI not found. Looked in:\n  ${candidates.join("\n  ")}`);
}

export const PORTAL_HTML = readFileSync(locate(), "utf8");
