# Cost

Three separate bills, and they behave differently.

## The coding agent

The largest by far, and the one that scales with how much work you ask for.

A session's cost is roughly its length. Ours run 11 to 55 minutes of wall clock, and a longer
session is a bigger bill as well as a slower one. The lever that matters is not the model
setting, it is how much you ask a staff member to do each morning and how much context it has
to read to start.

That is why the memory system is shaped the way it is. Boot context here went from about 52,000
words to about 6,000 by moving from a narrative status file to one line per fact. That is a
direct, repeated saving on every run of every staff member.

**Watch for sessions growing into their ceiling.** A run that gets killed at
`timeout_minutes` has been paid for and produced nothing. `roster doctor` reports the ratio.

## GitHub Actions minutes

Real on private repositories, and easy to forget because it is metered per minute of runner
time and every scheduled run consumes it whether or not the run was useful.

Three things spend it more than you would expect:

- **Timeouts.** A run killed at 90 minutes bills 90 minutes.
- **Mention workflows.** Every comment on a tracker triggers a run, even ones the condition
  gates out. Those are seconds each, but they are not free and they are numerous.
- **`fetch-depth: 0`** on the brain checkout, which is deliberate (the agent reads its own
  history) but grows with the repository.

Public repositories are free, which is why the product-repo lane costs nothing.

## GitHub Apps

Free. There is no per-App or per-installation charge. The only cost here is the human minute
it takes to install one.

## What roster itself costs

Nothing at run time. The framework is not a dependency of anything a tenant runs: the CLI runs
on your machine when you ask it to, and the machinery is vendored into the tenant's own repo.

## Keeping it down

- **Prune memory.** Deleting is the maintenance. Every line in `memory/INDEX.md` is read at
  every boot, by every run, forever.
- **Do not raise a timeout to fix a slow session.** Find out why it grew. A ceiling that keeps
  being raised is a session that has stopped fitting its job.
- **Give a mention workflow a shorter ceiling than a daily one.** A focused task that runs for
  an hour has gone wrong, and the ceiling is the only thing that stops it.
- **Check the ratio, not the last run.** `roster doctor` reports how many of the last ten runs
  succeeded. One bad run is noise; four is a bill.
