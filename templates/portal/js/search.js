/* Search everything: ⌘K, or the search field in the sidebar.
 *
 * One dialog over the whole portal: issues and pull requests, staff, every fact and file in
 * every brain, the org files, the docs, runs, and the screens themselves. All of it except the
 * docs is already in the page, so it is searched here as you type; the docs are searched on the
 * server, which reads every page rather than only titles.
 *
 * `index()` and `rank()` are plain functions over plain data, so what is found, and in which
 * order, can be tested without a page. */

import { getOrgLayer, getRuns, searchDocs } from "./api.js";
import { ago, el } from "./dom.js";
import { icon, staffIcon } from "./icons.js";
import { ensureInbox } from "./refresh.js";
import { go } from "./router.js";
import { S } from "./state.js";
import { openThread } from "./views/home.js";

/** The groups, in the order they are shown. */
const GROUPS = ["Screens", "Staff", "Issues", "Pull requests", "Memory", "Files", "Org", "Runs", "Docs"];
/** How many of each a query shows; an empty query shows only screens and staff. */
const PER_GROUP = 5;

const SCREENS = [
  ["home", "Home", "What needs you, and who is working"],
  ["inbox", "Trackers", "Every open issue on each tracker"],
  ["runs", "Runs", "What ran, and what it cost"],
  ["org", "Org", "The files every staff member reads"],
  ["staff", "Staff", "Hire, set up, retire"],
  ["docs", "Docs", "How roster works"],
];
const STAFF_SCREENS = [
  ["brain", "Brain"],
  ["prompt", "Prompt"],
  ["graph", "Graph"],
  ["changed", "What changed"],
  ["health", "Health"],
];

/**
 * Every searchable thing, as `{ group, title, sub, text, icon, open }`. `text` is what is
 * matched beyond the title; `open` is what choosing it does.
 */
export function index(state) {
  const out = [];
  const staff = state.data?.staff ?? [];

  for (const [view, title, sub] of SCREENS) {
    out.push({ group: "Screens", title, sub, text: view, icon: "square", open: () => go({ view }) });
  }
  for (const s of staff) {
    for (const [view, label] of STAFF_SCREENS) {
      out.push({
        group: "Screens",
        title: `${s.name} · ${label}`,
        sub: s.handle,
        text: `${s.handle} ${label}`,
        icon: staffIcon(s),
        open: () => go({ view, staffHandle: s.handle }),
      });
    }
  }

  for (const s of staff) {
    out.push({
      group: "Staff",
      title: s.name,
      sub: [s.handle, s.brain].filter(Boolean).join(" · "),
      text: `${s.handle} ${s.brain ?? ""} ${s.mention ?? ""}`,
      icon: staffIcon(s),
      open: () => go({ view: "brain", staffHandle: s.handle, openFile: "mem:*", fileQuery: "" }),
    });

    for (const f of s.facts ?? []) {
      out.push({
        group: "Memory",
        title: f.statement,
        sub: `${s.name} · ${f.section} · ${f.slug}`,
        text: `${f.slug} ${f.consequence ?? ""} ${f.section}`,
        icon: "lightbulb",
        open: () =>
          go({ view: "brain", staffHandle: s.handle, openFile: "fact:" + f.slug, fileQuery: "" }),
      });
    }

    for (const surface of s.surfaces ?? []) {
      for (const file of surface.files ?? []) {
        const note = /(^|\/)notes\//.test(file.path);
        out.push({
          group: note ? "Memory" : "Files",
          title: file.path.split("/").pop(),
          sub: `${s.name} · ${file.path}`,
          text: file.path,
          icon: "file",
          open: () => go({ view: "brain", staffHandle: s.handle, openFile: file.path, fileQuery: "" }),
        });
      }
    }
  }

  const brains = new Map(staff.filter((s) => s.brain).map((s) => [s.brain, s]));
  for (const item of state.inbox?.items ?? []) {
    const owner = brains.get(item.repo);
    const repo = item.repo.split("/")[1] ?? item.repo;
    const where = owner ? owner.name : repo;
    const open = item.state === "OPEN";
    out.push({
      group: item.kind === "pr" ? "Pull requests" : "Issues",
      title: item.title,
      sub: `${where} · #${item.number} · ${open ? "open" : item.state.toLowerCase()} · ${ago(item.updatedAt)}`,
      text: `#${item.number} ${repo}#${item.number} ${(item.labels ?? []).join(" ")} ${item.author}`,
      icon: item.kind === "pr" ? (item.state === "MERGED" ? "merged" : "review") : open ? "issue-open" : "issue-closed",
      // Open work first among equal matches: it is usually what is being looked for.
      weight: open ? 1 : 0,
      open: () => openThread(item),
    });
  }

  for (const f of state.orgFiles ?? []) {
    out.push({
      group: "Org",
      title: f.path.split("/").pop(),
      sub: f.path,
      text: f.path,
      icon: "file",
      open: () => go({ view: "org", orgOpen: f.path }),
    });
  }

  for (const s of state.runs?.staff ?? []) {
    for (const r of s.runs ?? []) {
      const word = r.record?.outcome ?? r.conclusion ?? r.status;
      out.push({
        group: "Runs",
        title: `${s.name} · ${r.kind} run · ${word}`,
        sub: `${ago(r.createdAt)} · opens the log on GitHub`,
        text: `${s.handle} ${r.kind} ${word} ${r.id}`,
        icon: "play",
        open: () => window.open(r.url, "_blank", "noopener"),
      });
    }
  }

  return out;
}

