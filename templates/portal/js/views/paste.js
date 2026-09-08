/* Copy a prompt, paste it into whatever you use, paste the answer back.
 *
 * The two files nothing can generate — org/business.md and every CHARTER.md — have always been
 * handed off with "paste this into your AI". The half that was missing is the way back: the
 * model has no filesystem, so its answer is a message, and a message has to become a file.
 *
 * Nothing here writes. The panel parses, shows a diff, and waits for a second click. */

import { getBrief, parsePaste, saveFile } from "../api.js";
import { el, toClipboard } from "../dom.js";
import { unifiedDiff, diffStat } from "../textdiff.js";

/**
 * @param {{kind: string, staff?: string, title?: string, onSaved?: () => void}} opts
 */
export function paste(opts) {
  const box = el("div", { className: "paste" });
  box.append(el("h3", { textContent: opts.title ?? "Write it with your own AI" }));

  const status = el("p", { className: "sub", textContent: "Building the prompt…" });
  box.append(status);

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
      "Paste the whole reply here, including anything your AI said around the file. " +
      "Only the part between the sentinels is used.",
  });
  answer.rows = 8;

  const check = el("button", { className: "btn", textContent: "Check the answer", disabled: true });
  const result = el("div", { className: "pasteresult" });

  let brief = null;

  getBrief(opts.kind, opts.staff)
    .then((data) => {
      if (data.error) throw new Error(data.error);
      brief = data;
      status.textContent =
        "Paste this into Claude, ChatGPT or anything else. It carries every file it refers to, " +
        "so there is nothing to attach and nothing for it to ask you for. It will interview you " +
        "first, then hand back the finished file.";
      box.append(
        el("p", { className: "sub", textContent: "Then paste its whole reply back here:" }),
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

    for (const file of data.files ?? []) {
      if (file.unchanged) continue;
      const card = el("div", { className: "pastefile" });
      const stat = diffStat(file.before, file.text);
      card.append(
        el("b", { textContent: file.path }),
        el("span", {
          className: "meta",
          textContent: `+${stat.added} −${stat.removed}` + (file.writable ? "" : " · not writable"),
        }),
      );
      const diff = el("pre", { className: "diff" });
      diff.textContent = unifiedDiff(file.before, file.text, file.path);
      card.append(diff);

      if (file.writable) {
        const save = el("button", { className: "btn primary", textContent: "Save and commit" });
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
            save.textContent = "Save and commit";
            card.append(el("p", { className: "err", textContent: String(err.message || err) }));
          }
        };
        card.append(save);
      }
      result.append(card);
    }

    if (!(data.problems ?? []).length && !(data.files ?? []).length) {
      result.append(el("p", { className: "sub", textContent: "Nothing to do." }));
    }
  };

  return box;
}
