/* The shell: boot, the sidebar, and dispatching a view into <main>. */

import { getOrg } from "./api.js";
import { $, el, store } from "./dom.js";
import { icon, iconHTML, staffIcon } from "./icons.js";
import { installLightbox } from "./lightbox.js";
import { setPeople } from "./md.js";
import {
  countInBackground,
  refreshAll,
  refreshQuietly,
  stampCounts,
  stampLoaded,
  syncNotice,
} from "./refresh.js";
import { onRender } from "./router.js";
import { ORG_WIDE, S, VIEWS, applyHash, humanLabel, readHash, writeHash } from "./state.js";
import { viewBrain } from "./views/brain.js";
import { viewChanged } from "./views/changed.js";
import { viewDocs } from "./views/docs.js";
import { viewGraph } from "./views/graph.js";
import { viewHealth } from "./views/health.js";
import { openSearch } from "./search.js";
import { viewHome } from "./views/home.js";
import { viewInbox, viewPrs } from "./views/inbox.js";
import { viewOrg } from "./views/org.js";
import { viewPrompt } from "./views/prompt.js";
import { viewRuns } from "./views/runs.js";
import { sentence, whatsLeft } from "./readiness.js";
import { paintSetupNav, viewGettingStarted, viewSetup } from "./views/setup.js";
import { viewStaff } from "./views/staff.js";

const SCREEN = {
  setup: viewGettingStarted,
  home: viewHome,
  inbox: viewInbox,
  prs: viewPrs,
  runs: viewRuns,
  org: viewOrg,
  staff: viewStaff,
  docs: viewDocs,
  brain: viewBrain,
  memory: viewBrain,
  prompt: viewPrompt,
  graph: viewGraph,
  changed: viewChanged,
  health: viewHealth,
};

/**
 * Fields of the org export this page cannot render without.
 *
 * The portal reads its stylesheets and modules per request, so editing one and reloading
 * works. Its *server* is loaded once, at start. A portal left running across an upgrade
 * therefore serves new assets against an old API, and the first sign of it was an Org screen
 * asking for `undefined/org.yaml`. A missing field is version skew, and skew should say so.
 */
const NEEDS = ["org", "name", "opsName", "staff"];

/** The org-wide screens in the sidebar, by button. */
const NAV = [
  ["#setupnav", "setup"],
  ["#homenav", "home"],
  ["#inboxnav", "inbox"],
  ["#runsnav", "runs"],
  ["#staffnav", "staff"],
  ["#orgnav", "org"],
  ["#docsnav", "docs"],
];

