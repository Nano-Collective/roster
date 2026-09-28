/* Hiring and retiring, from the portal.
 *
 * Both run the CLI's own `buildPlan` and `applyPlan` on the server rather than describing
 * either again here. Two descriptions of how to create a repo is one too many, and the one in
 * the browser would be the one nobody updated.
 *
 * Plan then apply, the same as every roster command that changes something: you see every
 * file, every label and every existing staff member it would edit, and nothing happens until
 * you say so.
 */

import { post } from "../api.js";
import { askYes } from "../dialog.js";
import { ago, el, esc } from "../dom.js";
import { icon } from "../icons.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";
import { appPanel } from "./app.js";
import { credentialPanel } from "./credential.js";
import { cronText } from "./health.js";
import { paste } from "./paste.js";
import { runOnce } from "./runonce.js";

export function viewStaff(m) {
  m.append(el("h1", { textContent: "Staff" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        S.data.staff.length +
        " on the roster. Hiring creates a repo, its workflows, its labels and its pinned issue, " +
        "and wires it to everyone already here.",
    }),
  );

  const list = el("div", { className: "grid", style: "margin-bottom:18px" });
  for (const s of S.data.staff) list.append(card(s));
  m.append(list);

  const hire = el("button", { className: "ghbtn primary", textContent: "Hire someone" });
  const pane = el("div");
  hire.onclick = () => hireForm(pane);
  m.append(el("div", { className: "row", style: "margin-bottom:14px" }, [hire]));
  m.append(pane);

  /* --------------------------- one staff member --------------------------- */

  function card(s) {
    const d = el("div", { className: "kv staffcard" });
    const rig = s.rig ?? {};
    d.innerHTML =
      '<div class="k">' + esc(s.handle) + "</div>" +
      '<div class="v">' + esc(s.name) +
        "<small>" + esc(s.brain ?? s.dir) + " · " + s.facts.length + " facts · " +
        (rig.lastCommit ? "last commit " + esc(ago(rig.lastCommit.date)) : "no commits") +
        "</small></div>";

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn", textContent: "Retire" });
    go.onclick = () => retireForm(pane, s, status);

    /* The charter is the one file `hire` deliberately does not write, and until now the only
       route to it was a CLI command printing a brief. This is the same brief, with every file
       it refers to already inside it and somewhere to put the answer. */
    const write = el("button", { className: "ghbtn", textContent: "Write the charter" });
    write.onclick = () => {
      pane.replaceChildren(
        el("div", { className: "card" }, [
          paste({
            kind: "charter",
            staff: s.handle,
            title: "Write " + s.name + "'s charter with your own AI",
            onSaved: () => refreshAll(false),
          }),
        ]),
      );
      pane.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    /* The step `hire` has always had to hand back: there is no API that creates a GitHub App,
       so it is a browser hand-off either way. It may as well be this browser. */
    const app = el("button", { className: "ghbtn", textContent: "GitHub App" });
    app.onclick = () => {
      pane.replaceChildren(
        el("div", { className: "card" }, [
          el("h3", { textContent: s.name + "'s identity" }),
          appPanel({ staff: s.handle, name: s.name, scope: "private" }),
          appPanel({ staff: s.handle, name: s.name, scope: "public" }),
        ]),
      );
      pane.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    /* The credential is once for the org, but the moment somebody looks for it is while setting
       up one staff member, so it is reachable from each card. */
    const cred = el("button", { className: "ghbtn", textContent: "Agent credential" });
    cred.onclick = () => {
      pane.replaceChildren(el("div", { className: "card" }, [credentialPanel()]));
      pane.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    const run = el("button", { className: "ghbtn", textContent: "Run once now" });
    run.onclick = () => {
      pane.replaceChildren(
        el("div", { className: "card" }, [
          runOnce({ staff: s.handle, name: s.name, onDone: (ok) => ok && refreshAll(true) }),
        ]),
      );
      pane.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    d.append(
      el("div", { className: "row", style: "margin-top:10px" }, [write, app, cred, run, go, status]),
    );
    return d;
  }

  /* ------------------------------- hiring -------------------------------- */

  function hireForm(host) {
    /* App names are copied from whoever is already here. The first hire has nobody to copy
       from, and the CLI asks for --app and --public-app at that point; these are those two. */
    const first = !S.data.staff.length;
    const box = el("div", { className: "card" });
    box.append(
      el("h3", { textContent: "Hire someone" }),
      el("p", {
        className: "sub",
        style: "margin-bottom:14px",
        textContent: first
          ? "Only the handle is required. This is the first hire, so there is nobody to copy " +
            "App names from: name them here, and later hires follow the pattern."
          : "Only the handle is required. Everything else is copied from whoever is already " +
            "here, because app slugs carry a house naming scheme and the public identity is " +
            "genuinely shared.",
      }),
    );

    const handle = field("handle", "cfo", "lowercase, digits and dashes");
    const name = field("name", "Chief Financial Officer", "defaults to the handle, uppercased");
    const dir = field("dir", "finance", "directory and repo name; defaults to the handle");
    const schedule = scheduleField();
    const fields = [handle, name, dir, schedule];
    const apps = [];
    if (first) {
      const org = S.data.org;
      apps.push(
        ["app", field("app", org + "-cfo", "this staff member's GitHub App. Names are unique across GitHub, so prefix it")],
        ["publicApp", field("public app", org + "-robot", "the shared identity for public product repos. Optional when they are all private")],
      );
      fields.push(...apps.map(([, f]) => f));
    }
    for (const f of fields) box.append(f.row);

    const status = el("span", { className: "meta" });
    const plan = el("button", { className: "ghbtn primary", textContent: "Show the plan" });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    cancel.onclick = () => host.replaceChildren();
    box.append(el("div", { className: "row", style: "margin-top:12px" }, [plan, cancel, status]));

    const out = el("div");
    box.append(out);
    host.replaceChildren(box);
    handle.input.focus();

    plan.onclick = async () => {
      if (!handle.input.value.trim()) {
        handle.input.focus();
        return;
      }
      status.textContent = "planning…";
      status.className = "meta";
      out.replaceChildren();
      const params = new URLSearchParams({ handle: handle.input.value.trim() });
      for (const [key, f] of [["name", name], ["dir", dir], ["schedule", schedule], ...apps]) {
        const value = (f.value ? f.value() : f.input.value).trim();
        if (value) params.set(key, value);
      }
      try {
        const data = await (await fetch("/api/staff/plan?" + params, { cache: "no-store" })).json();
        if (data.error) throw new Error(data.error);
        status.textContent = "";
        out.replaceChildren(hirePlan(data.plan, params));
      } catch (e) {
        status.textContent = e.message;
        status.className = "meta err";
      }
    };
  }

  function hirePlan(plan, params) {
    const box = el("div", { className: "plan" });
    box.append(el("div", { className: "planhead", textContent: "This would create" }));

    const s = plan.staff;
    box.append(
      line("ok", s.brain + ", private"),
      line("ok", plan.files.length + " files, including three caller workflows"),
      line("ok", plan.labels.length + " labels: " + plan.labels.join(", ")),
      line("ok", "a pinned status issue"),
      line("ok", "runs at " + s.schedule + ", on " + s.model),
    );
    for (const p of plan.peers) {
      box.append(line("ok", p.brain + " gains a " + p.label + " label"));
    }
    /* Commits into repos that already exist, as you. Listed because they are writes to
       somebody else's repo, and a plan that hid them would be the silent kind. */
    box.append(el("div", { className: "planhead", textContent: "Commits and pushes, as you" }));
    for (const c of plan.commits ?? []) box.append(line("ok", c.repo + ": " + c.file + ", " + c.why));

    const cred = s.agentSecret ?? "the agent credential";
    box.append(
      plan.orgSecret?.visibility === "selected"
        ? line("ok", s.brain + " is added to the repos that can read the org secret " + cred)
        : plan.orgSecret
          ? line("ok", "the org secret " + cred + " already reaches " + plan.orgSecret.visibility + " repos")
          : line("warn", "no org secret " + cred + " yet: store it once with Agent credential, after this"),
    );

    box.append(el("div", { className: "planhead", textContent: "Then, on the new card" }));
    box.append(
      line(
        "todo",
        "GitHub App, or roster app " + s.handle + " --apply: creates it, sets its secrets, and " +
          "opens the install page with the repos already ticked",
      ),
      line("todo", "Write the charter"),
      line("todo", "Run once now, or roster run " + s.handle + " --apply: the run that proves the wiring"),
    );
    for (const w of plan.warnings ?? []) box.append(line("warn", S.data.staff.length ? w : portalWords(w)));

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn primary", textContent: "Hire " + s.handle });
    go.onclick = () =>
      apply(
        {
          action: "hire",
          handle: s.handle,
          flags: Object.fromEntries(params),
        },
        { title: "Create " + s.brain + " and wire it up?", hint: "This creates a repository on GitHub.", confirm: "Hire " + s.handle },
        go,
        status,
        box,
      );
    box.append(el("div", { className: "row", style: "margin-top:14px" }, [go, status]));
    return box;
  }

  /* ------------------------------- retiring ------------------------------- */

  async function retireForm(host, s, cardStatus) {
    cardStatus.textContent = "planning…";
    cardStatus.className = "meta";
    let data;
    try {
      data = await (
        await fetch("/api/staff/plan?action=retire&handle=" + encodeURIComponent(s.handle), {
          cache: "no-store",
        })
      ).json();
      if (data.error) throw new Error(data.error);
    } catch (e) {
      cardStatus.textContent = e.message;
      cardStatus.className = "meta err";
      return;
    }
    cardStatus.textContent = "";

    const plan = data.plan;
    const box = el("div", { className: "plan" });
    box.append(el("h3", { textContent: "Retire " + plan.name + "?" }));
    box.append(el("div", { className: "planhead", textContent: "This would stop" }));
    for (const w of plan.workflows) box.append(line("stop", plan.dir + "/" + w + " disabled"));
    box.append(line("stop", "removed from org.yaml"));
    for (const p of plan.peers) {
      box.append(
        line("stop", "removed from " + p.dir + "/staff.yaml"),
        line("stop", p.label + " deleted from " + (p.brain ?? p.dir)),
      );
    }

    /* The point of retiring rather than deleting. Said as loudly as what it stops, because
       "this is not destructive" is the thing somebody needs to believe before clicking. */
    box.append(el("div", { className: "planhead keep", textContent: "This would keep" }));
    for (const k of plan.keeps) box.append(line("keep", k));
    for (const w of plan.warnings ?? []) box.append(line("warn", w));

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn", textContent: "Retire " + plan.handle });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    cancel.onclick = () => host.replaceChildren();
    go.onclick = () =>
      apply(
        { action: "retire", handle: plan.handle },
        { title: "Retire " + plan.name + "?", hint: (plan.brain ?? plan.dir) + " is not touched.", confirm: "Retire " + plan.handle },
        go,
        status,
        box,
      );
    box.append(el("div", { className: "row", style: "margin-top:14px" }, [go, cancel, status]));
    host.replaceChildren(box);
  }

  /* -------------------------------- apply -------------------------------- */

  async function apply(payload, ask, btn, status, box) {
    if (!(await askYes(ask))) return;
    btn.disabled = true;
    status.textContent = "working…";
    status.className = "meta";
    try {
      const r = await post(payload, "/api/staff/apply");
      status.textContent = r.ok ? "done" : "finished with problems";
      status.className = r.ok ? "meta ok" : "meta warn";
      // What the terminal would have printed, because that is the useful account of it.
      if (r.output) box.append(el("pre", { className: "code planout", textContent: r.output }));
      await refreshAll(true);
    } catch (e) {
      status.textContent = e.message;
      status.className = "meta err";
      btn.disabled = false;
    }
  }
}

/* The plan's warnings are the CLI's, and name its flags. Here the same two options are fields
   on the form above, and a flag the page has no box for reads as a dead end. */
function portalWords(warning) {
  return warning
    .replace(/pass --public-app\b/, "fill in public app above")
    .replace(/pass --app\b/, "fill in app above");
}

function field(label, placeholder, hint) {
  const input = el("input", { type: "search", placeholder, value: "", style: "width:100%" });
  input.dataset.field = label;
  const row = el("div", { className: "ffield" });
  row.append(
    el("label", { textContent: label }),
    input,
    el("small", { textContent: hint }),
  );
  return { row, input };
}

/**
 * When the daily run happens, as a time and a set of days rather than as cron.
 *
 * The value on the wire is still a cron expression, because that is what goes in the workflow
 * and what `roster hire` takes. But nobody hiring their first staff member knows that
 * `0 9 * * 1-5` is nine in the morning on weekdays, and a field that demands it is a field
 * that gets a wrong answer or an empty one.
 *
 * UTC, said out loud, with the local equivalent beside it: GitHub schedules in UTC, and an
 * agent that starts an hour off twice a year is worse than one you had to think about once.
 */
function scheduleField() {
  const time = el("input", { type: "time", value: "", step: "60", style: "width:130px" });
  const days = el("select");
  days.append(
    el("option", { value: "1-5", textContent: "Weekdays" }),
    el("option", { value: "*", textContent: "Every day" }),
    el("option", { value: "1", textContent: "Mondays" }),
    el("option", { value: "1,3,5", textContent: "Mon, Wed, Fri" }),
  );
  // Said rather than relying on "the first option is selected", which is true of a rendered
  // <select> and not of one that has only been built.
  days.value = "1-5";

  const said = el("small");
  const value = () => {
    if (!time.value) return "";
    const [h, m] = time.value.split(":");
    return `${Number(m)} ${Number(h)} * * ${days.value}`;
  };
  const say = () => {
    const cron = value();
    said.textContent = cron
      ? cronText(cron) + local(time.value)
      : "Leave it empty for a slot clear of everyone else.";
  };
  time.oninput = say;
  days.onchange = say;
  say();

  const row = el("div", { className: "ffield" });
  row.append(
    el("label", { textContent: "schedule" }),
    el("div", { className: "row" }, [time, days, el("span", { className: "meta", textContent: "UTC" })]),
    said,
  );
  return { row, input: time, value };
}

/** What that UTC time is where the person reading it is, when the two differ. */
function local(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date(Date.UTC(2026, 0, 5, h, m));
  const here = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return here === hhmm ? "" : " · " + here + " where you are";
}

const MARK = { ok: "check", stop: "closed", keep: "issue-open", todo: "dash", warn: "label" };

function line(kind, text) {
  const d = el("div", { className: "planline " + kind });
  d.append(icon(MARK[kind] ?? "dot", "ic"), el("span", { textContent: text }));
  return d;
}
