## What this changes

## Type of change

- [ ] `feat` new feature
- [ ] `fix` bug fix
- [ ] `mod` change to existing behaviour
- [ ] `docs` documentation only
- [ ] `chore` dependencies, tooling

## Testing

**Automated:**

**Manual:**

## Checklist

- [ ] `pnpm test:all` passes
- [ ] Tests cover the change, and I broke one deliberately to check it fails
- [ ] Docs updated (the suite fails if a command or flag is undocumented)
- [ ] No generated file was edited in a tenant instead of in `templates/`
- [ ] If this touches a live org: `roster prompt` output checked, and `roster upgrade` reviewed

## Breaking changes

If this changes a manifest field, a template, or the session workflow, say what an existing
tenant has to do.