export async function boot() {
  initTheme();

  /* Bound before the first request rather than after it. The sidebar is markup, so it is on
     screen and clickable while /api/org is still building the export, and a click in that
     window used to do nothing at all: the first click on Staff after a load was simply lost.
     Now it is remembered and honoured once there is something to render. */
  let early = null;
  for (const [id, view] of NAV) {
    const b = $(id);
    if (!b) continue;
    b.onclick = () => {
      if (!S.data) {
        early = view;
        return;
      }
      S.view = view;
      render();
    };
  }

  /* Before the first render, and once: it is delegated, so it covers every image any screen
     draws from here on, including the setup screen. */
  installLightbox();

  /* Before there is a tenant the server answers every data route with `mode: setup`. That is
     not an error state: it is the first thing a new user ever sees, and the whole page becomes
     the thing that fixes it. */
  const first = await getOrg();
  if (first && first.mode === "setup") {
    document.body.dataset.setup = "1";
    $("#orgname").textContent = "no org yet";
    /* Every one of these reads a tenant, so during setup they answer 409 and the sidebar is a
       row of four dead ends beside an empty Staff heading. There is one thing to do on this
       screen; the navigation comes back with the org. */
    for (const el of document.querySelectorAll("#sidesearch, #homenav, #inboxnav, #runsnav, #orgnav, #staffnav, #docsnav, #refreshall, .sect, #stafflist")) {
      el.hidden = true;
    }
    for (const slot of document.querySelectorAll("[data-icon]")) {
      slot.innerHTML = iconHTML(slot.dataset.icon);
    }
    await viewSetup($("#main"));
    return;
  }

  S.data = first;
  S.loadedAt = new Date();
  S.staffOpen = null; // an open hire list survives a refresh, not a page load
  S.readiness = null;
  S.staffHandle = S.data.staff[0]?.handle ?? null;
  $("#orgname").textContent = S.data.name + " · " + S.data.staff.length + " staff";

  learnPeople();
  // The shell's own icons are markup, so they are filled in once the module is running
  // rather than pasted into index.html as inline SVG nobody would ever read.
  for (const slot of document.querySelectorAll("[data-icon]")) {
    slot.innerHTML = iconHTML(slot.dataset.icon);
  }
  onRender(render);
  const linked = readHash() !== null;
  applyHash();
  /* An org nobody has been hired into has an empty Inbox, which says nothing about what to do
     next. It opens on what is left instead, unless a link or a click asked for somewhere else. */
  if (early) S.view = early;
  else if (!linked && (S.data.unfinished ?? []).includes("hire")) S.view = "setup";
  initStaffFold();
  paintSidebar();

  $("#refreshall").onclick = () => refreshAll(false);

  /* Coming back to the tab after a run should show the run — and coming back to it thirty
     seconds after leaving it should show nothing at all. Clicking into the window used to
     re-read every repo on GitHub and repaint the screen under you; now it looks first and
     only repaints when something actually moved. */
  addEventListener("focus", () => {
    if (S.loadedAt && Date.now() - S.loadedAt > 60000) refreshQuietly();
  });
  /* ⌘K (Ctrl+K off a Mac) opens search from anywhere, even from inside a text box: it is the
     one shortcut that should never be swallowed by whatever has focus. The sidebar's field
     opens the same dialog. */
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  });
  const side = $("#sidesearch");
  if (side) side.onclick = () => openSearch();
  const key = $("#searchkey");
  if (key && !/Mac|iPhone|iPad/.test(navigator.platform ?? "")) key.textContent = "Ctrl K";
  addEventListener("keydown", (e) => {
    if (e.key === "r" && !e.metaKey && !e.ctrlKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) {
      e.preventDefault();
      refreshAll(false);
    }
  });
  setInterval(stampLoaded, 30000);

  /* What is waiting on you is the first thing this page should be able to tell you, and it used
     to be the one thing it would not say until you clicked Inbox. One request, shared with
     whichever screen renders next. */
  countInBackground();

  // Only the state changes here. This used to re-run half of boot on every navigation,
  // which stacked up a focus listener, a keydown listener and an interval each time.
  addEventListener("hashchange", () => {
    S.applyingHash = true;
    applyHash();
    S.applyingHash = false;
    render();
  });

  render();
}

/** Say it plainly, rather than rendering half a page built on values that are not there. */
function stale(missing) {
  const m = $("#main");
  m.replaceChildren();
  const box = el("div", { className: "notice" });
  box.innerHTML =
    "<b>This page is newer than the portal serving it.</b><br>" +
    "The stylesheets and modules are read per request, but the server is not: it was loaded " +
    "when <code>roster portal</code> started. Stop it and start it again.<br><br>" +
    "<span class=\"meta\">/api/org is not sending: " + missing.join(", ") + "</span>";
  m.append(box);
  $("#orgname").textContent = "restart needed";
}

/* Who `@cto` and `@you` are, so a mention in a thread can point somewhere useful
   instead of at github.com/cto, which is nobody.
   A staff mention goes to their repo on GitHub. It used to open their Brain screen here, which
   read as the page hijacking a click: you are in the middle of a thread, and a mention is
   about the work, not about their memory. */
