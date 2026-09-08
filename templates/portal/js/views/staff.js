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
import { ago, el, esc } from "../dom.js";
import { icon } from "../icons.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";

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
    d.append(el("div", { className: "row", style: "margin-top:10px" }, [go, status]));
    return d;
  }

  /* ------------------------------- hiring -------------------------------- */

  function hireForm(host) {
    const box = el("div", { className: "card" });
    box.append(
      el("h3", { textContent: "Hire someone" }),
      el("p", {
        className: "sub",
        style: "margin-bottom:14px",
        textContent:
          "Only the handle is required. Everything else is copied from whoever is already " +
          "here, because app slugs carry a house naming scheme and the public identity is " +
          "genuinely shared.",
      }),
    );

    const handle = field("handle", "cfo", "lowercase, digits and dashes");
    const name = field("name", "Chief Financial Officer", "defaults to the handle, uppercased");
    const dir = field("dir", "finance", "directory and repo name; defaults to the handle");
    const schedule = field("schedule", "0 9 * * 1-5", "defaults to a slot clear of everyone else");
    for (const f of [handle, name, dir, schedule]) box.append(f.row);

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
      for (const [key, f] of [["name", name], ["dir", dir], ["schedule", schedule]]) {
        if (f.input.value.trim()) params.set(key, f.input.value.trim());
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
      box.append(line("ok", p.dir + "/staff.yaml gains a peer entry and a " + p.label + " label"));
    }
    box.append(line("ok", "org.yaml gains a staff entry and a repo entry"));

    if (plan.secrets?.length) {
      box.append(el("div", { className: "planhead", textContent: "You will still have to" }));
      box.append(
        line("todo", "create the GitHub App: roster app " + s.handle),
        line("todo", "put " + plan.secrets.join(", ") + " on the new repo"),
      );
    }
    for (const w of plan.warnings ?? []) box.append(line("warn", w));

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn primary", textContent: "Hire " + s.handle });
    go.onclick = () =>
      apply(
        {
          action: "hire",
          handle: s.handle,
          flags: Object.fromEntries(params),
        },
        "Create " + s.brain + " and wire it up?\n\nThis creates a repository on GitHub.",
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
        "Retire " + plan.name + "?\n\n" + (plan.brain ?? plan.dir) + " is not touched.",
        go,
        status,
        box,
      );
    box.append(el("div", { className: "row", style: "margin-top:14px" }, [go, cancel, status]));
    host.replaceChildren(box);
  }

  /* -------------------------------- apply -------------------------------- */

  async function apply(payload, ask, btn, status, box) {
    if (!confirm(ask)) return;
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

const MARK = { ok: "check", stop: "closed", keep: "issue-open", todo: "dash", warn: "label" };

function line(kind, text) {
  const d = el("div", { className: "planline " + kind });
  d.append(icon(MARK[kind] ?? "dot", "ic"), el("span", { textContent: text }));
  return d;
}
