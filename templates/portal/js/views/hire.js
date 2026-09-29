/* Hiring from the Staff screen: pick a role, then one numbered list per staff member.
 *
 * The plan and the hire are the CLI's own `buildPlan` and `applyPlan`, run on the server, so
 * the browser never describes how to create a repo a second time. Every step's Done is read
 * from something real where the portal has it: the export for the hire and the charter,
 * GitHub for the App secrets and the first run, and the credential panel's own check. A step
 * is never marked done because a button was clicked. */

import { getCharterExample, getCredential, getRepos, getStaffProgress, post } from "../api.js";
import { askYes } from "../dialog.js";
import { el } from "../dom.js";
import { icon } from "../icons.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";
import { appPanel } from "./app.js";
import { credentialPanel } from "./credential.js";
import { cronText } from "./health.js";
import { modes, rawMode } from "./orgedit.js";
import { paste } from "./paste.js";
import { runOnce } from "./runonce.js";
import { todo } from "./todo.js";

const ROLES = [
  {
    handle: "cto",
    label: "CTO",
    name: "Chief Technology Officer",
    about: "Builds the product: fixes, features and tests, as pull requests for you to review.",
  },
  {
    handle: "cmo",
    label: "CMO",
    name: "Chief Marketing Officer",
    about: "Marketing: posts, SEO, copy and launch plans, as drafts for you to approve.",
  },
  {
    handle: "support",
    label: "Support",
    name: "Head of Support",
    about: "Answers issues, writes help docs, and turns user reports into bugs.",
  },
];

/**
 * The roles as cards. The three with worked examples are offered until they are hired;
 * Something else asks for a name and a sentence.
 * @param {{onPick: (role: {handle: string, name: string, dir: string, about?: string}) => void}} o
 */
export function rolePicker(o) {
  const hired = new Set(S.data.staff.map((s) => s.handle));
  const box = el("div");
  const grid = el("div", { className: "roles" });
  for (const r of ROLES.filter((r) => !hired.has(r.handle))) {
    const b = roleCard(r.label, r.about);
    b.dataset.role = r.handle;
    b.onclick = () => o.onPick({ handle: r.handle, name: r.name, dir: r.handle });
    grid.append(b);
  }

  const other = roleCard("Something else", "Name the role and say what they do.");
  other.dataset.role = "other";
  grid.append(other);

  const name = el("input", { type: "text", placeholder: "e.g. Head of Finance" });
  name.dataset.field = "role name";
  const about = el("textarea", { className: "pastebox", rows: 2, placeholder: "e.g. Tracks spending and prepares the monthly accounts." });
  about.dataset.field = "role about";
  const go = el("button", { className: "btn primary", textContent: "Continue" });
  const err = el("p", { className: "err", hidden: true });
  const form = el("div", { className: "roleform", hidden: true }, [
    el("label", { className: "qfield" }, [el("span", { textContent: "Role" }), name]),
    el("label", { className: "qfield" }, [el("span", { textContent: "What do they do? One sentence." }), about]),
    el("div", { className: "row" }, [go]),
    err,
  ]);
  other.onclick = () => {
    form.hidden = false;
    name.focus?.();
  };
  go.onclick = () => {
    const title = String(name.value ?? "").trim();
    const handle = handleFor(title);
    err.hidden = true;
    if (!title || !handle) {
      err.textContent = "Give the role a name.";
      err.hidden = false;
      name.focus?.();
      return;
    }
    if (hired.has(handle)) {
      err.textContent = "Someone called " + handle + " is already hired. Pick another name.";
      err.hidden = false;
      return;
    }
    o.onPick({ handle, name: title, dir: handle, about: String(about.value ?? "").trim() });
  };

  box.append(grid, form);
  return box;
}

function roleCard(label, about) {
  return el("button", { className: "role" }, [el("b", { textContent: label }), el("span", { textContent: about })]);
}

/** "Head of Finance" → "head-of-finance", inside what `hire` accepts as a handle. */
function handleFor(name) {
  let h = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 21)
    .replace(/-+$/, "");
  if (h && !/^[a-z]/.test(h)) h = ("staff-" + h).slice(0, 21).replace(/-+$/, "");
  return /^[a-z][a-z0-9-]{1,20}$/.test(h) ? h : "";
}

/**
 * The steps for one staff member, hired or about to be.
 * @param {{
 *   role: {handle: string, name: string, dir: string, about?: string},
 *   onHired: (handle: string, result: object) => void,
 *   onClose: () => void,
 *   result?: {ok: boolean, output?: string},
 * }} o  `result` is what the hire said, shown once when it had problems.
 */
