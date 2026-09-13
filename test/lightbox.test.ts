import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error a portal module, plain JS with no types
import { fitInside, maxScaleFor, zoomAbout } from "../templates/portal/js/lightbox.js";

/**
 * The arithmetic behind the lightbox.
 *
 * Everything else about it is visible the moment you open one. This is not: a zoom that drifts
 * off the point you aimed at looks like a zoom, and the only way to notice is to be trying to
 * read something and keep losing it. So the two pure functions are pinned here and the element
 * is left to the eye.
 */

const near = (a: number, b: number, why: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} !== ${b}`);

/** Where a point in image space lands on the stage, under a given transform. */
const project = (
  at: { scale: number; tx: number; ty: number },
  x: number,
  y: number,
): [number, number] => [at.tx + x * at.scale, at.ty + y * at.scale];

/** And back the other way: which point in image space is currently under (px, py). */
const unproject = (
  at: { scale: number; tx: number; ty: number },
  px: number,
  py: number,
): [number, number] => [(px - at.tx) / at.scale, (py - at.ty) / at.scale];

test("zooming keeps the pixel under the cursor under the cursor", () => {
  const at = { scale: 1, tx: 0, ty: 0 };
  const [px, py] = [300, 200];

  const zoomed = zoomAbout(at, 2.5, px, py);
  assert.equal(zoomed.scale, 2.5);

  // Whatever was at (px, py) before is at (px, py) after. That is the whole contract.
  const [wx, wy] = unproject(at, px, py);
  const [nx, ny] = project(zoomed, wx, wy);
  near(nx, px, "x drifted");
  near(ny, py, "y drifted");
});

test("it holds after a run of wheel events, not just one", () => {
  /* The reason scale and offset are kept as numbers rather than read back off the matrix: a
     dozen events is the normal case and error compounds. */
  let at = { scale: 0.7, tx: 40, ty: 12 };
  const [px, py] = [512, 301];
  const [wx, wy] = unproject(at, px, py);

  for (let i = 0; i < 40; i++) at = zoomAbout(at, i % 2 ? 1.1 : 1.07, px, py);

  const [nx, ny] = project(at, wx, wy);
  near(nx, px, "x drifted over 40 events");
  near(ny, py, "y drifted over 40 events");
});

test("it stops rather than running away in either direction", () => {
  let at = { scale: 1, tx: 0, ty: 0 };
  for (let i = 0; i < 100; i++) at = zoomAbout(at, 2, 0, 0, 4);
  assert.equal(at.scale, 4, "there is a ceiling, and it is the one passed in");

  for (let i = 0; i < 100; i++) at = zoomAbout(at, 0.5, 0, 0, 4);
  assert.equal(at.scale, 0.1, "and a floor");
});

test("a zoom that changes nothing returns the same transform, untouched", () => {
  const at = { scale: 4, tx: 5, ty: 6 };
  assert.equal(zoomAbout(at, 2, 100, 100, 4), at, "at the stop, nothing moves either");
});

/* -------------------------- how far in it will go ------------------------- */

test("the ceiling is bounded by what the compositor has to render", () => {
  /* Not a hypothetical. A flat ceiling of 16 turned a 1544x784 screenshot into a
     310-megapixel layer and froze the tab for the best part of a minute. */
  const shot = maxScaleFor({ width: 1544, height: 784 });
  const rendered = 1544 * 784 * shot * shot;
  assert.ok(rendered <= 16e6 + 1, `${Math.round(rendered / 1e6)}MP is too much to composite`);
  assert.ok(shot > 3, `${shot} is not enough to read fine print with`);
});

test("a small image can still be enlarged usefully", () => {
  // The budget would allow 40x for an icon; a cap keeps it somewhere sane instead.
  assert.equal(maxScaleFor({ width: 100, height: 100 }), 8);
});

test("actual size stays reachable however large the source is", () => {
  /* A photo straight off a camera already exceeds the budget at 1:1. Refusing to show it at
     actual size would be the wrong way to spend that limit: 100% is the whole point. */
  assert.equal(maxScaleFor({ width: 8000, height: 6000 }), 1);
});

test("a natural size of nothing does not produce an infinite ceiling", () => {
  assert.equal(maxScaleFor({ width: 0, height: 0 }), 8);
});

test("fitting centres the image and shows all of it", () => {
  // A portal screenshot in the portal's own lightbox. Height is the binding dimension here.
  const at = fitInside({ width: 1544, height: 784 }, { width: 1392, height: 666 });
  assert.ok(at.scale < 1);
  near(784 * at.scale, 666, "the binding dimension fits exactly");
  assert.ok(1544 * at.scale <= 1392 + 1e-9, "and the other one fits inside");
  near(at.ty, 0, "no slack in the direction that binds");
  near(at.tx, (1392 - 1544 * at.scale) / 2, "the slack in the other is split evenly");
});

test("a small image is centred, not blown up", () => {
  const at = fitInside({ width: 200, height: 100 }, { width: 1392, height: 666 });
  assert.equal(at.scale, 1, "enlarging a small picture to fill the window makes it worse");
  near(at.tx, (1392 - 200) / 2, "centred across");
  near(at.ty, (666 - 100) / 2, "and down");
});

test("a missing natural size is not a division by zero", () => {
  // An image asked about before it has loaded reports 0x0, and reset() runs on `load` anyway.
  const at = fitInside({ width: 0, height: 0 }, { width: 0, height: 0 });
  assert.ok(Number.isFinite(at.scale) && Number.isFinite(at.tx) && Number.isFinite(at.ty));
});

test("gallery tiles are not caught by the selector, and rendered documents are", () => {
  /* A gallery tile already has a click, which opens the file; the file's own view is marked
     `zoomable` and is what the lightbox catches instead. Asserted on the source because the
     selector is a string the DOM shim cannot evaluate. */
  const root = join(import.meta.dirname, "..", "templates", "portal");
  const src = readFileSync(join(root, "js", "lightbox.js"), "utf8");
  assert.match(src, /SELECTOR = "\.md img, img\.zoomable"/);

  const files = readFileSync(join(root, "js", "views", "files.js"), "utf8");
  assert.match(files, /className: "zoomable"/, "the file viewer's image opts in");
  const gallery = files.slice(files.indexOf('className: "gallery"'));
  assert.doesNotMatch(gallery, /zoomable/, "the tiles above it do not");
});
