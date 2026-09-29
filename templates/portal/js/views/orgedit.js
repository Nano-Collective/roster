/* Ways to write the two org files a person has to write, shared by Getting started and the Org
 * screen: plain questions, an AI interview, or the file itself. Each is one tab of a switcher,
 * so the choice is visible rather than folded under a Save button. */

import { fileUrl, saveFile } from "../api.js";
import { el, grow } from "../dom.js";
import { highlighted } from "../mdedit.js";
import { paste } from "./paste.js";

const BUSINESS_QUESTIONS = [
  ["line", "What does it do, in one line?", "What this business does, in one line", true],
  ["who", "Who is it for?", "Who the customers are, specifically", true],
  ["key", "What does everything depend on?", "The one fact everything else follows from", false],
  ["true", "What's already true? What's built, measured or tried?", "What is already true", false],
  ["not", "What should staff never decide on their own?", "What is not ours to decide", false],
];

const val = (input) => String(input.value ?? "").trim();

/* A file still in the shape it shipped in holds the questions, not answers, and pre-filling the
   fields with "Not a segment. The person…" reads as if somebody had already answered them. */
const isStub = (text) => /This file is a stub|Or answer these by hand/.test(text);

/**
 * org/business.md as five questions. With `text`, the answers already in the file fill the
 * fields, so changing one answer does not mean retyping the other four.
 * @param {{path: string, name: string, text?: string, onSaved: () => void, before?: object[]}} o
 *   `before` puts extra tabs ahead of the three, which is how the Org screen adds Read.
 */
export function businessForm(o) {
  const form = el("div");
  const known = isStub(o.text ?? "") ? new Map() : sections(o.text ?? "");
  const fields = BUSINESS_QUESTIONS.map(([id, label, heading, required]) => {
    const input = id === "line" ? el("input", { type: "text" }) : el("textarea", { className: "pastebox", rows: 3 });
    const had = known.get(heading.toLowerCase());
    if (had) input.value = had.replace(/^>\s?/gm, "");
    return { id, input, wrap: el("label", { className: "qfield" }, [el("span", { textContent: label + (required ? "" : " (optional)") }), input]) };
  });
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  form.append(...fields.map((f) => f.wrap), el("div", { className: "row" }, [save]), out);

  save.onclick = async () => {
    const missing = fields.find((f, i) => BUSINESS_QUESTIONS[i][3] && !val(f.input));
    if (missing) {
      missing.input.focus?.();
      out.replaceChildren(el("p", { className: "err", textContent: "Answer the first two at least." }));
      return;
    }
    const text =
      `# What ${o.name} is\n\n` +
      fields
        .map((f, i) => [BUSINESS_QUESTIONS[i][2], val(f.input)])
        .filter(([, v]) => v)
        .map(([h, v]) => `## ${h}\n\n${v}\n`)
        .join("\n");
    await saveAndSay(save, out, o.path, text, "portal: write org/business.md", o.onSaved);
  };

  return modes([
    ...(o.before ?? []),
    { label: "Answer questions", node: form },
    { label: "Let an AI interview you", node: paste({ kind: "discover", title: "", onSaved: o.onSaved }) },
    rawMode(o.path, o.onSaved),
  ]);
}

/** org/priorities.md as three lines and an out-of-scope list, filled from the file if it has them. */
export function prioritiesForm(o) {
  const form = el("div");
  const { items, outs } = isStub(o.text ?? "") ? { items: [], outs: [] } : parsePriorities(o.text ?? "");
  const ranks = [1, 2, 3].map((i) => {
    const input = el("input", { type: "text", placeholder: i === 1 ? "e.g. Tasks can be ticked off and removed" : "" });
    if (items[i - 1]) input.value = items[i - 1];
    return { input, wrap: el("label", { className: "qfield" }, [el("span", { textContent: "Priority " + i + (i > 1 ? " (optional)" : "") }), input]) };
  });
  const scope = el("textarea", { className: "pastebox", rows: 3, placeholder: "One per line" });
  if (outs.length) scope.value = outs.join("\n");
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  form.append(
    ...ranks.map((r) => r.wrap),
    el("label", { className: "qfield" }, [el("span", { textContent: "Out of scope this month (optional)" }), scope]),
    el("div", { className: "row" }, [save]),
    out,
  );
  save.onclick = async () => {
    const list = ranks.map((r) => val(r.input)).filter(Boolean);
    if (!list.length) {
      ranks[0].input.focus?.();
      out.replaceChildren(el("p", { className: "err", textContent: "Add at least one priority." }));
      return;
    }
    const scoped = val(scope).split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    const text =
      "## What matters this month\n\n### Priorities, in order\n\n" +
      list.map((t, i) => `${i + 1}. ${t}`).join("\n") +
      "\n" +
      (scoped.length ? "\n### Out of scope this month\n\n" + scoped.map((t) => `- ${t}`).join("\n") + "\n" : "");
    await saveAndSay(save, out, o.path, text, "portal: write org/priorities.md", o.onSaved);
  };
  return modes([
    ...(o.before ?? []),
    { label: "Fill in", node: form },
    { label: "Let an AI interview you", node: paste({ kind: "priorities", title: "", onSaved: o.onSaved }) },
    rawMode(o.path, o.onSaved),
  ]);
}

/** Any org file as highlighted text, with Read ahead of it on the Org screen. */
export function fileModes(o) {
  return modes([...(o.before ?? []), rawMode(o.path, o.onSaved, o.lang)]);
}

/** The file itself, for editing what is already there rather than starting again. */
export function rawMode(path, onSaved, lang = "md") {
  const node = el("div");
  const ta = el("textarea", { className: "pastebox" });
  ta.rows = 12;
  const save = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  const hl = highlighted(ta, lang);
  node.append(hl, el("div", { className: "row" }, [save]), out);
  ta.addEventListener("input", () => grow(ta));
  const commit = () =>
    saveAndSay(save, out, path, ta.value, "portal: edit " + path.split("/").slice(1).join("/"), onSaved);
  save.onclick = commit;
  // ⌘S is what a person's hands do in a text box.
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      commit();
    }
  });
  // Read when first shown, so it shows the file as it is then, not as it was at page load.
  const load = () =>
    // Not getFile: an absent file answers 404 with a message, and that is not what to edit.
    fetch(fileUrl(path), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        ta.value = text;
        grow(ta);
        hl.repaint();
      });
  return { label: "Edit the file", node, onShow: load };
}

/** Ways to do one thing, as a switcher across the top: one shown at a time. */
export function modes(list) {
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
    onSaved?.();
  } catch (err) {
    out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** `## Heading` → the text under it, by lower-cased heading. */
function sections(text) {
  const out = new Map();
  let key = null;
  let buf = [];
  const flush = () => key && out.set(key, buf.join("\n").trim());
  for (const line of text.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      flush();
      key = m[1].trim().toLowerCase();
      buf = [];
    } else if (key) buf.push(line);
  }
  flush();
  return out;
}

function parsePriorities(text) {
  const items = [];
  const outs = [];
  let where = "";
  for (const line of text.split("\n")) {
    if (/^#+\s.*priorit/i.test(line)) where = "p";
    else if (/^#+\s.*out of scope/i.test(line)) where = "o";
    else if (/^#/.test(line)) where = "";
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (where === "p" && n) items.push(n[1].trim());
    if (where === "o" && b) outs.push(b[1].trim());
  }
  return { items, outs };
}
