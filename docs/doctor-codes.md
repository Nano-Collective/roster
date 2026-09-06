---
title: "doctor codes"
description: "Every finding roster doctor can emit, what it means, and what to do."
sidebar_order: 19
---

# doctor codes

Every finding `roster doctor` can emit. Each carries a stable `id`, which is what
`--json` reports and what to quote in an issue.

```bash
roster doctor --json | jq '.findings[] | select(.level != "ok")'
```

Levels: `fail` sets exit code 1, `warn` does not, `ok` is reported so you can see the check
ran at all.

## Workspace

| id | Means |
|---|---|
| `gh` | Whether `gh` is installed and authenticated. A warning here means every network check was skipped, not that anything is wrong. |
| `org.yaml` | The org manifest parsed, and how much it declares. |
| `human` | **fail.** `org.yaml` has no `human.github`. The mention callers gate on that login, so nothing can wake an agent. |
| `repo` | Every repo in `org.yaml` is reachable. A failure means it does not exist or your `gh` cannot see it. |
| `repo.visibility` | A repo's real visibility disagrees with what `org.yaml` records. Cosmetic, but the posture it records is then fiction. |
| `actions-access` | **fail** unless the ops repo is callable from the whole organisation. This is the "workflow not found" trap. See [manual steps](manual-steps.md#1-allow-the-ops-repos-workflow-to-be-called). |
| `upgrade` | The tenant is in sync with the framework. |
| `upgrade.stale` | Generated files are behind. `roster upgrade --apply`. |
| `upgrade.owned` | **fail.** A framework-owned file was edited in the tenant. Move the change upstream or the next upgrade reverts it. |
| `upgrade.blocked` | A file cannot be merged: either a conflict to resolve, or no recorded base. See [upgrading](upgrading.md). |

## Per staff member

| id | Means |
|---|---|
| `checkout` | **fail.** Their directory is not checked out beside the ops repo, so nothing else could be checked. |
| `manifest` | **fail.** No `staff.yaml`, or it does not parse. `compose.mjs` reads a small strict YAML subset. |
| `manifest.handle` | **fail.** `staff.yaml` and `org.yaml` disagree about the handle. The composer looks them up by the `org.yaml` one. |
| `manifest.brain` | **fail.** No brain repo declared, so no secrets, labels or runs can be checked. |
| `charter` | **fail** if `CHARTER.md` is absent. Note that a stub counts as present: this checks the file exists, not that it says anything. |
| `memory` | `memory/INDEX.md` parses, and how many facts and notes it holds. |
| `compose` | All three prompts compose. A failure names the kind and the placeholder. |
| `callers` | Three caller workflows exist. |
| `callers.uses` | **fail.** A caller references no reusable workflow, or one in a different organisation. A private reusable workflow is only callable inside its own org. |
| `callers.target` | **fail.** A caller points at a workflow file that is not in the ops repo. Fails at run time as "workflow not found". |
| `surfaces` | A surface declared in `staff.yaml` is not on disk. The portal renders nothing for it. |
| `secrets` | Every secret the callers reference exists on the brain repo. Derived from the callers themselves, not a fixed list. |
| `labels` | Every label declared in `staff.yaml` exists. An agent applying a label that does not exist gets an API error mid-run. |
| `peer-labels` | The `from-<handle>` label exists on the *peer's* tracker, which is where this staff member's asks land. |
| `status-issue` | The declared status issue is actually pinned. If not, the place you look is not the place the agent maintains. |
| `runs` | A window of recent runs. See below. |
| `runs.timeout` | **fail.** Runs were killed at a ceiling. |
| `runs.cancelled` | Runs were cancelled short of any ceiling, with their durations. |

## Reading `runs`

This is the only check that proves the whole chain works, so it is worth understanding.

- **"has never run"** is a warning, not an `ok`. Nothing has exercised the App grant or the
  secrets, so nothing is known.
- **"all gated out before doing anything"** means every recent trigger was `skipped`. That is
  normal for a mention workflow, but it means the credentials are still unproven.
- **"ran to a Nm ceiling and were killed"** is a timeout. GitHub reports those as `cancelled`,
  so doctor identifies them by duration. If the ceiling it names differs from the one the
  caller sets today, it says so: those runs happened under the old setting.
- **`N/M recent runs succeeded`** is the healthy form.

A skipped run is never counted as a failure. Most of a mention workflow's history is skipped
runs, and counting them would bury the real ones.
