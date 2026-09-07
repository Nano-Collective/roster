/* The inbox: everything open across the org, and the thread beside it. */

import { getInbox, getThread, post } from "../api.js";
import { ago, el, esc, markCurrent } from "../dom.js";
import { icon, iconHTML } from "../icons.js";
import { mdlite } from "../md.js";
import { refreshAll } from "../refresh.js";
import { S, openCount, writeHash } from "../state.js";

const LABEL_TONE = {
  decision: "hot", blocked: "hot", will: "hot", review: "warm", submit: "warm",
  idea: "cool", build: "cool", setup: "cool", data: "cool",
};

/* Bookkeeping. Real history, worth being able to see, but not what you opened the thread
   to read — so a run of it folds away. */
const QUIET = new Set([
  "labeled", "unlabeled", "assigned", "unassigned", "renamed",
  "review-requested", "ready-for-review",
]);

/* Whose work an item is. The inbox is org-wide, so without this the CTO's product PRs and
   the CMO's are one undifferentiated list — which is the complaint.
   In descending order of confidence: it lives in their brain, their own app wrote it, a peer
   addressed it to them with a from-<handle> label, it is assigned to their app, or the
   shared public identity wrote it in a repo they work in.
   That last one matches both of them on purpose. Both agents push through the same robot, so
   the honest answer is "one of these two" — better than hiding real work behind a filter. */
export function belongsTo(item, s) {
  if (!s) return true;
  if (item.repo === s.brain) return true;
  const solo = s.soloBots ?? [];
  if (solo.includes(item.author)) return true;
  if ((item.labels ?? []).some((l) => l === "from-" + s.handle || l === s.handle)) return true;
  if ((item.assignees ?? []).some((a) => solo.includes(a))) return true;
  if ((s.sharedBots ?? []).includes(item.author) && (s.worksIn ?? []).includes(item.repo)) return true;
  return false;
}

