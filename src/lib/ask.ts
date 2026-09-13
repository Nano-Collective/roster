/**
 * Handing a pull request back to a staff member.
 *
 * A pull request lives in the product repo. Nothing in the product repo wakes an agent, and
 * deliberately so: a run started from a public comment executes with repository secrets, and a
 * run that prints a charter and a chain of reasoning would print it into a world-readable log.
 * The `pr-mention` forwarder that once bridged that gap was removed for costing more than it
 * bought — see docs/concepts.md.
 *
 * What it left behind was a round trip: read the diff, leave the thread, open an issue on the
 * right tracker, retype the context, paste the link. This module is that round trip, composed
 * once, so the portal can do it from where you are already standing.
 *
 * Everything here is a pure function over text. The writing is `act()`'s job, through the
 * human's own `gh` — which already reaches both repositories, which is exactly why this needs
 * no forwarder, no dispatch, and no credential on a public repo.
 */

/** The staff member being asked. Their brain repo is the only place an issue reaches them. */
export interface AskStaff {
  handle: string;
  name: string;
  /** `@cto`. Their workflow gates on this string, so it is carried rather than rebuilt. */
  mention: string;
  /** owner/name of their brain repo. */
  brain: string;
}

export interface AskPr {
  /** owner/name of the repo the pull request is on. */
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Branch names, when the portal has already fetched the detail. */
  head?: string;
  base?: string;
}

/** The file they were looking at when they asked, if they asked from the Files tab. */
export interface AskAnchor {
  path: string;
  /** The unified diff for that one file, as GitHub sends it. Optional and often large. */
  patch?: string;
}

export interface AskRequest {
  staff: AskStaff;
  pr: AskPr;
  /** What the human typed. */
  body: string;
  anchor?: AskAnchor;
}

/**
 * How much of a hunk to carry into the tracker.
 *
 * The agent checks the product repo out and can read the whole diff itself, so this is here to
 * say *which part they meant*, not to be the diff. Past about this much it has stopped being a
 * pointer and started being a copy, and a copy goes stale the moment anyone pushes.
 */
const MAX_PATCH_LINES = 40;

/**
 * The tracker issue's title.
 *
 * Led by the pull request rather than by the question, because this lands in a list beside a
 * dozen other asks and "which PR is this" is the thing being scanned for. Truncated at a width
 * GitHub does not itself truncate.
 */
export function askTitle(req: AskRequest): string {
  const name = req.pr.repo.split("/")[1] ?? req.pr.repo;
  const head = `${name}#${req.pr.number} — `;
  const room = 120 - head.length;
  const title = req.pr.title.trim() || "a pull request";
  return head + (title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title);
}

/**
 * The tracker issue's body.
 *
 * Four things have to be true or this reaches nobody and does nothing:
 *
 * 1. The mention is first, because that is the mechanism — the caller workflow gates on it.
 * 2. What the human typed is next and unedited. It is the actual request; everything under the
 *    rule is provenance.
 * 3. The pull request is named and linked, so the agent does not have to work out what "this"
 *    is from a sentence written while looking at a diff.
 * 4. **The reply goes on the pull request.** `prompts/mention.md` tells them to answer where the
 *    request came from, which here would be the tracker — leaving the diff silent and the human
 *    watching the wrong page. It is the one instruction in this body that overrides the prompt,
 *    so it is stated as an instruction rather than implied by context.
 */
export function askBody(req: AskRequest): string {
  const { staff, pr, anchor } = req;
  const said = req.body.trim();

  const out: string[] = [];
  // The mention and the question read as one message; the mention is not a header.
  out.push(stripLeadingMention(said, staff.mention) ? `${staff.mention} ${said}` : said);
  out.push("", "---", "");
  out.push(`**This is about ${pr.repo}#${pr.number} — "${pr.title.trim()}".**`);
  out.push("", pr.url);

  if (pr.head && pr.base) out.push("", `Branch \`${pr.head}\` → \`${pr.base}\`.`);

  if (anchor?.path) {
    out.push("", `They were looking at \`${anchor.path}\`.`);
    const hunk = clip(anchor.patch ?? "");
    if (hunk) out.push("", fence(hunk, "diff"));
    else if (anchor.patch) out.push("", "The diff for it is on the pull request.");
  }

  out.push(
    "",
    `**Answer on the pull request, not here.** That is where it will be read, and it is where`,
    `the diff is:`,
    "",
    fence(`gh pr comment ${pr.number} --repo ${pr.repo} --body "…"`, ""),
    "",
    ...(pr.head
      ? [`Push any change to \`${pr.head}\`. Close this issue once the reply is up.`]
      : ["Push any change to the pull request's branch. Close this issue once the reply is up."]),
  );

  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/** Whether the mention still has to be added, rather than already being the first thing said. */
function stripLeadingMention(said: string, mention: string): boolean {
  return !new RegExp(`(^|\\s)${escapeRe(mention)}(\\s|$)`).test(said);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first hunk lines, or nothing if there were none. Says so when it cut. */
function clip(patch: string): string {
  const lines = patch.replace(/\s+$/, "").split("\n");
  if (!lines[0]) return "";
  if (lines.length <= MAX_PATCH_LINES) return lines.join("\n");
  return [
    ...lines.slice(0, MAX_PATCH_LINES),
    `… ${lines.length - MAX_PATCH_LINES} more lines, on the pull request`,
  ].join("\n");
}

/**
 * A fenced block that survives its contents.
 *
 * A diff of a markdown file contains fences, and a three-backtick fence around one ends the
 * block in the middle of the quote. The fence is grown past the longest run inside it, which is
 * what CommonMark's own rule is for.
 */
function fence(text: string, lang: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}
