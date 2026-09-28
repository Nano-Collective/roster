/* Standing an org up, in the browser, before there is anything on disk to browse.
 *
 * The rule this screen follows: never claim a step is done because you clicked it. Everything
 * here is re-derived from /api/setup/status, so a page reloaded tomorrow shows the world as it
 * is rather than as it was left. Setup cannot be finished in one sitting, so it must survive
 * being abandoned halfway. */

import {
  checkOrg,
  createTenant,
  fileUrl,
  getAccess,
  getOrg,
  getSetup,
  joinOrg,
  planTenant,
  saveFile,
  setAccess,
} from "../api.js";
import { $, el, esc, grow, toClipboard } from "../dom.js";
import { go } from "../router.js";
import { S as App } from "../state.js";
import { checklist } from "./checklist.js";
import { credentialPanel } from "./credential.js";
import { repoPicker } from "./repos.js";
import { paste } from "./paste.js";

let S = null; // /api/setup/status, refreshed after anything that changes the world

/* Where the doctor checklist is drawn on this screen, so a save can re-run it. Left stale, it
   went on saying business.stub after business.md had been saved, until "Check again". */
let healthHost = null;
let healthStep = null;

/* What the "What is left" cards already ask for. Doctor reporting them as well, right after a
   successful create, read as the create having failed. */
const COVERED = ["business", "business.stub", "priorities", "priorities.stub", "actions-access", "secrets", "agent"];
const HEALTH = { skip: COVERED, hideWhenClean: true };

/* Each "what is left" step that is a file, by id, so a save can mark it done in place rather
   than repainting the page and throwing away the diff somebody is still reading. */
const fileSteps = new Map();

export async function viewSetup(main) {
  S = await getSetup();
  render(main);
}

/**
 * The same steps once a tenant exists, as their own screen in the portal.
 *
 * Setup used to be reachable only before there was a tenant, so the reload that followed
 * creating one landed on an empty Inbox with the repo picker, the credential and both files
 * gone. The sidebar offers this while anything is unfinished, and an org nobody has been hired
 * into opens on it.
 */
export async function viewGettingStarted(main) {
  main.append(el("h1", { textContent: "Getting started" }));
  const sub = el("p", { className: "sub", textContent: "Reading what is left…" });
  main.append(sub);
  S = await getSetup();
  // Somebody may have clicked elsewhere while GitHub was answering.
  if (App.view !== "setup") return;
  sub.textContent = "Work through these in order.";
  main.append(afterCreate());

  const health = step("!", "Other problems", false);
  healthHost = el("div", { style: "margin-top:12px" });
  health.append(healthHost);
  main.append(health);
  healthStep = health;
  checklist(healthHost, { ...HEALTH, onEmpty: () => health.remove() });
}

/** Whether the sidebar offers Getting started: while anything is left, or while it is open. */
export function paintSetupNav() {
  const nav = $("#setupnav");
  if (!nav) return;
  nav.hidden = !App.data?.unfinished?.length && App.view !== "setup";
}

/* After a save: the checklist and the step list are both derived from disk, so both are asked
   again rather than updated by hand. The sidebar's list comes from /api/org, which is the one
   the portal already reads. */
async function recheck() {
  if (healthHost) checklist(healthHost, { ...HEALTH, onEmpty: () => healthStep?.remove() });
  try {
    S = await getSetup();
    for (const [id, mark] of fileSteps) mark(!(S.tenant.left ?? []).includes(id));
  } catch {
    // The saved file is saved either way; a stale tick is not worth an error on top of it.
  }
  if (App.data) {
    const fresh = await getOrg().catch(() => null);
    if (fresh?.unfinished) App.data.unfinished = fresh.unfinished;
    paintSetupNav();
  }
}

function render(main) {
  /* The sidebar is written by boot() before any of this is known. Once a tenant has been
     adopted, leaving it on "no org yet" contradicts the card directly below it. */
  const brand = $("#orgname");
  if (brand) brand.textContent = S.tenant.found ? (S.tenant.org ?? "set up") : "no org yet";

  main.replaceChildren();
  main.append(el("h1", { textContent: "Set up your org" }));
  main.append(
    el("p", {
      className: "sub",
      textContent:
        "Choose an organisation and a coding agent. Nothing is created until you press Create it.",
    }),
  );

  main.append(stepGh());
  if (!S.gh.ok) return; // everything downstream needs gh, and saying so once is enough
  main.append(stepOrg(main));

  /* Drawn whenever a tenant exists, not only in the seconds after creating one. Setup takes
     days: the repo picker and the two manual steps have to still be here tomorrow. */
  if (S.tenant.found) {
    const rest = step(3, "Finish setting up", false);
    rest.append(afterCreate());
    main.append(rest);
  }
}

