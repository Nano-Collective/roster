/* Home: what needs you, who is working, what you asked for, and what was closed today.
 *
 * Built from the inbox list and /api/live, sorted by homesort.js, which is where the rule that
 * every open item has exactly one place lives. Clicking an item opens its thread on the
 * Trackers screen, which is the same thread view the inbox always had. */

import { getLive, post } from "../api.js";
import { ago, el, skeleton } from "../dom.js";
import { daysUntil, sortHome } from "../homesort.js";
import { icon, staffIcon } from "../icons.js";
import { ensureInbox, stampCounts } from "../refresh.js";
import { go, render } from "../router.js";
import { humansOf, S } from "../state.js";

const KIND_LABEL = {
  decision: "Decision",
  review: "Review",
  chore: "Chore",
  ask: "Ask",
  merge: "Pull request",
};
const KIND_TONE = { decision: "hot", review: "warm", chore: "cool", ask: "", merge: "cool" };

/* While a run is live this asks every few seconds; otherwise every half minute, so a run that
   a reply just started shows up without a reload. Only while Home is on screen. */
const FAST = 5_000;
const SLOW = 30_000;
let timer = null;

export function viewHome(m) {
  m.append(el("h1", { textContent: "Home" }));

  if (!S.inbox) {
    m.append(el("div", { className: "home" }, skeleton("row", 5)));
    ensureInbox(false)
      .then(() => S.view === "home" && render())
      .catch((e) => {
        m.append(el("p", { className: "err", textContent: String(e.message || e) }));
      });
    poll();
    return;
  }
  if (!S.live) poll();

  const staff = S.data.staff;
  const h = sortHome(S.inbox.items ?? [], staff, humansOf(), S.live?.staff ?? []);
  stampCounts();

  const page = el("div", { className: "home" });
  page.append(askBox(staff));

  if (h.reports.length) {
    page.append(section("Latest reports"));
    const box = el("div", { className: "card homereports" });
    for (const r of h.reports) {
      box.append(
        el("div", { className: "homereport" }, [
          el("div", { className: "homewho2" }, [
            icon(staffIcon(r.staff), "ic"),
            el("b", { textContent: r.staff.name }),
            el("span", { className: "meta", textContent: ago(r.at) }),
          ]),
          el("div", {}, r.lines.map((l) => el("p", { textContent: l }))),
        ]),
      );
    }
    page.append(box);
  }

  page.append(section("Needs you", h.needs.length));
  if (h.needs.length) for (const e of h.needs) page.append(needCard(e));
  else page.append(el("p", { className: "homeempty", textContent: "Nothing needs you." }));

  page.append(section("Working now"));
  page.append(working(staff));

  if (h.requests.length) {
    page.append(section("Your requests", h.requests.length));
    for (const e of h.requests) page.append(requestRow(e));
  }

  if (h.closedToday.length) {
    page.append(section("Closed today", h.closedToday.length));
    for (const e of h.closedToday) page.append(closedRow(e));
  }

  page.append(rest(h));
  for (const e of S.inbox.errors ?? []) page.append(el("p", { className: "err", textContent: e }));
  m.append(page);
}

/* ------------------------------- asking -------------------------------- */

function askBox(staff) {
  const who = el("select", { className: "homewho", ariaLabel: "Who to ask" });
  for (const s of staff.filter((x) => x.brain)) {
    who.append(el("option", { value: s.handle, textContent: s.name }));
  }
  const text = el("textarea", {
    className: "homeask",
    rows: 2,
    placeholder: "Ask a staff member to do something",
  });
  const send = el("button", { className: "ghbtn primary", textContent: "Send" });
  const note = el("span", { className: "meta" });
  send.onclick = async () => {
    const s = staff.find((x) => x.handle === who.value);
    const said = text.value.trim();
    if (!s || !said) return;
    send.disabled = true;
    note.textContent = "Sending…";
    try {
      await post({
        action: "create",
        repo: s.brain,
        title: titleOf(said),
        body: `${s.mention ?? "@" + s.handle} ${said}`,
      });
      text.value = "";
      note.textContent = `Sent. ${s.name} starts in about a minute.`;
      refreshSoon();
    } catch (e) {
      note.textContent = String(e.message || e);
      note.className = "meta err";
    } finally {
      send.disabled = false;
    }
  };
  return el("div", { className: "card homeaskcard" }, [
    el("div", { className: "row" }, [who]),
    text,
    el("div", { className: "row" }, [send, note]),
  ]);
}

/** The first line, short enough to be an issue title. */
function titleOf(said) {
  const line = said.split("\n").find((l) => l.trim()) ?? said;
  return line.length > 90 ? line.slice(0, 89).trimEnd() + "…" : line;
}

