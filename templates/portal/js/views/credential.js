/* The agent's credential, stored once for the org.
 *
 * The value goes from this box to the local server in a POST, and from there to gh on its
 * standard input. It is not kept in the page after it is sent, and nothing echoes it back. */

import { getCredential, storeCredential } from "../api.js";
import { el } from "../dom.js";

export function credentialPanel() {
  const box = el("div", { className: "manual" });
  box.append(el("b", { textContent: "Your agent's credential, once" }));
  const body = el("div");
  box.append(body);
  body.append(el("p", { className: "sub", textContent: "Looking at where it would go…" }));

  getCredential()
    .then((c) => draw(body, c))
    .catch((err) => body.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) })));
  return box;
}

function draw(body, c) {
  body.replaceChildren();
  if (c.howTo) body.append(el("p", { textContent: "Where to get one: " + c.howTo }));

  if (!c.brains.length) {
    body.append(
      el("p", {
        className: "sub",
        textContent:
          "Nothing reads it until somebody is hired, so this box opens once there is a staff " +
          "member. It is asked for once, not once per hire.",
      }),
    );
    return;
  }

  if (c.orgSecret) {
    body.append(
      el("p", {
        className: "sub",
        textContent:
          c.name + " is already an org secret, shared with " + c.orgSecret.visibility + " repos. " +
          "Each hire adds its brain to it. Paste a new one only to replace it.",
      }),
    );
  }

  body.append(
    el("p", {
      className: "sub",
      textContent:
        (c.plan.mode === "org"
          ? "Stored as one org secret, " + c.name + ", shared with " + c.brains.join(", ") + ". "
          : "Stored as " + c.name + " on each of " + c.brains.join(", ") + ", because " + c.plan.reason + ". ") +
        "It goes to gh on standard input and is never written to disk.",
    }),
  );

  const input = el("input", { type: "password", placeholder: c.name, autocomplete: "off" });
  input.style.width = "100%";
  const go = el("button", { className: "btn primary", textContent: "Store it" });
  const out = el("div", { style: "margin-top:9px" });
  body.append(input, el("div", { className: "row", style: "margin-top:9px" }, [go]), out);

  go.onclick = async () => {
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    go.disabled = true;
    out.replaceChildren(el("p", { className: "sub", textContent: "Storing…" }));
    try {
      const r = await storeCredential(value, false);
      input.value = "";
      if (!r.ok) throw new Error(r.error);
      out.replaceChildren(
        ...(r.fellBack ? [el("p", { className: "err", textContent: "The org secret was refused: " + r.fellBack })] : []),
        el("p", {
          textContent:
            r.mode === "org"
              ? "Stored once for the org, shared with " + r.repos.length + " brains."
              : "Stored on " + r.repos.join(", ") + ".",
        }),
      );
    } catch (err) {
      out.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    } finally {
      go.disabled = false;
    }
  };
}
