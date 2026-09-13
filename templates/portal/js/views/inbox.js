/* The inbox: everything open across the org, and the thread beside it. */

import { getLabels, getPr, getThread, post, upload } from "../api.js";
import { askText } from "../dialog.js";
import { ago, el, esc, markCurrent, skeleton } from "../dom.js";
import { icon, iconHTML } from "../icons.js";
import { mdlite } from "../md.js";
import { attachMentions } from "../mention.js";
import { ensureInbox, refreshAll, stampCounts } from "../refresh.js";
import { humanLabel, humansOf, isHuman, S, writeHash } from "../state.js";
import { renderDiff } from "./changed.js";

/* The labels roster itself creates, and what each one means about urgency. Everything else is
   the org's own vocabulary and stays plain: colouring a word this file has never heard of
   would be guessing. */
const LABEL_TONE = {
  decision: "hot", blocked: "hot", review: "warm", submit: "warm",
  idea: "cool", build: "cool", setup: "cool", data: "cool",
};

/**
 * A label's tone.
 *
 * `roster hire` puts a label on every tracker named after the human's marker, so "this is on a
 * person" is a label like `will` or `sam` — it used to be spelled `will` in the map above,
 * which coloured exactly one org's and left every other org's looking like an ordinary tag.
 * It comes off org.yaml now, so it is right wherever this runs.
 */
function tone(label) {
  if (LABEL_TONE[label]) return LABEL_TONE[label];
  const name = String(label).toLowerCase();
  return humansOf().some(
    (h) => String(h.marker ?? "").toLowerCase() === name ||
      String(h.github ?? "").toLowerCase() === name,
  )
    ? "hot"
    : "";
}

/**
 * The staff member this repo is the tracker for, or null.
 *
 * A staff member's caller workflow lives in their own brain repo and gates on their `@handle`
 * appearing there. So a mention is a mechanism in exactly one repository per person, and
 * decoration in every other — including the product repos, where the pull requests are.
 *
 * That asymmetry is invisible on the page otherwise: the reply box takes `@cto` anywhere and
 * posts it anywhere, and the difference between "asked the CTO" and "typed their name" is a
 * workflow file in another repository. This is what the two things below use to say so.
 */
function listener(repo) {
  return S.data.staff.find((s) => s.brain && s.brain === repo) ?? null;
}

/** The handles mentioned in some text, as staff members. */
function mentioned(text) {
  const said = String(text ?? "");
  return S.data.staff.filter((s) => {
    const at = String(s.mention ?? "@" + s.handle);
    return new RegExp("(^|\\s)" + at.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)", "i").test(said);
  });
}

/** Half-written replies, by thread, for as long as the page is open. */
const DRAFTS = new Map();

/** A pull request's commits and diff, once fetched. Same lifetime, same reason. */
const PRS = new Map();

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

export const viewInbox = (m) => inboxScreen(m, {});

/**
 * The same screen, scoped to pull requests.
 *
 * Its own place in the sidebar because open PRs are a different question from an inbox: an
 * inbox is what is waiting on you, and a PR is work that is finished and waiting on a merge.
 * Everything else — the threads, the reactions, the commits and the diff — is the one
 * implementation, because a PR is a thread with more on it and not a second kind of screen.
 */
export const viewPrs = (m) => inboxScreen(m, { prs: true });

