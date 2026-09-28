# Memory index

**This is a staff member's memory. Read it at every boot, in full.**

A fixture, not anybody's real org. It is shaped like a memory that has been worked for a few
months: several sections, facts that cite each other in backticks, a handful of notes, issue
numbers and file paths. The portal's graph tests need that shape to have anything to judge.

---

## The governing facts

- **`one-plan-pricing`** · [boss] One plan, one price, and pricing is not ours to change. **So:** raise packaging as a decision rather than testing it. · [note](notes/one-plan-pricing.md)
- **`holds-customer-data`** · [derived] Accounts store an email and a schedule on our server. **So:** the row policy in `db/policies.sql` is the only thing between one customer's rows and another's; see `policy-verified`.
- **`policy-verified`** · [measured] An anonymous caller sees 0 of 3 seeded rows (n=3 tables). **So:** re-run `scripts/canary.mjs` after any change touching `holds-customer-data`.
- **`no-credentials-here`** · [derived] The runner holds no database or payment keys. **So:** anything that needs them is filed for the boss, not attempted; see #12.
- **`approve-outbound`** · [boss] Nothing goes out under the company name unread. **So:** finished work waits in `drafts/`; never schedule a send.
- **`single-region`** · [derived] Everything runs in one region. **So:** an outage there is a total outage, and `status-page` says so rather than hedging.

## Deploy and release

- **`deploy-on-merge`** · [derived] Merging to main deploys the site in about four minutes. **So:** a merge is a release; the gate in `ci-gate-lies` has to be green first.
- **`ci-gate-lies`** · [measured] The e2e job passed twice while the build was broken (2 of 40 runs, Jul). **So:** read the build log, not the badge, before `deploy-on-merge`. · [note](notes/ci-gate-lies.md)
- **`preview-urls`** · [derived] Every pull request gets a preview URL. **So:** link it in the PR body; the boss reviews there, not locally.
- **`rollback-is-revert`** · [derived] There is no rollback button; a revert commit is the rollback. **So:** keep commits small enough to revert alone, per `deploy-on-merge`.
- **`release-notes`** · [boss] Every release gets one line in `CHANGELOG.md`. **So:** write it in the PR, not afterwards.
- **`asset-budget`** · [measured] The home page ships 410 KB (n=1 build, Aug). **So:** anything that adds more than 20 KB needs a reason in the PR; see #31.
- **`cache-busting`** · [derived] Assets are content-hashed by the bundler in `vite.config.ts`. **So:** never hand-edit a hashed filename; fix the source.

## Permissions and identity

- **`app-identity`** · [derived] Work is done as a GitHub App, not a person. **So:** comments are signed by the bot, and `approve-outbound` still applies to them.
- **`token-scope`** · [derived] The App token cannot read Actions variables. **So:** a 403 there is expected; do not file it as a bug, per `no-credentials-here`.
- **`peer-labels`** · [derived] Asks to a peer carry that peer's `from-` label. **So:** filter the peer's queue by label, never by author.
- **`branch-protection`** · [derived] Main requires one review. **So:** the bot opens PRs and never merges its own; see `deploy-on-merge`.
- **`secrets-rotation`** · [boss] Keys rotate quarterly; the next rotation is tracked in #44. **So:** a sudden 401 in October is the rotation, not an outage.
- **`two-humans`** · [boss] Two humans can approve, but only one owns pricing. **So:** route `one-plan-pricing` questions to the owner alone.

## The product

- **`setup-step-drop-off`** · [measured] 38% of accounts never finish the setup step (n=212, Jun to Aug). **So:** nothing upstream of it is worth spending on until it moves. · [note](notes/setup-step-drop-off.md)
- **`trial-length`** · [boss] The trial is 14 days and is not an experiment. **So:** do not propose changing it; it follows `one-plan-pricing`.
- **`mobile-share`** · [measured] 61% of sessions are mobile (n=4,120, Aug). **So:** every screen is checked at phone width before `deploy-on-merge`.
- **`export-csv`** · [derived] Export is CSV only, built in `src/export.ts`. **So:** a request for another format is a product decision, filed as one.
- **`timezone-bug`** · [measured] Schedules shift by an hour for 3 of 212 accounts after DST (n=212). **So:** store UTC and render local; the fix is tracked in #57.
- **`onboarding-email`** · [boss] One welcome email, no drip. **So:** a nurture sequence is out of scope however well it tests; see `approve-outbound`.
- **`search-is-client-side`** · [derived] Search filters in the browser over at most 500 rows. **So:** past that, `asset-budget` and speed both break, so it is a known ceiling.

## Instruments

- **`analytics-cookieless`** · [derived] Analytics are cookieless and aggregate. **So:** there is no per-user funnel; `setup-step-drop-off` is measured by counts, not journeys.
- **`weekly-numbers`** · [boss] The weekly note reports signups, activations and churn, nothing else. **So:** a new metric needs the boss's yes before it appears.
- **`small-n`** · [derived] Most weekly counts are under 100. **So:** a week-on-week change under 20% is noise; say so rather than explain it. · [note](notes/small-n.md)
- **`uptime-check`** · [measured] Uptime was 99.95% (n=30 days, Aug). **So:** below 99.9 is worth an issue; above it is not news, whatever `single-region` implies.
- **`error-tracking`** · [derived] Errors are sampled at 10%. **So:** one report may be ten users; do not treat a single stack trace as rare.
- **`status-page`** · [derived] The status page is updated by hand. **So:** during an outage it is the first thing to update, before the fix.

## Lessons that keep repaying

- **`read-the-log`** · [derived] Twice a green check hid a failure. **So:** open the log for anything that matters; this is `ci-gate-lies` generalised.
- **`one-change-per-pr`** · [derived] Mixed PRs were reverted whole. **So:** one concern per PR, which is what makes `rollback-is-revert` safe.
- **`ask-before-scope`** · [boss] Unasked-for scope was declined three times. **So:** propose it as an issue first.
- **`write-it-down`** · [derived] A fact re-derived twice costs more than the line. **So:** add it here the first time, in the grammar lint enforces. · [note](notes/write-it-down.md)
- **`delete-is-maintenance`** · [boss] Memory that only grows stops being read. **So:** cut a line when it stops changing a decision, and log the cut.
