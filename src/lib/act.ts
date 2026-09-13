import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type AskRequest, askBody, askTitle } from "./ask.js";

const run = promisify(execFile);

export type Action = "comment" | "close" | "reopen" | "create" | "merge" | "ask";

export interface ActRequest {
  action: Action;
  repo: string;
  number?: number;
  body?: string;
  title?: string;
  labels?: string[];
  /** Only for close: GitHub's own reason, so "not planned" is expressible. */
  reason?: "completed" | "not planned";
  /**
   * Only for merge, and normally absent.
   *
   * How to merge is a question about git, not about this pull request, and answering it is not
   * the work. Left unset, the repository is asked what it allows and the first of squash, merge
   * commit, rebase that it permits is used. Set it only to override that deliberately.
   */
  mergeMethod?: "squash" | "merge" | "rebase";
  /** Only for ask: who it is for, which pull request it is about, and where they were looking. */
  ask?: AskRequest;
  /**
   * Only for ask. Post the same text on the pull request as well, so the thread the question
   * was asked in does not go silent while the answer is being written somewhere else.
   */
  alsoOnPr?: boolean;
}

const MERGE_FLAG = { squash: "--squash", merge: "--merge", rebase: "--rebase" } as const;

export interface ActResult {
  ok: true;
  action: Action;
  url?: string;
  /** Only for ask: the comment left on the pull request, when one was asked for. */
  prUrl?: string;
  /** Only for merge: how it was merged, since nobody was asked. */
  mergedBy?: "squash" | "merge" | "rebase";
  /**
   * Only for ask: the copy on the pull request did not go up, but the ask did.
   *
   * Reported rather than thrown. The tracker issue is what wakes the agent and it already
   * exists; failing the whole action here would say nothing happened, and the next click would
   * ask the same staff member the same question twice.
   */
  warning?: string;
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

  /**
   * Hand a pull request back to a staff member.
   *
   * Two writes, in an order that matters. The tracker issue is what actually wakes them, so it
   * goes first and its failure is the action's failure. The copy on the pull request is a
   * courtesy to whoever reads that thread next, and its failure is a warning: by then the ask
   * has already been made, and reporting it as an error would invite a second one.
   *
   * `repo` is the staff member's brain repo — where the issue lands — and not the repo the
   * pull request is on. The caller checks both against org.yaml.
   */
  if (action === "ask") {
    const ask = req.ask;
    if (!ask) throw new Error("an ask needs to say who it is for and what it is about");
    if (!ask.staff?.brain) throw new Error(`${ask.staff?.name ?? "they"} has no brain repo`);
    if (repo !== ask.staff.brain)
      throw new Error(`an ask goes to ${ask.staff.brain}, not to ${repo}`);
    if (!ask.body?.trim()) throw new Error("an empty ask is not an ask");

    const title = (req.title ?? "").trim() || askTitle(ask);
    const args = ["issue", "create", "--repo", repo, "--title", title, "--body-file", "-"];
    for (const l of req.labels ?? []) args.push("--label", l);
    const { stdout } = await execWithStdin(args, askBody(ask));
    const url = stdout.trim().split("\n").pop();

    if (!req.alsoOnPr) return { ok: true, action, url };

    /* What goes on the pull request is what they typed, plus where the answer will come from.
       Not the composed body: that one is written for an agent, and the diff's thread is read
       by people. */
    const note =
      `${ask.body.trim()}\n\n` +
      `— asked ${ask.staff.name} (${ask.staff.mention}): ${url ?? ask.staff.brain}`;
    try {
      const posted = await execWithStdin(
        ["issue", "comment", String(ask.pr.number), "--repo", ask.pr.repo, "--body-file", "-"],
        note,
      );
      return { ok: true, action, url, prUrl: posted.stdout.trim().split("\n").pop() };
    } catch (err) {
      return {
        ok: true,
        action,
        url,
        warning:
          `${ask.staff.name} was asked, but the copy on ${ask.pr.repo}#${ask.pr.number} ` +
          `did not go up: ${String((err as Error)?.message ?? err).split("\n")[0]}`,
      };
    }
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

  /* The only action here that cannot be taken back with another click. It never deletes the
     branch: that is a second decision, and it is not this button's to make.

     The method used to be a dropdown on the page. It is a question about git rather than about
     the pull request in front of you, and three of the four answers are wrong on any given
     repository — so it is worked out here instead, from what the repository itself allows. */
  if (action === "merge") {
    const how = req.mergeMethod ?? (await mergeMethodFor(repo));
    const flag = MERGE_FLAG[how];
    if (!flag) throw new Error(`unknown merge method "${req.mergeMethod}"`);
    const args = ["pr", "merge", n, "--repo", repo, flag];
    // A rebase produces no merge commit, so there is nothing for a body to be the body of.
    if (req.body?.trim() && how !== "rebase") args.push("--body", req.body.trim());
    await run("gh", args, { encoding: "utf8" });
    return { ok: true, action, mergedBy: how };
  }

  throw new Error(`unknown action "${action}"`);
}

/**
 * How this repository wants to be merged.
 *
 * Squash first, because a staff member's branch is a run's worth of commits and one of them is
 * the change; then a merge commit; then rebase. A repository that has turned squash off has
 * made that decision already, and asking the person at the keyboard to make it again — per
 * merge, from a dropdown — is asking them to know something the repository knows.
 *
 * A repository that cannot be read falls back to squash rather than failing: `gh pr merge` will
 * then say what is actually wrong, which is a better error than one invented here.
 */
async function mergeMethodFor(repo: string): Promise<"squash" | "merge" | "rebase"> {
  try {
    const { stdout } = await run(
      "gh",
      [
        "api",
        `repos/${repo}`,
        "--jq",
        "[.allow_squash_merge,.allow_merge_commit,.allow_rebase_merge]",
      ],
      { encoding: "utf8" },
    );
    const [squash, commit, rebase] = JSON.parse(stdout) as boolean[];
    if (squash) return "squash";
    if (commit) return "merge";
    if (rebase) return "rebase";
  } catch {
    /* offline, no access, or a shape that is not what it was: squash and let gh explain */
  }
  return "squash";
}

function execWithStdin(args: string[], input: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { encoding: "utf8" }, (err, stdout) =>
      err ? reject(err) : resolve({ stdout }),
    );
    child.stdin?.end(input);
  });
}