export function hireFlow(o) {
  const role = o.role;
  const staff = () => S.data.staff.find((s) => s.handle === role.handle);
  const s = staff();
  const hired = Boolean(s);
  const name = s?.name ?? role.name;

  const box = el("div", { className: "hireflow" });
  const close = el("button", { className: "ghbtn", textContent: "Close" });
  close.onclick = o.onClose;
  box.append(
    el("div", { className: "row hireflowhead" }, [el("h2", { textContent: name }), close]),
  );
  const list = el("div", { className: "todos" });
  box.append(list);

  const hire = todo(1, "Hire", hired);
  const app = todo(2, "Create their GitHub App", false);
  const charter = todo(3, "Write their charter", hired && !s.rig?.charterStub);
  const cred = todo(4, "Add your agent credential", false);
  const run = todo(5, "Run once now", false);
  list.append(hire.card, app.card, charter.card, cred.card, run.card);

  /* The credential is once for the org. Stored already, it is not a step for this person. */
  let credSeen = false;
  const credStatus = (ok) => {
    if (!credSeen && ok) {
      cred.card.remove();
      run.renumber(4);
    } else cred.setDone(ok);
    credSeen = true;
  };

  if (!hired) {
    hireStep(hire.body, role, o.onHired);
    for (const t of [app, charter, cred, run]) t.setLocked("Hire first");
    getCredential()
      .then((c) => credStatus(Boolean(c.orgSecret)))
      .catch(() => {});
    return box;
  }

  hire.body.append(el("p", { className: "sub", textContent: "Hired. Their repo is " + (s.brain ?? s.dir) + "." }));
  if (o.result && !o.result.ok) {
    hire.setDone(false);
    hire.body.append(el("p", { className: "err", textContent: "The hire finished with problems. Read the output below." }));
  }
  if (o.result?.output) {
    const out = el("details", { className: "planfiles" }, [
      el("summary", { textContent: "Output" }),
      el("pre", { className: "code planout", textContent: o.result.output }),
    ]);
    out.open = !o.result.ok;
    hire.body.append(out);
  }

  /* 2 · the App. The public identity only matters when a product repo is public, and hire
     treats one with no visibility written as public, so this does too. */
  let needPublic = false;
  const made = { private: false, public: false };
  const appDone = () => app.setDone(made.private && (!needPublic || made.public));
  const panels = el("div");
  app.body.append(panels);
  panels.append(
    appPanel({ staff: s.handle, name: s.name, scope: "private", onDone: () => ((made.private = true), appDone()) }),
  );
  getRepos()
    .then((r) => {
      needPublic = (r.repos ?? []).some(
        (x) => x.role === "product" && String(x.visibility ?? "").toLowerCase() !== "private",
      );
      if (needPublic) {
        app.hint("One of your product repos is public. Public work uses a second App, shared by all staff.");
        panels.append(
          appPanel({ staff: s.handle, name: s.name, scope: "public", onDone: () => ((made.public = true), appDone()) }),
        );
      }
      appDone();
    })
    .catch(() => {});

  /* 3 · the charter. */
  const charterSaved = () =>
    refreshAll(true).then(() => charter.setDone(!staff()?.rig?.charterStub));
  charter.body.append(charterModes(s, role.about, charterSaved));

  /* 4 · the credential. */
  cred.body.append(credentialPanel({ bare: true, onStatus: credStatus }));

  /* 5 · the first run. */
  run.body.append(
    runOnce({
      staff: s.handle,
      name: s.name,
      onDone: (ok) => {
        run.setDone(ok);
        if (ok) refreshAll(true);
      },
    }),
  );

  /* What only GitHub knows: the App's secrets on the repo, and whether a run has succeeded. */
  getStaffProgress(s.handle, true)
    .then((p) => {
      if (p.app) made.private = true;
      if (p.publicApp) made.public = true;
      appDone();
      if (p.ran) run.setDone(true);
    })
    .catch(() => {});

  return box;
}

/** Three ways to write CHARTER.md. The template is offered only when a worked example fits. */
function charterModes(s, about, onSaved) {
  const box = el("div", {}, [el("p", { className: "sub", textContent: "Loading…" })]);
  const path = s.dir + "/CHARTER.md";
  getCharterExample(s.handle)
    .catch(() => ({ kind: null }))
    .then((ex) => {
      const tabs = [
        {
          label: "Let an AI interview you",
          node: paste({ kind: "charter", staff: s.handle, title: "", about, onSaved }),
        },
      ];
      if (ex?.kind) {
        tabs.push(
          rawMode(path, onSaved, "md", {
            label: "Start from the template",
            note: "Edit this so it fits your business before saving.",
            read: async () => ex.text,
          }),
        );
      }
      tabs.push(rawMode(path, onSaved));
      box.replaceChildren(modes(tabs));
    });
  return box;
}

