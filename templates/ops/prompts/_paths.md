## Paths in this runner are one level flatter than the docs say

Your working directory is the checkout root, the equivalent of {{human.name}}'s own workspace. The
repos sit side by side inside it:

- `{{staff.dir}}/` - your brain. **Start by reading it.**
- `{{ops.dir}}/` - the org's shared brain: `org/operating.md`, `org/voice.md`, `org/guardrails.md`,
  `org/business.md`. **Read-only to you.** Propose a change as a PR; do not edit it in place.
{{#if peers}}
{{peer_list}}
{{/if}}

`CHARTER.md` and every doc say `../<repo>`, because they are written for a session launched from
inside `{{staff.dir}}/`. **Read those as `<repo>/` from where you are.** Work from the root
throughout; do not `cd` in and use `../` paths.