export function viewInbox(m) {
  m.append(el("h1", { textContent: "Inbox" }));
  const sub = el("p", { className: "sub", textContent: "Everything open across the org." });
  m.append(sub);

  const search = el("input", {
    type: "search",
    placeholder: "Filter by title, label, repo…",
    value: S.query,
  });
  const scope = el("select");
  scope.append(
    el("option", { value: "", textContent: "Everything" }),
    el("option", { value: "mine", textContent: "On " + (S.data.human.name ?? "me") }),
    el("option", { value: "decision", textContent: "Decisions" }),
    el("option", { value: "pr", textContent: "Open work (PRs)" }),
  );
  scope.value = S.inboxFilter;

  /* Open only by default. An inbox is what is waiting on somebody, and burying that under
     five months of finished work would be answering a different question. */
  const state = el("select", { title: "Which items to list" });
  state.append(
    el("option", { value: "", textContent: "Open" }),
    el("option", { value: "closed", textContent: "Recently closed" }),
    el("option", { value: "all", textContent: "Open and closed" }),
  );
  state.value = S.inboxState;

  const whose = el("select", {
    title: "Whose work: their brain repo, anything their bot wrote, and anything addressed to them",
  });
  whose.append(
    el("option", { value: "", textContent: "Everyone" }),
    ...S.data.staff.map((s) => el("option", { value: s.handle, textContent: s.name })),
  );
  whose.value = S.inboxStaff;

  const refresh = el("button", { className: "iconbtn", title: "Refresh from GitHub" });
  refresh.innerHTML = '<span class="sync">' + iconHTML("refresh") + "</span>";
  const newBtn = el("button", { className: "ghbtn", textContent: "New issue" });
  newBtn.onclick = () => newIssueForm(viewer);
  m.append(
    el("div", { className: "row", style: "margin-bottom:16px" }, [
      search, whose, state, scope, refresh, newBtn,
    ]),
  );

  const split = el("div", { className: "split" });
  const list = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(list, viewer);
  m.append(split);

  search.oninput = () => { S.query = search.value; writeHash(false); paint(); };
  scope.onchange = () => { S.inboxFilter = scope.value; writeHash(false); paint(); };
  whose.onchange = () => { S.inboxStaff = whose.value; writeHash(false); paint(); };
  state.onchange = () => { S.inboxState = state.value; writeHash(false); paint(); };
  refresh.onclick = () => { refresh.classList.add("spin"); load(true); };

  if (S.inbox) { stampCount(); paint(); restore(); } else load(false);

  /** A `?t=` in the URL names a thread. It used to be read into the state and then never
      acted on, because only the already-loaded branch opened one. */
  function restore() {
    if (S.inboxOpen) openThread(S.inboxOpen);
  }

  async function load(force) {
    list.replaceChildren(el("p", { className: "empty", textContent: "Asking GitHub…" }));
    try {
      S.inbox = await getInbox(force);
    } catch (e) {
      refresh.classList.remove("spin");
      list.replaceChildren(
        el("p", { className: "empty err", textContent: "Could not reach GitHub: " + e.message }),
      );
      return;
    }
    refresh.classList.remove("spin");
    stampCount();
    paint();
    restore();
  }

  /* The sidebar badge is painted by the shell, which runs before this screen has asked
     GitHub anything. Without this it stays empty until something else causes a render. */
  function stampCount() {
    const badge = document.querySelector("#inboxcount");
    if (badge) badge.textContent = S.inbox ? String(openCount()) : "";
  }

  function paint() {
    if (!S.inbox) return;
    const q = S.query.trim().toLowerCase();
    const human = S.data.human.github;

    const whoseStaff = S.inboxStaff ? S.data.staff.find((s) => s.handle === S.inboxStaff) : null;
    const mine = S.inbox.items.filter((i) => belongsTo(i, whoseStaff));
    const isOpen = (i) => i.state === "OPEN";
    const scoped = mine.filter(
      S.inboxState === "closed" ? (i) => !isOpen(i) : S.inboxState === "all" ? () => true : isOpen,
    );

    let items = scoped.filter(
      (i) => !q || (i.title + " " + i.repo + " " + i.labels.join(" ") + " #" + i.number)
        .toLowerCase().includes(q),
    );
    if (S.inboxFilter === "mine") items = items.filter((i) => i.assignees.includes(human));
    else if (S.inboxFilter === "decision") items = items.filter((i) => i.labels.includes("decision"));
    else if (S.inboxFilter === "pr") items = items.filter((i) => i.kind === "pr");

    const open = mine.filter(isOpen);
    const onYou = open.filter((i) => i.assignees.includes(human)).length;
    const prs = open.filter((i) => i.kind === "pr").length;
    const shut = mine.length - open.length;
    const where = whoseStaff
      ? " for <b>" + esc(whoseStaff.name) + "</b>"
      : " across " + (S.inbox.repos ?? []).length + " repos";
    sub.innerHTML =
      (S.inboxState === "closed"
        ? shut + " closed in the last 45 days" + where
        : open.length + " open" + where + " · <b>" + onYou + " on " +
          esc(S.data.human.name ?? "you") + "</b> · " + prs + " open PRs" +
          (S.inboxState === "all" ? " · " + shut + " closed" : "")) +
      (S.inbox.fetchedAt ? ' <span class="meta">· checked ' + ago(S.inbox.fetchedAt) + "</span>" : "");

    list.replaceChildren();
    for (const e of S.inbox.errors ?? []) {
      list.append(el("div", { className: "tdir err", textContent: e }));
    }

    // Newest first, flat. Grouping by repo buried a fresh comment under whichever project
    // happened to sort first; the project moves onto the row instead.
    items = items.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!items.length) {
      list.append(el("p", { className: "empty", textContent: "Nothing matches." }));
      return;
    }

    for (const i of items) {
      const shutState = i.state === "MERGED" ? "merged" : i.state === "OPEN" ? "" : "closed";
      const b = el("button", { className: "irow" + (shutState ? " shut" : "") });
      const yours = i.assignees.includes(human);
      const chips = i.labels
        .slice(0, 3)
        .map((l) => '<span class="chip ' + (LABEL_TONE[l] ?? "") + '">' + esc(l) + "</span>")
        .join("");
      b.innerHTML =
        '<div class="ititle">' + (yours ? '<span class="dot" title="assigned to you"></span>' : "") +
          esc(i.title) + "</div>" +
        '<div class="imeta">' +
          '<span class="repo">' + esc(i.repo.split("/")[1]) + "</span>" +
          (shutState
            ? '<span class="ist ' + shutState + '" title="' + esc(i.state) + '">' +
              iconHTML(shutState === "merged" ? "merged" : "issue-closed") + "</span>"
            : "") +
          '<span class="num">' + (i.kind === "pr" ? "PR " : "") + "#" + i.number + "</span>" +
          (i.checks && i.checks !== "none"
            ? '<span class="ck ' + i.checks + '">' + checkGlyph(i.checks) + "</span>" : "") +
          chips +
          '<span class="when">' + ago(i.updatedAt) + "</span>" +
        "</div>";
      b.dataset.ref = i.repo + "#" + i.number;
      b.setAttribute("aria-current", String(S.inboxOpen?.repo === i.repo && S.inboxOpen?.number === i.number));
      b.onclick = () => {
        markCurrent(list, b);
        S.inboxOpen = { repo: i.repo, number: i.number, kind: i.kind };
        writeHash(false);
        openThread(S.inboxOpen);
      };
      list.append(b);
    }
  }

  /* Everything is already loaded, so opening a thread is a render, not a request. */
  function openThread(ref) {
    const item = (S.inbox?.items ?? []).find(
      (i) => i.repo === ref.repo && i.number === ref.number,
    );
    if (!item) {
      viewer.replaceChildren(
        el("p", { className: "empty", textContent: "That one is no longer open. Refresh." }),
      );
      return;
    }
    const row = list.querySelector('[data-ref="' + item.repo + "#" + item.number + '"]');
    if (row) markCurrent(list, row);

    const head = el("div", { className: "thead" });
    head.innerHTML =
      '<div class="trow">' +
        '<div class="meta">' + esc(item.repo) + " · " + (item.kind === "pr" ? "PR " : "") + "#" + item.number +
          ' · <span class="' + (item.state === "OPEN" ? "ok" : "") + '">' + esc(item.state) + "</span>" +
          " · " + esc(item.author) + " · " + ago(item.updatedAt) + "</div>" +
        '<a class="ghbtn" href="' + esc(item.url) + '" target="_blank" rel="noopener">Open in GitHub</a>' +
      "</div>" +
      "<h3>" + esc(item.title) + "</h3>" +
      (item.labels.length
        ? '<div class="row" style="margin-top:8px">' +
          item.labels.map((l) => '<span class="chip ' + (LABEL_TONE[l] ?? "") + '">' + esc(l) + "</span>").join("") +
          "</div>"
        : "");
    viewer.replaceChildren(head);

    viewer.append(comment(item.author, item.createdAt, item.body, true, item.repo));
    for (const node of timeline(item, openThread)) viewer.append(node);
    viewer.append(replyBox(item));
    viewer.scrollTop = 0;
  }

  /* Replies and closes go out as the human, through their own gh. This is where a person
     answers their agents, so it should be the same as typing it on the site. */
  function replyBox(item) {
    const box = el("div", { className: "reply" });
    const ta = el("textarea", {
      placeholder: "Reply as " + (S.data.human.github ?? "you") + "…",
      rows: 3,
    });
    const status = el("span", { className: "meta" });

    const send = el("button", { className: "ghbtn primary", textContent: "Comment" });
    const closeBtn = el("button", {
      className: "ghbtn",
      textContent: item.state === "OPEN" ? "Close" : "Reopen",
    });

    const busy = (on, msg) => {
      send.disabled = closeBtn.disabled = on;
      status.textContent = msg ?? "";
      status.className = "meta";
    };
    const failed = (e) => {
      status.textContent = e.message;
      status.className = "meta err";
    };

    send.onclick = async () => {
      if (!ta.value.trim()) { ta.focus(); return; }
      busy(true, "posting…");
      try {
        await post({ action: "comment", repo: item.repo, number: item.number, body: ta.value });
        ta.value = "";
        await reloadThread(item);
      } catch (e) { failed(e); busy(false); }
    };

    closeBtn.onclick = async () => {
      const closing = item.state === "OPEN";
      // Closing is the one thing here that is awkward to undo from a phone later.
      if (closing && !confirm("Close " + item.repo + " #" + item.number + "?")) return;
      busy(true, closing ? "closing…" : "reopening…");
      try {
        await post({
          action: closing ? "close" : "reopen",
          repo: item.repo,
          number: item.number,
          body: closing ? ta.value : undefined,
        });
        await refreshAll(false);
      } catch (e) { failed(e); busy(false); }
    };

    box.append(ta, el("div", { className: "row", style: "margin-top:9px" }, [send, closeBtn, status]));
    return box;
  }

  async function reloadThread(item) {
    // Re-read just this one, so a reply appears without paying for the whole org again.
    try {
      const fresh = await getThread(item.repo, item.number, item.kind);
      if (fresh && !fresh.error) {
        const at = S.inbox.items.findIndex(
          (i) => i.repo === item.repo && i.number === item.number,
        );
        if (at >= 0) S.inbox.items[at] = { ...S.inbox.items[at], ...fresh };
      }
    } catch {
      /* the comment posted; a stale pane is not worth an error */
    }
    paint();
    openThread({ repo: item.repo, number: item.number, kind: item.kind });
  }
}