function learnPeople() {
  const people = new Map();
  for (const s of S.data.staff) {
    if (!s.brain) continue;
    const to = { href: "https://github.com/" + s.brain, title: s.name + " · " + s.brain };
    people.set(String(s.handle).toLowerCase(), to);
    if (s.mention) people.set(String(s.mention).replace(/^@/, "").toLowerCase(), to);
    for (const b of s.bots ?? []) people.set(String(b).toLowerCase(), to);
  }
  const human = S.data.human ?? {};
  if (human.github) {
    people.set(String(human.github).toLowerCase(), {
      href: "https://github.com/" + human.github,
      title: human.name ?? human.github,
    });
  }
  setPeople(people);
}

/* ------------------------------- the sidebar ------------------------------ */

/**
 * Staff are rows that unfold into their own views.
 *
 * This used to be a dropdown, then the chosen name repeated underneath it, then four
 * unlabelled views — three pieces you had to assemble into "these belong to that person".
 * Nesting says it instead.
 */
let paintedRoster = null;

/**
 * The Staff heading is a fold, and folded it carries the count.
 *
 * It starts folded, so the count is not decoration: a bare "STAFF" heading over nothing is how
 * a loaded org would look if the export came back empty, and those two states have to be
 * tellable apart at a glance. The count sits on the heading rather than beside it so there is
 * one thing to click.
 */
let staffOpen = true;

function paintStaffFold() {
  const b = $("#stafffold");
  if (b) b.setAttribute("aria-expanded", String(staffOpen));
  const list = $("#stafflist");
  if (list) list.hidden = !staffOpen;
  const n = $("#staffcount");
  if (n) {
    n.textContent = "(" + (S.data?.staff?.length ?? 0) + ")";
    n.hidden = staffOpen;
  }
}

function initStaffFold() {
  // Folded until you say otherwise: the count on the heading is enough to know the roster is
  // there, and the four org-wide screens above it are where a session starts.
  staffOpen = store("roster.staffopen") === "1";
  paintStaffFold();
  const b = $("#stafffold");
  if (!b) return;
  b.onclick = () => {
    staffOpen = !staffOpen;
    store("roster.staffopen", staffOpen ? "1" : "0");
    paintStaffFold();
  };
}

function paintSidebar() {
  paintInboxLinks();
  const host = $("#stafflist");
  host.replaceChildren();
  paintedRoster = S.data.staff.map((s) => s.handle).join(" ");

  for (const s of S.data.staff) {
    const open = s.handle === S.staffHandle;

    const head = el("button", { className: "nav staffrow" });
    head.dataset.staff = s.handle;
    head.setAttribute("aria-expanded", String(open));
    const dot = el("span", { className: "readydot", hidden: true });
    head.append(
      icon("chevron", "caret"),
      icon(staffIcon(s), "ic"),
      el("span", { className: "t", textContent: s.name }),
      dot,
      el("span", { className: "hh", textContent: s.handle }),
    );
    whatsLeft(s).then((left) => {
      paintSetupNav();
      if (!left.length) return;
      dot.hidden = false;
      head.title = "Not ready to run: " + sentence(left);
    });

    const views = el("div", { className: "staffviews" });
    views.hidden = !open;
    for (const [id, label] of VIEWS) {
      const b = el("button", { className: "nav subnav", textContent: label });
      b.dataset.view = id;
      b.dataset.staff = s.handle;
      b.onclick = () => {
        if (S.staffHandle !== s.handle) S.openFile = null;
        S.staffHandle = s.handle;
        S.view = id;
        render();
      };
      views.append(b);
    }

    head.onclick = () => {
      // Clicking the staff member you are already on folds them away; clicking another
      // switches to them and keeps whichever view you were reading.
      if (S.staffHandle === s.handle && !views.hidden) {
        views.hidden = true;
        head.setAttribute("aria-expanded", "false");
        return;
      }
      S.staffHandle = s.handle;
      S.openFile = null;
      if (ORG_WIDE.has(S.view)) S.view = "brain";
      render();
    };

    host.append(head, views);
  }

  // A refresh can hire or retire someone, and the folded heading is where that number shows.
  paintStaffFold();
}

