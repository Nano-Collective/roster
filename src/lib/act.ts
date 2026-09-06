import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Action = "comment" | "close" | "reopen" | "create";

export interface ActRequest {
  action: Action;
  repo: string;
  number?: number;
  body?: string;
  title?: string;
  labels?: string[];
  /** Only for close: GitHub's own reason, so "not planned" is expressible. */
  reason?: "completed" | "not planned";
}

export interface ActResult {
  ok: true;
  action: Action;
  url?: string;
}

/**
 * Write actions, through the human's own `gh`.
 *
 * Everything here posts **as the human**, not as any staff member. That is the point: the
 * portal is where a person answers their agents, and a reply typed here should be
 * indistinguishable from one typed on github.com.
 *
 * The caller is responsible for checking the repo is one of ours; this only validates shape.
 */
export async function act(req: ActRequest): Promise<ActResult> {
  const { action, repo } = req;

  if (action === "create") {
    const title = (req.title ?? "").trim();
    if (!title) throw new Error("an issue needs a title");
    const args = ["issue", "create", "--repo", repo, "--title", title, "--body", req.body ?? ""];
    for (const l of req.labels ?? []) args.push("--label", l);
    const { stdout } = await run("gh", args, { encoding: "utf8" });
    return { ok: true, action, url: stdout.trim().split("\n").pop() };
  }

  const number = req.number;
  if (!Number.isInteger(number) || (number as number) <= 0)
    throw new Error("a valid issue number is required");
  const n = String(number);

  if (action === "comment") {
    const body = (req.body ?? "").trim();
    if (!body) throw new Error("an empty comment is not a comment");
    // --body-file - keeps the text off the command line, so newlines and quotes survive
    // whatever someone types into the box.
    const { stdout } = await execWithStdin(
      ["issue", "comment", n, "--repo", repo, "--body-file", "-"],
      body,
    );
    return { ok: true, action, url: stdout.trim().split("\n").pop() };
  }

  if (action === "close") {
    const args = ["issue", "close", n, "--repo", repo];
    if (req.reason) args.push("--reason", req.reason);
    if (req.body?.trim()) args.push("--comment", req.body.trim());
    await run("gh", args, { encoding: "utf8" });
    return { ok: true, action };
  }

  if (action === "reopen") {
    await run("gh", ["issue", "reopen", n, "--repo", repo], { encoding: "utf8" });
    return { ok: true, action };
  }

  throw new Error(`unknown action "${action}"`);
}

function execWithStdin(args: string[], input: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { encoding: "utf8" }, (err, stdout) =>
      err ? reject(err) : resolve({ stdout }),
    );
    child.stdin?.end(input);
  });
}
