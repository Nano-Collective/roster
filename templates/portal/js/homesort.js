/* Where every issue and pull request goes on Home.
 *
 * Every open item lands in exactly one place, so nothing is missed and nothing shows twice:
 *
 *   needs      an ask on a person, or a pull request ready to merge
 *   requests   something a person asked a staff member for
 *   staff      a staff member's own work: their status issue, a peer's ask, their own issues
 *   elsewhere  draft pull requests, and product or ops issues nobody has put on a person
 *
 * Closed items only matter when a staff member closed them today: that is "Closed today", with
 * Reopen beside each, because staff now close things without asking. */

/** The kinds an ask on a person carries. Older trackers used other words for a chore. */
const KINDS = ["decision", "review", "chore"];
const CHORE_WORDS = ["setup", "submit", "data", "blocked"];

const lower = (s) => String(s ?? "").toLowerCase();

/** How old a run report can be and still be this morning's. */
const REPORT_HOURS = 20;

/** A run report as lines, without the @mention it opens with. */
function reportLines(body) {
  return String(body ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(@[\w-]+\s*)+/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * @param items   the inbox list: open and recently closed issues and pull requests
 * @param staff   S.data.staff: handle, name, brain, statusIssue, mention
 * @param humans  [{ github, marker }]
 * @param live    /api/live's staff list, or [] before it has answered
 * @param now     for "today", in the viewer's own day
 */
export function sortHome(items, staff, humans, live = [], now = new Date()) {
  const people = new Set(humans.map((h) => lower(h.github)).filter(Boolean));
  const markers = new Set(humans.map((h) => lower(h.marker)).filter(Boolean));
  const byBrain = new Map(staff.filter((s) => s.brain).map((s) => [s.brain, s]));
  const working = new Set();
  for (const l of live) {
    const s = staff.find((x) => x.handle === l.handle);
    for (const r of l.running ?? []) if (s && r.issue) working.add(`${s.brain}#${r.issue}`);
  }

  const out = { reports: [], needs: [], requests: [], staff: [], elsewhere: [], closedToday: [] };
  const today = dayOf(now);

  for (const item of items) {
    const owner = byBrain.get(item.repo) ?? null;

    if (item.state !== "OPEN") {
      if (
        owner &&
        item.kind === "issue" &&
        item.closedAt &&
        dayOf(new Date(item.closedAt)) === today &&
        !people.has(lower(item.closedBy))
      ) {
        out.closedToday.push({ item, staff: owner, reason: reasonOf(item, people) });
      }
      continue;
    }

    // The run report: the last word on a status issue, from the staff member, in the last day.
    const c = item.lastComment;
    if (
      owner &&
      item.number === owner.statusIssue &&
      c &&
      !people.has(lower(c.author)) &&
      now - new Date(c.createdAt) < REPORT_HOURS * 3_600_000
    ) {
      out.reports.push({ staff: owner, item, at: c.createdAt, lines: reportLines(c.body) });
    }

    const place = placeOf(item, owner, people, markers);
    const entry = { item, staff: owner, ...place };
    if (place.place === "requests") {
      entry.status = working.has(`${item.repo}#${item.number}`)
        ? "working"
        : item.lastComment && !people.has(lower(item.lastComment.author))
          ? "answered"
          : "waiting";
    }
    out[place.place].push(entry);
  }

  const oldest = (a, b) => a.item.createdAt.localeCompare(b.item.createdAt);
  out.needs.sort(oldest);
  out.requests.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
  out.closedToday.sort((a, b) => b.item.closedAt.localeCompare(a.item.closedAt));
  return out;
}

/** Which place an open item belongs in, and for an ask, which kind it is. */
export function placeOf(item, owner, people, markers) {
  if (item.kind === "pr") {
    return item.draft ? { place: "elsewhere", why: "draft" } : { place: "needs", kind: "merge" };
  }

  const labels = (item.labels ?? []).map(lower);
  const onPerson =
    (item.assignees ?? []).some((a) => people.has(lower(a))) ||
    labels.some((l) => markers.has(l));
  const byPerson = people.has(lower(item.author));

  if (!owner) {
    return onPerson && !byPerson
      ? { place: "needs", kind: kindOf(labels) }
      : { place: "elsewhere", why: item.role === "product" ? "contributor" : "other" };
  }
  if (item.number === owner.statusIssue || labels.includes("keep-open")) {
    return { place: "staff", why: "status" };
  }
  if (byPerson) return { place: "requests" };
  if (onPerson) return { place: "needs", kind: kindOf(labels) };
  return {
    place: "staff",
    why: labels.some((l) => l.startsWith("from-")) ? "peer" : "own",
  };
}

function kindOf(labels) {
  const found = KINDS.find((k) => labels.includes(k));
  if (found) return found;
  return labels.some((l) => CHORE_WORDS.includes(l)) ? "chore" : "ask";
}

/** The one line a staff member closed it with: their last comment's first line. */
function reasonOf(item, people) {
  const c = item.lastComment;
  if (!c || people.has(lower(c.author))) return "";
  const line = String(c.body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return line ? line.replace(/^[#>*\s-]+/, "").slice(0, 160) : "";
}

/** A date as the viewer's own calendar day. */
export function dayOf(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Whole days from today to a YYYY-MM-DD date: 0 today, negative once it has passed. */
export function daysUntil(date, now = new Date()) {
  const [y, m, d] = String(date).split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - start) / 86_400_000);
}