/* ------------------------------ needs you ------------------------------- */

function needCard(e) {
  const { item, kind } = e;
  const card = el("div", { className: "card homecard" });
  card.append(
    el("div", { className: "homehead" }, [
      el("span", { className: "chip " + (KIND_TONE[kind] ?? ""), textContent: KIND_LABEL[kind] }),
      openLink(item),
    ]),
    el("div", { className: "meta", textContent: whereOf(e) + " · " + ago(item.createdAt) }),
  );

  if (kind === "decision" && item.due) card.append(dueLine(item.due));
  if (kind === "merge") card.append(checksLine(item));

  const note = el("span", { className: "meta" });
  const actions = el("div", { className: "row homeacts" });

  if (kind === "decision" || kind === "ask") {
    const box = el("textarea", { className: "homeanswer", rows: 2, placeholder: "Your answer" });
    const send = button("Send", true, () => say(e, box.value, note, actions));
    card.append(box);
    actions.append(send);
    if (item.due) actions.append(button("Go with the default", false, () => say(e, "Go with your default.", note, actions)));
  } else if (kind === "review") {
    actions.append(button("Approve", true, () => say(e, "Approved.", note, actions)));
  } else if (kind === "chore") {
    actions.append(button("Done", true, () => done(e, note, actions)));
  } else if (kind === "merge") {
    const blocked = item.checks === "failing" || item.mergeable === "CONFLICTING";
    const merge = button("Merge", true, () => merge_(e, note, actions));
    merge.disabled = blocked || item.checks === "pending";
    actions.append(merge);
  }
  actions.append(button("Open", false, () => openThread(item)), note);
  card.append(actions);
  return card;
}

function dueLine(due) {
  const d = daysUntil(due.date);
  const when =
    d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d} day${d === -1 ? "" : "s"} ago`;
  return el("p", {
    className: "homedue" + (d <= 0 ? " late" : ""),
    textContent: `Default ${d < 0 ? "was due" : "applies"} ${when}: ${due.action}.`,
  });
}

function checksLine(item) {
  const words = {
    passing: "Checks pass.",
    failing: "Checks fail.",
    pending: "Checks are running.",
    none: "No checks.",
  };
  const conflict = item.mergeable === "CONFLICTING" ? " Conflicts with its base." : "";
  return el("p", {
    className: "homedue" + (item.checks === "failing" || conflict ? " late" : ""),
    textContent: (words[item.checks] ?? "") + conflict,
  });
}

async function say(e, text, note, actions) {
  const said = String(text ?? "").trim();
  if (!said) return;
  const mention = e.staff?.mention ?? "";
  await act(note, actions, { action: "comment", repo: e.item.repo, number: e.item.number, body: `${mention} ${said}`.trim() }, "Sent.");
}

function done(e, note, actions) {
  return act(note, actions, { action: "close", repo: e.item.repo, number: e.item.number, body: "Done." }, "Closed.");
}

function merge_(e, note, actions) {
  return act(note, actions, { action: "merge", repo: e.item.repo, number: e.item.number }, "Merged.");
}

async function act(note, actions, payload, ok) {
  for (const b of actions.querySelectorAll("button")) b.disabled = true;
  note.className = "meta";
  note.textContent = "Working…";
  try {
    await post(payload);
    note.textContent = ok;
    refreshSoon();
  } catch (err) {
    note.textContent = String(err.message || err);
    note.className = "meta err";
    for (const b of actions.querySelectorAll("button")) b.disabled = false;
  }
}

/* ------------------------------ working now ----------------------------- */

/** What a run was, in a few words: "daily run", "answering #12", "a peer's ask #4". */
function whatRun(r) {
  if (r.trigger === "mention") return r.issue ? `answering #${r.issue}` : "answering a mention";
  if (r.trigger === "peer") return r.issue ? `a peer's ask #${r.issue}` : "a peer's ask";
  return (
    { daily: "daily run", manual: "run started by hand", "follow-on": "follow-on run" }[r.trigger] ??
    "run"
  );
}

