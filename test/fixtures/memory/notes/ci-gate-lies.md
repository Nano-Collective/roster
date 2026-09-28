# The gate, and the ways it lies

The e2e job retries flaky steps and reports the last attempt, so a broken build that passes on
retry shows green. Tracked in #23. Until then `read-the-log` is the rule, and
`deploy-on-merge` means nothing without it.