/* ------------------------------- the thread ------------------------------ */

/**
 * A thread's history, in GitHub's order: comments and reviews as cards, references as lines,
 * and a run of bookkeeping folded behind one disclosure.
 *
 * A run of exactly one stays inline. Hiding "added the build label" behind a click costs
 * more attention than reading it does.
 */
function timeline(item, openThread) {
  const out = [];
  let quiet = [];

  const flush = () => {
    if (!quiet.length) return;
    if (quiet.length === 1) out.push(eventLine(quiet[0], item, openThread));
    else out.push(folded(quiet, item, openThread));
    quiet = [];
  };

  for (const e of item.events ?? []) {
    if (QUIET.has(e.type)) { quiet.push(e); continue; }
    flush();
    if (e.type === "comment") {
      out.push(comment(e.actor, e.createdAt, e.body, false, item.repo));
    } else if (e.type === "review" && (e.body ?? "").trim()) {
      out.push(comment(e.actor, e.createdAt, e.body, false, item.repo, reviewWord(e.state)));
    } else {
      out.push(eventLine(e, item, openThread));
    }
  }
  flush();
  return out;
}

function folded(events, item, openThread) {
  const box = el("div");
  const btn = el("button", { className: "tevmore" });
  btn.setAttribute("aria-expanded", "false");
  btn.append(
    icon("chevron", "caret"),
    el("span", { textContent: events.length + " more events" }),
  );
  const body = el("div", { className: "tevquiet" }, events.map((e) => eventLine(e, item, openThread)));
  body.hidden = true;
  btn.onclick = () => {
    body.hidden = !body.hidden;
    btn.setAttribute("aria-expanded", String(!body.hidden));
  };
  box.append(btn, body);
  return box;
}

