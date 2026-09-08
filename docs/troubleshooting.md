---
title: "Troubleshooting"
description: "Every trap we have actually hit, and what it looks like from the outside."
sidebar_order: 10
---

# Troubleshooting

Every trap on this page has actually been hit. Most of them fail in a way that points somewhere
else, which is why they are worth writing down.

Start with `roster doctor`. It groups by staff member and every finding that is not `ok` says
what to do about it.

---

## "workflow not found"

**Looks like:** a typo in the `uses:` path, a missing file, a bad branch.

**Is:** the ops repo's Actions access is not set to organisation-wide.

Settings -> Actions -> General on `roster-ops`. `roster doctor` checks this explicitly, and the
portal's setup screen links straight to the page.

---

## A run was "cancelled" and nobody cancelled it

**Is:** almost always the `timeout_minutes` ceiling. GitHub reports a job killed by
`timeout-minutes` as `cancelled`, which reads as though somebody pressed a button.

Tell them apart by duration. Several cancelled runs all stopping at the same minute is a
ceiling, not a coincidence. `roster doctor` does this for you and names the number:

```
✗ cto-daily.yaml: 5 of the last 10 ran to a 60m ceiling and were killed
```

Raise `timeout_minutes` in the staff member's `staff.yaml`, then `roster upgrade --apply`.
Note that raising it does not rewrite history: doctor reads the ceiling those runs actually hit,
so old timeouts keep being reported as timeouts.

---

## Every mention run says "skipped"

**Is:** correct. The job-level condition gates out every comment that is not a mention, and a
gated run still appears in the list with conclusion `skipped`. Most of a mention workflow's
history is skipped runs.

`roster doctor` ignores them. A workflow whose runs are *all* skipped is reported differently,
because nothing has exercised the credentials.

---

## The App exists, the API says so, and runs still fail

**This is the one that costs the most time.**

`GET /apps/<slug>` reports what an App **declares**. It says nothing about whether that App has
been **installed** on the repository in question, or which repositories the installation was
granted. The two are reported separately and they disagree exactly when you care.

Do not verify an installation by reading the API. The only proof of the whole chain is a run
that finished. `roster doctor` reads recent runs for this reason and calls a workflow that has
never run **unproven** rather than fine.

Fix: open the App's installation settings and check the repository list includes every tracker
the staff member writes to, not just its own. `roster app` prints that list.

---

## An agent cannot push a workflow change

**Is:** a GitHub restriction, not a misconfiguration. **App tokens cannot push any change under
`.github/workflows/` in any repository.**

This is why agents can never update their own workflows and why `roster upgrade` writes into
your working tree and asks you to push. It is deliberate: an agent editing the workflow that
constrains it is not a thing anybody wants.

---

## A fix I applied to the tenant disappeared

**Is:** you edited a framework-owned file. `compose.mjs`, `agents.mjs`, `runner-plan.mjs` and
`session.yaml` are generated. The next `roster upgrade` reconciles them against the template.

This happened here: a fix went into `roster-ops/.github/workflows/session.yaml` instead of
`templates/ops/...`, and nothing noticed because the framework had not touched that file *yet*.

`roster upgrade` now reports an edit to a framework-owned file whether or not anything has
collided, and `roster upgrade --check` fails on it. Move the change upstream.

---

## A new staff member's prompt will not compose

```
unknown or empty placeholder: {{staff.product.repo}}
```

**Is:** the prompt refers to something their manifest does not have. `product` comes from the
first entry in `works_in`, and a staff member who contributes to no other repository has none.

The shipped prompts guard these. A prompt fragment you have written yourself needs
`{{#if staff.product}}` around anything that assumes one. Conditionals do not nest.

Similarly `{{staff.status_issue}}` is empty until `roster hire --apply` has opened the pinned
issue.

---

## A mention gets no reaction

The eyes reaction is posted by `session.yaml` before any checkout, so it should land in
seconds. If it does not:

- The reaction is `continue-on-error`. A missing reaction never costs the answer, so check
  whether the run itself started at all.
- It is scoped to `kind == 'mention'`. A pr-mention is acknowledged by the forwarder in the
  public repo instead, so that it gets one reaction rather than two.
- On the `issues` route (a mention typed into a new issue body) the eyes go on the issue, not
  on a comment, because that payload has no comment.

---

## The portal opened on a setup screen and I already have an org

**Looks like:** roster forgot your organisation.

**Is:** you started it somewhere else. The portal walks up from where it was run looking for a
directory containing `org.yaml`; from an unrelated folder it finds nothing, which is a setup, not
an error.

`cd` to your workspace, or pass `--ops <dir>`. If the workspace is on another machine or was never
cloned here, the setup screen's own answer is right: pick the org, and it will say it already runs
roster and offer to check it out.

---

## My AI wrote the charter and the portal will not save it

**Looks like:** the paste box rejecting good work.

**Is:** almost always one of four things, and the page says which, with a line to send back:

- the reply had no `<<<ROSTER FILE …>>>` block, because the model answered in prose
- it wrote a path the brief did not ask for, which is never offered as a save
- it handed the template back, which some models do after a long prompt
- it is a few lines long

The file itself is never the problem: text outside the block is ignored and one wrapping fence is
stripped, so chat and ```` ```markdown ```` are both fine.

---

## The App was created and the portal tab never noticed

**Looks like:** the page stuck on "Confirm it in the tab that just opened".

**Is:** GitHub redirects the tab *it* opened, not the one you clicked from, so the original polls
for the result. It gives up after five minutes and tells you to reload.

**The App was probably created.** Check the org's App settings before trying again; a second
attempt fails on the name, which is the safe failure.

---

## The portal shows stale data

It reads the repositories on disk. `/api/sync` fetches and fast-forwards on every refresh, and
refuses to pull a repository that is dirty or has diverged, saying so in a banner. If a run
landed on GitHub thirty seconds ago and the checkout is behind, that is what you are seeing.

---

## `roster upgrade` says a file has no base

A tenant created before the merge base was recorded has nothing to merge against. Reconstruct
one from the framework's history:

```bash
roster upgrade --baseline <git-ref>
```

Use the framework commit the tenant was seeded from. Check it afterwards: files that match the
reconstruction byte for byte confirm you picked the right one.
