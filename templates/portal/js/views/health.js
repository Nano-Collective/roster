/* Is the scaffolding still there, has the agent been running, and what does lint say. */

import { post } from "../api.js";
import { ago, el, esc, kb } from "../dom.js";
import { inline } from "../md.js";
import { render } from "../router.js";
import { S, staff } from "../state.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The common cron shapes in plain words; anything unusual is shown as it was written. */
export function cronText(spec) {
  if (!spec) return "no schedule";
  const p = String(spec).trim().split(/\s+/);
  if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) return String(spec);
  const [min, hour, dom, mon, dow] = p;
  const time = hour.padStart(2, "0") + ":" + min.padStart(2, "0") + " UTC";
  if (dom !== "*" || mon !== "*") return String(spec);
  if (dow === "*") return time + " · every day";
  if (dow === "1-5") return time + " · Mon–Fri";
  return time + " · " + dow.split(",").map((d) => DAYS[Number(d) % 7] ?? d).join(", ");
}

export function viewHealth(m) {
  const s = staff();
  const rig = s.rig ?? {};
  m.append(el("h1", { textContent: s.name + " · health" }));
  const errs = s.problems.filter((p) => p.level === "error");
  const warns = s.problems.filter((p) => p.level === "warning");
  m.append(el("p", { className: "sub", innerHTML:
    "<span class='" + (errs.length ? "err" : "ok") + "'>" + errs.length + " errors</span> · " +
    "<span class='warn'>" + warns.length + " warnings</span> · memory checks are the same ones " +
    "<code>roster lint</code> runs; the rest is read off the checkout." }));

  /* The rig: is the scaffolding still there, and has the agent actually been running. This
     is everything answerable without the GitHub API — installation grants, secrets and
     rulesets are `roster doctor`'s job, and it does not exist yet. */
  const kv = (k, v, sub, bad) => {
    const d = el("div", { className: "kv" + (bad ? " bad" : "") });
    d.innerHTML = '<div class="k">' + esc(k) + "</div><div class=\"v\">" + v +
      (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
    return d;
  };

  const g = el("div", { className: "grid", style: "margin-bottom:6px" });
  g.append(kv("Runs", esc(cronText(s.schedule)),
    (rig.workflows ?? []).length + " workflows: " + (rig.workflows ?? []).join(", "),
    !(rig.workflows ?? []).length));
  g.append(rig.lastCommit
    ? kv("Last commit", esc(ago(rig.lastCommit.date)), rig.lastCommit.subject)
    : kv("Last commit", "never", "no git history here", true));
  g.append(rig.lastMemoryCommit
    ? kv("Last thought", esc(ago(rig.lastMemoryCommit.date)), rig.lastMemoryCommit.subject)
    : kv("Last thought", "never", "memory/ has never been committed to", true));
  g.append(kv("Memory", s.facts.length + " facts",
    kb(rig.memoryBytes ?? 0) + " index · " + s.notes.length + " notes, " + kb(rig.notesBytes ?? 0) +
    " · read in full every boot"));

  const authored = s.links.filter((l) => !l.inferred).length;
  g.append(kv("Links", authored + " authored", (s.links.length - authored) + " more inferred"));
  g.append(kv("Charter", rig.hasCharter === false ? "missing" : "CHARTER.md",
    rig.hasManifest === false ? "staff.yaml is missing too" : "staff.yaml present",
    rig.hasCharter === false || rig.hasManifest === false));
  if (s.statusIssue && s.brain) {
    g.append(kv("Status", '<a class="ref" href="https://github.com/' + esc(s.brain) + "/issues/" +
      s.statusIssue + '" target="_blank" rel="noopener">#' + s.statusIssue + "</a>",
      "the pinned issue this staff member keeps"));
  }
  if ((rig.missingSurfaces ?? []).length) {
    g.append(kv("Surfaces", esc(rig.missingSurfaces.length + " missing"),
      rig.missingSurfaces.join(", ") + " — declared in staff.yaml, not on disk", true));
  }
  m.append(g);

  m.append(el("div", { className: "hsect", textContent: "Memory problems" }));

  if (!s.problems.length) {
    m.append(el("p", { className: "empty", textContent: "Nothing to fix." }));
    return;
  }

  /* The portal's one power over an agent is that it acts as the human, so "fix this" is an
     issue in their own repo — the same thing you would have typed on GitHub. */
  const allStatus = el("span", { className: "meta" });
  const all = el("button", { className: "ghbtn primary",
    textContent: "Ask " + s.handle.toUpperCase() + " to fix all " + s.problems.length });
  all.onclick = () => askToFix(s, s.problems, all, allStatus);
  m.append(el("div", { className: "row", style: "margin-bottom:12px" }, [all, allStatus]));

  for (const p of s.problems) {
    const d = el("div", { className: "card" });
    d.innerHTML = '<div class="row"><span class="' + (p.level === "error" ? "err" : "warn") +
      '" style="font:11px var(--mono)">' + p.level + "</span>" +
      '<span class="pill">' + esc(p.rule) + "</span>" +
      (p.line ? '<span class="meta">INDEX.md:' + p.line + "</span>" : "") + "</div>" +
      '<p style="margin:8px 0 0">' + inline(p.message) + "</p>";

    const status = el("span", { className: "meta" });
    const btn = el("button", { className: "ghbtn", textContent: "Ask " + s.handle.toUpperCase() + " to fix" });
    btn.onclick = () => askToFix(s, [p], btn, status);
    const actions = el("div", { className: "row fix" }, [btn, status]);
    if (p.slug) {
      const go = el("button", { className: "ghbtn", textContent: "Show the fact" });
      go.onclick = () => { S.openFile = "fact:" + p.slug; S.fileQuery = ""; S.view = "brain"; render(); };
      actions.append(go);
    }
    d.append(actions);
    m.append(d);
  }
}

/** Open one issue asking this staff member to fix what lint found. */
export async function askToFix(s, problems, btn, status) {
  if (!s.brain) {
    status.textContent = "no brain repo declared in staff.yaml";
    status.className = "meta err";
    return;
  }
  const one = problems.length === 1 ? problems[0] : null;
  const title = one
    ? "Memory lint: " + one.rule + (one.line ? " at INDEX.md:" + one.line : "")
    : "Memory lint: " + problems.length + " problems in memory/INDEX.md";
  const body = [
    "`roster lint` flags " + (one ? "this" : "these") + " in `memory/INDEX.md`. Opened from the portal.",
    "",
    "| rule | where | what |",
    "|---|---|---|",
    ...problems.map((p) => "| `" + p.rule + "` | " + (p.line ? "INDEX.md:" + p.line : "—") + " | " +
      String(p.message).replace(/\|/g, "\\|") + " |"),
    "",
    "Fix in your next session and close this.",
  ].join("\n");

  if (!confirm("Open an issue in " + s.brain + "?")) return;
  btn.disabled = true;
  status.textContent = "opening…";
  status.className = "meta";
  try {
    const r = await post({ action: "create", repo: s.brain, title, body });
    status.innerHTML = 'opened · <a href="' + esc(r.url ?? "") + '" target="_blank" rel="noopener">' +
      esc((r.url ?? "").split("/").slice(-2).join(" #").replace("issues #", "#") || "the issue") + "</a>";
    status.className = "meta ok";
  } catch (e) {
    status.textContent = e.message;
    status.className = "meta err";
    btn.disabled = false;
  }
}
