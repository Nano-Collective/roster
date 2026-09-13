import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error a portal module, plain JS with no types
import { onBackdrop } from "../templates/portal/js/dialog.js";

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