function inboxScreen(m, opts) {
  /* "Pending work", not "Pull requests". Every one of these is a piece of work a staff member
     has finished and cannot land on their own, which is the thing you are being asked about.
     That it arrives as a pull request is how it is delivered, not what it is. */
  m.append(el("h1", { textContent: opts.prs ? "Pending work" : "Inbox" }));
  const sub = el("p", {
    className: "sub",
    textContent: opts.prs
      ? "Work the staff have finished and cannot land themselves."
      : "Everything open across the org.",
  });
  m.append(sub);

  const search = el("input", {
    type: "search",
    placeholder: "Filter by title, label, repo…",
    value: S.query,
  });
  const scope = el("select");
  scope.append(
    el("option", { value: "", textContent: "Everything" }),
    el("option", { value: "mine", textContent: "On " + humanLabel() }),
    // Scoping pull requests to pull requests is not a filter, and a decision is not a PR.
    ...(opts.prs
      ? []
      : [
          el("option", { value: "decision", textContent: "Decisions" }),
          el("option", { value: "pr", textContent: "Open work (PRs)" }),
        ]),
  );
  scope.value = opts.prs && S.inboxFilter !== "mine" ? "" : S.inboxFilter;

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
  const controls = [search, whose, state, scope, refresh];
  // A pull request comes from a branch, so there is nothing here that could open one.
  if (!opts.prs) {
    const newBtn = el("button", { className: "ghbtn", textContent: "New issue" });
    newBtn.onclick = () => {
      delete viewer.dataset.wait;
      newIssueForm(viewer);
    };
    controls.push(newBtn);
  }
  m.append(el("div", { className: "row", style: "margin-bottom:16px" }, controls));

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

  if (S.inbox) { stampCounts(); paint(); restore(); } else load(false);

  /** A `?t=` in the URL names a thread. It used to be read into the state and then never
      acted on, because only the already-loaded branch opened one. */
  function restore() {
    if (!S.inboxOpen) return;
    // The two screens share one open thread. An issue carried over from the inbox is not on
    // this one, so it is dropped rather than opened beside a list it is not in.
    if (opts.prs && S.inboxOpen.kind !== "pr") {
      S.inboxOpen = null;
      writeHash(false);
      return;
    }
    openThread(S.inboxOpen);
  }

  /**
   * Fetch, through the one request the shell may already have in flight.
   *
   * Waiting looks like what is coming: rows in the list, a thread in the viewer. The reads run
   * across every repo in the org, so on a cold cache this is seconds, and seconds of a blank
   * panel beside a blank panel reads as a page that has failed rather than one that is working.
   */
  async function load(force) {
    sub.dataset.busy = "1";
    list.replaceChildren(
      el("p", { className: "skhead", textContent: "Asking GitHub…" }),
      ...skeleton("row", 7),
    );
    /* The flag is what makes the placeholder safe to remove: you can open New issue while this
       is still running, and the arriving inbox must not throw away what you have started
       typing. Anything that writes real content into the viewer clears it. */
    if (!S.inboxOpen) {
      viewer.dataset.wait = "1";
      viewer.replaceChildren(...skeleton("head", 1), ...skeleton("line", 6));
    }
    try {
      await ensureInbox(force);
    } catch (e) {
      refresh.classList.remove("spin");
      delete sub.dataset.busy;
      clearPlaceholder();
      list.replaceChildren(
        el("p", { className: "empty err", textContent: "Could not reach GitHub: " + e.message }),
      );
      return;
    }
    refresh.classList.remove("spin");
    delete sub.dataset.busy;
    stampCounts();
    paint();
    restore();
    // Nothing was selected, so the placeholder thread has nothing to become.
    clearPlaceholder();
  }

  /** Take the waiting shapes away, and leave alone anything that replaced them. */
  function clearPlaceholder() {
    if (viewer.dataset.wait !== "1") return;
    delete viewer.dataset.wait;
    viewer.replaceChildren();
  }

  function paint() {
    if (!S.inbox) return;
    const q = S.query.trim().toLowerCase();
    // "On you" is on any of the humans this org answers to, not only the first one.
    const onAHuman = (i) => (i.assignees ?? []).some(isHuman);

    const whoseStaff = S.inboxStaff ? S.data.staff.find((s) => s.handle === S.inboxStaff) : null;
    const mine = S.inbox.items
      .filter((i) => belongsTo(i, whoseStaff))
      .filter((i) => !opts.prs || i.kind === "pr");
    const isOpen = (i) => i.state === "OPEN";
    const scoped = mine.filter(
      S.inboxState === "closed" ? (i) => !isOpen(i) : S.inboxState === "all" ? () => true : isOpen,
    );

    let items = scoped.filter(
      (i) => !q || (i.title + " " + i.repo + " " + i.labels.join(" ") + " #" + i.number)
        .toLowerCase().includes(q),
    );
    if (S.inboxFilter === "mine") items = items.filter(onAHuman);
    else if (S.inboxFilter === "decision") items = items.filter((i) => i.labels.includes("decision"));
    else if (S.inboxFilter === "pr") items = items.filter((i) => i.kind === "pr");

    const open = mine.filter(isOpen);
    const onYou = open.filter(onAHuman).length;
    const prs = open.filter((i) => i.kind === "pr").length;
    const shut = mine.length - open.length;
    const where = whoseStaff
      ? " for <b>" + esc(whoseStaff.name) + "</b>"
      : " across " + (S.inbox.repos ?? []).length + " repos";
    /* On the PR screen the count that matters is not "how many are open" — it is how many are
       green and still sitting there, because that is the pile you are the bottleneck on. */
    const failing = open.filter((i) => i.checks === "failing").length;
    const ready = open.filter((i) => i.checks === "passing").length;
    sub.innerHTML =
      (S.inboxState === "closed"
        ? shut + " closed in the last 45 days" + where
        : opts.prs
          ? open.length + " open" + where + " · <b>" + ready + " with checks passing</b>" +
            (failing ? " · " + failing + " failing" : "") +
            (S.inboxState === "all" ? " · " + shut + " closed or merged" : "")
          : open.length + " open" + where + " · <b>" + onYou + " on " +
            esc(humanLabel()) + "</b> · " + prs + " waiting on a merge" +
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
      const yours = onAHuman(i);
      const chips = i.labels
        .slice(0, 3)
        .map((l) => '<span class="chip ' + tone(l) + '">' + esc(l) + "</span>")
        .join("");
      b.innerHTML =
        '<div class="ititle">' +
          (yours ? '<span class="dot" title="assigned to ' + esc(humanLabel()) + '"></span>' : "") +
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
          // How much conversation is on a thread, which is most of what tells a live one from
          // something that was filed and never answered.
          (i.comments.length
            ? '<span class="cc" title="' + i.comments.length + ' comments">' +
              iconHTML("review") + i.comments.length + "</span>"
            : "") +
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
      '<div class="meta">' + esc(item.repo) + " · " + (item.kind === "pr" ? "PR " : "") + "#" + item.number +
        ' · <span class="' + (item.state === "OPEN" ? "ok" : "") + '">' + esc(item.state) + "</span>" +
        " · " + esc(item.author) + " · " + ago(item.updatedAt) + "</div>" +
      "<h3>" + esc(item.title) + "</h3>" +
      (item.labels.length
        ? '<div class="row tlabels">' +
          item.labels.map((l) => '<span class="chip ' + tone(l) + '">' + esc(l) + "</span>").join("") +
          "</div>"
        : "");
    head.append(threadActions(item));
    delete viewer.dataset.wait;
    viewer.replaceChildren(head);

    /* A pull request is a conversation, a set of commits and a diff. The inbox carries the
       first; the other two are a click away rather than in every refresh of every repo.
       An issue has only the conversation, so it stays flat in the viewer rather than paying
       for a wrapper that would only ever hold one thing. */
    const pane = item.kind === "pr" ? el("div") : viewer;
    if (item.kind === "pr") viewer.append(prTabs(item, pane), pane);
    conversation(pane, item);
    viewer.scrollTop = 0;
  }

  /** Appends; whoever is swapping panes owns clearing them. */
  function conversation(pane, item) {
    /* Newest first, opening post last. GitHub's own order puts the answer you came for at the
       bottom of a year of bookkeeping, and the thing you do most on this screen is read what
       just happened. The title and the actions are in the header, so nothing you need is
       further down than the first screenful. */
    const from = pane.children.length;
    for (const node of timeline(item, openThread)) pane.append(node);
    pane.append(
      comment({
        author: item.author, when: item.createdAt, body: item.body, first: true,
        repo: item.repo, reactions: item.reactions,
      }),
    );
    /* Whatever ends up first drops its own top rule. The header already draws a line under
       itself, and with the thread reversed the first thing under it is any of three shapes. */
    pane.children[from]?.classList?.add("lead");
  }

  /**
   * Conversation, commits, files — for pull requests only.
   *
   * The detail is fetched once per thread and kept, so switching back and forth is free. A
   * failure is shown in the pane rather than swallowed: "no diff" and "GitHub would not give
   * me the diff" are different answers.
   */
  function prTabs(item, pane) {
    const bar = el("div", { className: "tabs" });
    const key = item.repo + "#" + item.number;
    let detail = PRS.get(key) ?? null;

    const tabs = [
      ["conversation", "Conversation", () => { pane.replaceChildren(); conversation(pane, item); }],
      ["commits", "Commits", () => paintCommits(pane, detail)],
      ["files", "Files", () => paintFiles(pane, detail, item)],
    ];

    const pick = async (id) => {
      for (const b of bar.children) b.setAttribute("aria-current", String(b.dataset.tab === id));
      if (id === "conversation") {
        pane.replaceChildren();
        conversation(pane, item);
        return;
      }
      if (!detail) {
        pane.replaceChildren(el("p", { className: "empty", textContent: "Asking GitHub…" }));
        try {
          detail = await getPr(item.repo, item.number);
          PRS.set(key, detail);
        } catch (e) {
          pane.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
          return;
        }
      }
      if (detail.error) {
        pane.replaceChildren(el("p", { className: "empty err", textContent: detail.error }));
        return;
      }
      tabs.find((t) => t[0] === id)[2]();
    };

    for (const [id, label] of tabs) {
      const b = el("button", { className: "tab", textContent: label });
      b.dataset.tab = id;
      b.setAttribute("aria-current", String(id === "conversation"));
      b.onclick = () => pick(id);
      bar.append(b);
    }
    return bar;
  }

  function paintCommits(pane, d) {
    pane.replaceChildren(
      el("p", { className: "meta", style: "margin:14px 0 10px",
        textContent: d.commits.length + " commits · " + d.head + " → " + d.base }),
    );
    if (!d.commits.length) {
      pane.append(el("p", { className: "empty", textContent: "No commits on this branch yet." }));
      return;
    }
    for (const c of d.commits) {
      const row = el("div", { className: "prcommit" });
      row.append(
        el("a", { className: "sha", href: c.url, target: "_blank", rel: "noopener", textContent: c.sha }),
        el("span", { className: "subj", textContent: c.subject }),
        el("span", { className: "meta", textContent: c.author + (c.date ? " · " + ago(c.date) : "") }),
      );
      pane.append(row);
    }
  }

  function paintFiles(pane, d, item) {
    pane.replaceChildren(
      el("p", { className: "meta", style: "margin:14px 0 10px",
        textContent: d.changedFiles + " files · +" + d.additions + " −" + d.deletions }),
    );
    if (!d.files.length) {
      pane.append(el("p", { className: "empty", textContent: "This pull request changes nothing." }));
      return;
    }
    for (const f of d.files) {
      /* renderDiff reads a git diff, so each file's patch is given the header the API leaves
         off. A file with no patch is binary or too big for GitHub to send one — say which. */
      if (!f.patch) {
        const wrap = el("div", { className: "dblock" });
        const h = el("div", { className: "dfile" });
        h.innerHTML = "<b>" + esc(f.path) + "</b>" +
          '<span class="p">+' + f.additions + '</span><span class="m">−' + f.deletions + "</span>";
        wrap.append(h, el("p", { className: "dempty",
          textContent: "No patch: this file is binary or too large for the API to send one." }));
        pane.append(wrap);
        continue;
      }
      const blocks = renderDiff("diff --git a/" + f.path + " b/" + f.path + "\n" + f.patch);
      /* The ask goes in the file's own heading, because "this file is wrong" is the thing you
         want to say while looking at one file, and the alternative is describing in prose which
         of thirty files you meant. The hunk goes with it, so the agent gets the part you were
         reading rather than the whole diff and a guess. */
      const head = blocks[0]?.children?.[0];
      if (item && head && String(head.className ?? "").includes("dfile")) {
        head.append(replyAboutFile(item, f));
      }
      for (const block of blocks) pane.append(block);
    }
  }

  /**
   * The same reply box, opened about one file.
   *
   * "This bit is wrong" is what you want to say while looking at one file, and the alternative
   * is describing in prose which of thirty files you meant. It is not a second kind of thing:
   * it opens the composer the Reply button opens, with the file remembered, so the hunk rides
   * along to whoever you name in it.
   */
  function replyAboutFile(item, f) {
    const b = el("button", {
      className: "ghbtn askfile",
      textContent: "Reply",
      title: "Reply about " + f.path,
    });
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await openReply(item, f);
        if (r) b.textContent = r.warning ? "sent, with a warning" : "sent";
      } catch (e) {
        b.textContent = e.message;
      }
      b.disabled = false;
    };
    return b;
  }

  /**
   * Reply, close, merge — at the top of the thread, next to the title.
   *
   * They used to sit under the last comment, which meant scrolling a long thread to the end to
   * answer it, and then the thread put the newest thing there too. The actions are about the
   * thread rather than about its last message, so they belong where the thread starts. Writing
   * happens in a dialog for the same reason: a box you can only reach by scrolling is a box you
   * stop using.
   *
   * All of it goes out as the human, through their own `gh`, so it is indistinguishable from
   * doing it on the site.
   */
  function threadActions(item) {
    const key = item.repo + "#" + item.number;
    const status = el("span", { className: "meta" });
    const buttons = [];

    const busy = (on, msg) => {
      for (const b of buttons) b.disabled = on;
      status.textContent = msg ?? "";
      status.className = "meta";
    };
    const failed = (e) => {
      status.textContent = e.message;
      status.className = "meta err";
      busy(false);
      status.className = "meta err";
    };

    /* A reply you started and did not send survives closing the dialog, and comes back the
       next time you open it rather than being lost to a stray Escape. `compose` is kept for
       the close button below, which also takes a parting comment. */
    const compose = ({ title, hint, confirm, allowEmpty }) =>
      askText({
        title,
        hint,
        confirm,
        allowEmpty,
        value: DRAFTS.get(key) ?? "",
        placeholder:
          "Reply as " + (humansOf().length === 1 ? humansOf()[0].github : "yourself") + "…",
        decorate: (ta) => {
          ta.oninput = () => {
            if (ta.value) DRAFTS.set(key, ta.value);
            else DRAFTS.delete(key);
          };
          return attachBox(ta, () => item.repo).node;
        },
      });

    /* One button, because there was no way to tell the two apart. Reply reaches whoever you
       named in it; see `openReply`. */
    const reply = el("button", { className: "ghbtn primary", textContent: "Reply" });
    reply.onclick = async () => {
      let r;
      try {
        r = await openReply(item, null);
      } catch (e) {
        failed(e);
        return;
      }
      if (!r) return;
      /* Repaint only when something was said on this thread, which is always true here: `ask`
         posts the comment too. A warning means the tracker issue went up and the comment did
         not, and then the status line is the only thing that says so. */
      if (r.warning) {
        status.className = "meta err";
        status.textContent = r.warning;
        return;
      }
      await reloadThread(item);
    };
    buttons.push(reply);

    const closeBtn = el("button", {
      className: "ghbtn",
      textContent: item.state === "OPEN" ? "Close" : "Reopen",
    });
    closeBtn.onclick = async () => {
      const closing = item.state === "OPEN";
      let body;
      if (closing) {
        // Closing is the one thing here that is awkward to undo from a phone later, so it asks
        // — and since it is asking anyway, it takes a parting comment.
        body = await compose({
          title: "Close " + item.repo + " #" + item.number + "?",
          hint: "Anything you write here is posted as a comment first. Leave it empty to just close.",
          confirm: "Close it",
          allowEmpty: true,
        });
        if (body === null) return;
      }
      busy(true, closing ? "closing…" : "reopening…");
      try {
        await post({
          action: closing ? "close" : "reopen",
          repo: item.repo,
          number: item.number,
          body: body || undefined,
        });
        DRAFTS.delete(key);
        await refreshAll(false);
      } catch (e) { failed(e); }
    };
    buttons.push(closeBtn);

    const row = el("div", { className: "row tacts" }, buttons);

    /* Merging cannot be undone with another click, so it asks first and names what it is about
       to merge. It does not ask *how*: squash, merge commit or rebase is a question about git
       rather than about this pull request, and the repository has already answered it in its
       own settings. The server reads it from there. */
    if (item.kind === "pr" && item.state === "OPEN") {
      const merge = el("button", { className: "ghbtn", textContent: "Merge" });
      merge.onclick = async () => {
        if (!confirm("Merge " + item.repo + " #" + item.number + " into its base branch?")) return;
        busy(true, "merging…");
        try {
          await post({ action: "merge", repo: item.repo, number: item.number });
          await refreshAll(false);
        } catch (e) { failed(e); }
      };
      buttons.push(merge);
      row.append(merge);
    }

    row.append(status);
    // Last, and pushed to the far end: it is the way out of this screen rather than one of the
    // things you do on it. Same shape as the rest, so the row reads as one set of controls.
    row.append(
      el("a", {
        className: "ghbtn out",
        href: item.url,
        target: "_blank",
        rel: "noopener",
        textContent: "Open in GitHub",
      }),
    );
    return row;
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
    // The thread is newest first, so what you just wrote is the first thing on it.
    openThread({ repo: item.repo, number: item.number, kind: item.kind });
  }
}