/* ---------------------------------- step 1 ---------------------------------- */

function hireStep(host, role, onHired) {
  const first = !S.data.staff.length;
  const org = S.data.org;

  const summary = el("p", { className: "hiresummary", textContent: "Reading the plan…" });
  const details = el("div", { className: "hiredetails", hidden: true });
  const showDetails = el("button", { className: "ghbtn", textContent: "Show details" });
  showDetails.onclick = () => {
    details.hidden = !details.hidden;
    showDetails.textContent = details.hidden ? "Show details" : "Hide details";
  };

  const handle = field("handle", role.handle, "Lowercase letters, digits and dashes.");
  const name = field("name", role.name, "The role's full name.");
  const dir = field("dir", role.dir, "The repo name.");
  const schedule = scheduleField();
  const fields = [
    ["name", name],
    ["dir", dir],
    ["schedule", schedule],
  ];
  /* App names are copied from whoever is already here. The first hire has nobody to copy
     from, so it names both, and later hires follow the pattern. */
  let app = null;
  if (first) {
    app = field("app", org + "-" + role.handle, "This staff member's GitHub App. App names are unique across GitHub.");
    const pub = field("public app", org + "-robot", "The App all staff share for public product repos.");
    fields.push(["app", app], ["publicApp", pub]);
  }

  const advanced = el("div", { className: "hireadvanced", hidden: true }, [
    handle.row,
    ...fields.map(([, f]) => f.row),
  ]);
  const showAdvanced = el("button", { className: "ghbtn", textContent: "Advanced" });
  showAdvanced.onclick = () => {
    advanced.hidden = !advanced.hidden;
  };

  const status = el("span", { className: "meta" });
  const go = el("button", { className: "btn primary", textContent: "Hire", disabled: true });

  host.append(
    summary,
    el("div", { className: "row" }, [showDetails, showAdvanced]),
    details,
    advanced,
    el("div", { className: "row" }, [go, status]),
  );

  const params = () => {
    const p = new URLSearchParams({ handle: val(handle) });
    for (const [key, f] of fields) {
      const v = f.value ? f.value() : val(f);
      if (v) p.set(key, v);
    }
    return p;
  };

  let plan = null;
  const replan = async () => {
    plan = null;
    go.disabled = true;
    summary.className = "hiresummary";
    summary.textContent = "Reading the plan…";
    try {
      const data = await (await fetch("/api/staff/plan?" + params(), { cache: "no-store" })).json();
      if (data.error) throw new Error(data.error);
      plan = data.plan;
      summary.textContent = summarise(plan);
      details.replaceChildren(planDetails(plan));
      go.disabled = false;
    } catch (e) {
      summary.className = "hiresummary err";
      summary.textContent = e.message;
      details.replaceChildren();
    }
  };

  /* The App name follows the handle until somebody types their own. */
  let lastHandle = val(handle);
  handle.input.onchange = () => {
    if (app && val(app) === org + "-" + lastHandle) app.input.value = org + "-" + val(handle);
    lastHandle = val(handle);
    replan();
  };
  for (const [, f] of fields) f.input.onchange = replan;
  if (schedule.days) schedule.days.onchange = () => (schedule.say(), replan());

  go.onclick = async () => {
    if (!plan) return;
    const p = plan.staff;
    const yes = await askYes({
      title: "Create " + p.brain + " and wire it up?",
      hint: "This creates a repository on GitHub.",
      confirm: "Hire " + p.handle,
    });
    if (!yes) return;
    go.disabled = true;
    status.className = "meta";
    status.textContent = "Hiring…";
    let r;
    try {
      r = await post({ action: "hire", handle: p.handle, flags: Object.fromEntries(params()) }, "/api/staff/apply");
      await refreshAll(true);
    } catch (e) {
      status.className = "meta err";
      status.textContent = e.message;
      go.disabled = false;
      return;
    }
    if (S.data.staff.some((x) => x.handle === p.handle)) {
      onHired(p.handle, r);
      return;
    }
    status.className = "meta err";
    status.textContent = "The hire did not finish.";
    if (r.output) host.append(el("pre", { className: "code planout", textContent: r.output }));
    go.disabled = false;
  };

  replan();
}