/* ---------------------------------- 1 · gh ---------------------------------- */

function stepGh() {
  const card = step(1, "GitHub CLI", S.gh.ok);
  if (S.gh.ok) {
    card.append(el("p", { className: "sub", textContent: "Signed in as " + S.gh.login + "." }));
    return card;
  }
  card.append(
    el("p", { textContent: S.gh.error }),
    el("p", {
      className: "sub",
      textContent:
        "Run this in a terminal, then reload:",
    }),
    el("pre", { className: "cmd", textContent: "gh auth login" }),
  );
  return card;
}

/* ------------------------- 2, 3, 4 · org, agent, create ------------------------- */

function stepOrg(main) {
  const done = S.tenant.found;
  const card = step(2, "The organisation, and who runs it", done);

  if (done) {
    card.append(
      el("p", {
        textContent: S.tenant.org + " is set up. Its ops repo is at " + S.tenant.opsDir + ".",
      }),
      el("p", {
        className: "sub",
        textContent:
          "Finish the steps below. They stay under Getting started in the sidebar until they're done.",
      }),
    );
    return card;
  }

  const form = el("div", { className: "setupform" });
  const field = (id, label, value, hint) => {
    const wrap = el("label", { className: "field" });
    wrap.append(el("span", { textContent: label }));
    const input = el("input", { id: "f-" + id, value: value ?? "" });
    input.setAttribute("type", "text");
    wrap.append(input);
    if (hint) wrap.append(el("small", { textContent: hint }));
    form.append(wrap);
    // The wrapper, not just the input: reaching back through parentElement to hide a row is
    // the kind of indirection that works until the markup moves one level.
    return { wrap, input };
  };

  /* A picker over the orgs gh can already see, because typing a name you have to get exactly
     right is the kind of thing that fails at step two and reads as the tool being broken. */
  const orgWrap = el("label", { className: "field" });
  orgWrap.append(el("span", { textContent: "GitHub organisation" }));
  const org = el("select", { id: "f-org" });
  org.append(el("option", { value: "", textContent: S.orgs.length ? "choose one…" : "type below" }));
  for (const o of S.orgs) org.append(el("option", { value: o, textContent: o }));
  org.append(el("option", { value: "__other", textContent: "another one…" }));
  orgWrap.append(org);
  orgWrap.append(
    el("small", {
      textContent:
        "Don't have one? Create it on github.com first.",
    }),
  );
  form.append(orgWrap);

  const other = field("orgother", "Organisation name", "", "");
  other.wrap.hidden = S.orgs.length > 0;

  /* Which of the two things this is. An org that already has a roster-ops wants joining, not
     a second one, and that is the question a second person on a team is really asking. */
  const verdict = el("div", { className: "verdict", hidden: true });
  form.append(verdict);
  let existing = null;

  const look = async () => {
    const name = org.value === "__other" ? other.input.value.trim() : org.value;
    existing = null;
    verdict.hidden = true;
    if (!name) return;
    verdict.hidden = false;
    verdict.replaceChildren(el("p", { className: "sub", textContent: "Looking at " + name + "…" }));
    try {
      const found = await checkOrg(name);
      existing = found.exists ? name : null;
      verdict.replaceChildren(
        el("p", {
          textContent: found.exists
            ? name + " already runs roster. Nothing here needs creating; it needs checking out."
            : "Nothing in " + name + " yet. This will create " + name + "/roster-ops.",
        }),
      );
      paint();
    } catch {
      verdict.hidden = true;
    }
  };

  org.addEventListener("change", () => {
    other.wrap.hidden = org.value !== "__other";
    look();
  });
  other.input.addEventListener("change", look);

  const name = field("name", "What the business is called", "", "Defaults to the organisation name.");
  const human = field("human", "Your GitHub login", S.gh.login ?? "", "The person the staff report to.");

  card.append(form);
  const agentHead = el("h3", { textContent: "Which coding agent runs a session" });

  /* The agent. Its id decides the secret name later, so setup can name it exactly rather than
     saying "it depends on the runner". */
  card.append(agentHead);
  const agents = el("div", { className: "choices" });
  S.agents.forEach((a, i) => {
    const opt = el("label", { className: "choice" });
    const radio = el("input", { name: "agent", value: a.id, checked: i === 0 });
    radio.setAttribute("type", "radio");
    opt.append(radio, el("b", { textContent: a.label }));
    opt.append(el("code", { textContent: a.tokenEnv }));
    agents.append(opt);
  });
  card.append(agents);
  const agentNote = el("p", {
    className: "sub",
    textContent:
      "Using a different agent? Pick any of these, then set it in org.yaml afterwards.",
  });
  card.append(agentNote);

  const params = () => ({
    org: org.value === "__other" ? other.input.value.trim() : org.value,
    name: name.input.value.trim(),
    human: human.input.value.trim(),
    marker: (human.input.value.trim().split("-")[0] || "human").toLowerCase(),
    agent: agents.querySelector("input:checked")?.value ?? "claude-code-action",
  });

  const out = el("div", { className: "planout" });
  const plan = el("button", { className: "btn", textContent: "Show me the plan" });
  const go = el("button", { className: "btn primary", textContent: "Create it", hidden: true });
  const join = el("button", { className: "btn primary", textContent: "Check it out here", hidden: true });
  card.append(el("div", { className: "row" }, [plan, go, join]), out);

  /* Creating and joining are mutually exclusive, and showing both is how somebody creates a
     second ops repo in an org that already had one. */
  function paint() {
    const joining = existing !== null;
    join.hidden = !joining;
    plan.hidden = joining;
    if (joining) go.hidden = true;

    /* An org that already runs roster has answered all of these: its own org.yaml names the
       business, the human and the agent. Leaving them on screen asks for values that will be
       thrown away, and implies the checkout is going to use them. */
    for (const bit of [name.wrap, human.wrap, agentHead, agents, agentNote]) bit.hidden = joining;
  }

  join.onclick = async () => {
    join.disabled = true;
    /* Cloning an ops repo and every brain took 38 seconds against a real org, behind a word
       that never changed. A static "Cloning…" for that long reads as hung, so this says what
       it is doing and keeps a clock running to show it is alive. */
    const clock = el("p", { className: "sub" });
    out.replaceChildren(clock);
    const started = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - started) / 1000);
      clock.textContent =
        `Cloning ${existing}: the ops repo and one for each staff member. ${s}s. ` +
        "A first checkout usually takes under a minute.";
    };
    tick();
    const ticking = setInterval(tick, 1000);
    try {
      const result = await joinOrg(existing);
      if (!result.ok) throw new Error(result.error);
      out.replaceChildren(
        el("p", {
          textContent:
            "Checked out " + (result.cloned ?? []).join(", ") + " into " + (S.startedIn ?? "here") + ".",
        }),
      );
      S = await getSetup();
      render(main);
    } catch (err) {
      out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    } finally {
      clearInterval(ticking);
      join.disabled = false;
    }
  };

  plan.onclick = async () => {
    const p = params();
    if (!p.org) {
      out.replaceChildren(el("p", { className: "err", textContent: "Pick an organisation first." }));
      return;
    }
    out.replaceChildren(el("p", { className: "sub", textContent: "Working…" }));
    try {
      const result = await planTenant(p);
      const steps = el("ol", { className: "plansteps" }, [
        el("li", { textContent: `Create a private repo, ${p.org}/roster-ops, to hold the org's shared settings.` }),
        el("li", { textContent: `Put a copy of it in ${result.dir}.` }),
        el("li", { textContent: `Let the other repos in ${p.org} run its workflow.` }),
      ]);
      const files = el("details", { className: "planfiles" }, [
        el("summary", { textContent: `The ${result.files.length} files it writes` }),
        el("div", { className: "filelist" }, result.files.map((f) => el("code", { textContent: f }))),
      ]);
      const next = el("p", {
        className: "sub",
        textContent: "After that: describe the business, set this month's priorities, and hire your first staff member.",
      });
      out.replaceChildren(el("p", { textContent: "Create it will:" }), steps, files, next);
      go.hidden = false;
    } catch (err) {
      out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    }
  };

  go.onclick = async () => {
    go.disabled = plan.disabled = true;
    out.replaceChildren(el("p", { className: "sub", textContent: "Creating…" }));
    try {
      const result = await createTenant(params());
      out.replaceChildren(el("pre", { className: "cmd", textContent: result.output.trim() }));
      if (result.ok) {
        // render() draws the rest itself now that a tenant is on disk.
        S = await getSetup();
        render(main);
      }
    } catch (err) {
      out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    } finally {
      go.disabled = plan.disabled = false;
    }
  };

  return card;
}

