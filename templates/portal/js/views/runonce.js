/* One daily run, now, followed to the end.
 *
 * The last step of setting anybody up. Doctor calls a workflow that has never run unproven,
 * because nothing short of a finished run shows the App, its grant, the secrets and the
 * callers all work together. This starts one, and says how it ended. */

import { runStatus, startRun } from "../api.js";
import { el } from "../dom.js";

/**
 * @param {{staff: string, name: string, onDone?: (ok: boolean) => void}} opts
 */
export function runOnce(opts) {
  const box = el("div", { className: "manual" });
  box.append(
    el("b", { textContent: "Run " + opts.name + " once, now" }),
    el("p", {
      className: "sub",
      textContent:
        "A real daily run: it does a day's work and spends what a scheduled one would. " +
        "When it finishes you get the outcome and the log.",
    }),
  );
  const go = el("button", { className: "btn primary", textContent: "Run once now" });
  const out = el("div", { style: "margin-top:9px" });
  box.append(el("div", { className: "row" }, [go]), out);

  go.onclick = async () => {
    if (!confirm("Start a daily run for " + opts.name + " now?\n\nIt is a real run, and it costs what one does.")) return;
    go.disabled = true;
    const say = (text, cls) => out.replaceChildren(el("p", { className: cls ?? "sub", textContent: text }));
    say("Starting…");
    let run;
    try {
      run = await startRun(opts.staff);
    } catch (err) {
      say(String(err.message || err), "err");
      go.disabled = false;
      return;
    }
    const link = el("a", { href: run.url, target: "_blank", rel: "noopener", textContent: "the log" });
    if (!run.id) {
      out.replaceChildren(el("p", { className: "sub" }, ["Started. It has not shown up yet; follow it at ", link, "."]));
      go.disabled = false;
      return;
    }

    /* Polled rather than streamed: a run takes minutes, the status changes a handful of times,
       and a clock beside it is what shows the page has not hung. */
    const began = Date.now();
    const tick = async () => {
      let now;
      try {
        now = await runStatus(opts.staff, run.id);
        if (now.error) throw new Error(now.error);
      } catch (err) {
        say(String(err.message || err), "err");
        go.disabled = false;
        return;
      }
      const mins = Math.floor((Date.now() - began) / 60000);
      if (now.status !== "completed") {
        out.replaceChildren(
          el("p", { className: "sub" }, [now.status.replace("_", " ") + ", " + mins + " min so far. ", link]),
        );
        setTimeout(tick, 15000);
        return;
      }
      go.disabled = false;
      const ok = now.conclusion === "success";
      const done = el("div");
      done.append(
        el("p", { className: ok ? "" : "err" }, [
          ok
            ? "It worked. The App, its grant, the secrets and the callers are proven, and Health now says so. "
            : "It ended " + (now.conclusion || "without a conclusion") + ". ",
          el("a", { href: now.url, target: "_blank", rel: "noopener", textContent: "The log" }),
        ]),
      );
      for (const f of now.failedAt ?? []) done.append(el("p", { className: "sub", textContent: "Failed at " + f }));
      if (!ok) done.append(el("p", { className: "sub", textContent: "Troubleshooting, in the docs, has what each failure usually means." }));
      out.replaceChildren(done);
      opts.onDone?.(ok);
    };
    tick();
  };
  return box;
}
