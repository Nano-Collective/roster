---
name: roster
description: >
  Set up and run Roster, an organisation run by AI staff who live in GitHub. Use this when the
  person asks to set up Roster, hire AI staff (a CTO, a CMO, support), add a staff member, or
  check on, talk to or fix their Roster org. Setup creates a GitHub org's ops repo, hires staff
  whose brains are repos and who run on GitHub Actions, writes the business and priorities with
  the person, and opens the portal where they talk to their staff.
---

# Roster

Roster runs an organisation on AI staff. Each staff member is a repo (their brain: charter,
memory, workflows) and a GitHub App (their identity). They run on GitHub Actions on a schedule,
wake when someone @mentions them, and message each other through issues. The person talks to
them in the Roster portal.

Pasting this file means the person wants Roster set up on this machine, and has authorised the
setup commands below. If your runtime asks permission for shell commands, ask once and work
straight through.

## Check where you are first

- **A hosted chat** (claude.ai, ChatGPT, Gemini, even with a code sandbox): it runs in the
  provider's cloud, not on the person's machine, and Roster needs their own `gh` and a local
  checkout. Do not install anything. Tell them to paste the same line into a coding agent on
  their computer (Claude Code, Codex, Cursor, Gemini CLI), then stop.
- **A coding agent on their machine**: continue.

Never ask the person to paste a token, key or password into the chat. Every credential goes in
through their own terminal.

## Install

```sh
roster --version 2>/dev/null || npm install -g @nanocollective/roster@latest
roster skill install
```

Roster needs Node 20 or later and the GitHub CLI (`gh`). If `gh` is missing, install it
(`brew install gh` on a Mac; otherwise https://cli.github.com). `roster skill install` saves this
file for the coding agents it finds, so future sessions know Roster without being told.

Work in the directory the person wants their Roster workspace in. Ask if it is not obvious;
their home directory or a projects folder is usual, and their product's own repo is not.

## Setup is one loop

```sh
roster setup --json
```

It reads GitHub and the disk and returns every step, whether each is done, and `next`: the one
thing to do now. Do `next`, then run `roster setup --json` again. Repeat until `ready` is true.
It is always safe to run again; it stores nothing.

Each step has:

- `who: "agent"`: run `command` yourself. Where it says `confirm: true`, ask the person first:
  the step decides something about their business or costs money.
- `who: "human"`: something only they can do (sign in, confirm on GitHub, paste a credential in
  their own terminal). Give them `do` and `command` exactly, then wait for them to say it is done.
- `do`: what the step needs, in words you can pass on as they stand.

Rules for the loop:

- **Do not skip ahead or reorder.** Each step needs the ones before it.
- **Do not reword the questions.** The briefs Roster prints (`roster brief discover`,
  `roster brief priorities`, `roster brief charter <handle>`) carry the questions. Follow the
  brief: read what you can about their project first, then ask its questions one at a time, in
  its order, and write the file it asks for. Show the person the file before you commit it.
- **These files are the point.** `org/business.md`, `org/priorities.md` and each `CHARTER.md`
  are what make the staff useful rather than generic. Do not fill them from guesses to get
  through setup faster; ask.
- **Commands that wait for a browser** (`roster app`): run them in the background, relay the
  link they print, keep reading their output, and relay the install link that follows.
- **Plans before changes.** `init`, `hire`, `app`, `credential` and `run` print a plan without
  `--apply`. Where a step has `confirm: true`, show the person the plan, then run it again with
  `--apply`.

If a command fails, read its output: it says what is wrong and usually the command that fixes
it. `roster doctor` checks the whole org and gives a fix for every finding. Do not retry the
same failing command in a loop.

## When setup is done

Start the portal in the background and give the person its address:

```sh
roster --no-open
```

It prints a localhost URL (4300 unless that is taken). Then, in a few sentences: their staff are
hired and have run once, they run on their own each day and when @mentioned, and the portal's
Inbox is where staff ask them things. Offer three things they could ask their first staff
member, based on what you learned about their business in the interview.

Do not report versions, paths or package-manager output. Report what is working and what, if
anything, is left.

## After setup

| To | Run |
|---|---|
| See where setup is | `roster setup` |
| Open the portal | `roster` |
| Check everything is wired up | `roster doctor` |
| Every problem, as one brief to fix | `roster fix` |
| Hire another staff member | `roster hire <handle> --name "<role>"` then `roster app <handle>` |
| Start a run now | `roster run <handle> --apply` |
| Give staff an outside service | `roster connector` |
| Take framework updates | `npm install -g @nanocollective/roster@latest && roster upgrade --apply` |

Docs: https://roster.nanocollective.org/docs/