/* ------------------------- 5 · the two GitHub insists on ------------------------- */

function afterCreate() {
  fileSteps.clear();
  const list = el("div", { className: "todos" });
  const left = S.tenant.left ?? [];
  const staffCount = App.data?.staff?.length ?? 0;
  let n = 0;

  if (S.tenant.org) {
    const repos = todo(++n, "Choose the repos your staff work on", (S.tenant.products ?? []).length > 0);
    repos.hint("Pick at least one. Staff open pull requests there, and you review them.");
    repos.body.append(
      repoPicker({ org: S.tenant.org, known: S.tenant.repos ?? [], bare: true, onAdded: () => repos.setDone(true) }),
    );
    list.append(repos.card);
  }

  const business = todo(++n, "Describe the business", !left.includes("business"));
  business.hint("A few short answers. Every staff member reads them before they start work.");
  business.body.append(businessForm(() => business.setDone(true)));
  fileSteps.set("business", business.setDone);
  list.append(business.card);

  const priorities = todo(++n, "Set this month's priorities", !left.includes("priorities"));
  priorities.hint("Up to three, in order. Staff pick work that serves them.");
  priorities.body.append(prioritiesForm(() => priorities.setDone(true)));
  fileSteps.set("priorities", priorities.setDone);
  list.append(priorities.card);

  const hire = todo(++n, "Hire your first staff member", staffCount > 0);
  hire.hint("Give them a role, like cto. You'll create their GitHub App and write their charter from their card.");
  const hireBtn = el("button", { className: "btn primary", textContent: "Hire someone" });
  hireBtn.onclick = () => {
    // Before the org has loaded, this screen is the whole app, so the Staff screen needs a reload.
    if (App.data) go({ view: "staff" });
    else location.assign("/#/-/staff") || location.reload();
  };
  hire.body.append(el("div", { className: "row" }, [hireBtn]));
  list.append(hire.card);

  const cred = todo(++n, "Add your agent credential", false);
  cred.hint(staffCount ? "Staff use it to run. You only add it once." : "Do this after your first hire.");
  cred.body.append(credentialPanel({ bare: true, onStatus: (ok) => cred.setDone(ok) }));
  list.append(cred.card);

  const access = todo(++n, "Let staff repos use the shared workflow", false);
  access.body.append(accessStep({ onStatus: (ok) => access.setDone(ok) }));
  list.append(access.card);

  return list;
}