/* -------------------------- one composer, one box ------------------------- */

/**
 * Reply to a thread, and reach whoever you named while doing it.
 *
 * There used to be two buttons on a thread, Reply and "Ask a staff member", and nothing on the
 * page said which one you wanted. They did almost the same thing: both put your words on the
 * thread, and both could open a request on somebody's tracker. The only real difference was
 * that one of them made you pick a name from a dropdown, which is a worse way of saying who you
 * mean than typing their name in the sentence.
 *
 * So there is one box. Type `@cto` in it, and if a comment here would not reach them the offer
 * to open it on their tracker appears underneath, ticked. One press does both.
 *
 * @param anchor  the file this is about, when it was opened from a diff. Its hunk rides along.
 * @returns the result of the write, or null if nothing was written.
 */
async function openReply(item, anchor) {
  const key = item.repo + "#" + item.number + (anchor ? " · " + anchor.path : "");
  let deaf = null;

  const body = await askText({
    title: "Reply to " + item.repo + " #" + item.number,
    hint: anchor ? anchor.path : item.title,
    confirm: "Comment",
    value: DRAFTS.get(key) ?? "",
    /* It goes out through whoever's `gh` is signed in here, which is only knowably one person
       when the org has one. With two it would be a guess, and a wrong name on a reply box is
       worse than no name. */
    placeholder: "Reply as " + (humansOf().length === 1 ? humansOf()[0].github : "yourself") + "…",
    decorate: (ta) => {
      ta.oninput = () => {
        if (ta.value) DRAFTS.set(key, ta.value);
        else DRAFTS.delete(key);
      };
      deaf = deafNote(ta, item, anchor);
      return el("div", {}, [attachBox(ta, () => item.repo).node, deaf.node]);
    },
  });
  if (!body) return null;

  /* One press, both writes. `ask` posts the comment itself when told to, so these are not two
     requests racing: the tracker issue goes up first because it is the half that actually
     reaches anybody, and the comment on the thread carries a link to it.

     Who to reach comes off the text that was submitted rather than off what was in the box
     while it was being typed, so a handle you typed and then deleted is not asked. */
  const reaching = listener(item.repo) ? [] : mentioned(body);
  const to = deaf?.declined() ? null : reaching[0];
  if (!to) {
    DRAFTS.delete(key);
    return post({ action: "comment", repo: item.repo, number: item.number, body });
  }

  const detail = PRS.get(item.repo + "#" + item.number);
  const r = await post({
    action: "ask",
    repo: to.brain,
    ask: {
      staff: {
        handle: to.handle,
        name: to.name,
        mention: to.mention ?? "@" + to.handle,
        brain: to.brain,
      },
      pr: {
        repo: item.repo,
        number: item.number,
        title: item.title ?? "",
        url: item.url ?? "",
        kind: item.kind,
        // The branch names only. The rest of the detail is commits and every file's patch, and
        // none of it belongs in a request that is about a sentence.
        head: detail?.head,
        base: detail?.base,
      },
      body,
      ...(anchor ? { anchor: { path: anchor.path, patch: anchor.patch } } : {}),
    },
    alsoOnPr: true,
  });
  DRAFTS.delete(key);
  return r;
}

