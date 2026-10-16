/* Home: who is working, what needs you, how each staff member is getting on, what you asked
 * for, and what was closed today.
 *
 * Built from the inbox list and /api/live, sorted by homesort.js, which is where the rule that
 * every open item has exactly one place lives. Clicking an item opens its thread in a side
 * sheet, the same thread view Trackers has, with the reply box in it. */

import { getLive, post } from "../api.js";
import { sheet } from "../dialog.js";
import { ago, el, skeleton } from "../dom.js";
import { daysUntil, isFor, sortHome } from "../homesort.js";
import { mdlite } from "../md.js";
import { parseReport } from "../report.js";
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
/** How old the issues on Home may get while it is open before they are read again. */
const ISSUES_STALE = 120_000;
let timer = null;
let issuesAt = Date.now();

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
  page.append(team(staff));
  page.append(askBox(staff));

  /* With more than one person, each sees what is on them, plus anything on nobody in
     particular. Everyone's is one click away, so nothing is hidden for good. */
  const me = meHuman();
  const split = Boolean(me) && humansOf().length > 1;
  const mine = split ? h.needs.filter((e) => isFor(e, me.github)) : h.needs;
  const shown = split && needsScope === "all" ? h.needs : mine;
  const needsHead = section("Needs you", shown.length);
  if (split && mine.length !== h.needs.length) needsHead.append(scopeToggle(mine.length, h.needs.length));
  page.append(needsHead);
  /* One list rather than a card each: five boxes with a green button apiece read as a wall, and
     nothing in it said which to do first. The top row's action is the one in green. */
  if (shown.length) {
    page.append(
      el("div", { className: "card homelist" }, shown.map((e, i) => needRow(e, i === 0, split ? me : null))),
    );
  } else page.append(el("p", { className: "homeempty", textContent: "Nothing needs you." }));

  const reporters = staff.filter((x) => x.brain && x.statusIssue);
  if (reporters.length) {
    page.append(section("Progress"));
    page.append(el("div", { className: "homereports" }, reporters.map((s) => reportRow(s, h.reports))));
  }

  if (h.unread.length) {
    page.append(section("Unread", h.unread.length));
    page.append(listBox(h.unread.map(unreadRow)));
  }

  if (h.requests.length) {
    page.append(section("Your requests", h.requests.length));
    page.append(listBox(h.requests.map(requestRow)));
  }

  if (h.closedToday.length) {
    page.append(section("Closed today", h.closedToday.length));
    page.append(listBox(h.closedToday.map(closedRow)));
  }

  page.append(rest(h));
  for (const e of S.inbox.errors ?? []) page.append(el("p", { className: "err", textContent: e }));
  m.append(page);
}

/* ------------------------------- reports -------------------------------- */

/** Whose reports are open in full. Kept here, since Home repaints on every poll. */
const openReports = new Set();

const STATUS_TONE = { "on track": "ok", "needs you": "warm", stuck: "hot", blocked: "hot" };

/**
 * One staff member's report: the body of their status issue, which every run rewrites, as a
 * card. Its status and one line on how it is going, what got done and what is next, with the
 * rest a click away. There is a button to ask for a fresh one.
 */