function working(staff) {
  const box = el("div", { className: "card homeworking" });
  if (!S.live) {
    box.append(el("p", { className: "meta", textContent: "Asking GitHub…" }));
    return box;
  }
  for (const s of staff) {
    const l = (S.live.staff ?? []).find((x) => x.handle === s.handle);
    const row = el("div", { className: "homerun" });
    row.append(el("span", { className: "homewho2" }, [icon(staffIcon(s), "ic"), el("b", { textContent: s.name })]));
    if (!l || l.error) {
      row.append(el("span", { className: "meta err", textContent: l?.error ?? "not read" }));
    } else if (l.running?.length) {
      for (const r of l.running) row.append(runLink(s, r, true));
    } else {
      const last = l.finished?.[0];
      row.append(
        el("span", {
          className: "meta",
          textContent: last ? `Idle. Last run: ${whatRun(last)}, ${outcome(last)} ${ago(last.updatedAt)}.` : "Idle.",
        }),
      );
      if (last) row.append(el("a", { className: "meta", href: last.url, target: "_blank", rel: "noopener", textContent: "log" }));
    }
    if (l && !l.error && l.automatic) {
      row.append(el("span", { className: "pill", title: "Runs today that nobody asked for", textContent: `${l.automatic}/${l.limit} automatic` }));
    }
    box.append(row);
  }
  return box;
}

function runLink(s, r, live) {
  const what = whatRun(r);
  const mins = Math.max(1, Math.round((Date.now() - new Date(r.createdAt).getTime()) / 60000));
  return el("a", {
    className: "homelive",
    href: r.url,
    target: "_blank",
    rel: "noopener",
    textContent: (live && r.status === "queued" ? "Queued: " : "Working: ") + what + ` · ${mins} min · log`,
  });
}

function outcome(r) {
  return r.conclusion === "success" ? "finished" : r.conclusion === "failure" ? "failed" : (r.conclusion ?? "ended");
}

function poll() {
  clearTimeout(timer);
  getLive()
    .then((data) => {
      S.live = data;
      if (S.view === "home") render();
    })
    .catch(() => {})
    .finally(() => {
      if (S.view !== "home") return;
      const busy = (S.live?.staff ?? []).some((l) => l.running?.length);
      timer = setTimeout(poll, busy ? FAST : SLOW);
    });
}

/* ------------------------------ your requests ---------------------------- */

const STATUS = { waiting: "Waiting", working: "Being worked on", answered: "Answered" };

function requestRow(e) {
  return el("div", { className: "homerow" }, [
    el("span", { className: "chip " + (e.status === "answered" ? "cool" : e.status === "working" ? "warm" : ""), textContent: STATUS[e.status] }),
    openLink(e.item),
    el("span", { className: "meta", textContent: whereOf(e) + " · " + ago(e.item.updatedAt) }),
  ]);
}

function closedRow(e) {
  const note = el("span", { className: "meta" });
  const reopen = button("Reopen", false, () => act(note, row, { action: "reopen", repo: e.item.repo, number: e.item.number }, "Reopened."));
  const row = el("div", { className: "homerow homeclosed" }, [
    el("div", {}, [
      openLink(e.item),
      el("div", { className: "meta", textContent: whereOf(e) + " · " + (e.reason || "No reason given.") }),
    ]),
    el("div", { className: "row" }, [note, reopen]),
  ]);
  return row;
}

/* --------------------------------- rest --------------------------------- */

function rest(h) {
  const parts = [];
  if (h.staff.length) parts.push(`${h.staff.length} on the staff's own trackers`);
  if (h.elsewhere.length) parts.push(`${h.elsewhere.length} elsewhere`);
  if (!parts.length) return el("span");
  const link = el("button", { className: "ghbtn", textContent: "Open Trackers" });
  link.onclick = () => go({ view: "inbox", inboxStaff: "", inboxOpen: null });
  return el("div", { className: "row homerest" }, [
    el("span", { className: "meta", textContent: "Also open: " + parts.join(", ") + "." }),
    link,
  ]);
}

/* -------------------------------- helpers -------------------------------- */

function section(title, count) {
  const h = el("h2", { textContent: title });
  if (count !== undefined) h.append(el("span", { className: "pill", textContent: String(count) }));
  return h;
}

function openLink(item) {
  const b = el("button", { className: "homeopen", textContent: item.title });
  b.onclick = () => openThread(item);
  return b;
}

function openThread(item) {
  go({
    view: item.kind === "pr" ? "prs" : "inbox",
    inboxStaff: "",
    inboxFilter: "",
    inboxOpen: { repo: item.repo, number: item.number, kind: item.kind },
  });
}

function whereOf(e) {
  const repo = e.item.repo.split("/")[1] ?? e.item.repo;
  return (e.staff?.name ?? repo) + " · #" + e.item.number;
}

function button(label, primary, onclick) {
  const b = el("button", { className: "ghbtn" + (primary ? " primary" : ""), textContent: label });
  b.onclick = onclick;
  return b;
}

/** After a write: re-read the inbox, and look for the run it starts. */
function refreshSoon() {
  ensureInbox(true)
    .then(() => S.view === "home" && render())
    .catch(() => {});
  setTimeout(poll, 3_000);
}
