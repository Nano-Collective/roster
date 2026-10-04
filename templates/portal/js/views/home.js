/* Home: what needs you, who is working, what you asked for, and what was closed today.
 *
 * Built from the inbox list and /api/live, sorted by homesort.js, which is where the rule that
 * every open item has exactly one place lives. Clicking an item opens its thread in a side
 * sheet, the same thread view Trackers has, with the reply box in it. */

import { getLive, post } from "../api.js";
import { sheet } from "../dialog.js";
import { ago, el, skeleton } from "../dom.js";
import { daysUntil, sortHome } from "../homesort.js";
import { icon, iconHTML, staffIcon } from "../icons.js";
import { ensureInbox, stampCounts } from "../refresh.js";
import { go, render } from "../router.js";
import { threadInto } from "./inbox.js";
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

  if (h.unread.length) {
    page.append(section("Unread", h.unread.length));
    for (const e of h.unread) page.append(unreadRow(e));
  }

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
  /* The whole card opens the thread; the one quick action on it does not. Answering in words
     happens in the thread, where what was asked is in front of you. */
  const card = el("div", {
    className: "card homecard" + (item.unread ? " unread" : ""),
    tabIndex: 0,
    role: "button",
  });
  card.onclick = (ev) => {
    if (!ev.target.closest("button, a, textarea")) openThread(item);
  };
  card.onkeydown = (ev) => {
    if (ev.target === card && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openThread(item);
    }
  };
  // What it is on the left, what you can do about it on the right.
  const about = el("div", { className: "homeabout" }, [
    el("div", { className: "homehead" }, [
      el("span", { className: "chip " + (KIND_TONE[kind] ?? ""), textContent: KIND_LABEL[kind] }),
      openLink(item),
    ]),
    el("div", { className: "meta", textContent: whereOf(e) + " · " + ago(item.createdAt) }),
  ]);
  card.append(about);

  if (kind === "decision" && item.due) about.append(dueLine(item.due));
  if (kind === "merge") about.append(checksLine(item));

  // The note comes first so that what happened sits just left of the button that did it.
  const note = el("span", { className: "meta" });
  const actions = el("div", { className: "row homeacts" }, [note]);

  if (kind === "decision" || kind === "ask") {
    actions.append(button("Reply", true, () => openThread(item)));
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
    // Done is done: the card goes now, rather than when GitHub next answers.
    const card = actions.closest?.(".homecard, .homerow");
    if (card) {
      card.classList.add("gone");
      setTimeout(() => card.remove(), 220);
    }
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
    box.append(el("p", { className: "homerunwhat", textContent: "Asking GitHub…" }));
    return box;
  }
  for (const s of staff) {
    const l = (S.live.staff ?? []).find((x) => x.handle === s.handle);
    const runs = l && !l.error ? (l.running ?? []) : [];
    const busy = runs.length > 0;
    const last = l?.finished?.[0];

    const what = el("div", { className: "homerunwhat" });
    let log = null;
    if (!l || l.error) {
      what.append(el("span", { className: "err", textContent: l?.error ?? "Could not read their runs." }));
    } else if (busy) {
      for (const r of runs) {
        what.append(el("div", { textContent: `${cap(whatRun(r))} · ${minutes(r.createdAt)} so far` }));
      }
      log = runs[0].url;
    } else if (last) {
      what.append(
        el("div", { textContent: `${cap(whatRun(last))}, ${outcome(last)} ${ago(last.updatedAt)}` }),
      );
      log = last.url;
    } else {
      what.append(el("div", { textContent: "No runs in the last few hours." }));
    }
    if (l && !l.error && l.automatic) {
      what.append(
        el("div", {
          className: "homerunsub",
          textContent: `${l.automatic} of ${l.limit} runs today that nobody asked for`,
        }),
      );
    }

    const state = el("span", {
      className: "chip homestate " + (busy ? "ok" : ""),
      textContent: busy ? (runs[0].status === "queued" ? "Queued" : "Working") : "Idle",
    });
    const actions = el("div", { className: "homerunlog" });
    if (log) {
      actions.append(
        el("a", { className: "ghbtn", href: log, target: "_blank", rel: "noopener", textContent: "Log" }),
      );
    }

    box.append(
      el("div", { className: "homerun" + (busy ? " busy" : "") }, [
        el("span", { className: "homewho2" }, [icon(staffIcon(s), "ic"), el("b", { textContent: s.name })]),
        state,
        what,
        actions,
      ]),
    );
  }
  return box;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function minutes(since) {
  const m = Math.max(1, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function outcome(r) {
  return r.conclusion === "success" ? "finished" : r.conclusion === "failure" ? "failed" : (r.conclusion ?? "ended");
}

function poll() {
  clearTimeout(timer);
  getLive()
    .then((data) => {
      // Only a change repaints: a poll every few seconds must not move the page under you.
      const changed = JSON.stringify(data.staff) !== JSON.stringify(S.live?.staff);
      S.live = data;
      if (changed && S.view === "home" && !document.querySelector("dialog[open]")) repaintInPlace();
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

const WHY = {
  status: "Status",
  peer: "Peer ask",
  own: "Their work",
  draft: "Draft",
  contributor: "Issue",
  other: "Issue",
};

/** Something on a staff member's tracker, or elsewhere, with activity you have not seen. */
function unreadRow(e) {
  return clickable(e.item, "homerow", [
    el("span", { className: "chip", textContent: WHY[e.why] ?? "Issue" }),
    openLink(e.item),
    el("span", { className: "meta", textContent: whereOf(e) + " · " + ago(e.item.updatedAt) }),
  ]);
}

function requestRow(e) {
  return clickable(e.item, "homerow", [
    el("span", { className: "chip " + (e.status === "answered" ? "cool" : e.status === "working" ? "warm" : ""), textContent: STATUS[e.status] }),
    openLink(e.item),
    el("span", { className: "meta", textContent: whereOf(e) + " · " + ago(e.item.updatedAt) }),
  ]);
}

/** A row that opens its thread from anywhere on it, except a button inside it. */
function clickable(item, className, kids) {
  const row = el(
    "div",
    { className: className + " homeclick" + (item.unread ? " unread" : ""), tabIndex: 0, role: "button" },
    kids,
  );
  row.onclick = (ev) => {
    if (!ev.target.closest("button, a")) openThread(item);
  };
  row.onkeydown = (ev) => {
    if (ev.target === row && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openThread(item);
    }
  };
  return row;
}

function closedRow(e) {
  const note = el("span", { className: "meta" });
  const reopen = button("Reopen", false, () => act(note, row, { action: "reopen", repo: e.item.repo, number: e.item.number }, "Reopened."));
  const row = clickable(e.item, "homerow homeclosed", [
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

/** Repaint Home where you were: the sheet may have changed what is on it, not where you are. */
function repaintInPlace() {
  const main = document.querySelector("#main");
  const at = { win: window.scrollY, main: main?.scrollTop ?? 0 };
  render();
  window.scrollTo(0, at.win);
  if (main) main.scrollTop = at.main;
}

/**
 * The thread in a side sheet: its header, actions, reply box and conversation. Closing it
 * repaints Home, since a reply or a close there changes what belongs where. Where there is no
 * <dialog> (the test shim), it falls back to the thread on Trackers.
 */
function openThread(item) {
  const ref = { repo: item.repo, number: item.number, kind: item.kind };
  const body = el("div");
  const x = el("button", { className: "iconbtn", title: "Close (Esc)", ariaLabel: "Close" });
  x.innerHTML = iconHTML("close");
  body.append(el("div", { className: "sidebar-x" }, [x]));
  threadInto(body, ref);
  const box = sheet({ node: body, side: true, onClose: () => S.view === "home" && repaintInPlace() });
  if (!box) {
    go({ view: item.kind === "pr" ? "prs" : "inbox", inboxStaff: "", inboxFilter: "", inboxOpen: ref });
    return;
  }
  x.onclick = () => box.close();
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
    .then(() => S.view === "home" && !document.querySelector("dialog[open]") && repaintInPlace())
    .catch(() => {});
  setTimeout(poll, 3_000);
}
