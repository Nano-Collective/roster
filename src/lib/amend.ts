import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptView } from "./prompt.js";
import { briefTemplateDir } from "./render.js";
import type { Workspace } from "./workspace.js";

/**
 * A prompt you paste into your own AI to change what an agent is told.
 *
 * The brief carries the state rather than asking for it: the composed prompt as it stands, and
 * every file it was assembled from. Someone amending a prompt does not know which of eight
 * files to open — that is the whole difficulty — so a brief that says "read your layers first"
 * has handed the hard part back.
 *
 * Long on purpose. It is one paste into a model with a large context, and the alternative is
 * six rounds of the model asking for files.
 */
export function amendBrief(
  ws: Workspace,
  view: PromptView,
  tokens: Record<string, string>,
  want: string,
): string {
  const template = readFileSync(join(briefTemplateDir(), "amend.md"), "utf8");
  const head = template.replace(/%%([A-Z_]+)%%/g, (m, name: string) => {
    if (name === "WANT") return want.trim() || WANT_PLACEHOLDER;
    return tokens[name] ?? m;
  });

  const parts = [head, "", "---", "", `## The ${view.kind} prompt as it composes today`, ""];
  parts.push(fence(view.composed), "");

  parts.push("---", "", "## Every file it is assembled from, in order", "");
  for (const layer of view.layers) {
    if (layer.missing) {
      parts.push(`### ${layer.rel}`, "", `Optional, and this staff member has none.`, "");
      continue;
    }
    parts.push(`### ${layer.path}`, "", `Reaches ${reach(layer.rel)}.`, "");
    parts.push(fence(read(ws, layer.path)), "");
  }

  parts.push("---", "", "## Named by the prompt, not contained in it", "");
  parts.push(
    "The prompt tells the agent to open these at run time. Changing one changes what the",
    "agent does without changing a byte of the text above.",
    "",
  );
  for (const layer of view.runtime) {
    if (layer.missing) continue;
    parts.push(`- \`${layer.path}\` — ${size(read(ws, layer.path))}`);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

const WANT_PLACEHOLDER =
  "**Replace this line with what you want changed**, then send the whole message.";

/** Said once per layer, because it is the thing that decides which file to edit. */
function reach(rel: string): string {
  return rel.startsWith("staff:") ? "this staff member only" : "every staff member";
}

function read(ws: Workspace, rel: string): string {
  const full = join(ws.root, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function size(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).length;
  return `${words.toLocaleString()} words`;
}

/* A fence long enough that a fence inside the content cannot close it. These files contain
   fenced examples, and a three-backtick wrapper round them ends the block early and puts the
   rest of the prompt outside it. */
function fence(text: string): string {
  const longest = (text.match(/`{3,}/g) ?? []).reduce((n, m) => Math.max(n, m.length), 2);
  const bars = "`".repeat(longest + 1);
  return `${bars}\n${text.trimEnd()}\n${bars}`;
}
