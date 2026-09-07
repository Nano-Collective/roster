/* The shell: boot, the sidebar, and dispatching a view into <main>. */

import { getOrg } from "./api.js";
import { $, el, store } from "./dom.js";
import { setPeople } from "./md.js";
import { refreshAll, stampLoaded, syncNotice } from "./refresh.js";
import { onRender } from "./router.js";
import { S, VIEWS, applyHash, writeHash } from "./state.js";
import { viewBrain } from "./views/brain.js";
import { viewChanged } from "./views/changed.js";
import { viewDocs } from "./views/docs.js";
import { viewGraph } from "./views/graph.js";
import { viewHealth } from "./views/health.js";
import { viewInbox } from "./views/inbox.js";
import { viewPrompt } from "./views/prompt.js";

const SCREEN = {
  inbox: viewInbox,
  docs: viewDocs,
  brain: viewBrain,
  memory: viewBrain,
  prompt: viewPrompt,
  graph: viewGraph,
  changed: viewChanged,
  health: viewHealth,
};

export async function boot() {
  initTheme();
  S.data = await getOrg();
  S.loadedAt = new Date();
  S.staffHandle = S.data.staff[0]?.handle ?? null;
  $("#orgname").textContent = S.data.name + " · " + S.data.staff.length + " staff";

  learnPeople();
  onRender(render);
  applyHash();
  paintSidebar();

  $("#inboxnav").onclick = () => { S.view = "inbox"; render(); };
  $("#docsnav").onclick = () => { S.view = "docs"; render(); };
  $("#refreshall").onclick = () => refreshAll(false);

  // Coming back to the tab after a run should show the run.
  addEventListener("focus", () => {
    if (S.loadedAt && Date.now() - S.loadedAt > 30000) refreshAll(false);
  });
  addEventListener("keydown", (e) => {
    if (e.key === "r" && !e.metaKey && !e.ctrlKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) {
      e.preventDefault();
      refreshAll(false);
    }
  });
  setInterval(stampLoaded, 30000);

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

/* Who `@cto` and `@you` are, so a mention in a thread can point somewhere useful
   instead of at github.com/cto, which is nobody. */
function learnPeople() {
  const people = new Map();
  for (const s of S.data.staff) {
    const to = { href: "#/" + s.handle + "/brain", title: s.name + " — open their brain" };
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

function paintSidebar() {
  const host = $("#stafflist");
  host.replaceChildren();
  paintedRoster = S.data.staff.map((s) => s.handle).join(" ");

  for (const s of S.data.staff) {
    const open = s.handle === S.staffHandle;

    const head = el("button", { className: "nav staffrow" });
    head.dataset.staff = s.handle;
    head.setAttribute("aria-expanded", String(open));
    head.append(
      el("span", { className: "caret", textContent: "▾" }),
      el("span", { className: "t", textContent: s.name }),
      el("span", { className: "hh", textContent: s.handle }),
    );

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
      if (S.view === "inbox" || S.view === "docs") S.view = "brain";
      render();
    };

    host.append(head, views);
  }
}

/** Which rows are lit, and which staff member is unfolded. */
function markSidebar() {
  for (const b of document.querySelectorAll(".nav")) {
    if (!b.dataset.view) continue;
    const mine = !b.dataset.staff || b.dataset.staff === S.staffHandle;
    b.setAttribute("aria-current", String(mine && b.dataset.view === S.view));
  }
  for (const head of document.querySelectorAll(".staffrow")) {
    const open = head.dataset.staff === S.staffHandle && S.view !== "inbox" && S.view !== "docs";
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-selected", String(head.dataset.staff === S.staffHandle));
    if (head.nextElementSibling) head.nextElementSibling.hidden = !open;
  }
}

/* --------------------------------- render --------------------------------- */

function render() {
  // A refresh can add or remove a staff member, and the sidebar is built once.
  const roster = S.data.staff.map((s) => s.handle).join(" ");
  if (roster !== paintedRoster) paintSidebar();
  markSidebar();
  const ic = $("#inboxcount");
  if (ic) ic.textContent = S.inbox ? String(S.inbox.items.length) : "";
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
  if (b) b.replaceChildren("Theme", el("span", { className: "n", textContent: name }));
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