/**
 * One numbered thing to do. Done ones fold to a single ticked line, and Change opens them again,
 * so the list shows what is left without hiding what was done.
 */
function todo(n, title, done) {
  const card = el("section", { className: "todo" });
  const num = el("span", { className: "todon" });
  const pill = el("span", { className: "todopill" });
  const change = el("button", { className: "ghbtn todochange", textContent: "Change" });
  const head = el("div", { className: "todohead" }, [num, el("h3", { textContent: title }), pill, change]);
  const hintEl = el("p", { className: "sub todohint" });
  const body = el("div", { className: "todobody" });
  card.append(head, hintEl, body);
  let open = false;
  const setDone = (d) => {
    card.classList.toggle("done", d);
    num.textContent = d ? "✓" : String(n);
    pill.textContent = d ? "Done" : "To do";
    change.hidden = !d;
    const shown = !d || open;
    body.hidden = !shown;
    hintEl.hidden = !shown || !hintEl.textContent;
  };
  change.onclick = () => {
    open = !open;
    change.textContent = open ? "Close" : "Change";
    setDone(card.classList.contains("done"));
  };
  setDone(done);
  return {
    card,
    body,
    setDone,
    hint: (text) => {
      hintEl.textContent = text;
      setDone(card.classList.contains("done"));
    },
  };
}

