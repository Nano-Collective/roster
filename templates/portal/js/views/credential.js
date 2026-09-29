/* The agent's credential, stored once for the org.
 *
 * The value goes from this box to the local server in a POST, and from there to gh on its
 * standard input. It is not kept in the page after it is sent, and nothing echoes it back. */

import { getCredential, storeCredential } from "../api.js";
import { el } from "../dom.js";

/** @param opts.bare  drawn inside a step that already has a title. `onStatus(done)` hears whether one is stored. */
export function credentialPanel(opts = {}) {
  const box = el("div", { className: opts.bare ? "" : "manual" });
  if (!opts.bare) box.append(el("b", { textContent: "Agent credential" }));
  const body = el("div");
  box.append(body);
  body.append(el("p", { className: "sub", textContent: "Checking…" }));

  getCredential()
    .then((c) => {
      opts.onStatus?.(Boolean(c.stored ?? c.orgSecret));
      draw(body, c, opts);
    })
    .catch((err) => body.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) })));
  return box;
}

function draw(body, c, opts = {}) {
  body.replaceChildren();

  if (!(c.brains ?? []).length) {
    // Inside a step, the step's own hint already says when this opens.
    if (!opts.bare) body.append(el("p", { className: "sub", textContent: "Available after your first hire. You only add it once." }));
    return;
  }

  const form = el("div", { className: "credform" });
  const input = el("input", { type: "password", placeholder: "Paste it here", autocomplete: "off", className: "textfield" });
  const go = el("button", { className: "btn primary", textContent: "Save" });
  const out = el("div");
  form.append(
    ...(c.howTo ? [el("p", { className: "sub", textContent: "To get one, " + c.howTo })] : []),
    input,
    el("div", { className: "row" }, [go]),
    out,
  );

  // Stored already, on the org or on every brain repo: say so, and keep replacing it one click away.
  if (c.stored ?? c.orgSecret) {
    const replace = el("button", { className: "ghbtn", textContent: "Replace it" });
    replace.onclick = () => {
      replace.remove();
      form.hidden = false;
      input.focus?.();
    };
    form.hidden = true;
    body.append(el("p", { className: "okline", textContent: "✓ Stored as " + c.name + "." }), replace, form);
  } else {
    body.append(form);
  }

  go.onclick = async () => {
    const value = String(input.value ?? "").trim();
    if (!value) {
      input.focus?.();
      return;
    }
    go.disabled = true;
    go.textContent = "Saving…";
    try {
      const r = await storeCredential(value, false);
      input.value = "";
      if (!r.ok) throw new Error(r.error);
      opts.onStatus?.(true);
      out.replaceChildren(
        ...(r.fellBack ? [el("p", { className: "sub", textContent: "Saved on each repo instead: " + r.fellBack })] : []),
        el("p", { className: "okline", textContent: "✓ Saved." }),
      );
    } catch (err) {
      out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    } finally {
      go.disabled = false;
      go.textContent = "Save";
    }
  };
}