/* One icon per kind of thing that can happen to a thread. Labels and people repeat on
   purpose: "added the build label" and "removed" are the same kind of event, and the verb
   next to it is what tells them apart. */
const GLYPH = {
  "cross-referenced": "crossref", referenced: "commit", closed: "closed",
  reopened: "reopened", merged: "merged",
  review: "review", "review-requested": "review", "ready-for-review": "review",
  labeled: "label", unlabeled: "label", assigned: "person", unassigned: "person",
  renamed: "rename",
};

function reviewWord(state) {
  return state === "APPROVED" ? "approved" :
    state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed";
}

/** One event as a line: a marker, what happened, and whatever it points at. */
function eventLine(e, item, openThread) {
  const d = el("div", { className: "tev " + e.type });
  const mark = el("span", { className: "tico" });
  mark.innerHTML = iconHTML(GLYPH[e.type] ?? "dot");
  d.append(mark);
  const body = el("div", { className: "tbody" });
  d.append(body);

  const said = (html) => {
    body.insertAdjacentHTML(
      "beforeend",
      "<b>" + esc(e.actor || "someone") + "</b> " + html +
        ' <span class="twhen">· ' + esc(ago(e.createdAt)) + "</span>",
    );
  };

  switch (e.type) {
    case "cross-referenced":
      said("mentioned this in");
      body.append(xref(e.source, item, openThread));
      break;

    case "referenced": {
      const where = e.commit?.repo && e.commit.repo !== item.repo ? " in " + esc(e.commit.repo) : "";
      said("added a commit that references this" + where);
      if (e.commit) {
        body.append(
          el("a", {
            className: "tcommit",
            href: e.commit.url,
            target: "_blank",
            rel: "noopener",
            textContent: e.commit.subject || e.commit.sha,
            title: e.commit.sha,
          }),
        );
      }
      break;
    }

    case "closed":
      said(e.closer ? "closed this as completed by" : "closed this");
      if (e.closer) body.append(xref({ ...e.closer, kind: "pr", state: "MERGED", repo: item.repo }, item, openThread));
      break;

    case "reopened": said("reopened this"); break;
    case "merged": said("merged this"); break;
    case "review": said(reviewWord(e.state) + " this"); break;
    case "ready-for-review": said("marked this ready for review"); break;
    case "review-requested": said("requested a review from <b>" + esc(e.assignee) + "</b>"); break;
    case "labeled": said("added the <b>" + esc(e.label) + "</b> label"); break;
    case "unlabeled": said("removed the <b>" + esc(e.label) + "</b> label"); break;
    case "assigned": said("assigned <b>" + esc(e.assignee) + "</b>"); break;
    case "unassigned": said("unassigned <b>" + esc(e.assignee) + "</b>"); break;
    case "renamed": said("renamed this from “" + esc(e.from) + "”"); break;
    default: said(e.type);
  }
  return d;
}

