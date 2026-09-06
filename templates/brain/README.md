# %%NAME%%

%%MENTION%%'s brain. This repo *is* the memory: everything this staff member knows, is working
on, and has decided.

| Where | What |
|---|---|
| `CHARTER.md` | The personality. Hand-written. Decides everything else. |
| `staff.yaml` | The machine-readable half of the charter. |
| `memory/INDEX.md` | One line per fact, read at every boot. |
| `memory/notes/` | The argument behind a fact, read on demand. |
| `log/decisions.md` | Why things were decided. Not boot context. |
| `.github/workflows/` | Three callers. The body lives in `%%OPS_REPO%%`. |

Scheduled runs and mentions are wired up by roster. To see what this staff member is actually
sent at 07:00:

    roster prompt %%STAFF%% --kind daily