/**
 * The best matches for a query, grouped. Every word has to appear somewhere; a match in the
 * title outranks one elsewhere, and the start of the title outranks the middle of it.
 */
export function rank(entries, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map(GROUPS.map((g) => [g, []]));
  if (!words.length) {
    for (const e of entries) {
      if (e.group === "Screens" || e.group === "Staff") groups.get(e.group).push({ e, score: 0 });
    }
  } else {
    for (const e of entries) {
      const title = e.title.toLowerCase();
      const all = `${title} ${String(e.sub ?? "").toLowerCase()} ${String(e.text ?? "").toLowerCase()}`;
      if (!words.every((w) => all.includes(w))) continue;
      let score = e.weight ?? 0;
      for (const w of words) {
        if (title.startsWith(w)) score += 6;
        else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) score += 4;
        else if (title.includes(w)) score += 2;
      }
      groups.get(e.group)?.push({ e, score });
    }
  }
  const out = [];
  for (const [group, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => b.score - a.score);
    const shown = list.slice(0, words.length ? PER_GROUP : 40);
    out.push({ group, entries: shown.map((x) => x.e), more: list.length - shown.length });
  }
  return out;
}

/* --------------------------------- the dialog --------------------------------- */

let current = null;

/** Open the search dialog, or focus it when it is already open. */
export function openSearch() {
  if (current) {
    current.input.focus();
    return;
  }
  const box = document.createElement("dialog");
  if (typeof box.showModal !== "function") return;
  box.className = "palette";

  const input = el("input", {
    type: "search",
    className: "palinput",
    placeholder: "Search issues, pull requests, memory, files, runs and docs",
    autocomplete: "off",
    spellcheck: false,
  });
  const results = el("div", { className: "palresults", role: "listbox" });
  const foot = el("div", { className: "palfoot" }, [
    el("span", { innerHTML: "<kbd>↑</kbd><kbd>↓</kbd> move" }),
    el("span", { innerHTML: "<kbd>↵</kbd> open" }),
    el("span", { innerHTML: "<kbd>esc</kbd> close" }),
  ]);
  box.append(el("div", { className: "palhead" }, [icon("search", "ic"), input]), results, foot);
  document.body.append(box);
  box.showModal();
  input.focus();

  let entries = index(S);
  let flat = [];
  let at = 0;
  let docs = [];
  let docsFor = "";
  let docTimer = null;

  const close = () => {
    if (!current) return;
    current = null;
    clearTimeout(docTimer);
    box.close();
    box.remove();
  };
  current = { input, close };
  box.addEventListener("close", () => {
    current = null;
    box.remove();
  });
  box.addEventListener("click", (e) => {
    if (e.target === box) close();
  });

  const choose = (e) => {
    close();
    e.open();
  };

  const paint = () => {
    const q = input.value.trim();
    const grouped = rank(entries, q);
    if (q && docsFor === q && docs.length) {
      grouped.push({
        group: "Docs",
        entries: docs.slice(0, PER_GROUP).map((h) => ({
          title: h.title,
          sub: h.matches?.[0]?.text ?? h.file,
          icon: "book-open",
          open: () => go({ view: "docs", openDoc: h.file, docQuery: q }),
        })),
        more: Math.max(0, docs.length - PER_GROUP),
      });
    }
    flat = grouped.flatMap((g) => g.entries);
    at = Math.min(at, Math.max(0, flat.length - 1));
    results.replaceChildren();
    if (!flat.length) {
      results.append(el("p", { className: "palempty", textContent: q ? "Nothing matches “" + q + "”." : "" }));
      return;
    }
    let i = 0;
    for (const g of grouped) {
      results.append(
        el("div", { className: "palgroup", textContent: g.group + (g.more ? ` · ${g.more} more` : "") }),
      );
      for (const e of g.entries) {
        const n = i++;
        const row = el("button", { className: "palrow", role: "option" }, [
          icon(e.icon ?? "file", "ic"),
          el("span", { className: "paltext" }, [
            el("span", { className: "paltitle", innerHTML: highlight(e.title, q) }),
            el("span", { className: "palsub", textContent: e.sub ?? "" }),
          ]),
        ]);
        row.setAttribute("aria-selected", String(n === at));
        row.onmouseenter = () => {
          at = n;
          mark();
        };
        row.onclick = () => choose(e);
        results.append(row);
      }
    }
    mark();
  };

  const mark = () => {
    const rows = results.querySelectorAll(".palrow");
    rows.forEach((r, n) => r.setAttribute("aria-selected", String(n === at)));
    rows[at]?.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => {
    at = 0;
    paint();
    const q = input.value.trim();
    clearTimeout(docTimer);
    if (q.length < 2) return;
    docTimer = setTimeout(() => {
      searchDocs(q)
        .then((r) => {
          docs = r.hits ?? [];
          docsFor = q;
          if (current && input.value.trim() === q) paint();
        })
        .catch(() => {});
    }, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      at = Math.min(at + 1, flat.length - 1);
      mark();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      at = Math.max(at - 1, 0);
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[at]) choose(flat[at]);
    }
  });

  paint();

  /* What is not in the page yet is fetched once and folded in as it lands: the issues, the org
     files and the runs. The dialog is usable straight away with whatever is already here. */
  const refill = () => {
    if (!current) return;
    entries = index(S);
    paint();
  };
  if (!S.inbox) ensureInbox(false).then(refill).catch(() => {});
  if (!S.orgFiles) {
    getOrgLayer()
      .then((r) => {
        S.orgFiles = r.files ?? [];
        refill();
      })
      .catch(() => {});
  }
  if (!S.runs) {
    getRuns(false)
      .then((r) => {
        S.runs = r;
        refill();
      })
      .catch(() => {});
  }
}

/** The title with each query word marked, escaped first. */
function highlight(title, q) {
  let html = String(title ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  for (const w of String(q ?? "").toLowerCase().split(/\s+/).filter((x) => x.length > 1)) {
    const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    html = html.replace(re, "<mark>$1</mark>");
  }
  return html;
}
