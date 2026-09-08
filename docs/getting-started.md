---
title: "Getting started"
description: "Stand up an org and a first staff member, in seven steps."
sidebar_order: 1
---

# Getting started

```bash
npx @nanocollective/roster
```

Run that in an empty directory. It opens a portal in your browser and walks the whole setup:
it checks `gh`, lists the organisations you can see, and asks which one.

**Two answers, and it works out which you need.** An organisation that does not run roster yet
gets one stood up. One that already does gets checked out here instead, ops repo and every
staff repo side by side, which is the shape the CI runner uses. That is how a second person on
a team joins an org somebody else set up.

From there the page carries the rest: the Actions setting that has to be clicked, the repos
your staff work in, hiring, each GitHub App, and a prompt you paste into your own AI to write
`org/business.md` and the charters.

You need `gh` authenticated, and a credential for whichever [coding agent](agents.md) you want
to run.

---

The rest of this page is the same setup from a terminal. Everything the portal does, these do;
nothing writes without `--apply`.

## 1. Stand up the org

```bash
roster init --org acme --name "Acme Robotics"
```

That prints the plan. Read it, then:

```bash
roster init --org acme --name "Acme Robotics" --apply
```

You now have `acme/roster-ops`: the org layer, the runner machinery, and a recorded merge base
so later upgrades are merges rather than copies.

Then do the one thing that cannot wait: **Settings -> Actions -> General on `roster-ops`, set
access to "accessible from repositories in the organisation".** Skip it and every workflow
later fails with "workflow not found", which reads like a typo and is not one.

## 2. Say what the business is

Open `roster-ops/org/business.md`. It ships as questions. Answer them, or:

```bash
roster brief discover        # paste into whatever agent you use
```

Or, in Claude Code, `cd roster-ops && claude` then `/discover`. Both print the same brief:
`roster init` generates the slash command from it.

Do this before hiring anyone. It is composed into the top of every prompt, and an agent that
cannot answer these questions writes plausible work about a business that does not exist.

## 3. Hire someone

```bash
roster hire cto --name "Chief Technology Officer" --dir technology
```

Read the plan. It lists every file, every label, the peer wiring in both directions, and the
things it cannot do for you. Then `--apply`.

For the first hire in a new org there is nobody to copy an identity from, so name them:

```bash
roster hire cto --name "Chief Technology Officer" --dir technology \
  --app acme-cto --public-app acme-robot --apply
```

Later hires infer both from whoever is already there.

## 4. Give them an identity

```bash
roster app cto
```

A browser opens, GitHub asks you to confirm, and the App's id and private key go straight into
the repository's secrets. The key never touches disk.

Then **install it**, using the URL that command prints, granting it every tracker the staff
member writes to. This is the step that most often looks done and is not. See
[manual steps](manual-steps.md#3-install-the-app-and-grant-it-the-right-repositories).

## 5. Write the charter

```bash
roster brief charter cto     # paste into whatever agent you use
```

Or, in Claude Code, `cd technology && claude` then `/charter`. Same brief either way.

This is the file that decides everything else. [Writing a charter](writing-a-charter.md).

## 6. Check, then run one by hand

```bash
roster doctor cto
```

Fix what it says. Then trigger the daily workflow once from the Actions tab and read the log.

**A workflow that has never run has proved nothing.** Not that the App is installed, not that
the grant took, not that the secrets are right. `doctor` says `unproven` rather than `fine` for
exactly this reason.

## 7. Look at it

```bash
roster portal
```

Everything open across the org, every staff member's memory, what changed since yesterday, and
whether anything is unhealthy. Reads the repositories on disk, so keep them checked out
alongside each other.

## Where things go from here

- A second staff member: `roster hire`, then `roster app`. Peer wiring happens both ways.
- A change to how everyone writes: edit `org/voice.md` once. It reaches everybody on their next
  run.
- A framework update: `roster upgrade`. See [upgrading](upgrading.md).
