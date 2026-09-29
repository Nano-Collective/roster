/* Copy a prompt, paste it into whatever you use, paste the answer back.
 *
 * The two files nothing can generate — org/business.md and every CHARTER.md — have always been
 * handed off with "paste this into your AI". The half that was missing is the way back: the
 * model has no filesystem, so its answer is a message, and a message has to become a file.
 *
 * Nothing here writes. The panel parses, shows a diff, and waits for a second click. */

import { getBrief, parsePaste, saveFile } from "../api.js";
import { mdlite } from "../md.js";
import { el, toClipboard } from "../dom.js";
import { unifiedDiff, diffStat } from "../textdiff.js";

/**
 * @param {{kind: string, staff?: string, title?: string, onSaved?: () => void}} opts
 */
export function paste(opts) {
  const box = el("div", { className: "paste" });
  if (opts.title !== "") box.append(el("h3", { textContent: opts.title ?? "Write it with your own AI" }));

  const status = el("p", { className: "sub", textContent: "Building the prompt…" });
  box.append(status);

  /* A charter brief carries a worked example to model the shape on, matched to the role. The
     choice is on the page because the match is a guess, and "none" is a fair answer. */
  const model = el("select", { hidden: true });
  const modelRow = el("label", { className: "sub", hidden: true }, ["Example to follow: ", model]);
  box.append(modelRow);

  const actions = el("div", { className: "row" });
  const copy = el("button", { className: "btn primary", textContent: "Copy the prompt" });
  const show = el("button", { className: "btn", textContent: "Show it" });
  actions.append(copy, show);
  box.append(actions);

  const preview = el("pre", { className: "briefpreview", hidden: true });
  box.append(preview);

  const answer = el("textarea", {
    className: "pastebox",
    placeholder:
      "Paste its whole reply here.",
  });
  answer.rows = 8;

  const check = el("button", { className: "btn", textContent: "Check the answer", disabled: true });
  const result = el("div", { className: "pasteresult" });

  let brief = null;

  const NAMES = { cto: "the CTO example", cmo: "the CMO example", support: "the support example", none: "no example" };
  model.onchange = () => {
    copy.disabled = true;
    getBrief(opts.kind, opts.staff, model.value)
      .then((data) => {
        if (data.error) throw new Error(data.error);
        brief = data;
        if (!preview.hidden) preview.textContent = brief.text;
      })
      .catch((err) => {
        status.className = "err";
        status.textContent = String(err.message || err);
      })
      .finally(() => {
        copy.disabled = false;
      });
  };

  getBrief(opts.kind, opts.staff)
    .then((data) => {
      if (data.error) throw new Error(data.error);
      brief = data;
      if (data.examples) {
        model.replaceChildren(...data.examples.map((e) => el("option", { value: e, textContent: NAMES[e] ?? e })));
        model.value = data.example ?? "none";
        model.hidden = modelRow.hidden = false;
      }
      status.textContent =
        "Copy the prompt into Claude or ChatGPT and answer its questions.";
      box.append(
        el("p", { className: "sub", textContent: "Then paste its reply here:" }),
        answer,
        el("div", { className: "row" }, [check]),
        result,
      );
      check.disabled = false;
    })
    .catch((err) => {
      status.className = "err";
      status.textContent = String(err.message || err);
      copy.disabled = show.disabled = true;
    });

  copy.onclick = () => brief && toClipboard(brief.text, copy, "Copied");
  show.onclick = () => {
    preview.hidden = !preview.hidden;
    preview.textContent = brief?.text ?? "";
    show.textContent = preview.hidden ? "Show it" : "Hide it";
  };

  check.onclick = async () => {
    result.replaceChildren(el("p", { className: "sub", textContent: "Reading…" }));
    let data;
    try {
      data = await parsePaste(opts.kind, opts.staff, answer.value);
    } catch (err) {
      result.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
      return;
    }
    result.replaceChildren();

    /* Problems first, each with the sentence that gets a better answer. A model that replied in
       prose is the common case and it is not the person's mistake, so it reads as a next step
       rather than as an error. */
    for (const p of data.problems ?? []) {
      const note = el("div", { className: "problem" });
      note.append(el("b", { textContent: p.message }));
      if (p.retry) {
        const retry = el("pre", { className: "cmd", textContent: p.retry });
        const again = el("button", { className: "btn", textContent: "Copy this reply" });
        again.onclick = () => toClipboard(p.retry, again, "Copied");
        note.append(retry, again);
      }
      result.append(note);
    }

    // What the AI said around the file: its caveats and "check these" are worth reading first.
    const notes = String(answer.value ?? "")
      .replace(/<<<ROSTER FILE [^>]+>>>[\s\S]*?<<<ROSTER END>>>/g, "")
      .trim();

    for (const file of data.files ?? []) {
      const card = el("div", { className: "pastefile" });
      const name = file.path.split("/").slice(-2).join("/");
      if (file.unchanged) {
        card.append(el("p", { className: "verdict", textContent: "✓ Same as what's already in " + name + ". Nothing to save." }));
        result.append(card);
        continue;
      }
      card.append(
        el("p", {
          className: "verdict" + (file.writable ? " ok" : " bad"),
          textContent: file.writable
            ? "✓ Looks good. Saving replaces " + name + " with this:"
            : "✗ " + file.path + " can't be written from here.",
        }),
      );
      card.append(el("div", { className: "md doc pastepreview", innerHTML: mdlite(file.text) }));

      if (notes) {
        const said = el("details", { className: "pastenotes", open: true });
        said.append(el("summary", { textContent: "Your AI also said" }), el("div", { className: "md doc", innerHTML: mdlite(notes) }));
        card.append(said);
      }

      const diff = el("pre", { className: "diff", hidden: true });
      diff.textContent = unifiedDiff(file.before, file.text, file.path);
      const stat = diffStat(file.before, file.text);
      const toggle = el("button", { className: "ghbtn", textContent: `Show changes (+${stat.added} −${stat.removed})` });
      toggle.onclick = () => {
        diff.hidden = !diff.hidden;
        toggle.textContent = (diff.hidden ? "Show changes" : "Hide changes") + ` (+${stat.added} −${stat.removed})`;
      };

      const row = el("div", { className: "row" });
      if (file.writable) {
        const save = el("button", { className: "btn primary", textContent: "Save" });
        save.onclick = async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await saveFile(file.path, file.text, `portal: write ${file.path}`);
            save.textContent = "Saved";
            card.classList.add("saved");
            opts.onSaved?.();
          } catch (err) {
            save.disabled = false;
            save.textContent = "Save";
            card.append(el("p", { className: "err", textContent: String(err.message || err) }));
          }
        };
        row.append(save);
      }
      row.append(toggle);
      card.append(row, diff);
      result.append(card);
    }

    if (!(data.problems ?? []).length && !(data.files ?? []).length) {
      result.append(el("p", { className: "verdict bad", textContent: "✗ No file found in that reply." }));
    }
  };

  return box;
}