/**
 * One of the files only a person can write, with whether it is written yet.
 *
 * Read from the status rather than from the click that saved it, so a file written in an
 * editor, or by a coding agent, shows as done here too.
 */

/**
 * org/priorities.md, edited in place.
 *
 * There is no brief for it, and it does not want one: business.md needs an interview because
 * nobody can write it off the top of their head, while a ranked list of three things is
 * quicker to type than to explain to a model. So the file opens as it is on disk, stub and
 * all, and saving it is the same commit-and-push as every other editor here.
 */
const BUSINESS_QUESTIONS = [
  ["line", "What does it do, in one line?", "What this business does, in one line", true],
  ["who", "Who is it for?", "Who the customers are, specifically", true],
  ["key", "What does everything depend on?", "The one fact everything else follows from", false],
  ["true", "What's already true? What's built, measured or tried?", "What is already true", false],
  ["not", "What should staff never decide on their own?", "What is not ours to decide", false],
];

/** The business, as five questions in plain fields, written out as org/business.md. */
function businessForm(onSaved) {
  const form = el("div");
  const path = opsName() + "/org/business.md";
  const fields = BUSINESS_QUESTIONS.map(([id, label, , required]) => {
    const input = id === "line" ? el("input", { type: "text" }) : el("textarea", { className: "pastebox", rows: 3 });
    const wrap = el("label", { className: "qfield" }, [
      el("span", { textContent: label + (required ? "" : " (optional)") }),
      input,
    ]);
    return { id, input, wrap };
  });
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  form.append(...fields.map((f) => f.wrap), el("div", { className: "row" }, [save]), out);

  save.onclick = async () => {
    const missing = fields.find((f, i) => BUSINESS_QUESTIONS[i][3] && !String(f.input.value ?? "").trim());
    if (missing) {
      missing.input.focus();
      out.replaceChildren(el("p", { className: "err", textContent: "Answer the first two at least." }));
      return;
    }
    const name = App.data?.name ?? S.tenant.name ?? S.tenant.org;
    const text =
      `# What ${name} is\n\n` +
      fields
        .map((f, i) => [BUSINESS_QUESTIONS[i][2], String(f.input.value ?? "").trim()])
        .filter(([, v]) => v)
        .map(([h, v]) => `## ${h}\n\n${v}\n`)
        .join("\n");
    await saveAndSay(save, out, path, text, "portal: write org/business.md", onSaved);
  };

  return modes([
    { label: "Answer questions", node: form },
    {
      label: "Let an AI interview you",
      node: paste({ kind: "discover", title: "", onSaved: () => (onSaved(), recheck()) }),
    },
    rawMode(path, onSaved),
  ]);
}

/** This month's priorities, as three lines and an out-of-scope list. */
function prioritiesForm(onSaved) {
  const form = el("div");
  const path = opsName() + "/org/priorities.md";
  const ranks = [1, 2, 3].map((i) => {
    const input = el("input", { type: "text", placeholder: i === 1 ? "e.g. Tasks can be ticked off and removed" : "" });
    return { input, wrap: el("label", { className: "qfield" }, [el("span", { textContent: "Priority " + i + (i > 1 ? " (optional)" : "") }), input]) };
  });
  const scope = el("textarea", { className: "pastebox", rows: 3, placeholder: "One per line" });
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  form.append(
    ...ranks.map((r) => r.wrap),
    el("label", { className: "qfield" }, [el("span", { textContent: "Out of scope this month (optional)" }), scope]),
    el("div", { className: "row" }, [save]),
    out,
  );
  save.onclick = async () => {
    const items = ranks.map((r) => String(r.input.value ?? "").trim()).filter(Boolean);
    if (!items.length) {
      ranks[0].input.focus();
      out.replaceChildren(el("p", { className: "err", textContent: "Add at least one priority." }));
      return;
    }
    const outs = String(scope.value ?? "").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    const text =
      "## What matters this month\n\n### Priorities, in order\n\n" +
      items.map((t, i) => `${i + 1}. ${t}`).join("\n") +
      "\n" +
      (outs.length ? "\n### Out of scope this month\n\n" + outs.map((t) => `- ${t}`).join("\n") + "\n" : "");
    await saveAndSay(save, out, path, text, "portal: write org/priorities.md", onSaved);
  };
  return modes([{ label: "Fill in", node: form }, rawMode(path, onSaved)]);
}

