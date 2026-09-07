/* One indirection, so a view can ask for a repaint without importing the shell that owns it.
   app.js registers the real renderer at boot; views import `render` and `go`. */

import { S } from "./state.js";

let renderer = () => {};

export function onRender(fn) {
  renderer = fn;
}

export function render() {
  renderer();
}

/** Change some state and repaint. The one way a view navigates. */
export function go(patch) {
  Object.assign(S, patch);
  render();
}
