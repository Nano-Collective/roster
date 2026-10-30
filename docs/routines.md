---
title: "Routines"
description: "When staff wake beyond the daily round, and what they do then."
sidebar_order: 24
---

# Routines

Every staff member has a **daily round**: the scheduled session where they boot, work and hand
off. A **routine** is one more time they wake, with a job of its own. For example:

- every Monday at 09:00, plan the week
- on the 1st of the month, write last month's numbers into a report
- every Friday at 16:00, tidy the tracker and close what is done

Make them on the portal's **Routines** screen: who, a name, when, and what to do in your own
words. A preview shows the routine as a sentence while you type. **Run now** starts one
straight away, which is the way to try one out.

From a terminal:

```bash
roster routine cto add --name "Monday plan" --at "0 9 * * 1" \
  --do "Plan the week: read last week's status issue and this month's priorities, then open one issue per thing to ship, ranked." --apply
roster routine cto              # list them
roster routine cto run monday-plan
roster routine cto daily "0 7 * * 1-5" --apply   # move the daily round
```

## What a routine run does

A routine run is a daily session whose prompt opens with the routine's name and your words. The
staff member boots as usual, so they know where things stand, then does what the routine asks
instead of the rest of the daily round. They record it as a daily run would: `STATE.md`, their
memory and the status issue. In **Runs** and on **Home** it shows as "cto routine monday-plan".

A routine is not held to `max_runs_per_day`. That limit is for runs nobody asked for, and a
routine is one you asked for at a set time.

## Where it lives

Each routine is in two places in the staff member's brain repo:

- `staff.yaml`, under `routines:`, has its id and its time:
  `- { id: monday-plan, schedule: "0 9 * * 1" }`
- `routines/monday-plan.md` has its name as the heading, then what to do.

Both are compiled into the daily caller's `on.schedule`, one cron line per routine. When the
schedule fires, the cron that fired (`github.event.schedule`) says which routine it was. Nothing
polls between runs, so a routine costs nothing until it runs.

The portal and `roster routine` write the three files in one commit, as you. That includes the
caller under `.github/workflows/`, so on the hosted portal you sign in with GitHub's `workflow`
permission. If you signed in before routines existed, sign out and sign in again.

## Rules

- **Times are UTC.** The editor shows your local time beside it.
- **Two schedules cannot share a minute.** GitHub fires once for a cron listed twice, so the
  second would never run. Move one by a minute.
- **GitHub runs scheduled workflows late when it is busy**, sometimes by tens of minutes. A
  routine is for "around then", not to the second.
- **Upgrade first.** Routines need the session workflow from roster 0.1.0-beta.20 or later in
  the ops repo. Saving one before `roster upgrade --apply` is refused with that message, rather
  than writing a caller that would fail.
