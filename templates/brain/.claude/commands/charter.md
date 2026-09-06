Write or revise this staff member's CHARTER.md.

You are helping a human author the charter for %%NAME%% (%%MENTION%%) at %%ORG_NAME%%.

Read first, in this order:

1. `../%%OPS_REPO_DIR%%/org/business.md` — what this business actually is.
2. `../%%OPS_REPO_DIR%%/org/operating.md`, `org/voice.md`, `org/guardrails.md` — the shared
   half every staff member already inherits. **Do not restate any of it.** The charter is only
   the difference between this role and the others.
3. Every peer's `CHARTER.md`, for consistency of register and to find the seams between roles.
4. This repo's `staff.yaml` — the machine-readable half. The charter must not contradict it.

Then interview the human. Ask about the role's purpose, the decisions it owns outright, the
ones it must escalate, and what it should refuse. Ask one question at a time and follow the
answers; do not present a form.

Draft `CHARTER.md` from what they tell you. Then check it yourself:

- Does anything here duplicate `org/`? Cut it.
- Are the decision rights specific enough to act on at 07:00 with nobody awake?
- Does it contradict `staff.yaml`? `roster lint` will fail if so.
- Does it read in the house voice? `org/voice.md` binds this file too.

Show the human the draft and the list of what you cut and why. The charter is theirs, not
yours — do not commit it without them reading it.
