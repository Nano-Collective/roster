/**
 * Telling a file that was written from a file that was only scaffolded.
 *
 * `roster doctor` has always reported `CHARTER.md` as present when it is the stub, which is
 * correct for what that check is — the file exists — and useless as a gate. The two files
 * nothing can generate are exactly the two that fail silently: nothing errors, the run works,
 * and the output is competent-looking work about a business that does not exist.
 *
 * The test is the shipped sentences rather than anything clever. A real charter can say almost
 * anything, and a heuristic that guessed at quality would reject good work; these only fire
 * while the scaffold's own words are still sitting there.
 */

/** Sentences that only appear in a file nobody has answered yet. */
const MARKERS = [
  "**This file is a stub",
  "This file is a stub, and it is the most important file in this repo",
  "This file is a stub, and everything the staff say is downstream of it",
  "The headings below are the shape that has worked; the words are yours",
  "Write it with your own AI",
  "One paragraph. What this role is for, in this business specifically.",
  "Not a segment. The person, what they were doing ten minutes before they arrived",
  "The single thing this staff member is optimising",
  "Or answer these by hand. Short is better than complete.",
];

/** Empty, absent, or still carrying the scaffold's own guidance. */
export function looksUnwritten(body: string): boolean {
  if (!body.trim()) return true;
  return MARKERS.some((marker) => body.includes(marker));
}