function reportRow(s, reports) {
  const r = reports.find((x) => x.staff.handle === s.handle);
  const item = r?.item ?? { repo: s.brain, number: s.statusIssue, kind: "issue" };
  const note = el("span", { className: "meta" });
  const ask = el("button", { className: "ghbtn", textContent: "Ask for an update" });
  ask.onclick = async () => {
    ask.disabled = true;
    note.className = "meta";
    note.textContent = "Asking…";
    try {
      await post({
        action: "comment",
        repo: s.brain,
        number: s.statusIssue,
        body: `${s.mention ?? "@" + s.handle} Report, please.`,
      });
      ask.remove();
      note.textContent = `Asked. ${s.name} updates it in a few minutes.`;
      refreshSoon();
    } catch (e) {
      note.textContent = String(e.message || e);
      note.className = "meta err";
      ask.disabled = false;
    }
  };

  const full = openReports.has(s.handle);
  const card = el("div", { className: "card homereport" + (full ? " full" : "") });
  const issue = el("button", { className: "homereportissue", textContent: "#" + item.number });
  issue.onclick = () => openThread(item);
  const p = r ? parseReport(r.body) : null;
  const head = el("div", { className: "homereporthead" }, [
    el("span", { className: "homewho2" }, [icon(staffIcon(s), "ic"), el("b", { textContent: s.name })]),
  ]);
  if (p?.status) {
    head.append(
      el("span", {
        className: "chip homereportstatus " + (STATUS_TONE[p.status] ?? ""),
        textContent: cap(p.status),
      }),
    );
  }
  head.append(
    el("span", { className: "meta homereportwhen" }, [
      document.createTextNode((r ? "Updated " + ago(r.at) : "No report yet") + " · "),
      issue,
    ]),
  );
  card.append(head);

  if (p) {
    if (p.headline) {
      card.append(el("div", { className: "md homereportline", innerHTML: mdlite(p.headline, { repo: s.brain }) }));
    }
    const cols = [
      ["done", "Done"],
      ["next", "Next"],
    ].filter(([k]) => p.sections[k]?.length);
    if (cols.length && !full) {
      card.append(
        el(
          "div",
          { className: "homereportcols" },
          cols.map(([k, label]) => bullets(label, p.sections[k], s.brain, 3)),
        ),
      );
    }
    const needs = p.sections.needs?.length ?? 0;
    if (needs && !full) {
      card.append(
        el("p", {
          className: "homereportneeds",
          textContent: `Waiting on a person: ${needs} thing${needs === 1 ? "" : "s"}.`,
        }),
      );
    }
    // A report in the old shape has no sections to show, so its opening lines stand in.
    const body = el("div", { className: "md homereportbody", innerHTML: mdlite(r.body, { repo: s.brain }) });
    if (full || !cols.length) card.append(body);
    if (!cols.length && !full) body.classList.add("fade");
  }

  const more = el("button", { className: "ghbtn", textContent: full ? "Show less" : "Read the full report" });
  more.onclick = () => {
    if (openReports.has(s.handle)) openReports.delete(s.handle);
    else openReports.add(s.handle);
    repaintInPlace();
  };
  card.append(el("div", { className: "row homereportacts" }, [...(r ? [more] : []), ask, note]));
  return card;
}

/** A short list under a label, with how many more there are once it runs past `max`. */
function bullets(label, items, repo, max) {
  const list = el(
    "ul",
    {},
    items.slice(0, max).map((x) => el("li", { className: "md", innerHTML: mdlite(x, { repo }) })),
  );
  const box = el("div", { className: "homereportcol" }, [el("h3", { textContent: label }), list]);
  if (items.length > max) box.append(el("p", { className: "meta", textContent: `and ${items.length - max} more` }));
  return box;
}

/* ------------------------------- asking -------------------------------- */

/** What is in the ask box, kept across repaints. */
const askDraft = { who: "", text: "" };

