/**
 * The labels roster itself owns on every tracker.
 *
 * An ask on the human carries exactly one kind, and the portal sorts what needs them by it:
 * a `decision` to rule on, a `review` to read or approve, a `chore` only they can do.
 * `keep-open` marks a standing thread that a sweep must never close.
 */
export const ASK_KINDS = ["decision", "review", "chore"] as const;
export const KEEP_OPEN = "keep-open";
export const OWNED_LABELS: readonly string[] = [...ASK_KINDS, KEEP_OPEN];

/** Whether an issue's labels name exactly one ask kind. */
export function askKinds(labels: string[]): string[] {
  return labels.filter((l) => (ASK_KINDS as readonly string[]).includes(l));
}
