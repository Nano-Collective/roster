/**
 * Where roster's own files are: the docs, the templates, the portal's pages.
 *
 * Normally found beside the running code, which is how an npm package works. A Worker has no
 * package directory, so it carries those files mounted at a path of its own and says so here
 * before anything asks.
 */
let root: string | null = null;

export function useFrameworkRoot(path: string | null): void {
  root = path;
}

/** The override, when there is one. Callers fall back to their own lookup without it. */
export function frameworkRoot(): string | null {
  return root;
}
