{{#if inflight}}
## Human work in flight

People have these pull requests open on the product repos, and each one is theirs. A long-lived
branch is usually rewriting what you would otherwise be about to change.

- **Do not open competing work on files they touch**: no pull request, and no issue asking for a
  change there. It gets overtaken when their branch lands, and it costs them a review first.
- **If you have something to say about that work, say it on their pull request**, briefly, and
  leave the decision to them.
- If today's task sits on those files, say so in your report and take the next thing.

{{inflight}}
{{/if}}
