import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { docsDir } from "./docs.js";

/** The worked charters in docs/charters/, by the role each one is written for. */
export const CHARTER_EXAMPLES = ["cto", "cmo", "support"] as const;

/**
 * Which example a staff member's charter is most like, from its handle and role name.
 *
 * A guess, and said to be one: the brief names it and says how to pick another. Nothing is
 * chosen for a role none of them resembles, because a CTO's charter held up as the model for a
 * finance role teaches the wrong shape.
 */
export function matchExample(handle: string, name = ""): string | undefined {
  if ((CHARTER_EXAMPLES as readonly string[]).includes(handle)) return handle;
  const words = `${handle} ${name}`.toLowerCase();
  if (/\b(cto|tech\w*|engineer\w*|dev\w*|platform)\b/.test(words)) return "cto";
  if (/\b(cmo|market\w*|growth|brand|content|comms)\b/.test(words)) return "cmo";
  if (/\b(support|help\w*|success|customer\w*|cs|care)\b/.test(words)) return "support";
  return undefined;
}

/**
 * The example as a section of a brief: something to model the shape on, never the content.
 *
 * Carried inside the brief rather than linked, because the thing reading it is usually a chat
 * window that cannot follow a link, and one that can would still be reading a file outside
 * the workspace it was told about.
 */
export function exampleSection(choice: string): string {
  const path = join(docsDir(), "charters", `${choice}.md`);
  if (!existsSync(path)) throw new Error(`there is no example charter called "${choice}"`);
  return [
    "## A worked example, to adapt",
    "",
    `Below is an invented company's ${choice === "support" ? "Head of Support" : choice.toUpperCase()}`,
    "charter. Use it for its shape: which sections there are, how long it is, how specific the",
    "decision rights get. Do not copy its content. Every specific in it belongs to Acme, and a",
    "charter built from someone else's specifics is the generic agent this file exists to",
    "prevent. The interview still comes first, and everything in the charter comes from it.",
    "",
    fence(readFileSync(path, "utf8")),
    "",
  ].join("\n");
}

/** Said when nothing matched, so the choice is visible rather than silently skipped. */
export function exampleOffer(handle: string): string {
  return [
    "## Worked examples",
    "",
    `No worked example obviously matches "${handle}". There are three to model a charter on:`,
    `${CHARTER_EXAMPLES.join(", ")}. \`roster brief charter ${handle} --example <one>\` includes one.`,
    "",
  ].join("\n");
}

function fence(text: string): string {
  const longest = (text.match(/`{3,}/g) ?? []).reduce((n, m) => Math.max(n, m.length), 2);
  const bars = "`".repeat(longest + 1);
  return `${bars}markdown\n${text.trimEnd()}\n${bars}`;
}