function askBox(staff) {
  const people = staff.filter((x) => x.brain);
  const who = el("select", { className: "homewho", id: "homewho" });
  for (const s of people) {
    who.append(el("option", { value: s.handle, textContent: s.name }));
  }
  if (askDraft.who && people.some((x) => x.handle === askDraft.who)) who.value = askDraft.who;
  const text = el("textarea", {
    className: "homeask",
    rows: 3,
    ariaLabel: "What you need",
    placeholder: "What do you need? For example: write a post about the new pricing page.",
    value: askDraft.text,
  });
  // Home repaints as runs start and finish, and what you were typing must survive that.
  text.oninput = () => {
    askDraft.text = text.value;
  };
  const send = el("button", { className: "ghbtn primary" });
  const label = () => {
    const s = people.find((x) => x.handle === who.value);
    send.textContent = s ? `Send to ${s.name}` : "Send";
  };
  label();
  who.onchange = () => {
    askDraft.who = who.value;
    label();
  };
  const note = el("span", { className: "meta" });
  send.onclick = async () => {
    const s = staff.find((x) => x.handle === who.value);
    const said = text.value.trim();
    if (!s || !said) {
      text.focus();
      return;
    }
    send.disabled = true;
    note.className = "meta";
    note.textContent = "Sending…";
    try {
      await post({
        action: "create",
        repo: s.brain,
        title: titleOf(said),
        body: `${s.mention ?? "@" + s.handle} ${said}`,
      });
      text.value = "";
      askDraft.text = "";
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
    el("h2", { className: "homeasktitle", textContent: "Ask a staff member to do something" }),
    el("div", { className: "row homeaskto" }, [el("label", { htmlFor: "homewho", textContent: "To" }), who]),
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

/** "mine" or "all": whose asks Needs you lists, when there is more than one person. */
let needsScope = readScope();

function readScope() {
  try {
    return localStorage.getItem("roster.needsScope") === "all" ? "all" : "mine";
  } catch {
    return "mine";
  }
}

/** The signed-in person, when they are one of the org's humans. */
function meHuman() {
  const login = String(S.me ?? "").toLowerCase();
  return login ? (humansOf().find((h) => String(h.github ?? "").toLowerCase() === login) ?? null) : null;
}

function scopeToggle(mine, all) {
  const bar = el("span", { className: "homescope", role: "group", ariaLabel: "Whose to show" });
  for (const [value, label] of [
    ["mine", `Yours ${mine}`],
    ["all", `Everyone's ${all}`],
  ]) {
    const b = el("button", { className: needsScope === value ? "on" : "", textContent: label });
    b.setAttribute("aria-pressed", String(needsScope === value));
    b.onclick = () => {
      needsScope = value;
      try {
        localStorage.setItem("roster.needsScope", value);
      } catch {
        /* a private window: it is only remembered for this visit */
      }
      repaintInPlace();
    };
    bar.append(b);
  }
  return bar;
}

/** "For Ben", on an ask that is on somebody else. */
function forWhom(e, me) {
  if (!me || !e.for?.length || e.for.some((g) => g.toLowerCase() === me.github.toLowerCase())) return "";
  const names = e.for.map((g) => humansOf().find((h) => h.github === g)?.name ?? g);
  return "For " + names.join(" and ");
}

function needRow(e, first, me = null) {
  const { item, kind } = e;
  /* The whole row opens the thread; the one quick action on it does not. Answering in words
     happens in the thread, where what was asked is in front of you. */
  const row = el("div", {
    className: "homeneed" + (item.unread ? " unread" : ""),
    tabIndex: 0,
    role: "button",
  });
  row.onclick = (ev) => {
    if (!ev.target.closest("button, a, textarea")) openThread(item);
  };
  row.onkeydown = (ev) => {
    if (ev.target === row && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openThread(item);
    }
  };

  /* What kind of thing it is sits in the line under the title, so every title starts in the
     same place; a chip in front of it pushed each one along by its own width. */
  const other = forWhom(e, me);
  const meta = el("div", { className: "meta" }, [
    el("span", { className: "homekind " + (KIND_TONE[kind] ?? ""), textContent: KIND_LABEL[kind] }),
    ...(other ? [document.createTextNode(" · "), el("span", { className: "homefor", textContent: other })] : []),
    document.createTextNode(" · " + whereOf(e) + " · " + ago(item.createdAt)),
  ]);
  const about = el("div", { className: "homeabout" }, [openLink(item), meta]);
  if (kind === "decision" && item.due) about.append(dueLine(item.due));
  if (kind === "merge") about.append(checksLine(item));

  // The note comes first so that what happened sits just left of the button that did it.
  const note = el("span", { className: "meta" });
  const actions = el("div", { className: "row homeacts" }, [note]);
  row.append(el("span", { className: "homedot", ariaHidden: "true" }), about, actions);

  if (kind === "decision" || kind === "ask") {
    actions.append(button("Reply", first, () => openThread(item)));
    if (item.due) {
      actions.append(button("Go with the default", false, () => say(e, "Go with your default.", note, actions)));
    }
  } else if (kind === "review") {
    actions.append(button("Approve", first, () => say(e, "Approved.", note, actions)));
  } else if (kind === "chore") {
    actions.append(button("Done", first, () => done(e, note, actions)));
  } else if (kind === "merge") {
    /* Merge is offered only when pressing it can work. A conflict, failing checks or checks
       still running are in the line under the title instead; a grey button that cannot be
       pressed looked like one that could. */
    const blocked =
      item.checks === "failing" || item.checks === "pending" || item.mergeable === "CONFLICTING";
    const merge = () => button("Merge", first, () => merge_(e, note, actions));
    if (item.reviewDecision === "REVIEW_REQUIRED") {
      // Approve is the person's review, given on purpose; Merge waits for it.
      const approve = button("Approve", first, async () => {
        approve.disabled = true;
        note.className = "meta";
        note.textContent = "Approving…";
        try {
          await post({ action: "approve", repo: item.repo, number: item.number });
          item.reviewDecision = "APPROVED";
          note.textContent = "Approved.";
          approve.remove();
          if (!blocked) actions.append(merge());
        } catch (err) {
          note.textContent = String(err.message || err);
          note.className = "meta err";
          approve.disabled = false;
        }
      });
      actions.append(approve);
    } else if (!blocked) actions.append(merge());
  }
  return row;
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

/** Where a pull request stands, with only the parts that stop a merge in amber. */
function checksLine(item) {
  const parts = [];
  if (item.checks === "passing") parts.push(["Checks pass", false]);
  if (item.checks === "failing") parts.push(["Checks fail", true]);
  if (item.checks === "pending") parts.push(["Checks are running", false]);
  if (item.mergeable === "CONFLICTING") parts.push(["Conflicts with its base", true]);
  if (item.reviewDecision === "REVIEW_REQUIRED") parts.push(["Needs your approval", false]);
  const line = el("p", { className: "homedue" });
  parts.forEach(([text, bad], i) => {
    if (i) line.append(document.createTextNode(" · "));
    line.append(el("span", { className: bad ? "bad" : "", textContent: text }));
  });
  return line;
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
    const card = actions.closest?.(".homeneed, .homeline");
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

/* ---------------------------------- team ---------------------------------- */

/* One colour per staff member, in hire order, so two orbs side by side are told apart. */
const HUES = ["#30d158", "#0a84ff", "#bf5af2", "#ff375f", "#ff9f0a", "#64d2ff", "#ffd60a"];

/** What a run is doing, as a person would say it. */
function whatRun(r) {
  const on = r.issue ? titleOn(r) : "";
  if (r.trigger === "mention") return r.issue ? `Answering #${r.issue}${on}` : "Answering a message";
  if (r.trigger === "peer") return r.issue ? `Helping a colleague with #${r.issue}${on}` : "Helping a colleague";
  return (
    {
      daily: "Doing their daily work",
      manual: "Doing the work you started",
      "follow-on": "Carrying on from their last session",
    }[r.trigger] ?? "Working"
  );
}

/** ": the issue's title", when the inbox has it. */
function titleOn(r) {
  const s = (S.data?.staff ?? []).find((x) => x.handle === r.handle);
  const it = (S.inbox?.items ?? []).find((i) => i.number === r.issue && (!s || i.repo === s.brain));
  return it?.title ? `: ${it.title}` : "";
}

/**
 * Who is working, as a row of orbs. A lit, moving orb is somebody at work; a still, dim one is
 * somebody free. Under it, in words, what they are doing or when they last finished. Pressing
 * an orb that is answering something opens that thread.
 */
function team(staff) {
  const box = el("div", { className: "hometeam" });
  const live = S.live?.staff ?? [];
  staff.forEach((s, i) => {
    const l = live.find((x) => x.handle === s.handle);
    const runs = l && !l.error ? (l.running ?? []) : [];
    const queued = runs.length > 0 && runs.every((r) => r.status === "queued");
    const busy = runs.length > 0 && !queued;
    const last = l?.finished?.[0];
    const failed = !runs.length && last && last.conclusion === "failure";
    const state = !S.live ? "wait" : busy ? "busy" : queued ? "queued" : failed ? "failed" : "idle";

    let word = "Free";
    let line = "Not working right now";
    if (!S.live) {
      word = "…";
      line = "Checking…";
    } else if (!l || l.error) {
      word = "Unknown";
      line = "Could not check on them";
    } else if (busy || queued) {
      const r = { ...runs[0], handle: s.handle };
      word = busy ? "Working" : "Starting";
      line = busy ? `${whatRun(r)} · ${minutes(r.createdAt)} so far` : "About to start";
    } else if (failed) {
      word = "Free";
      line = `Their last session stopped with a problem, ${ago(last.updatedAt)}`;
    } else if (last) {
      line = `Last finished ${ago(last.updatedAt)}`;
    }

    const issue = (busy || queued) && runs[0].issue && s.brain ? runs[0].issue : null;
    const card = el("div", {
      className: "orbcard " + state + (issue ? " homeclick" : ""),
      ...(issue ? { tabIndex: 0, role: "button", title: `Open #${issue}` } : {}),
    });
    card.style?.setProperty?.("--hue", HUES[i % HUES.length]);
    const orb = el("div", { className: "orb", ariaHidden: "true" }, [
      el("span", { className: "orbglow" }),
      el("span", { className: "orbbody" }, [el("span", { className: "orbswirl" })]),
      el("span", { className: "orbicon" }, [icon(staffIcon(s), "ic")]),
    ]);
    card.append(
      orb,
      el("b", { className: "orbname", textContent: s.name }),
      el("span", { className: "orbstate", textContent: word }),
      el("span", { className: "orbline", textContent: line }),
    );
    const log = runs[0]?.url ?? last?.url;
    if (log && state !== "idle") {
      card.append(
        el("a", { className: "orblog", href: log, target: "_blank", rel: "noopener", textContent: "View log" }),
      );
    }
    if (issue) {
      const open = () => openThread({ repo: s.brain, number: issue, kind: "issue" });
      card.onclick = (ev) => {
        if (!ev.target.closest("a")) open();
      };
      card.onkeydown = (ev) => {
        if (ev.target === card && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          open();
        }
      };
    }
    box.append(card);
  });
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

/**
 * A timer that never keeps a process alive. In the browser this is setTimeout; under the
 * tests' Node shim the polling loop would otherwise hold a test file open forever.
 */
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  t?.unref?.();
  return t;
}

function poll() {
  clearTimeout(timer);
  getLive()
    .then((data) => {
      // Only a change repaints: a poll every few seconds must not move the page under you.
      const changed = JSON.stringify(data.staff) !== JSON.stringify(S.live?.staff);
      /* A run that just ended has usually replied, closed or opened something, so that is when
         the issues are read again. Otherwise every couple of minutes while Home is open. */
      const ended = S.live && finishedCount(data) !== finishedCount(S.live);
      S.live = data;
      if (ended || Date.now() - issuesAt > ISSUES_STALE) {
        issuesAt = Date.now();
        refreshSoon(false);
      } else if (changed && S.view === "home" && !document.querySelector("dialog[open]")) {
        /* Typing in the ask box is not interrupted by a run starting: only the orbs move. */
        const row = document.querySelector(".hometeam");
        if (row && document.activeElement?.closest?.(".homeaskcard")) row.replaceWith(team(S.data.staff));
        else repaintInPlace();
      }
    })
    .catch(() => {})
    .finally(() => {
      if (S.view !== "home") return;
      const busy = (S.live?.staff ?? []).some((l) => l.running?.length);
      timer = later(poll, busy ? FAST : SLOW);
    });
}

/* ------------------------------ your requests ---------------------------- */

/** A card of rows. */
function listBox(rows) {
  return el("div", { className: "card homeworking" }, rows);
}

/**
 * One row in a list card: a status chip, the title with one line under it, and a button on the
 * right. The whole row opens the thread, except the button.
 */
function listRow(e, { chip, tone = "", sub, action = null }) {
  const row = el(
    "div",
    { className: "homeline homeclick" + (e.item.unread ? " unread" : ""), tabIndex: 0, role: "button" },
    [
      // The same row as Needs you: an unread dot, the title, and what it is in the line under it.
      el("span", { className: "homedot", ariaHidden: "true" }),
      el("div", { className: "homerunwhat" }, [
        el("div", { className: "homerowtitle", textContent: e.item.title }),
        el("div", { className: "homerunsub" }, [
          el("span", { className: "homekind " + tone, textContent: chip }),
          document.createTextNode(` · ${whereOf(e)} · ${sub}`),
        ]),
      ]),
      el("div", { className: "homerunlog" }, action ? [action] : []),
    ],
  );
  row.onclick = (ev) => {
    if (!ev.target.closest("button, a")) openThread(e.item);
  };
  row.onkeydown = (ev) => {
    if (ev.target === row && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openThread(e.item);
    }
  };
  return row;
}

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
  return listRow(e, {
    chip: WHY[e.why] ?? "Issue",
    tone: "cool",
    sub: ago(e.item.updatedAt),
  });
}

const STATUS = { waiting: "Waiting", working: "Working", answered: "Answered" };

function requestRow(e) {
  return listRow(e, {
    chip: STATUS[e.status],
    tone: e.status === "answered" ? "cool" : e.status === "working" ? "ok" : "",
    sub: ago(e.item.updatedAt),
  });
}

function closedRow(e) {
  const note = el("span", { className: "meta" });
  const reopen = button("Reopen", false, () =>
    act(note, holder, { action: "reopen", repo: e.item.repo, number: e.item.number }, "Reopened."),
  );
  const holder = el("div", { className: "row" }, [note, reopen]);
  return listRow(e, {
    chip: "Closed",
    sub: e.reason || "No reason given.",
    action: holder,
  });
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
export function openThread(item) {
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

/** How many runs have finished across the staff, to notice one ending. */
function finishedCount(live) {
  return (live?.staff ?? []).reduce((n, l) => n + (l.finished?.length ?? 0), 0);
}

/**
 * Re-read the issues and repaint where you were. After a write it also looks for the run the
 * write starts; from the poll it does not, since the poll is already running.
 */
function refreshSoon(lookForRun = true) {
  issuesAt = Date.now();
  ensureInbox(true)
    .then(() => S.view === "home" && !document.querySelector("dialog[open]") && repaintInPlace())
    .catch(() => {});
  if (lookForRun) later(poll, 3_000);
}
