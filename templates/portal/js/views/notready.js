/* What a screen says about a staff member who cannot run yet.
 *
 * Every screen with a button that wakes somebody (Run now, Run once now, a new issue, a
 * mention) used to offer it to a staff member with no App or no credential, and the run it
 * started failed where nobody was looking. One note, the same everywhere: what is left, and on
 * a hosted portal the command for each step, since setting up is only done on your machine. */

import { el, toClipboard } from "../dom.js";
import { canRun, IN_PORTAL, ROSTER, sentence, stepCommand, whatsLeft } from "../readiness.js";
import { go } from "../router.js";
import { S } from "../state.js";

/** One roster command, with a Copy button. */
export function commandLine(cmd) {
  const text = `${ROSTER} ${cmd}`;
  const copy = el("button", { className: "ghbtn", textContent: "Copy" });
  copy.onclick = () => toClipboard(text, copy, "Copy");
  return el("div", { className: "connline" }, [el("code", { textContent: text }), copy]);
}

/** The note, or null when they can run (or it is not known yet). */
export function notReadyNote(s) {
  if (canRun(s.handle)) return null;
  const left = S.readiness[s.handle];
  const box = el("div", { className: "warnline notready" }, [
    el("span", {
      textContent: `${s.name} is not set up yet, so nothing will start them. Still to do: ${sentence(left)}.`,
    }),
  ]);
  if (!S.hosted) {
    // On your machine the steps are a click away, on Staff.
    const finish = el("button", { className: "ghbtn primary", textContent: "Finish setting up" });
    finish.onclick = () => {
      S.staffOpen = { handle: s.handle, name: s.name, dir: s.dir };
      go({ view: "staff" });
    };
    box.append(el("div", { className: "row" }, [finish]));
  } else {
    // The charter is writing, which works from here; the rest needs your machine.
    if (left.includes("write the charter")) {
      const write = el("button", { className: "ghbtn primary", textContent: "Write the charter" });
      write.onclick = () => {
        S.writeCharter = s.handle;
        go({ view: "staff" });
      };
      box.append(el("div", { className: "row" }, [write]));
    }
    const seen = new Set();
    for (const what of left) {
      if (IN_PORTAL.has(what)) continue;
      const cmd = stepCommand(what, s.handle);
      if (!cmd || seen.has(cmd)) continue;
      seen.add(cmd);
      box.append(commandLine(cmd));
    }
  }
  return box;
}

/**
 * A slot filled once their readiness is known: at once when it is, or when GitHub answers.
 * Landing straight on a screen used to find nothing known yet and nothing that asked.
 */
export function whenKnown(s, fill) {
  const slot = el("div", { className: "readyslot" });
  const paint = () => slot.replaceChildren(...[fill()].flat().filter(Boolean));
  if (S.readiness?.[s.handle]) paint();
  else whatsLeft(s).then(paint, paint);
  return slot;
}
