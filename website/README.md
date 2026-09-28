# roster website

The marketing site for roster. Next.js, exported as static files, served by Cloudflare Pages.

It lives in the roster repo but is not part of the package: the CLI's `files` whitelist in the
root `package.json` publishes only `dist`, `templates` and `docs`, so nothing here reaches
anybody who runs `npx @nanocollective/roster`. It has its own `package.json`, lockfile and
`pnpm-workspace.yaml`, and the root biome config ignores it.

## The docs

`/docs` is rendered at build time from the repo's own `../docs/*.md`, so the site cannot drift
from them. The sidebar follows the sections of `docs/README.md`; frontmatter supplies each
page's title, description and order. Links between `.md` files become site links, and
`docs/images/` is copied into `public/docs/images` before every build and dev start. Edit the
markdown, not the site.

## Develop

```bash
cd website
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # static export into out/
```

## Deploy on Cloudflare Pages

**Pushing to `main` deploys it.** There is no deploy from a terminal: the Pages project is
connected to `Nano-Collective/roster` and builds on every push. To set one up again, the
build reads `../docs`, which Pages has because it clones the whole repo:

| Setting | Value |
|---|---|
| Root directory | `website` |
| Build command | `pnpm install && pnpm build` |
| Build output directory | `out` |
| Environment variable | `NODE_VERSION` = `22` |

`public/_headers` sets caching and security headers, and gives the extensionless
`/opengraph-image` its `image/png` type. If the site ends up somewhere other than
`roster.nanocollective.org`, change `metadataBase` in `src/app/layout.tsx` so social cards
resolve.

## Screenshots

`public/screens/` are the portal, captured against a demo `acme` org. Re-take them when the
portal changes; never capture a real tenant.
