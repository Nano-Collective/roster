# Upgrading

The framework writes templates out. A tenant runs its own copies. So the two drift, and
`roster upgrade` is what reconciles them without eating your edits.

```bash
roster upgrade                 # what would change
roster upgrade --apply         # do it
roster upgrade --check         # exit non-zero if anything is pending (for CI)
```

## How it decides

A generated file has three versions: what the framework shipped when this tenant was seeded,
what it ships now, and what you have today. Upgrading is a three-way merge between them, done
by `git merge-file`. A tenant that has rewritten half of `org/voice.md` still gets the rest.

The base lives in `<ops>/.roster/seed/` and is committed. Without it an upgrade can only be a
copy, which would take your edits with it.

## Ownership decides what an edit means

**In the ops repo:**

| | |
|---|---|
| `org/`, `prompts/` | yours. Local edits are expected and get a real merge. |
| everything else | the framework's. An edit is reported whether or not anything has collided. |

That last rule is deliberate. A fix applied to a framework-owned file in the tenant is not safe
just because nothing broke; it survives only until the framework next touches that file. "Not
broken yet" is the state a lost fix sits in, so it is reported then, not later.

**In a brain repo, only the caller workflows are upgraded.** The charter, the memory index, the
decisions log and the manifest belong to the staff member from the moment they are created. A
working agent rewrites them beyond recognition, and merging a template into that would be
vandalism. They are added when new and never rewritten.

## Callers are regenerated, not merged

A caller is derived entirely from the manifest and the template, so there is no third version
to reconcile. What looks like a local edit is either a template change that has not arrived, or
something that should have been a manifest change.

The diff is printed either way, so nothing goes quietly.

If you want a caller to differ, change the thing it is generated from. Timeouts, schedule,
model and identities all live in `staff.yaml`.

## Conflicts

A conflict is never written into a live file. Agents read `org/voice.md` at every boot, and
conflict markers in it would land in every composed prompt.

Instead the merged result with markers goes to `<file>.roster-merge`, the live file is
untouched, and the recorded base does **not** advance for that file. That last part matters:
advancing it would throw away the only thing that can merge it next time.

Resolve by hand, then re-run.

## A tenant with no recorded base

Tenants created before this existed have nothing to merge against. Reconstruct it from the
framework's own history:

```bash
roster upgrade --baseline <git-ref>
```

Pick the framework commit the tenant was seeded from. You can tell you picked the right one:
most files will match it byte for byte, and the ones that do not will be the ones you know you
edited.

## After applying

`roster upgrade --apply` writes into your working trees. It does not commit or push, and it
cannot: **App tokens cannot push a change under `.github/workflows/`**. Review, commit, push.
