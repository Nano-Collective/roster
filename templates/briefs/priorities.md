Write `org/priorities.md` for %%ORG_NAME%%.

You are helping %%HUMAN%% decide what their AI staff should work on this month. Every staff
member reads this file at the start of every run and picks work that serves it, so a vague
priority produces scattered work.

## Where you are

- `%%OPS_REPO_DIR%%/org/business.md`: what the business is. **Read it first**, and don't ask
  anything it already answers.
- `%%OPS_REPO_DIR%%/org/priorities.md`: the current file, which you are replacing.

If you cannot read files where you are running, ask %%HUMAN%% to paste `org/business.md`.

## Interview

Ask one question at a time. You are after:

- **The one outcome that matters most this month**, and how they will know it happened.
- **At most two more**, in order. Push back on a fourth: past three it is a wish list.
- **What is out of scope this month**: work that is tempting but not now. Naming it is what
  stops the staff doing it.

Prefer outcomes ("a stranger pays for it") to activities ("improve the landing page"). If an
answer is an activity, ask what it is for.

## Write it

Use exactly this shape:

```
## What matters this month

### Priorities, in order

1. The first outcome, and how you will know it happened.
2. The second.
3. The third.

### Out of scope this month

- One thing per line.
```

Keep each priority to a sentence or two. Don't add anything %%HUMAN%% didn't say without
listing it after the file so they can check it.
