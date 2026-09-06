# Writing a charter

The charter is the personality. It decides what a staff member does when nobody is watching,
what it refuses, and what it escalates.

roster will not write it for you. That is not a missing feature. A generated charter produces a
generic agent, and a generic agent produces work that is competent-looking and about nothing in
particular, which takes longer to notice than no work at all.

## Write it with your own AI

```bash
cd <staff-dir> && claude
/charter
```

The `/charter` command ships in the scaffold. It reads `org/business.md`, the shared operating
layer, and every peer's charter, then interviews you and drafts from your answers. It also tells
you what it cut and why.

For an agent other than Claude Code, `.claude/commands/charter.md` is a plain markdown brief.
Paste it into whatever you use.

## What goes in it, and what does not

**Only the difference.** The shared half already exists in `org/`: how anyone here operates, how
we write, the guardrails everyone is bound by. All of it is composed into the prompt above the
charter. Restating any of it wastes context on every run of every day and creates two places to
change one rule.

If a sentence would be true of every staff member you will ever hire, it belongs in `org/`.

## The shape that has worked

**Who I am.** One paragraph. What this role is for, in this business specifically.

**The mission.** The single thing this staff member optimises. If a decision does not serve it,
it is somebody else's decision.

**How I work, that others here do not.** The habits particular to this role.

**Decision rights.** What it decides alone, what it proposes and waits on, what it never
touches. Be specific. A vague boundary is one that gets crossed at 07:00 with nobody awake.

**Guardrails on top of the org's.** Only the additions.

**Where the rest of it lives.** Point at `memory/INDEX.md`, `log/decisions.md`, the pinned
status issue, and the surfaces the manifest declares.

## Things worth being concrete about

- **Escalation.** Name the label and the mechanism, not the sentiment. "Open an issue labelled
  `decision`, assigned to `@you`" beats "check with the founder".
- **What it must not do.** Money, legal, anything touching a real person's data. Say it here
  even if `org/guardrails.md` covers it, if this role gets closer to the line than others.
- **What good output looks like for this role.** A CTO's and a CMO's differ, and the shared
  voice file cannot know that.

## Keep it agreeing with the manifest

`roster lint` fails if the charter and `staff.yaml` disagree. The manifest is the
machine-readable half of the same document: handle, schedule, peers, surfaces, identities. If
the charter says it reviews pull requests on the product repo, `works_in` had better include it.

## It is not finished

The charter is the file most worth revisiting. When a run does something you did not want, the
question is usually not "what went wrong in that run" but "what does the charter not say".
