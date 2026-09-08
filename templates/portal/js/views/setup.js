/* Standing an org up, in the browser, before there is anything on disk to browse.
 *
 * The rule this screen follows: never claim a step is done because you clicked it. Everything
 * here is re-derived from /api/setup/status, so a page reloaded tomorrow shows the world as it
 * is rather than as it was left. Setup cannot be finished in one sitting, so it must survive
 * being abandoned halfway. */

import { checkOrg, createTenant, getSetup, joinOrg, planTenant } from "../api.js";
import { $, el, esc, toClipboard } from "../dom.js";
import { checklist } from "./checklist.js";
import { repoPicker } from "./repos.js";
import { paste } from "./paste.js";

let S = null; // /api/setup/status, refreshed after anything that changes the world

export async function viewSetup(main) {
  S = await getSetup();
  render(main);
}

function render(main) {
  main.replaceChildren();
  main.append(el("h1", { textContent: "Set up your org" }));
  main.append(
    el("p", {
      className: "sub",
      textContent:
        "Four things here, then two that GitHub insists a human does. Nothing is created until " +
        "you have read the plan.",
    }),
  );

  main.append(stepGh());
  if (!S.gh.ok) return; // everything downstream needs gh, and saying so once is enough
  main.append(stepOrg(main));

  /* Drawn whenever a tenant exists, not only in the seconds after creating one. Setup takes
     days: the repo picker and the two manual steps have to still be here tomorrow. */
  if (S.tenant.found) main.append(afterCreate());
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
        "roster does everything through your own gh, so it holds no token of its own. Run this " +
        "in a terminal, then reload:",
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
        textContent: "Reload the page to leave setup and use the portal.",
      }),
    );
    const rows = el("div", { style: "margin-top:12px" });
    card.append(rows);
    checklist(rows, {});
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
        "Repos are created here. GitHub has no API for creating an organisation, so make one on " +
        "github.com first if you need to.",
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

  const name = field("name", "What the business is called", "", "Shown to the agents. Defaults to the org.");
  const human = field("human", "Your GitHub login", S.gh.login ?? "", "The person the agents answer to.");

  card.append(form);

  /* The agent. Its id decides the secret name later, so setup can name it exactly rather than
     saying "it depends on the runner". */
  card.append(el("h3", { textContent: "Which coding agent runs a session" }));
  const agents = el("div", { className: "choices" });
  S.agents.forEach((a, i) => {
    const opt = el("label", { className: "choice" });
    const radio = el("input", { name: "agent", value: a.id, checked: i === 0 });
    radio.setAttribute("type", "radio");
    opt.append(radio, el("b", { textContent: a.label }), el("small", { textContent: a.note }));
    opt.append(el("code", { textContent: a.tokenEnv }));
    agents.append(opt);
  });
  card.append(agents);
  card.append(
    el("p", {
      className: "sub",
      textContent:
        "Anything else works too: a runner is an install command, a run command and the name of " +
        "the secret holding its credential. Write those three into org.yaml afterwards.",
    }),
  );

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
  }

  join.onclick = async () => {
    join.disabled = true;
    out.replaceChildren(el("p", { className: "sub", textContent: "Cloning…" }));
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
      out.replaceChildren();
      out.append(
        el("p", {
          textContent: `${result.files.length} files in ${result.dir}, and one private repo, ${p.org}/roster-ops.`,
        }),
      );
      const list = el("div", { className: "filelist" });
      for (const f of result.files) list.append(el("code", { textContent: "+ " + f }));
      out.append(list);
      out.append(
        el("p", {
          className: "sub",
          textContent:
            "org/business.md arrives as questions, not prose. Answering it is the next step and " +
            "it is the one that decides whether any of this is worth running.",
        }),
      );
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
  const card = step(3, "Two things only you can do", false);
  card.append(
    el("p", {
      textContent:
        "Neither can be automated, and the first one fails in a way that wastes an afternoon if " +
        "you skip it.",
    }),
  );

  const one = el("div", { className: "manual" });
  one.append(
    el("b", { textContent: "Let the ops repo's workflow be called" }),
    el("p", {
      textContent:
        "Settings → Actions → General → Access → “Accessible from repositories in the " +
        "organisation”, on roster-ops.",
    }),
    el("small", {
      textContent:
        "Skip it and every workflow fails with “workflow not found”, which reads like a typo in " +
        "a path and is not one. It is an org permission on a repo, so it is yours to click.",
    }),
  );
  if (S.tenant.org) {
    const url = `https://github.com/${S.tenant.org}/roster-ops/settings/actions`;
    one.append(el("a", { className: "btn", href: url, target: "_blank", textContent: "Open that page" }));
  }
  card.append(one);

  if (S.tenant.org) {
    card.append(repoPicker({ org: S.tenant.org, known: S.tenant.repos ?? [] }));
  }

  const two = el("div", { className: "manual" });
  two.append(
    el("b", { textContent: "Answer org/business.md" }),
    el("p", {
      textContent:
        "It ships as questions. It is composed into the top of every prompt, every run, and an " +
        "agent that cannot answer them writes work that is plausible and generic.",
    }),
  );
  card.append(two);

  // The copy-a-prompt loop, which is the whole answer to "how do I write this file".
  card.append(paste({ kind: "discover", title: "Write it with your own AI" }));
  return card;
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