/** One plain sentence from the plan. */
function summarise(plan) {
  const s = plan.staff;
  return "Creates a private repo " + s.brain + ", its workflows and a pinned status issue. " + runsAt(s.schedule);
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "0 8 * * 1-5" → "Runs weekdays at 08:00 UTC." */
function runsAt(cron) {
  const p = String(cron ?? "").trim().split(/\s+/);
  if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1]) || p[2] !== "*" || p[3] !== "*") {
    return "Schedule: " + cron + " (UTC).";
  }
  const at = p[1].padStart(2, "0") + ":" + p[0].padStart(2, "0") + " UTC";
  if (p[4] === "1-5") return "Runs weekdays at " + at + ".";
  if (p[4] === "*") return "Runs every day at " + at + ".";
  const days = p[4].split(",").map((d) => DAY_NAMES[Number(d) % 7]);
  if (days.some((d) => !d)) return "Schedule: " + cron + " (UTC).";
  const said = days.length > 1 ? days.slice(0, -1).join(", ") + " and " + days.at(-1) : days[0];
  return "Runs " + said + " at " + at + ".";
}

/** Everything the plan would do, for Show details. */
function planDetails(plan) {
  const box = el("div", { className: "plan" });
  const s = plan.staff;
  box.append(el("div", { className: "planhead", textContent: "Creates" }));
  box.append(
    line("ok", s.brain + ", private"),
    line("ok", plan.files.length + " files, including three caller workflows"),
    line("ok", plan.labels.length + " labels: " + plan.labels.join(", ")),
    line("ok", "a pinned status issue"),
    line("ok", "runs at " + cronText(s.schedule) + ", on " + s.model),
  );
  for (const p of plan.peers) box.append(line("ok", p.brain + " gets a " + p.label + " label"));
  /* Commits into repos that already exist, as you. Listed because they are writes to
     somebody else's repo, and a plan that hid them would be the silent kind. */
  if ((plan.commits ?? []).length) {
    box.append(el("div", { className: "planhead", textContent: "Commits and pushes, as you" }));
    for (const c of plan.commits) box.append(line("ok", c.repo + ": " + c.file + ", " + c.why));
  }
  const cred = s.agentSecret ?? "the agent credential";
  box.append(
    plan.orgSecret?.visibility === "selected"
      ? line("ok", s.brain + " is added to the repos that can read the org secret " + cred)
      : plan.orgSecret
        ? line("ok", "the org secret " + cred + " already reaches " + plan.orgSecret.visibility + " repos")
        : line("warn", "no org secret " + cred + " yet. Step 4 adds it."),
  );
  for (const w of plan.warnings ?? []) box.append(line("warn", portalWords(w)));
  return box;
}

/* The plan's warnings are the CLI's, and name its flags. Here the same options are fields
   under Advanced, and a flag the page has no box for reads as a dead end. */
function portalWords(warning) {
  return warning
    .replace(/pass --public-app\b/, "fill in public app under Advanced")
    .replace(/pass --app\b/, "fill in app under Advanced");
}

const val = (f) => String(f.input.value ?? "").trim();

function field(label, value, hint) {
  const input = el("input", { type: "text", value: value ?? "", style: "width:100%" });
  input.dataset.field = label;
  const row = el("div", { className: "ffield" });
  row.append(el("label", { textContent: label }), input, el("small", { textContent: hint }));
  return { row, input };
}

/**
 * When the daily run happens, as a time and a set of days rather than as cron.
 *
 * The value on the wire is still a cron expression, because that is what goes in the workflow
 * and what `roster hire` takes. UTC is said out loud, with the local time beside it: GitHub
 * schedules in UTC.
 */
function scheduleField() {
  const time = el("input", { type: "time", value: "", step: "60", style: "width:130px" });
  time.dataset.field = "schedule";
  const days = el("select");
  days.append(
    el("option", { value: "1-5", textContent: "Weekdays" }),
    el("option", { value: "*", textContent: "Every day" }),
    el("option", { value: "1", textContent: "Mondays" }),
    el("option", { value: "1,3,5", textContent: "Mon, Wed, Fri" }),
  );
  // Set rather than relying on "the first option is selected", which is true of a rendered
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
    said.textContent = cron ? cronText(cron) + local(time.value) : "Leave it empty to get a free slot.";
  };
  time.oninput = say;
  say();

  const row = el("div", { className: "ffield" });
  row.append(
    el("label", { textContent: "schedule" }),
    el("div", { className: "row" }, [time, days, el("span", { className: "meta", textContent: "UTC" })]),
    said,
  );
  return { row, input: time, days, value, say };
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

/** One line of a plan, with its mark. */
export function line(kind, text) {
  const d = el("div", { className: "planline " + kind });
  d.append(icon(MARK[kind] ?? "dot", "ic"), el("span", { textContent: text }));
  return d;
}