/** The issue or PR an event points at. Open it here if it is one of ours; GitHub if not. */
function xref(source, item, openThread) {
  const state = String(source.state ?? "OPEN").toLowerCase();
  const b = el("button", { className: "xref" });
  const glyph =
    state === "merged" ? "merged" :
    state === "closed" ? "issue-closed" :
    state === "draft" ? "draft" : "issue-open";
  const st = el("span", { className: "st " + state, title: state });
  st.innerHTML = iconHTML(glyph);
  b.append(
    st,
    el("span", { className: "t", textContent: source.title || "#" + source.number }),
    el("span", {
      className: "n",
      textContent: (source.repo && source.repo !== item.repo ? source.repo.split("/")[1] + " " : "") +
        "#" + source.number,
    }),
  );
  // Open it in the portal when it is something the inbox already holds; otherwise GitHub,
  // because a closed issue is not in the inbox and there is nothing here to show.
  b.onclick = () => {
    const known = (S.inbox?.items ?? []).find(
      (i) => i.repo === source.repo && i.number === source.number,
    );
    if (known) {
      S.inboxOpen = { repo: known.repo, number: known.number, kind: known.kind };
      writeHash(false);
      openThread(S.inboxOpen);
      return;
    }
    if (source.url) open(source.url, "_blank", "noopener");
  };
  return b;
}

function comment(author, when, body, isBody, repo, badge) {
  const d = el("div", { className: "cmt" + (isBody ? " first" : "") });
  const meta = el("div", { className: "meta" });
  meta.append((author || "?") + " · " + new Date(when).toLocaleString());
  if (badge) meta.append(el("span", { className: "pill", style: "margin-left:8px", textContent: badge }));
  d.append(meta);
  d.append(el("div", { className: "md cbody", innerHTML: mdlite(body || "_no description_", { repo }) }));
  return d;
}

function checkGlyph(state) {
  return iconHTML(state === "passing" ? "check" : state === "failing" ? "close" : "dot");
}

/* --------------------------------- new issue -------------------------------- */

function newIssueForm(viewer) {
  const repos = (S.inbox?.repos ?? []).map((r) => r.owner + "/" + r.name);
  const box = el("div");
  const repo = el("select");
  for (const r of repos) repo.append(el("option", { value: r, textContent: r }));
  const title = el("input", { type: "search", placeholder: "Title", style: "flex:1;min-width:240px" });
  const body = el("textarea", { placeholder: "Body (markdown)", rows: 8 });
  const labels = el("input", { type: "search", placeholder: "Labels, comma separated" });
  const status = el("span", { className: "meta" });
  const create = el("button", { className: "ghbtn primary", textContent: "Create issue" });

  create.onclick = async () => {
    if (!title.value.trim()) { title.focus(); return; }
    create.disabled = true;
    status.textContent = "creating…";
    status.className = "meta";
    try {
      const r = await post({
        action: "create",
        repo: repo.value,
        title: title.value,
        body: body.value,
        labels: labels.value.split(",").map((s) => s.trim()).filter(Boolean),
      });
      status.innerHTML =
        'created · <a href="' + esc(r.url ?? "") + '" target="_blank" rel="noopener">open it</a>';
      await refreshAll(true);
    } catch (e) {
      status.textContent = e.message;
      status.className = "meta err";
    }
    create.disabled = false;
  };

  box.append(
    el("h3", { style: "margin:0 0 12px;font:600 16px var(--sans)", textContent: "New issue" }),
    el("div", { className: "row", style: "margin-bottom:9px" }, [repo, title]),
    body,
    labels,
    el("div", { className: "row", style: "margin-top:10px" }, [create, status]),
  );
  viewer.replaceChildren(box);
}
