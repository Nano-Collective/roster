/* Is the scaffolding still there, has the agent been running, and what does lint say. */

import { post } from "../api.js";
import { ago, el, esc, kb } from "../dom.js";
import { inline } from "../md.js";
import { render } from "../router.js";
import { S, staff } from "../state.js";
import { checklist } from "./checklist.js";
import { copyAmendBrief } from "./prompt.js";

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

  m.append(
    el("p", {
      className: "sub",
      textContent:
        "The rig, then three sets of checks: the org, the prompts they are sent, and what " +
        "they have written down.",
    }),
  );

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

  /* Three sets of checks, and they were three different-looking things: hairline rows for
     doctor, bordered boxes for the prompt audit, cards with two buttons each for lint. Same
     question in all three, so one shape: a heading that carries its own count, a line saying
     what the section is, the findings as rows, and the section's actions at the end. */
  const doctor = section(m, "The org, from roster doctor", "doctor");
  checklist(doctor.body, { shell: doctor });

  /* What is wrong with what this agent is sent. It used to sit in the tree on the Prompt
     screen, beside the prompt itself — which answers "what is sent", not "is it any good".
     Both questions are health questions, so both are here. */
  const prompt = section(m, "Prompt problems", "prompts");
  promptProblems(prompt, s);

  memoryProblems(section(m, "Memory problems", "memory"), s);
}

/**
 * One section: a heading with a count, a body, and a row for whatever acts on all of it.
 *
 * Returned rather than built in one go because two of the three fill themselves in later, and
 * a heading that appears with its count already right is worth the small indirection.
 */
function section(m, title, key) {
  const head = el("div", { className: "hsect" });
  head.append(el("span", { textContent: title }));
  const count = el("i");
  head.append(count);
  const body = el("div", { className: "hbody " + key });
  const actions = el("div", { className: "row hacts" });
  m.append(head, body, actions);
  return {
    body,
    actions,
    /** `n` findings, or a word when a count is the wrong shape of answer. */
    say: (text) => { count.textContent = text; },
  };
}

/** The same checks `roster lint` runs, over what this staff member has written down. */
function memoryProblems({ body, actions, say }, s) {
  say(s.problems.length ? String(s.problems.length) : "clean");
  body.append(
    el("p", {
      className: "hnote",
      textContent: s.problems.length
        ? "The same checks roster lint runs, over memory/INDEX.md."
        : "Nothing roster lint can fault in memory/INDEX.md.",
    }),
  );
  if (!s.problems.length) return;

  for (const p of s.problems) {
    const { row, body: text } = finding(
      p.level === "error" ? "error" : "warning",
      { html: inline(p.message) },
      [p.rule, p.line ? "INDEX.md:" + p.line : ""],
    );
    const status = el("span", { className: "meta" });
    const btn = el("button", { className: "ghbtn", textContent: "Ask " + s.handle.toUpperCase() + " to fix" });
    btn.onclick = () => askToFix(s, [p], btn, status);
    const acts = el("div", { className: "row facts" }, [btn]);
    if (p.slug) {
      const go = el("button", { className: "ghbtn", textContent: "Show the fact" });
      go.onclick = () => { S.openFile = "fact:" + p.slug; S.fileQuery = ""; S.view = "brain"; render(); };
      acts.append(go);
    }
    acts.append(status);
    text.append(acts);
    body.append(row);
  }

  /* The portal's one power over an agent is that it acts as the human, so "fix this" is an
     issue in their own repo — the same thing you would have typed on GitHub. */
  const allStatus = el("span", { className: "meta" });
  const all = el("button", { className: "ghbtn primary",
    textContent: "Ask " + s.handle.toUpperCase() + " to fix all " + s.problems.length });
  all.onclick = () => askToFix(s, s.problems, all, allStatus);
  actions.append(all, allStatus);
}

/**
 * One finding, in the shape every section uses: a level marker, what is wrong, and where.
 *
 * The marker carries the severity so the words do not have to. A row that opens with the word
 * "warning" spends its first line saying something a glyph already said.
 */
function finding(level, title, tags) {
  const row = el("div", { className: "check " + (level === "error" ? "fail" : "warn") });
  row.append(el("span", { className: "checkmark", textContent: level === "error" ? "✗" : "!" }));
  const body = el("div");
  // Plain text where there is any, markup only where a message carries its own.
  const head = el("b");
  if (title.html) head.innerHTML = title.html;
  else head.textContent = title.text;
  body.append(head);
  for (const t of tags.filter(Boolean)) {
    body.append(el("span", { className: "meta", textContent: t }));
  }
  row.append(body);
  // Everything else goes in the second column, under the text rather than under the marker.
  return { row, body };
}

/**
 * Everything the audit says about this staff member's prompts, over every kind of run.
 *
 * Fetched rather than read off the export: composing three prompts and diffing their layers is
 * not something to do on every page paint of every screen, and this is the only one that asks.
 */
async function promptProblems({ body, say }, s) {
  say("…");
  body.append(el("p", { className: "hnote", textContent: "Composing the prompts…" }));
  let data;
  try {
    data = await (
      await fetch("/api/promptaudit?staff=" + encodeURIComponent(s.handle), { cache: "no-store" })
    ).json();
  } catch (e) {
    say("?");
    body.replaceChildren(el("p", { className: "hnote err", textContent: e.message }));
    return;
  }

  const problems = data.problems ?? [];
  const errors = data.errors ?? [];
  say(problems.length ? String(problems.length) : errors.length ? "?" : "clean");
  body.replaceChildren(
    el("p", {
      className: "hnote",
      textContent: problems.length
        ? "What the audit can be sure about, over every kind of run this staff member has."
        : "Nothing the audit can fault in what this staff member is sent.",
    }),
  );
  for (const bad of errors) {
    body.append(
      el("div", { className: "notice", textContent:
        "The " + bad.kind + " prompt does not compose: " + bad.error }),
    );
  }
  if (!problems.length) return;

  /* Worst first, and each one carrying the sentence that fixes it. Knowing there is a problem
     is the hard part; writing the paragraph that asks for the change is not. */
  const rank = { error: 0, warning: 1, note: 2 };
  for (const p of [...problems].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3))) {
    const { row, body: text } = finding(p.level, { text: p.title }, [(p.kinds ?? []).join(", ")]);
    text.append(el("p", { textContent: p.detail }));

    const note = el("span", { className: "meta" });
    const fix = el("button", { className: "ghbtn", textContent: "Copy a prompt to fix this" });
    fix.onclick = () => copyAmendBrief(s.handle, p.kind, p.want, fix, note);
    const actions = el("div", { className: "row facts" }, [fix]);
    if (p.path) {
      const go = el("button", { className: "ghbtn", textContent: "Open the file" });
      // The file is a layer of a prompt, so it opens where prompts are read.
      go.onclick = () => {
        S.promptKind = p.kind;
        S.promptOpen = p.path;
        S.view = "prompt";
        render();
      };
      actions.append(go);
    }
    actions.append(note);
    text.append(actions);
    body.append(row);
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
