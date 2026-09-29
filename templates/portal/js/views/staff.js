/* The Staff screen: a card per staff member, retiring, and the way in to hiring.
 *
 * Hiring itself is in hire.js. Retiring runs the CLI's own `buildRetirePlan` and
 * `applyRetirePlan` on the server, plan then apply: you see what it stops and what it keeps,
 * and nothing happens until you say so.
 */

import { getStaffProgress, post } from "../api.js";
import { askYes } from "../dialog.js";
import { ago, el, esc } from "../dom.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";
import { appPanel } from "./app.js";
import { credentialPanel } from "./credential.js";
import { hireFlow, line, rolePicker } from "./hire.js";
import { paste } from "./paste.js";
import { runOnce } from "./runonce.js";

/**
 * @param {{open?: string, result?: object}} [o]  `open` keeps one staff member's steps on
 *   screen across a repaint, which is how a finished hire lands on step 2.
 */
export function viewStaff(m, o = {}) {
  m.append(el("h1", { textContent: "Staff" }));
  const empty = !S.data.staff.length;
  if (empty) m.append(el("p", { className: "sub", textContent: "No staff yet. Pick a role to hire your first." }));

  const pane = el("div", { className: "hirepane" });

  const pick = () => {
    pane.replaceChildren(
      ...(empty ? [] : [el("h3", { textContent: "Pick a role" })]),
      rolePicker({ onPick: (role) => open(role) }),
    );
    if (!empty) {
      const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
      cancel.onclick = () => pane.replaceChildren();
      pane.append(el("div", { className: "row" }, [cancel]));
    }
  };

  /* One staff member's steps, hired or not yet. A hire repaints the whole screen, so the new
     card is in the list and the steps reopen on the same person. */
  function open(role, result) {
    // Remembered, so a refresh after a trip to GitHub (creating the App) reopens it.
    S.staffOpen = role;
    pane.replaceChildren(
      hireFlow({
        role,
        result,
        onHired: (handle, r) => {
          m.replaceChildren();
          viewStaff(m, { open: handle, result: r });
        },
        onClose: () => {
          S.staffOpen = null;
          if (empty) pick();
          else pane.replaceChildren();
        },
      }),
    );
    pane.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  if (!empty) {
    const list = el("div", { className: "grid", style: "margin-bottom:18px" });
    for (const s of S.data.staff) list.append(card(s));
    m.append(list);
    const hire = el("button", { className: "ghbtn primary", textContent: "Hire someone" });
    hire.onclick = pick;
    m.append(el("div", { className: "row", style: "margin-bottom:14px" }, [hire]));
  }
  m.append(pane);

  const opened = o.open && S.data.staff.find((s) => s.handle === o.open);
  const kept = !opened && S.staffOpen;
  const keptStaff = kept && S.data.staff.find((s) => s.handle === kept.handle);
  if (opened) open(roleOf(opened), o.result);
  else if (kept) open(keptStaff ? roleOf(keptStaff) : kept);
  else if (empty) pick();

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

    /* Whether setup is finished, as far as can be told cheaply: the charter from disk at once,
       and the App's secrets and a first run from GitHub when it answers. */
    const finish = el("button", { className: "ghbtn primary", textContent: "Finish setting up", hidden: true });
    finish.onclick = () => open(roleOf(s));
    if (s.rig?.charterStub) finish.hidden = false;
    else {
      getStaffProgress(s.handle)
        .then((p) => {
          if (p.app === false || p.ran === false) finish.hidden = false;
        })
        .catch(() => {});
    }

    d.append(
      el("div", { className: "row", style: "margin-top:10px" }, [finish, write, app, cred, run, go, status]),
    );
    return d;
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

/** The flow's view of somebody already hired. */
function roleOf(s) {
  return { handle: s.handle, name: s.name, dir: s.dir };
}
