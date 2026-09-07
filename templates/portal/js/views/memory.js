/* The memory cards, in the brain's right pane.
 *
 * `mem:*` is everything, `mem:<section>` is one section, `fact:<slug>` is that fact's section
 * with the fact itself lit up.
 *
 * That last one used to happen silently: clicking a fact's name narrowed 111 cards to a
 * dozen and highlighted one, with nothing saying so and no way back. Hence the focus bar —
 * it names where you are, and every part of it is a way out.
 */

import { el, esc } from "../dom.js";
import { inline } from "../md.js";
import { S } from "../state.js";
import { matchesFact } from "./brain.js";

export function showMemory(viewer, s, key, pick) {
  const section = key.startsWith("mem:") ? key.slice(4) : null;
  const slug = key.startsWith("fact:") ? key.slice(5) : null;
  const target = slug ? s.facts.find((f) => f.slug === slug) : null;
  const q = S.fileQuery.trim().toLowerCase();

  let facts = s.facts;
  if (section && section !== "*") facts = facts.filter((f) => f.section === section);
  else if (target) facts = facts.filter((f) => f.section === target.section);
  else if (q) facts = facts.filter((f) => matchesFact(f, q));

  const here = section && section !== "*" ? section : target ? target.section : null;

  viewer.replaceChildren();

  if (here) viewer.append(focusBar(here, target, pick));

  viewer.append(
    el("div", {
      className: "meta",
      style: "margin-bottom:5px",
      textContent: "memory/INDEX.md · " + facts.length + " facts",
    }),
  );
  viewer.append(
    el("p", {
      className: "factsub",
      textContent: "Read in full at every boot. Deleting is the maintenance.",
    }),
  );

  if (!facts.length) {
    viewer.append(el("p", { className: "empty", textContent: "Nothing matches." }));
    return;
  }

  const host = el("div");
  let seen = null;
  for (const f of facts) {
    if (f.section !== seen && !here) {
      seen = f.section;
      host.append(el("div", { className: "sect", style: "padding-left:0", textContent: seen }));
    }
    const d = el("div", { className: "fact" + (slug === f.slug ? " lit" : "") });
    d.id = "fact-" + f.slug;
    d.innerHTML =
      '<span class="slug" data-goto="' + esc(f.slug) + '" title="Show just this fact">' +
        esc(f.slug) + "</span>" +
      (f.provenance ? '<span class="tag ' + esc(f.provenance) + '">' + esc(f.provenance) + "</span>" : "") +
      (f.note ? '<span class="notelink" data-note="' + esc(f.note) + '">' + esc(f.note) + "</span>" : "") +
      '<p class="stmt">' + inline(f.statement) + "</p>" +
      (f.consequence
        ? '<p class="so"><b>So:</b> ' + inline(f.consequence) + "</p>"
        : '<p class="so err">No <b>So:</b> — lint will flag this.</p>');
    host.append(d);
  }
  viewer.append(host);

  host.addEventListener("click", (e) => {
    const note = e.target.closest?.("[data-note]");
    if (note) {
      pick("memory/" + note.dataset.note);
      return;
    }
    const goto = e.target.closest?.("[data-goto]");
    if (!goto) return;
    // Clicking the fact you are already focused on is how you let go of it.
    pick(slug === goto.dataset.goto ? "mem:" + (target?.section ?? "*") : "fact:" + goto.dataset.goto);
  });

  if (slug) {
    const lit = host.querySelector(".lit");
    if (lit?.scrollIntoView) lit.scrollIntoView({ block: "center" });
  }
}

/** Where you are and how to leave. Every crumb is clickable and Escape clears the lot. */
function focusBar(section, target, pick) {
  const bar = el("div", { className: "focusbar" });
  bar.append(
    el("button", { className: "crumb", textContent: "All facts", onclick: () => pick("mem:*") }),
    el("span", { className: "sep", textContent: "›" }),
  );
  if (target) {
    bar.append(
      el("button", {
        className: "crumb",
        textContent: section,
        onclick: () => pick("mem:" + section),
      }),
      el("span", { className: "sep", textContent: "·" }),
      el("span", { className: "here", textContent: target.slug }),
    );
  } else {
    bar.append(el("span", { className: "here", textContent: section }));
  }
  bar.append(
    el("button", {
      className: "x",
      textContent: target ? "Show the whole section" : "Show all facts",
      onclick: () => pick(target ? "mem:" + section : "mem:*"),
    }),
  );

  /* Escape is what a person tries first, so it does the same thing the button does. Bound to
     the document because the focus is wherever they clicked, and removed when this pane is
     replaced — otherwise every repaint stacks another listener. */
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) return;
    if (!bar.isConnected) {
      removeEventListener("keydown", onKey);
      return;
    }
    e.preventDefault();
    pick("mem:*");
  };
  addEventListener("keydown", onKey);
  return bar;
}