/**
 * "You typed a name nobody here answers to." And then an offer to fix it.
 *
 * The `@` list offers every staff member in every box, and posting one on a product repo looks
 * exactly like posting one on a tracker: it goes up, it renders as a chip, and nothing happens.
 *
 * Saying so is not enough. An earlier version told you to post the comment and then go and
 * press the other button, which is the round trip this whole lane exists to remove, with a
 * lecture in front of it. If the box knows who you meant and knows a comment here will not
 * reach them, it should offer to reach them.
 */
function deafNote(ta, on, anchor) {
  const line = el("span", {});
  const box = el("input", { type: "checkbox", checked: true, id: "reply-alsoask" });
  const offer = el("label", { className: "meta", htmlFor: "reply-alsoask" }, [
    box,
    el("span", {
      textContent:
        " open it on their tracker too, with a link to this" +
        (anchor ? " and the diff for " + anchor.path : ""),
    }),
  ]);
  const note = el("div", { className: "meta err", style: "margin:8px 0 0" }, [line, offer]);

  const check = () => {
    const deaf = listener(on.repo) ? [] : mentioned(ta.value);
    note.hidden = !deaf.length;
    line.textContent = deaf.length
      ? deaf.map((s) => s.mention ?? "@" + s.handle).join(" and ") +
        " is not woken by a comment on " + on.repo + ": it is not their tracker. "
      : "";
  };
  ta.addEventListener("input", check);
  check();
  /* Only whether the offer was declined. Who, and whether there is anybody at all, is worked
     out from the text that was actually submitted. */
  return { node: note, declined: () => !box.checked };
}