async function saveAndSay(btn, out, path, text, message, onSaved) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Saving…";
  try {
    const r = await saveFile(path, text, message);
    out.replaceChildren(
      el("p", {
        className: r.pushed ? "sub" : "err",
        textContent: r.pushed ? "Saved." : "Saved locally, but the push failed: " + (r.note ?? ""),
      }),
    );
    onSaved();
    recheck();
  } catch (err) {
    out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** The file itself, for editing what is already there rather than starting again. */
function rawMode(path, onSaved) {
  const node = el("div");
  const ta = el("textarea", { className: "pastebox" });
  ta.rows = 12;
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  node.append(ta, el("div", { className: "row" }, [save]), out);
  ta.addEventListener("input", () => grow(ta));
  save.onclick = () =>
    saveAndSay(save, out, path, ta.value, "portal: edit " + path.split("/").slice(1).join("/"), onSaved);
  // Read when first shown, so it shows the file as it is then, not as it was at page load.
  const load = () =>
    // Not getFile: an absent file answers 404 with a message, and that is not what to edit.
    fetch(fileUrl(path), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        ta.value = text;
        grow(ta);
      });
  return { label: "Edit the file", node, onShow: load };
}

/** Ways to do one step, as a switcher across the top: one shown at a time. */
function modes(list) {
  const box = el("div");
  const bar = el("div", { className: "modes" });
  const panes = el("div");
  const buttons = list.map((m, i) => {
    const b = el("button", { className: "mode", textContent: m.label });
    b.onclick = () => show(i);
    return b;
  });
  bar.append(...buttons);
  box.append(bar, panes);
  function show(i) {
    buttons.forEach((b, j) => b.classList.toggle("on", i === j));
    panes.replaceChildren(list[i].node);
    list[i].onShow?.();
  }
  show(0);
  return box;
}

/** The ops repo's directory name, which is what every workspace-relative path starts with. */
function opsName() {
  return App.data?.opsName ?? String(S.tenant.opsDir ?? "roster-ops").split("/").pop();
}

/**
 * The ops repo's Actions access. Read on arrival, so a page reloaded after it was set says it
 * is done without anybody pressing anything; the button asks the server to set it, and a
 * refusal comes back with GitHub's reason and the page to click instead.
 *
 * Skipped, every workflow fails with "workflow not found", which reads like a typo in a path.
 */
function accessStep(opts = {}) {
  const box = el("div");
  const out = el("div");
  box.append(out);
  const say = (text, cls) => el("p", { className: cls ?? "sub", textContent: text });

  const offer = (why) => {
    const go = el("button", { className: "btn primary", textContent: "Set it for me" });
    out.replaceChildren(
      say(
        (why ? why + " " : "") +
          "Roster tried to set this when it created the org, and GitHub didn't allow it.",
      ),
      el("div", { className: "row" }, [go]),
    );
    go.onclick = async () => {
      go.disabled = true;
      try {
        const r = await setAccess();
        if (r.ok) {
          out.replaceChildren(say("Done."));
          opts.onStatus?.(true);
          return;
        }
        out.replaceChildren(
          say("GitHub refused: " + r.error + ".", "err"),
          el("a", { className: "btn", href: r.link, target: "_blank", textContent: "Set it by hand" }),
          say("Access → “Accessible from repositories in the organisation”."),
        );
      } catch (err) {
        out.replaceChildren(say(String(err.message || err), "err"));
        go.disabled = false;
      }
    };
  };

  out.replaceChildren(say("Checking…"));
  getAccess()
    .then((r) => {
      opts.onStatus?.(Boolean(r.ok));
      if (r.ok) out.replaceChildren(say("Done."));
      else offer(r.level ? "It is set to “" + r.level + "”." : "");
    })
    .catch(() => offer(""));
  return box;
}

/* ---------------------------------- furniture ---------------------------------- */

function step(n, title, done) {
  const card = el("section", { className: "step" + (done ? " done" : "") });
  const head = el("div", { className: "stephead" });
  head.append(
    el("span", { className: "stepn", textContent: done ? "✓" : String(n) }),
    el("h2", { textContent: title }),
  );
  card.append(head);
  return card;
}

export { esc, toClipboard, $ };
