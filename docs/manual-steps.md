---
title: "Manual steps"
description: "What only a person can do, why, and what breaks if it is skipped."
sidebar_order: 2
---

# Manual steps

What roster cannot do for you, why, and what it looks like when one is skipped. The
[getting started](getting-started.md) path walks through each of these in order; this page is
what to read when one of them bites.

**Health**, or `roster doctor`, checks each one it can, and every finding carries the sentence
that fixes it.

---

## 1. Create the organisation

**Do:** make it on github.com, if you do not have one.

**Why not automated:** GitHub has no API for creating an organisation.

---

## 2. Confirm the GitHub App

**Do:** press **GitHub App** on a staff card, or run `roster app <handle> --apply`. A tab
opens; confirm on GitHub. The App's id and private key go straight into the brain repo's
secrets.

**Why not automated:** there is no API that creates a GitHub App. The only route is the App
Manifest flow, where a person confirms on a GitHub page. roster does everything either side of
that.

**If you skip it:** the run fails at the token-minting step, saying the App does not exist.

The private key is handed to `gh` on standard input. It is never written to a file, never on a
command line, and never in the process table. If the secret write fails after the App is
created, the key is gone: generate a new one from the App's settings page and set the secret by
hand. roster says so if it happens.

---

## 3. Confirm the App's install

**Do:** press **Install it** in the portal, or open the link `roster app` prints. The page opens
with the organisation and the repos this staff member needs already selected: its brain, the
ops repo (every run checks it out first), each peer's tracker, and the product repos. Check the
list and confirm. Choosing **All repositories** instead also works.

**Why not automated:** installing is a grant of access to specific repositories, and GitHub asks
a person to confirm it. That is correct and should not be worked around.

The pre-selection uses `suggested_target_id` and `repository_ids[]` on the install page. GitHub's
own links use them, but they are not in GitHub's documentation. If the ids cannot be read, or
GitHub stops honouring them, the link is the plain install page and you tick the repos yourself;
the portal and `roster app` both list which.

**If you under-grant it:** this is the trap that costs the most time, because the API reports an
App's **declaration** separately from an installation's **grant**. `GET /apps/<slug>` will say
the App exists and has `contents: write` without saying whether it is installed on the repo you
care about. So **do not verify an installation by reading the API**. Run it once (item 5).

---

## 4. Get the agent's credential

**Do:** get a credential for your coding agent (`claude setup-token` for Claude Code; the others
are in [choosing a coding agent](agents.md#1-the-credential-exists-and-you-have-it)) and paste it
into **Agent credential**, or pipe it to `roster credential --apply`. It is stored once, as an
organisation secret shared with the brain repos, and each hire adds its repo to it.

**Why not automated:** it is your account's credential and roster has no way to obtain one.

Where an org secret would not arrive, it goes on each brain repo instead and says why. On GitHub
Free, org secrets do not reach private repos, and only an org owner can set one. Setting an org
secret also needs the `admin:org` scope on your `gh` token; if it is missing, the credential goes
on each repo and the output gives the command that adds the scope.

**If you skip it:** the run fails immediately with `the caller passed no agent credential`.

**Check:** Health, or `roster doctor`, lists the secrets each caller references and whether they
exist, on the repo or shared from the org.

---

## 5. Watch the first run

**Do:** **Run once now** on the staff card or on Health, or `roster run <handle> --apply`. It
starts the daily workflow, follows it, and reports how it ended, with the log.

**Why it is yours:** it is a real run. It does a day's work and costs what one does, so it is a
button you press rather than something setup does behind your back.

**Why it matters:** the only thing that proves the whole chain (App created, installed, granted,
secrets right, ops repo callable) is a run that finished. `roster doctor` reports a workflow
that has never run as **unproven** rather than fine, and one finished run clears it.

---

## 6. Write `org/business.md` and `org/priorities.md`

**Do:** on the setup screen, **Copy the prompt** puts a brief on your clipboard with every file
it refers to inside it; paste the reply back and you get a diff and a save button. `roster brief
discover` prints the same brief. Then write `org/priorities.md`: a few ranked lines on what
matters this month.

Health reports `business.stub` and `priorities.stub` while either is still the stub.

**Why not automated:** an agent that does not know the business writes work that is plausible
and generic. That is worse than no work, because it takes longer to notice.

**If you skip it:** nothing errors. That is the problem.

---

## 7. Write each staff member's `CHARTER.md`

**Do:** **Write the charter** on that staff member's card, the same round trip as item 6. The
brief carries the org layer, `business.md`, the peers' charters, and where the role matches one,
a [worked example](writing-a-charter.md#worked-examples) to model the shape on. `roster brief
charter <handle>` prints the same brief.

**Why not automated:** the charter is what makes a staff member different from the others, and
a generated one is the generic agent this arrangement exists to avoid.

**If you skip it:** `charter.stub` says nobody has answered it, and the agent produces whatever
the shared layer implies.

---

## 8. Commit what `roster upgrade` wrote

**Do:** review, commit and push what `roster upgrade --apply` changed in the brain repos.

**Why not automated:** **App tokens cannot push a change under `.github/workflows/`**, in any
repository. That is a GitHub restriction, and it is why agents never update their own workflows
and upgrades are run by a person. Hiring commits its own changes as you, and lists them first.

**If you skip it:** the change exists locally and nowhere else, and `roster upgrade` reports it as
pending next time.

---

## What roster does for you

Each of these is a step of a command, listed in its plan before it happens, and each falls back
to telling you exactly what to click if GitHub refuses.

| | |
|---|---|
| The ops repo's Actions access | `roster init --apply`, or **Set it for me** on the setup screen. Needs admin on the ops repo. Skipped, every caller fails with "workflow not found". |
| Committing peer wiring | `roster hire --apply` commits and pushes each peer's `staff.yaml` and `org.yaml` as you. A push that fails is reported and left for you. |
| Giving each new brain the credential | `roster hire --apply` adds the repo to the org secret. |
| Choosing repos on the install page | pre-selected, as above. |
| The review gate on product repos | `roster hire --apply` adds it where there is none. See [security](security.md#the-review-gate). |