/* ------------------------------- the thread ------------------------------ */

/**
 * A thread's history, newest first: comments and reviews as cards, references as lines, and a
 * run of bookkeeping folded behind one disclosure.
 *
 * A run of exactly one stays inline. Hiding "added the build label" behind a click costs
 * more attention than reading it does.
 *
 * Reversed rather than rendered in GitHub's order, because the question this screen answers is
 * "what just happened", and the answer was at the bottom of everything that happened before it.
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

  for (const e of [...(item.events ?? [])].reverse()) {
    if (QUIET.has(e.type)) { quiet.push(e); continue; }
    flush();
    if (e.type === "comment") {
      out.push(
        comment({
          author: e.actor, when: e.createdAt, body: e.body, repo: item.repo,
          reactions: e.reactions,
        }),
      );
    } else if (e.type === "review" && (e.body ?? "").trim()) {
      out.push(
        comment({
          author: e.actor, when: e.createdAt, body: e.body, repo: item.repo,
          badge: reviewWord(e.state),
        }),
      );
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

function comment({ author, when, body, first, repo, badge, reactions }) {
  const d = el("div", { className: "cmt" + (first ? " first" : "") });
  const meta = el("div", { className: "meta" });
  meta.append((author || "?") + " · " + new Date(when).toLocaleString());
  if (badge) meta.append(el("span", { className: "pill", style: "margin-left:8px", textContent: badge }));
  d.append(meta);
  d.append(el("div", { className: "md cbody", innerHTML: mdlite(body || "_no description_", { repo }) }));
  const marks = reactionRow(reactions);
  if (marks) d.append(marks);
  return d;
}

/* GitHub's eight, by their API names. An agent that has picked something up puts 👀 on it, and
   that acknowledgement is most of why these are worth rendering at all: without it a person
   posts a comment and has no way to see it landed short of opening GitHub. */