/** Which rows are lit, and which staff member is unfolded. */
/* The inbox's filters, as links under Inbox: everything, what is on you, decisions, then one
   per staff member. They replaced two dropdowns on the Inbox screen itself. */
function paintInboxLinks() {
  const sub = $("#inboxsub");
  if (!sub) return;
  sub.replaceChildren();
  // Inbox itself is everything. Under it: each staff member, then the product repos' issues.
  const links = [
    ["", "All", "inbox"],
    ...S.data.staff.map((s) => [s.handle, s.name, staffIcon(s)]),
    ["@issues", "Issues", "issue-open"],
  ];
  for (const [who, label, glyph] of links) {
    const b = el("button", { className: "nav subnav inboxlink" }, [
      icon(glyph, "ic"),
      el("span", { className: "t", textContent: label }),
      ...(who === "@unread" ? [el("span", { className: "n", id: "unreadcount" })] : []),
    ]);
    b.dataset.who = who;
    b.onclick = () => {
      S.view = "inbox";
      S.inboxStaff = who;
      S.inboxFilter = "";
      S.inboxOpen = null;
      render();
    };
    sub.append(b);
  }
}

function markSidebar() {
  const sub = $("#inboxsub");
  if (sub) sub.hidden = S.view !== "inbox";
  for (const b of document.querySelectorAll(".inboxlink")) {
    const on = S.view === "inbox" && b.dataset.who === (S.inboxStaff || "");
    b.setAttribute("aria-current", String(on));
  }
  for (const b of document.querySelectorAll(".nav")) {
    if (!b.dataset.view) continue;
    const mine = !b.dataset.staff || b.dataset.staff === S.staffHandle;
    b.setAttribute("aria-current", String(mine && b.dataset.view === S.view));
  }
  for (const head of document.querySelectorAll(".staffrow")) {
    const open = head.dataset.staff === S.staffHandle && !ORG_WIDE.has(S.view);
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-selected", String(head.dataset.staff === S.staffHandle));
    if (head.nextElementSibling) head.nextElementSibling.hidden = !open;
  }
}

/* --------------------------------- render --------------------------------- */

function render() {
  /* Checked on every paint rather than once at boot, because `refreshAll` re-fetches the
     export and a portal can go stale under a page that is already open. */
  const missing = NEEDS.filter((k) => S.data?.[k] === undefined);
  if (missing.length) return stale(missing);

  // A refresh can add or remove a staff member, and the sidebar is built once.
  const roster = S.data.staff.map((s) => s.handle).join(" ");
  if (roster !== paintedRoster) paintSidebar();
  paintSetupNav();
  markSidebar();
  stampCounts();
  writeHash(true);
  stampLoaded();

  const m = $("#main");
  m.replaceChildren();
  const notice = syncNotice();
  if (notice) m.append(notice);
  (SCREEN[S.view] ?? viewBrain)(m);
}

/* --------------------------------- theme ---------------------------------- */

/* Three states on purpose: "system" is the default and has to be reachable again after
   someone has tried both others. */
const THEMES = ["system", "light", "dark"];

function applyTheme(name) {
  if (name === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", name);
  const b = $("#theme");
  if (b) {
    b.replaceChildren(
      icon(name === "light" ? "sun" : name === "dark" ? "moon" : "monitor", "ic"),
      "Theme",
      el("span", { className: "n", textContent: name }),
    );
  }
}

function initTheme() {
  let theme = store("roster.theme") ?? "system";
  if (!THEMES.includes(theme)) theme = "system";
  applyTheme(theme);
  const b = $("#theme");
  if (b) {
    b.onclick = () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      store("roster.theme", theme);
      applyTheme(theme);
    };
  }
}

export { render };

boot().catch((e) => {
  $("#main").innerHTML = '<p class="empty err">' + String(e?.message ?? e) + "</p>";
});
