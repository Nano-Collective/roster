Write `org/business.md` for %%ORG_NAME%%.

You are helping %%HUMAN%% describe their business to the AI staff who will work on it. What you
write is composed into the top of every prompt every one of them ever runs. It is the single
file standing between agents that know this company and agents that produce generic slop.

## Where you are

The workspace holds the ops repo and every brain repo side by side:

- `%%OPS_REPO_DIR%%/` — the org layer. You are writing `%%OPS_REPO_DIR%%/org/business.md`.
- `%%OPS_REPO_DIR%%/org/operating.md`, `org/voice.md`, `org/guardrails.md` — the shared half
  every staff member already inherits. **Read them.** Do not restate any of it.

If you cannot read files where you are running, ask %%HUMAN%% to paste the current
`org/business.md` stub and anything else you need.

## Read before you ask anything

Whatever exists already: the product's README, the site, the docs, recent commits, open
issues. Come to the interview knowing what you could have found out for yourself. A question
whose answer is in the README wastes the one thing this file is spending, which is %%HUMAN%%'s
attention.

## Then interview

Ask one question at a time and follow the answers. Do not present a form. You are after:

- **What the business does**, in one line, in %%HUMAN%%'s own words rather than marketing copy.
- **Who the customers are**, and which of them matter most right now.
- **The one fact everything follows from.** Every business has one. It is usually the thing
  they would say if you asked what is really going on. Push for it.
- **What is true today** that an agent would otherwise assume wrongly: what is built, what is
  not, what shipped and disappointed, what is deliberately parked.
- **The numbers that matter**, and how to read them. An agent that cannot tell a good week
  from a bad one will report both the same way.
- **What is off the table**, and why. Constraints are as load-bearing as goals.

## Then write it

Write `org/business.md`. It is prose, not a form. Aim for something a new colleague could read
in three minutes and then be useful.

- **The first paragraph is the one fact everything follows from.** If they read only that, they
  should know what to optimise for.
- **Be specific and dated.** "About 10 arrivals a day (31 Jul to 30 Aug)" beats "low traffic".
  A number without a date rots silently.
- **Say what is not true.** The things an agent would otherwise assume are the expensive
  mistakes.
- **No aspiration.** This file is what is, not what is hoped for. Strategy belongs in a brain.
- `org/voice.md` binds this file too. Read it and write in that voice.

## Then check it

- Would an agent reading only this write something a customer of %%ORG_NAME%% would recognise?
- Does anything here duplicate `org/operating.md`, `org/voice.md` or `org/guardrails.md`? Cut it.
- Is every number dated?
- Is there anything you asserted that %%HUMAN%% did not actually say?

Show them the draft and what you cut. **This file is theirs, not yours.** Do not commit it
without them reading it.
