/* Every screen's state in one object, and the URL that mirrors it.
 *
 * The URL is the state, so a refresh lands where you were and a link is shareable. Changing
 * staff or view pushes; typing in a filter replaces, so a search does not bury the back
 * button under one entry per keystroke.
 *
 * This used to be a wall of top-level `var`s in a classic script, kept as `var` on purpose
 * because a top-level `let` is not reachable as a global and the state was otherwise
 * untestable. As a module it is exported, so it is neither global nor hidden. */

export const VIEWS = [
  ["brain", "Brain"],
  ["graph", "Graph"],
  ["changed", "What changed"],
  ["health", "Health"],
];

/* Memory used to be its own view. It is a surface of the brain — both manifests already
   declare `memory/` with `render: memory` — so it is now the brain's first stop, and the
   old links still land somewhere sensible. */
export const VIEW_ALIAS = { memory: "brain" };

export const S = {
  /** The org export from /api/org. Everything the brain screens read comes off this. */
  data: null,
  docs: null,
  inbox: null,
  sync: null,
  loadedAt: null,

  staffHandle: null,
  view: "brain",
  /** The inbox filter box. Brain and "what changed" keep their own, below. */
  query: "",

  /* What the brain's right pane is showing: a file path, or one of the memory pseudo-paths
     `mem:*`, `mem:<section>`, `fact:<slug>`. One key, so the URL carries either. */
  openFile: null,
  fileQuery: "",
  /** Which surfaces are unfolded in the brain navigator. Not in the URL: it is furniture. */
  openSurfaces: null,

  changedQuery: "",
  changedFilter: "",

  openDoc: null,

  inboxFilter: "",
  inboxStaff: "",
  inboxOpen: null,

  applyingHash: false,
};

export const staff = () => S.data.staff.find((s) => s.handle === S.staffHandle) ?? S.data.staff[0];

export function readHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  if (!raw) return null;
  const [path, qs] = raw.split("?");
  const [handle, view] = path.split("/");
  const p = new URLSearchParams(qs || "");
  return {
    handle,
    view,
    q: p.get("q") || "",
    f: p.get("f") || null,
    s: p.get("s") || "",
    w: p.get("w") || "",
    t: p.get("t") || null,
    p: p.get("p") || null,
  };
}

export function writeHash(push) {
  if (S.applyingHash) return;
  if (!S.staffHandle && S.view !== "docs") return;
  const params = new URLSearchParams();
  const q = S.view === "brain" ? S.fileQuery : S.view === "changed" ? S.changedQuery : S.query;
  if (q) params.set("q", q);
  if (S.view === "brain" && S.openFile) params.set("f", S.openFile);
  if (S.view === "docs" && S.openDoc) params.set("p", S.openDoc);
  if (S.view === "inbox") {
    if (S.inboxFilter) params.set("s", S.inboxFilter);
    if (S.inboxStaff) params.set("w", S.inboxStaff);
    if (S.inboxOpen) {
      params.set("t", S.inboxOpen.repo + "#" + S.inboxOpen.number + ":" + S.inboxOpen.kind);
    }
  }
  const qs = params.toString();
  const next = "#/" + (S.staffHandle ?? "-") + "/" + S.view + (qs ? "?" + qs : "");
  if (location.hash === next) return;
  if (history.pushState) history[push ? "pushState" : "replaceState"](null, "", next);
  else location.hash = next;
}

export function applyHash() {
  const h = readHash();
  if (!h) return false;
  const known = S.data.staff.some((s) => s.handle === h.handle);
  if (known) S.staffHandle = h.handle;
  const asked = VIEW_ALIAS[h.view] ?? h.view;
  if (asked === "inbox" || asked === "docs" || VIEWS.some(([id]) => id === asked)) S.view = asked;

  if (S.view === "brain") {
    S.fileQuery = h.q;
    S.openFile = h.f;
  } else if (S.view === "changed") {
    S.changedQuery = h.q;
  } else {
    S.query = h.q;
  }

  if (S.view === "docs") S.openDoc = h.p;

  if (S.view === "inbox") {
    S.inboxFilter = h.s;
    S.inboxStaff = h.w;
    if (h.t) {
      const [repoNum, kind] = h.t.split(":");
      const [repo, number] = repoNum.split("#");
      S.inboxOpen = { repo, number: Number(number), kind: kind === "pr" ? "pr" : "issue" };
    }
  }
  return known;
}
