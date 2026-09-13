/* Looking properly at a picture.
 *
 * An image inside a document is laid out for the page it is in, which for a screenshot of a
 * user interface means unreadable: the thing you wanted to see is the small print. Every other
 * surface here has an answer for "show me that bigger" and this one did not.
 *
 * So any image the portal renders as *content* opens over the page, fitted to the window, and
 * zooms. Gallery tiles are deliberately not included: they already have a click, which opens
 * the file, and the file's own view is one of the images this does catch.
 *
 * Deliberately not a `<dialog>`. The rest of the portal uses one, and it is right for a form,
 * but this needs its own key handling, wheel handling and pointer capture, and `showModal`
 * brings a focus trap and a backdrop that then have to be worked around rather than used.
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";

/** Images that open. `.md img` is every rendered document; `zoomable` is opt-in elsewhere. */
const SELECTOR = ".md img, img.zoomable";

const MIN_SCALE = 0.1;

/**
 * How far in it will go, and why it is not just a number.
 *
 * A scaled `<img>` is a composited layer, and the compositor allocates it at the *rendered*
 * size. A flat ceiling of 16 turned a 1544x784 screenshot into a 310-megapixel layer, about
 * 1.2GB of texture, and froze the tab for the best part of a minute. That is not a zoom level
 * anybody asked for; it is a number that was never checked against a real picture.
 *
 * So the ceiling comes off the image. The budget is what may be rendered at once; the floor of
 * 1 keeps actual size reachable however large the source is, and the cap of 8 stops a 100px
 * icon being allowed to fill a wall.
 */
const MAX_RENDERED_PIXELS = 16e6;
const ABSOLUTE_MAX = 8;

export function maxScaleFor(natural) {
  const px = (natural.width || 1) * (natural.height || 1);
  return Math.min(ABSOLUTE_MAX, Math.max(1, Math.sqrt(MAX_RENDERED_PIXELS / px)));
}

let open = null;

/**
 * Zoom about a point, as arithmetic.
 *
 * The pixel under the cursor has to stay under the cursor. Without that the image drifts away
 * from whatever you were trying to look at, which is the difference between a zoom and a
 * nuisance, and it is the one part of this that is wrong in a way no screenshot shows.
 *
 * Pure, and separate from the element, so it can be checked rather than eyeballed.
 *
 * @param at     {scale, tx, ty}, the current transform
 * @param px,py  the fixed point, in stage coordinates
 * @param max    the ceiling, from `maxScaleFor`
 * @returns the new transform, or `at` unchanged when it is already against a stop
 */
export function zoomAbout(at, factor, px, py, max = ABSOLUTE_MAX) {
  const scale = Math.min(max, Math.max(MIN_SCALE, at.scale * factor));
  if (scale === at.scale) return at;
  const k = scale / at.scale;
  return { scale, tx: px - (px - at.tx) * k, ty: py - (py - at.ty) * k };
}

/**
 * The fitted transform: the whole thing visible, centred, and never enlarged to get there.
 *
 * Blowing a 200px image up to fill a 1400px window is not "fitting" it, it is making it worse,
 * so the scale is capped at 1 and a small picture sits small in the middle.
 */
export function fitInside(natural, stage) {
  const [w, h] = [natural.width || 1, natural.height || 1];
  const [bw, bh] = [stage.width || 1, stage.height || 1];
  const scale = Math.min(bw / w, bh / h, 1);
  return { scale, tx: (bw - w * scale) / 2, ty: (bh - h * scale) / 2 };
}

/**
 * One delegated listener, installed at boot.
 *
 * Per-image handlers would have to be attached by every render site, and there are four of
 * them: markdown in a doc page, markdown in a brain document, an image surface, and the file
 * viewer. A render that forgot would be an image that silently does not open, which is exactly
 * the sort of thing nobody notices for a month.
 */
export function installLightbox() {
  document.addEventListener?.("click", (e) => {
    const img = e.target?.closest?.(SELECTOR);
    if (!img || !img.currentSrc && !img.getAttribute?.("src")) return;
    // A picture inside a link is the link's to handle. Following it is what was asked for.
    if (img.closest("a")) return;
    e.preventDefault();
    show(img.currentSrc || img.getAttribute("src"), img.getAttribute("alt") || "");
  });

  /* Navigating away closes it. The overlay is appended to the body rather than into the view,
     so without this it outlives the page it was opened from: a doc image left open over the
     Inbox, with no obvious relationship to anything on screen. */
  addEventListener?.("hashchange", close);
}

