#!/usr/bin/env node
// Works out what a runner has to check out, before it has checked anything out.
//
// The ops repo is the only thing a workflow can clone without reading a manifest first, so it
// clones that, runs this, and gets back everything else: where the staff member's brain lands,
// which peers to bring along, which product repos to clone and how deep.
//
// Emits `key=value` lines for $GITHUB_OUTPUT. Vendored alongside compose.mjs for the same reason:
// a morning run must not depend on npm or on an org the tenant does not control.
//
// Usage:  node roster-ops/runner-plan.mjs --staff cto --ops roster-ops >> "$GITHUB_OUTPUT"

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseYaml } from "./compose.mjs";

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.staff) throw new Error("--staff is required");

  const opsDir = resolve(args.ops ?? ".");
  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");

  const entry = (org.staff ?? []).find((s) => s.handle === args.staff);
  if (!entry) throw new Error(`org.yaml has no staff member "${args.staff}"`);
  const dir = entry.dir ?? entry.handle;

  // The staff manifest may not be readable yet (its repo is cloned after this runs), so
  // everything here comes from org.yaml, which is the registry for exactly this reason.
  const peers = (org.staff ?? [])
    .filter((s) => s.handle !== args.staff)
    .map((s) => `${org.org}/${s.dir ?? s.handle}:${s.dir ?? s.handle}`);

  const products = (org.repos ?? [])
    .filter((r) => r.role === "product")
    .map((r) => `${org.org}/${r.name}:${r.name}:${r.depth ?? 0}`);

  const out = {
    brain_dir: dir,
    brain_repo: `${org.org}/${dir}`,
    org: org.org,
    peers: peers.join(" "),
    products: products.join(" "),
    // A product repo present means node is worth setting up; a triage-only run should not
    // pay for an install it will not use.
    needs_node: products.length > 0 ? "true" : "false",
    product_dir: products.length ? products[0].split(":")[1] : "",
    product_repo: products.length ? products[0].split(":")[0] : "",
    package_json: products.length ? `${products[0].split(":")[1]}/package.json` : "",
  };

  return Object.entries(out)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

try {
  process.stdout.write(main(process.argv.slice(2)) + "\n");
} catch (err) {
  console.error(`runner-plan: ${err.message}`);
  process.exit(1);
}

export { main };
