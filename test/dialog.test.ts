import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error a portal module, plain JS with no types
import { askYes, onBackdrop } from "../templates/portal/js/dialog.js";

/**
 * Closing a dialog by clicking away from it, and the one case where that is wrong.
 *
 * Picking a name from the `@` list closed the whole reply dialog and threw away what had been
 * typed. The list hides itself on mousedown, so the caret survives the pick; by the time the
 * `click` arrives the row it was on no longer exists and the event retargets to the nearest
 * thing still under the pointer, which is the dialog. `e.target === box` reads that as a click
 * on the backdrop.
 *
 * The distinguishing fact is the pointer: a retargeted click is over the dialog, a backdrop
 * click is not.
 */

const RECT = { left: 200, top: 100, right: 800, bottom: 600 };

/** A click as the handler sees it: attached to the dialog, so currentTarget is the dialog. */
const clickAt = (x: number, y: number, over: unknown = "dialog") =>
  ({ currentTarget: "dialog", target: over, detail: 1, clientX: x, clientY: y }) as never;

test("a click beyond the dialog is the backdrop", () => {
  assert.equal(onBackdrop(clickAt(50, 300), RECT), true, "to the left");
  assert.equal(onBackdrop(clickAt(900, 300), RECT), true, "to the right");
  assert.equal(onBackdrop(clickAt(400, 20), RECT), true, "above");
  assert.equal(onBackdrop(clickAt(400, 700), RECT), true, "below");
});

test("a click retargeted onto the dialog is not the backdrop", () => {
  /* The bug, as a test: target is the dialog, because the row under the pointer vanished, but
     the pointer is in the middle of the box. Closing here loses the reply. */
  assert.equal(onBackdrop(clickAt(500, 350), RECT), false);
  // And the edges count as inside, so a click on the dialog's own border does not dismiss it.
  assert.equal(onBackdrop(clickAt(200, 100), RECT), false, "top left corner");
  assert.equal(onBackdrop(clickAt(800, 600), RECT), false, "bottom right corner");
});

test("a click on something inside the dialog is not the backdrop either", () => {
  // A button in the dialog: the target is the button, so this never reaches the geometry.
  assert.equal(onBackdrop(clickAt(50, 300, "button"), RECT), false);
});

test("a keyboard-synthesised click does not dismiss anything", () => {
  /* Enter on a focused control reports detail 0 and clientX/Y of 0, which is outside every
     dialog there has ever been. Without this, picking a mention with the keyboard would close
     the dialog for a completely different reason than picking it with the mouse did. */
  const keyed = { currentTarget: "d", target: "d", detail: 0, clientX: 0, clientY: 0 } as never;
  assert.equal(onBackdrop(keyed, RECT), false);
});

test("no rect means no decision", () => {
  // The test shim has no layout. Guessing "dismiss" there would be the worse guess.
  assert.equal(onBackdrop(clickAt(50, 300), undefined), false);
});

/* ------------------------------ asking before acting ------------------------------ */

/**
 * Enough of a DOM for one `<dialog>`: listeners that fire, and a close() that says so. The
 * portal's render shim has no dialog at all, which is why this lives here.
 */
function fakeDocument() {
  const made: any[] = [];
  const node = (tag: string): any => {
    const on: Record<string, Array<(e: unknown) => void>> = {};
    const n: any = {
      tagName: tag.toUpperCase(),
      children: [] as any[],
      append: (...k: any[]) => n.children.push(...k),
      addEventListener: (t: string, f: (e: unknown) => void) => {
        on[t] = [...(on[t] ?? []), f];
      },
      focus() {},
      remove() {},
      getBoundingClientRect: () => RECT,
    };
    if (tag === "dialog") {
      n.showModal = () => {
        n.open = true;
      };
      n.close = () => {
        n.open = false;
        for (const f of on.close ?? []) f({});
      };
      n.fire = (t: string, e: unknown) => {
        for (const f of on[t] ?? []) f(e);
      };
    }
    made.push(n);
    return n;
  };
  return { made, document: { createElement: node, body: node("body") } };
}

async function withDom<T>(fn: (made: any[]) => Promise<T>): Promise<T> {
  const g = globalThis as any;
  const was = { document: g.document, confirm: g.confirm };
  const dom = fakeDocument();
  g.document = dom.document;
  // A native confirm() anywhere on this path is the bug, so reaching one fails the test.
  g.confirm = () => {
    throw new Error("native confirm() was called");
  };
  try {
    return await fn(dom.made);
  } finally {
    g.document = was.document;
    g.confirm = was.confirm;
  }
}

const buttonIn = (made: any[], label: string) =>
  made.find((n) => n.tagName === "BUTTON" && n.textContent === label);

test("asking before a merge is a dialog on the page, and only its own button says yes", async () => {
  await withDom(async (made) => {
    const asked = askYes({
      title: "Merge acme/site #7?",
      hint: "It cannot be undone.",
      confirm: "Merge",
    });
    const box = made.find((n) => n.tagName === "DIALOG");
    assert.ok(box?.open, "the page's own dialog, opened modally");
    assert.ok(
      box.children.some((c: any) => c.textContent === "It cannot be undone."),
      "what will happen is said, not left to the title",
    );
    buttonIn(made, "Merge").onclick();
    assert.equal(await asked, true);
  });
});

test("Cancel, Escape and the backdrop are all no", async () => {
  await withDom(async (made) => {
    const cancelled = askYes({ title: "Retire cmo?" });
    buttonIn(made, "Cancel").onclick();
    assert.equal(await cancelled, false);
  });
  await withDom(async (made) => {
    // Escape closes a modal dialog natively, without either button.
    const escaped = askYes({ title: "Retire cmo?" });
    made.find((n) => n.tagName === "DIALOG").close();
    assert.equal(await escaped, false);
  });
  await withDom(async (made) => {
    const away = askYes({ title: "Retire cmo?" });
    const box = made.find((n) => n.tagName === "DIALOG");
    box.fire("click", { currentTarget: box, target: box, detail: 1, clientX: 10, clientY: 10 });
    assert.equal(await away, false);
  });
});