const REACTION = {
  THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉",
  CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀",
};

function reactionRow(reactions) {
  const list = (reactions ?? []).filter((r) => r.count > 0);
  if (!list.length) return null;
  const row = el("div", { className: "reacts" });
  for (const r of list) {
    const extra = r.count - r.by.length;
    row.append(
      el("span", {
        className: "react",
        title: r.by.join(", ") + (extra > 0 ? " and " + extra + " more" : ""),
        textContent: (REACTION[r.content] ?? "•") + " " + r.count,
      }),
    );
  }
  return row;
}

function checkGlyph(state) {
  return iconHTML(state === "passing" ? "check" : state === "failing" ? "close" : "dot");
}

/* --------------------------------- new issue -------------------------------- */

/**
 * Ask one of the staff for something.
 *
 * One question, one dropdown: **who is this for**. It used to be two — a staff member and a
 * repo — which asked you to know that an issue reaches an agent by landing in their brain repo
 * *and* saying their `@handle`, and let you set the pair to a combination that reaches nobody.
 * Neither of those is a decision worth having; both follow from the name you picked.
 *
 * So the repo is their brain, the mention goes in the body and is kept in step with the choice,
 * and where it is going is said on the page rather than chosen on it.
 */
function newIssueForm(viewer) {
  const box = el("div");
  const title = el("input", { type: "search", placeholder: "Title", style: "width:100%" });
  const body = el("textarea", {
    placeholder: "What do you want them to do? (markdown)",
    rows: 8,
    value: "",
  });
  const status = el("span", { className: "meta" });
  const create = el("button", { className: "ghbtn primary", textContent: "Send it" });

  const mentionOf = (s) => s.mention ?? "@" + s.handle;
  const chosen = () => S.data.staff.find((x) => x.handle === who.value) ?? null;
  const repoOf = () => chosen()?.brain ?? "";

  const picked = labelPicker(repoOf);
  const files = attachBox(body, repoOf);
  // The recipient's mention is written in for you; this is for the second one, when an issue
  // needs somebody else to see it too.
  attachMentions(body);

  const who = el("select", { title: "Whose brain this goes to" });
  who.append(
    ...S.data.staff.map((s) =>
      el("option", {
        value: s.handle,
        textContent: s.name + (s.brain ? "" : " · no brain repo"),
      }),
    ),
  );
  if (!S.data.staff.length) {
    who.append(el("option", { value: "", textContent: "nobody has been hired yet" }));
  }
  who.value = S.inboxStaff || S.data.staff[0]?.handle || "";

  /* The mention is the mechanism: their workflow gates on it, so a body without one is a note
     nobody is woken by. It is written in for you, and rewritten when you change your mind —
     leaving the last person's `@handle` at the top would send the issue to one staff member
     and address it to another. */
  const MENTIONS = S.data.staff.map(mentionOf);
  const retarget = (to) => {
    const at = mentionOf(to);
    let text = String(body.value ?? "");
    for (const old of MENTIONS) {
      if (old === at) continue;
      text = text.replace(new RegExp("^\\s*" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*"), "");
    }
    body.value = text.includes(at) ? text : at + " " + text.replace(/^\s+/, "");
  };

  who.onchange = () => {
    const s = chosen();
    if (!s) return;
    retarget(s);
    picked.load();
    hint();
  };

  /* Where it lands and what wakes them, said out loud. Somebody who deletes the mention from
     the body has quietly turned a request into a note, and this is the only thing that says so. */
  const forWhom = el("p", { className: "meta", style: "margin:9px 0 0" });
  const hint = () => {
    const s = chosen();
    if (!s) {
      forWhom.textContent = "There is nobody to send this to yet. Hire a staff member first.";
      create.disabled = true;
      return;
    }
    if (!s.brain) {
      forWhom.textContent =
        s.name + " has no brain repo in their manifest, so there is nowhere to put this.";
      create.disabled = true;
      return;
    }
    create.disabled = false;
    forWhom.textContent =
      "Goes to " + s.brain + ". " +
      (String(body.value ?? "").includes(mentionOf(s))
        ? mentionOf(s) + " in the body is what wakes them, usually within a minute."
        : "Put " + mentionOf(s) + " back in the body, or nothing will wake them.");
  };
  body.addEventListener("input", hint);

  if (chosen()) retarget(chosen());
  picked.load();
  hint();

  create.onclick = async () => {
    const s = chosen();
    if (!s?.brain) return;
    if (!title.value.trim()) { title.focus(); return; }
    create.disabled = true;
    status.textContent = "creating…";
    status.className = "meta";
    try {
      const r = await post({
        action: "create",
        repo: s.brain,
        title: title.value,
        body: body.value,
        labels: picked.chosen(),
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
    el("h3", { style: "margin:0 0 12px;font:600 16px var(--sans)", textContent: "Ask a staff member" }),
    el("div", { className: "row", style: "margin-bottom:9px" }, [
      el("label", { className: "meta", textContent: "For", htmlFor: "newissue-who" }),
      Object.assign(who, { id: "newissue-who" }),
    ]),
    el("div", { className: "row", style: "margin-bottom:9px" }, [title]),
    body,
    forWhom,
    files.node,
    picked.node,
    el("div", { className: "row", style: "margin-top:10px" }, [create, status]),
  );
  viewer.replaceChildren(box);
}

/* --------------------------------- labels --------------------------------- */

/**
 * The repo's own labels, as toggles.
 *
 * This used to be a text box you typed comma-separated names into, which is a spelling test:
 * `from-cmo` and `from-CMO` are different labels and only one of them exists. The set is small
 * and it is knowable, so it is offered instead.
 *
 * When GitHub cannot be reached the labels already on items in the inbox stand in. They are
 * not the whole vocabulary, but they are real, and a picker with the common ones beats a
 * disabled one.
 */
function labelPicker(repoOf) {
  const node = el("div", { className: "labelpick" });
  const head = el("div", { className: "meta", textContent: "Labels" });
  const wrap = el("div", { className: "chips" });
  node.append(head, wrap);
  const chosen = new Set();

  const paint = (labels, note) => {
    wrap.replaceChildren();
    head.textContent = "Labels" + (note ? " · " + note : "");
    if (!labels.length) {
      wrap.append(el("span", { className: "meta", textContent: "none on this repo" }));
      return;
    }
    for (const name of labels) {
      const b = el("button", { className: "chip pick " + tone(name), textContent: name });
      b.type = "button";
      b.setAttribute("aria-pressed", String(chosen.has(name)));
      b.onclick = () => {
        if (chosen.has(name)) chosen.delete(name);
        else chosen.add(name);
        b.setAttribute("aria-pressed", String(chosen.has(name)));
      };
      wrap.append(b);
    }
  };

  const seen = (repo) => [
    ...new Set((S.inbox?.items ?? []).filter((i) => i.repo === repo).flatMap((i) => i.labels ?? [])),
  ].sort();

  const load = async () => {
    const repo = repoOf();
    chosen.clear();
    if (!repo) { paint([]); return; }
    paint([], "asking GitHub…");
    try {
      const r = await getLabels(repo);
      if (r.error) paint(seen(repo), "GitHub said: " + r.error);
      else paint((r.labels ?? []).map((l) => l.name));
    } catch {
      paint(seen(repo), "offline, showing labels already in use");
    }
  };

  return { node, load, chosen: () => [...chosen] };
}

/* ------------------------------- attachments ------------------------------- */

/**
 * Files onto an issue.
 *
 * GitHub's own drag-and-drop attachments are minted by its web app and cannot be made with
 * `gh`, so a file dropped here is committed into the repo the issue is in and linked. That is
 * the better answer for this org anyway: every run clones the repo, so an agent opens the
 * screenshot off its own disk instead of being handed a URL it has no token for.
 *
 * Drop, pick or paste — paste is the one that matters, because a screenshot is on the
 * clipboard and never on disk.
 */
function attachBox(ta, repoOf) {
  const node = el("div", { className: "attach" });
  const pick = el("input", { type: "file", multiple: true, hidden: true });
  const btn = el("button", { className: "ghbtn", type: "button" });
  btn.append(icon("paperclip", "ic"), el("span", { textContent: "Attach files" }));
  const status = el("span", { className: "meta", textContent: "or drop them on the box above" });
  node.append(pick, btn, status);

  const say = (text, bad) => {
    status.textContent = text;
    status.className = bad ? "meta err" : "meta";
  };

  /* Written at the cursor, so an attachment lands where you were typing rather than at the
     end of whatever you had written. The repo path goes in beside the link: the link is for
     the person, the path is for the model. */
  const insert = (a) => {
    const name = a.path.split("/").pop();
    const media = /\.(png|jpe?g|gif|svg|webp|mp4|mov|webm|m4v)$/i.test(name);
    const text = (media ? "!" : "") + "[" + name + "](" + a.url + ")\n`" + a.path + "`\n";
    const at = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, at);
    ta.value = before + (before && !before.endsWith("\n") ? "\n" : "") + text + ta.value.slice(at);
    ta.selectionStart = ta.selectionEnd = before.length + text.length + 1;
    ta.focus();
  };

  const send = async (list) => {
    const repo = repoOf();
    if (!repo) { say("pick a repo first", true); return; }
    const files = [...list].filter((f) => f.size);
    if (!files.length) return;
    btn.disabled = true;
    for (const [n, f] of files.entries()) {
      say("uploading " + f.name + (files.length > 1 ? " (" + (n + 1) + "/" + files.length + ")" : "") + "…");
      try {
        const a = await upload(repo, f);
        insert(a);
        say(
          a.pushed
            ? "committed " + a.path + " to " + repo
            : "committed locally but not pushed: " + a.note,
          !a.pushed,
        );
      } catch (e) {
        say(f.name + ": " + e.message, true);
        break;
      }
    }
    btn.disabled = false;
    pick.value = "";
  };

  btn.onclick = () => pick.click();
  pick.onchange = () => send(pick.files);

  for (const zone of [node, ta]) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      ta.classList.add("dropping");
    });
    zone.addEventListener("dragleave", () => ta.classList.remove("dropping"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      ta.classList.remove("dropping");
      send(e.dataTransfer?.files ?? []);
    });
  }
  ta.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    send(files);
  });

  return { node };
}
