import { readFileSync } from "node:fs";

/**
 * Pull the `prompt:` block out of a workflow file as it exists today.
 *
 * This is migration scaffolding, not a general YAML reader: it exists so a composed
 * prompt can be diffed against the one currently being sent to the agent, and it should
 * be deleted once every staff member is migrated.
 */
export function extractLivePrompt(workflowPath: string): string {
  const lines = readFileSync(workflowPath, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*prompt:\s*\|/.test(l));
  if (start === -1) throw new Error(`no "prompt: |" block in ${workflowPath}`);

  const blockIndent = (lines[start]!.match(/^\s*/)?.[0].length ?? 0) + 2;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    const indent = line.match(/^\s*/)![0].length;
    if (indent < blockIndent) break;
    out.push(line.slice(blockIndent));
  }
  return out.join("\n").replace(/\n+$/, "") + "\n";
}
