/* Creating a staff member's GitHub App, from the page you are already on.
 *
 * There is no API that creates a GitHub App. The only route is the manifest flow: post a
 * manifest to a settings page, a human confirms, GitHub hands back a one-time code. `roster app`
 * does that by standing up a second server on 4310; here it runs on the portal's own port, so
 * it is one browser, one origin, and nothing extra to explain.
 *
 * What it still cannot do is install the App. Installing is a grant of access to specific
 * repositories and GitHub asks a human to choose them, which is correct behaviour and should not
 * be worked around. */

import { appResult, startApp } from "../api.js";
import { el } from "../dom.js";

/**
 * @param {{staff: string, name: string, scope?: "private"|"public", onDone?: () => void}} opts
 */
export function appPanel(opts) {
  const scope = opts.scope ?? "private";
  const box = el("div", { className: "manual" });
  box.append(
    el("b", {
      textContent:
        scope === "public"
          ? "Create the shared public identity"
          : `Create ${opts.name}'s GitHub App`,
    }),
    el("p", {
      textContent:
        "A tab opens, GitHub asks you to confirm, and the App's id and private key go straight " +
        "into the repo's secrets. The key is held in memory and never written to disk.",
    }),
  );

  const go = el("button", { className: "btn primary", textContent: "Create the App" });
  const out = el("div", { style: "margin-top:9px" });
  box.append(el("div", { className: "row" }, [go]), out);

  go.onclick = async () => {
    go.disabled = true;
    out.replaceChildren(el("p", { className: "sub", textContent: "Preparing the hand-off…" }));
    let started;
    try {
      started = await startApp(opts.staff, scope);
    } catch (err) {
      go.disabled = false;
      /* The common failure is a name already taken, and the server sends the install URL with
         it: an App that exists is not a problem, it is a step you have already done. */
      const note = el("div");
      note.append(el("p", { className: "err", textContent: String(err.message || err) }));
      out.replaceChildren(note);
      return;
    }

    window.open(started.start, "_blank");
    out.replaceChildren(
      el("p", {
        className: "sub",
        textContent: "Confirm it in the tab that just opened. This will update when it lands.",
      }),
    );

    /* GitHub redirects the *other* tab back to this server, so there is no callback to await
       here. Polling for the result the callback recorded is the only thing this tab can do. */
    const started_at = Date.now();
    const tick = async () => {
      let result;
      try {
        result = await appResult(started.state);
      } catch {
        result = { pending: true };
      }
      if (result.pending) {
        if (Date.now() - started_at > 5 * 60 * 1000) {
          out.replaceChildren(
            el("p", {
              className: "sub",
              textContent:
                "Still waiting. If you finished in the other tab and nothing happened here, " +
                "reload — the App may well have been created.",
            }),
          );
          go.disabled = false;
          return;
        }
        setTimeout(tick, 2000);
        return;
      }

      go.disabled = false;
      if (!result.ok) {
        out.replaceChildren(el("p", { className: "err", textContent: String(result.error) }));
        return;
      }

      /* The install is the step that most often looks done and is not, so it is the loudest
         thing on the page once the App exists. */
      const done = el("div");
      done.append(
        el("p", { textContent: `${result.slug} created, and its secrets are set.` }),
        el("b", { textContent: "It still has to be installed." }),
        el("p", {
          className: "sub",
          textContent:
            "Grant it every tracker this staff member writes to, not just their own: the token " +
            "is minted organisation-wide and a peer's board is where a brief lands.",
        }),
        el("a", {
          className: "btn primary",
          href: result.install,
          target: "_blank",
          textContent: "Install it",
        }),
        el("p", {
          className: "sub",
          textContent:
            "Do not verify this by reading the API. It reports what an App declares separately " +
            "from what an installation was granted. Only a run that finished proves the chain.",
        }),
      );
      out.replaceChildren(done);
      opts.onDone?.();
    };
    setTimeout(tick, 2000);
  };

  return box;
}
