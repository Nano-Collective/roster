#!/usr/bin/env node
/**
 * The portal as a Cloudflare Worker, built into dist/worker/.
 *
 *   dist/worker/index.js       the handler, the libraries and compose.mjs, as one module
 *   dist/worker/assets/        what the Worker serves as files: the portal's page and its
 *                              /assets/ exactly as templates/portal has them, and the docs'
 *                              screenshots under /docs-images/
 *
 * The text roster reads at run time — the docs, the worked charters, the brief templates — is
 * bundled into the module as `roster:framework` and mounted where the CLI would find it on disk.
 * The page itself is still unbuilt: these are the same files `roster portal` serves.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "worker");
rmSync(out, { recursive: true, force: true });

/* The files the handler reads at run time, keyed as they sit in the package. */
const framework = {};
const take = (dir, keep) => {
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (keep(full)) framework[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(join(root, dir));
};
take("docs", (f) => f.endsWith(".md"));
take("templates/briefs", () => true);

await build({
  entry: { index: "src/portal/worker.ts" },
  outDir: out,
  format: ["esm"],
  platform: "neutral",
  target: "es2023",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: false,
  dts: false,
  silent: true,
  noExternal: [/.*/],
  // nodejs_compat provides these; everything else is in the bundle.
  external: [/^node:/],
  esbuildPlugins: [
    {
      name: "roster-framework",
      setup(b) {
        b.onResolve({ filter: /^roster:framework$/ }, () => ({
          path: "framework",
          namespace: "roster",
        }));
        b.onLoad({ filter: /.*/, namespace: "roster" }, () => ({
          contents: JSON.stringify(framework),
          loader: "json",
        }));
      },
    },
  ],
});

const assets = join(out, "assets");
mkdirSync(join(assets, "assets"), { recursive: true });
cpSync(join(root, "templates/portal/index.html"), join(assets, "index.html"));
for (const dir of ["css", "js"]) {
  cpSync(join(root, "templates/portal", dir), join(assets, "assets", dir), { recursive: true });
}
cpSync(join(root, "docs/images"), join(assets, "docs-images"), { recursive: true });

const size = statSync(join(out, "index.js")).size;
process.stdout.write(
  `  dist/worker/index.js  ${(size / 1024).toFixed(0)} KiB\n  dist/worker/assets/\n`,
);
