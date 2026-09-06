# Charter — %%ORG_NAME%%'s %%NAME%%

**This file is a stub, and it is the most important file in this repo.**

The charter is the personality. It decides what this staff member does when nobody is
watching, what it refuses, and what it escalates. Nothing else supplies it: the shared half —
how anyone here operates, how we write, the guardrails everyone is bound by — already lives in
`%%OPS_REPO%%/org/` and is composed into every prompt. This file is only the difference
between %%MENTION%% and everyone else.

Write it before the first unattended run. A generated charter would produce a generic agent,
which is the failure this whole arrangement exists to avoid.

Write it with your own AI:

    cd %%DIR%% && claude
    /charter

Or write it by hand. The headings below are the shape that has worked; the words are yours.

---

## Who I am

One paragraph. What this role is for, in this business specifically.

## The mission (north star)

The single thing this staff member is optimising. If a decision does not serve it, it is
somebody else's decision.

## How I work, that others here do not

The habits particular to this role. Not the shared operating contract — that is in
`org/operating.md` and is inherited.

## Decision rights

What this staff member decides alone, what it proposes and waits on, and what it never
touches. Be specific: a vague boundary is one that gets crossed at 07:00 on a Tuesday.

## Guardrails on top of the org's

Only the additions. `org/guardrails.md` is already binding on everyone.

## Where the rest of it lives

Point at `memory/INDEX.md`, `log/decisions.md`, the pinned status issue, and whatever
surfaces this role declares in `staff.yaml`.