/** Open one. Exported so a caller with a src and no element can use it too. */
export function show(src, alt = "") {
  close();

  const img = el("img", { src, alt, draggable: false });
  const stage = el("div", { className: "lbstage" }, [img]);

  const caption = alt ? el("figcaption", { className: "lbcap", textContent: alt }) : null;
  const shut = el("button", {
    className: "lbx",
    title: "Close (Esc)",
    "aria-label": "Close",
  }, [icon("close", "ic")]);
  const hint = el("span", {
    className: "lbhint",
    textContent: "scroll to zoom · drag to move · click to fit",
  });

  /* Zoom has always worked from the keyboard and the wheel. Neither is discoverable, and on a
     mouse without a usable wheel the keyboard was the only way in at all.
     The percentage is a button rather than a readout: "how big is this" and "put it back" are
     the same question, and it is the one control here that says what the state is. */
  const out = el("button", {
    className: "lbctl",
    title: "Zoom out (-)",
    "aria-label": "Zoom out",
  }, [icon("dash", "ic")]);
  const level = el("button", { className: "lbctl lblevel", title: "Fit to the window (0)" });
  const into = el("button", {
    className: "lbctl",
    title: "Zoom in (+)",
    "aria-label": "Zoom in",
  }, [icon("plus", "ic")]);
  const zoombar = el("div", { className: "lbzoom" }, [out, level, into]);

  const box = el("div", {
    className: "lightbox",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": alt || "image",
  }, [stage, shut, hint, zoombar, ...(caption ? [caption] : [])]);

  /* Scale and offset are kept here rather than read back off the transform, because reading a
     matrix back and re-deriving them accumulates error over a few dozen wheel events. */
  let scale = 1;
  let fit = 1;
  let ceiling = ABSOLUTE_MAX;
  let tx = 0;
  let ty = 0;

  const draw = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    box.dataset.zoomed = String(scale > fit * 1.001);
    /* Percentage of actual size, not of fitted: 100% has to mean one image pixel per screen
       pixel, or the number is about the window rather than about the picture. */
    level.textContent = `${Math.round(scale * 100)}%`;
    // Disabled at the stops, because a button that does nothing reads as a broken one.
    out.disabled = scale <= MIN_SCALE + 1e-9;
    into.disabled = scale >= ceiling - 1e-9;
  };

  const reset = () => {
    const natural = {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
    const at = fitInside(natural, stage.getBoundingClientRect?.() ?? { width: 0, height: 0 });
    fit = at.scale;
    ceiling = maxScaleFor(natural);
    ({ scale, tx, ty } = at);
    draw();
  };

  const zoomAt = (factor, px, py) => {
    ({ scale, tx, ty } = zoomAbout({ scale, tx, ty }, factor, px, py, ceiling));
    draw();
  };

  const centre = () => {
    const r = stage.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    return [r.width / 2, r.height / 2];
  };

  img.addEventListener("load", reset);
  if (img.complete) reset();

  box.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      // ctrl+wheel is what a trackpad pinch arrives as, and it comes in much larger steps.
      const step = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(Math.exp(-e.deltaY * step), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  /* Drag to pan, and the same gesture decides what a release means: a press that moved is a
     pan, a press that did not is a click. Without the distance test, panning an image always
     ended by toggling the zoom you had just set. */
  let from = null;
  let moved = false;
  img.addEventListener("pointerdown", (e) => {
    from = { x: e.clientX, y: e.clientY, tx, ty };
    moved = false;
    img.setPointerCapture?.(e.pointerId);
  });
  img.addEventListener("pointermove", (e) => {
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    tx = from.tx + dx;
    ty = from.ty + dy;
    draw();
  });
  img.addEventListener("pointerup", (e) => {
    const wasDrag = moved;
    from = null;
    img.releasePointerCapture?.(e.pointerId);
    if (wasDrag) return;
    // Fitted: go to actual size under the cursor. Zoomed at all: back to fitted.
    const r = stage.getBoundingClientRect();
    if (scale > fit * 1.001) reset();
    else zoomAt(1 / fit, e.clientX - r.left, e.clientY - r.top);
  });

  // The buttons zoom about the middle of the stage, which is the only fixed point they have.
  out.onclick = () => zoomAt(0.8, ...centre());
  into.onclick = () => zoomAt(1.25, ...centre());
  level.onclick = reset;

  // The backdrop is the way out, and the image is not the backdrop.
  box.addEventListener("pointerdown", (e) => {
    if (e.target === box || e.target === stage) close();
  });
  shut.onclick = close;

  const keys = (e) => {
    if (e.key === "Escape") return close();
    if (e.key === "0") return reset();
    if (e.key === "+" || e.key === "=") return zoomAt(1.25, ...centre());
    if (e.key === "-" || e.key === "_") return zoomAt(0.8, ...centre());
  };
  addEventListener("keydown", keys);

  const onResize = () => reset();
  addEventListener("resize", onResize);

  const returnTo = document.activeElement;
  open = { box, keys, onResize, returnTo };

  document.body.append(box);
  // The page behind must not scroll under an overlay: the scrollbar is still live otherwise,
  // and a wheel event that misses the image scrolls the document instead of zooming.
  document.body.dataset.lightbox = "1";
  shut.focus?.();
}

export function close() {
  if (!open) return;
  const { box, keys, onResize, returnTo } = open;
  open = null;
  removeEventListener("keydown", keys);
  removeEventListener("resize", onResize);
  box.remove?.();
  delete document.body.dataset.lightbox;
  returnTo?.focus?.();
}
