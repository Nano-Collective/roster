---
title: "Manual steps"
description: "Every human action, why it cannot be automated, and what breaks if you skip it."
sidebar_order: 2
---

# Manual steps

Everything a human has to do, why it cannot be automated, and what it looks like when you skip
it. This page exists because every item on it has cost somebody real time.

`roster doctor` checks most of these. Run it after each one.

---

## 1. Allow the ops repo's workflow to be called

**Do:** `<org>/roster-ops` -> Settings -> Actions -> General -> *Access* -> **Accessible from
repositories in the organisation**.

**Why not automated:** it is an organisation permission on a repository, and the API for it
needs admin rights that a token created for a different purpose should not have. roster reads
it and tells you, but setting it is one click and it is yours.

**If you skip it:** every caller fails with **"workflow not found"**. That reads like a typo in
a path, or a missing file, or a bad branch reference. You will check all three. It is none of
them, it is this.

**Check:** `roster doctor` reports `roster-ops is callable from the whole org`.

---

## 2. Create the GitHub App

**Do:** `roster app <handle>`. It opens a browser, GitHub asks you to confirm, and you come
back. Credentials go straight into the repository's secrets.

**Why not fully automated:** there is no API that creates a GitHub App. The only route is the
App Manifest flow: POST a manifest to a settings page, a human confirms, GitHub returns a
one-time code. roster does everything either side of that confirmation.

**If you skip it:** the run fails at the token-minting step with a message about the app not
existing.

**Note:** the private key is handed to `gh` on standard input. It is never written to a file,
never passed on a command line, and never appears in the process table. If the secret write
fails after the App is created, the key is gone: generate a new one from the App's settings
page and set the secret by hand. roster tells you this if it happens.

---

## 3. Install the App, and grant it the right repositories

**Do:** open the URL `roster app` prints. Choose repositories.

**Why not automated:** installing is a grant of access to specific repositories, and GitHub
requires a human to choose them. This is the correct behaviour and should not be worked around.

**Grant it on every tracker the staff member writes to**, not just their own. The token is
minted organisation-wide, and a peer's board is where a brief lands. `roster app` prints the
full list.

**If you skip it, or under-grant it:** this is the trap that costs the most time, because of
how it fails.

> The API reports an App's **declaration** separately from an installation's **grant**.
> `GET /apps/<slug>` will happily tell you the App exists and has `contents: write`. That says
> nothing about whether it has been installed on the repository you care about. Two of our
> Apps declare permissions they were never granted.

So: **do not verify an installation by reading the API.** The only thing that proves the whole
chain (App created, installed, granted, secrets right, workflow reachable) is a run that
finished. `roster doctor` reads a window of recent runs for exactly this reason, and reports a
workflow that has never run as **unproven** rather than as fine.

**Check:** `roster doctor <handle>`, then trigger one run and look again.

---

## 4. Set the agent's credential

**Do:** put the coding agent's credential on each brain repo as a secret. The name follows the
credential: `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, and so on. See
[choosing a coding agent](agents.md).

**Why not automated:** it is your account's credential and roster has no way to obtain one.

**If you skip it:** the run fails immediately with `the caller passed no agent credential`.
That check exists so it fails there rather than forty lines later inside the agent, after the
checkouts have already happened.

**Check:** `roster doctor` lists the secrets each caller references and whether they exist.

---

## 5. Write `org/business.md`

**Do:** answer the questions `roster init` leaves in it. With your own AI if you like:
`roster brief discover`, then paste it into your agent.

**Why not automated:** an agent that does not know the business writes work that is plausible
and generic. That is worse than no work, because it takes longer to notice. This file is
composed into the top of every prompt, every run.

**If you skip it:** nothing errors. That is the problem. You get competent-looking output about
a business that does not exist.

---

## 6. Write each staff member's `CHARTER.md`

**Do:** `roster brief charter <handle>`, and paste it into your agent. Or write it by hand;
[writing a charter](writing-a-charter.md) has the shape.

**Why not automated:** same reason, one level down. The charter is what makes a staff member
different from the others.

**If you skip it:** `roster doctor` reports the charter as present (the stub is a file) but the
agent has no personality and will produce whatever the shared layer implies.

---

## 7. Commit and push what roster wrote into other repos

**Do:** `roster hire` and `roster upgrade` write into brain repos on disk. Review, commit, push.

**Why not automated:** roster does not commit on your behalf into repositories it did not
create in that command. And **App tokens cannot push a change under `.github/workflows/` in any
repository**, which is a GitHub restriction and not a configuration mistake. That is also why
agents can never update their own workflows, and why upgrades are human-run by design.

**If you skip it:** the change exists locally and nowhere else. `roster upgrade` will report it
as still pending next time, which is the intended behaviour.

---

## Order

For a new organisation:

```
roster init --org <org> --apply          # 1 applies here
roster hire <handle> --apply             # then 7
roster app <handle>                      # 2, then 3
# 4, 5, 6
roster doctor <handle>
```

Then trigger one run by hand before trusting the schedule. A workflow that has never run has
proved nothing.
