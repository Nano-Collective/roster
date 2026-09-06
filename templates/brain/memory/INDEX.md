# Memory index

**This is %%NAME%%'s memory. Read it at every boot, in full. It is the only file that is.**

One line per fact. The line is the fact; `So:` is what it changes. A few carry a note in
`notes/` where the argument is load-bearing and worth not re-deriving. Read a note only when
the fact is in play today.

**The five rules that keep this file usable:**

1. **One line per fact.** If it needs more, the extra goes in `notes/<slug>.md` and the line stays one line.
2. **Correct in place. Never append "updated:".** An update chain is how one fact became six paragraphs.
3. **Every fact says what it changes.** If you cannot write the `So:`, it is not memory. Do not add it.
4. **Measurements carry `n` and a date. Constraints do not expire; measurements do.** Anything with a `review:` date is re-read or deleted on that date.
5. **Deleting is the maintenance.** Cut every line that no longer changes a decision, and log the cut in `log/decisions.md`. A memory that only grows is a memory nobody reads.

The grammar, which `roster lint` enforces:

    - **`<slug>`** · [<%%HUMAN_MARKER%%|measured|derived>] <the fact, one line>. **So:** <what it changes>. · [note](notes/<slug>.md)

`log/decisions.md` = why things were decided. The pinned status issue = what is outstanding.
**Nothing is copied between them.**

---

## Ungrouped

*No facts yet. The first session adds them. An empty memory is honest; an invented one is not.*
