// @ts-expect-error: vendored plain JS, with no types on purpose
import * as framework from "../../templates/ops/connectors.mjs";
import type { GitHub } from "./github.js";
import { sealForGitHub } from "./sealedbox.js";

/**
 * Connectors, from the CLI's and the portal's side: what the catalogue offers, whether a key
 * works, and storing it as a GitHub secret. What a run does with them is connectors.mjs.
 *
 * The catalogue read here is the framework's, so a new entry is offered as soon as roster is
 * updated. A run reads the tenant's vendored copy, which `roster upgrade` brings up to date.
 */

export interface Field {
  id: string;
  label: string;
  secret?: boolean;
  pattern?: string;
  required?: boolean;
}

export interface Declared {
  id: string;
  name: string;
  known: boolean;
  catalogue: string | null;
  staff: string[];
  readOnly: boolean;
  auth: "key" | "oauth";
  portal: string | null;
  settings: Record<string, string>;
  secrets: Array<{ field: string; label: string; name: string }>;
  problem: string | null;
  entry: Record<string, unknown>;
}

interface Entry {
  name: string;
  summary: string;
  suggest?: string[];
  link?: string;
  steps: string[];
  auth?: "oauth";
  fields: Field[];
  oauth?: { resource: string };
  readOnly?: { server?: boolean; tools?: string[] };
  check?: (v: Record<string, string>) => {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export const CATALOGUE = framework.CATALOGUE as Record<string, Entry>;
export const declared = framework.declared as (org: unknown) => Declared[];
export const secretName = framework.secretName as (id: string, field: string) => string;
export const withConnectors = framework.withConnectors as (
  text: string,
  entries: Record<string, Record<string, unknown>>,
) => string;

/** The catalogue as the page reads it: the same entries, without the functions. */
export function catalogueView() {
  return Object.entries(CATALOGUE).map(([id, e]) => ({
    id,
    name: e.name,
    summary: e.summary,
    suggest: e.suggest ?? [],
    link: e.link ?? "",
    steps: e.steps,
    auth: e.auth ?? "key",
    fields: e.fields.map((f) => ({
      id: f.id,
      label: f.label,
      secret: f.secret === true,
      pattern: f.pattern ?? "",
      required: f.required !== false,
    })),
    readOnly: Boolean(e.readOnly?.server || e.readOnly?.tools),
    canCheck: typeof e.check === "function",
  }));
}

/**
 * What a field's value is wrong about, before anything is stored, or null. `keepKeys` is an
 * edit that leaves the stored keys as they are, so an empty key field is not a mistake.
 */
export function wrongValue(
  id: string,
  values: Record<string, string>,
  opts: { keepKeys?: boolean } = {},
): string | null {
  const e = CATALOGUE[id];
  if (!e) return null;
  for (const f of e.fields) {
    const v = (values[f.id] ?? "").trim();
    if (!v) {
      if (f.required !== false && !(f.secret && opts.keepKeys)) return `${f.label} is empty`;
      continue;
    }
    if (f.pattern && !new RegExp(f.pattern).test(v)) {
      return `That does not look like a ${e.name} ${f.label.toLowerCase()}`;
    }
  }
  return null;
}

export type CheckResult =
  | { state: "ok" }
  | { state: "limited"; note: string }
  | { state: "rejected"; note: string }
  | { state: "unknown"; note: string };

/**
 * One cheap request with the key, to tell a typo from a working key before it is stored.
 *
 * A 403 is a key the service knows and has narrowed, which is what a read-only key should be,
 * so it passes. Only a 401 is a key the service does not accept.
 */
export async function checkKey(
  id: string,
  values: Record<string, string>,
  doFetch: typeof fetch = fetch,
): Promise<CheckResult> {
  const e = CATALOGUE[id];
  if (!e?.check) return { state: "unknown", note: "This one cannot be checked before a run." };
  const req = e.check(values);
  let res: Response;
  try {
    res = await doFetch(req.url, {
      method: req.method ?? "GET",
      headers: { "user-agent": "roster", ...(req.headers ?? {}) },
      body: req.body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { state: "unknown", note: `Could not reach ${e.name}: ${(err as Error).message}` };
  }
  if (res.ok) return { state: "ok" };
  if (res.status === 401) return { state: "rejected", note: `${e.name} rejected this key.` };
  if (res.status === 403) {
    return { state: "limited", note: "The key works. It cannot read everything, which is fine." };
  }
  return { state: "unknown", note: `${e.name} answered ${res.status}, so the key is unchecked.` };
}

/* ------------------------------------------------------------------------------------------ */
/* Secrets                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * Where a connector's keys are, for each brain: on the repo, or shared to it from the org.
 * `null` for a brain whose secrets this token cannot read.
 */
export async function secretsOn(
  gh: GitHub,
  brains: string[],
): Promise<Map<string, Set<string> | null>> {
  const out = new Map<string, Set<string> | null>();
  await Promise.all(
    brains.map(async (repo) => {
      const [own, shared] = await Promise.all([
        gh.request<{ secrets: Array<{ name: string }> }>(
          "GET",
          `repos/${repo}/actions/secrets?per_page=100`,
        ),
        gh.request<{ secrets: Array<{ name: string }> }>(
          "GET",
          `repos/${repo}/actions/organization-secrets?per_page=100`,
        ),
      ]);
      if (!own.ok) {
        out.set(repo, null);
        return;
      }
      out.set(
        repo,
        new Set([
          ...own.data!.secrets.map((s) => s.name),
          ...(shared.ok ? shared.data!.secrets.map((s) => s.name) : []),
        ]),
      );
    }),
  );
  return out;
}

export interface Stored {
  mode: "org" | "repo";
  repos: string[];
  /** Why the org secret was not used, when it was tried. */
  fellBack?: string;
}

/**
 * Store one value as a secret every brain can read, encrypted to GitHub's key on the way.
 *
 * Once for the org where that reaches private repos, which is every plan but Free; otherwise on
 * each brain. Every brain rather than only the staff who have the connector, so that ticking
 * somebody else later is a change to org.yaml and not another paste. Which staff a key reaches
 * in a run is still org.yaml's call: connectors.mjs gives each run only its own.
 */
export async function storeSecret(
  gh: GitHub,
  org: string,
  name: string,
  value: string,
  brains: string[],
): Promise<Stored> {
  if (!value.trim()) throw new Error("the value is empty");
  if (!brains.length) throw new Error("there are no brain repos yet. Hire someone first");
  let fellBack: string | undefined;

  const info = await gh.request<{ plan?: { name?: string } }>("GET", `orgs/${org}`);
  const plan = info.ok ? info.data?.plan?.name : undefined;
  if (plan && plan !== "free") {
    try {
      const ids = await Promise.all(
        brains.map(async (repo) => {
          const r = await gh.request<{ id: number }>("GET", `repos/${repo}`);
          if (!r.ok) throw new Error(`could not read ${repo}: ${r.error}`);
          return r.data!.id;
        }),
      );
      const key = await publicKey(gh, `orgs/${org}`);
      const put = await gh.request("PUT", `orgs/${org}/actions/secrets/${name}`, {
        body: {
          encrypted_value: sealForGitHub(value.trim(), key.key),
          key_id: key.key_id,
          visibility: "selected",
          selected_repository_ids: ids,
        },
      });
      if (!put.ok) throw new Error(put.error ?? "refused");
      return { mode: "org", repos: brains };
    } catch (err) {
      fellBack = (err as Error).message;
    }
  }

  for (const repo of brains) {
    const key = await publicKey(gh, `repos/${repo}`);
    const put = await gh.request("PUT", `repos/${repo}/actions/secrets/${name}`, {
      body: { encrypted_value: sealForGitHub(value.trim(), key.key), key_id: key.key_id },
    });
    if (!put.ok) throw new Error(`could not store ${name} on ${repo}: ${put.error}`);
  }
  return { mode: "repo", repos: brains, fellBack };
}

/** Remove a secret wherever it is. Missing is not an error: the point is that it is gone. */
export async function deleteSecret(
  gh: GitHub,
  org: string,
  name: string,
  brains: string[],
): Promise<void> {
  await gh.request("DELETE", `orgs/${org}/actions/secrets/${name}`);
  await Promise.all(
    brains.map((repo) => gh.request("DELETE", `repos/${repo}/actions/secrets/${name}`)),
  );
}

async function publicKey(gh: GitHub, scope: string): Promise<{ key: string; key_id: string }> {
  const r = await gh.request<{ key: string; key_id: string }>(
    "GET",
    `${scope}/actions/secrets/public-key`,
  );
  if (!r.ok) throw new Error(`could not read ${scope}'s secret key: ${r.error}`);
  return r.data!;
}

/* ------------------------------------------------------------------------------------------ */
/* Editing org.yaml                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * org.yaml with one connector set, as `entries` would have it. Everything that is not the
 * connector's own setting is kept from what was there, so a hand-written field survives.
 */
export function setConnector(
  text: string,
  org: { connectors?: Record<string, Record<string, unknown>> | null },
  id: string,
  entry: Record<string, unknown> | null,
): string {
  const current = { ...(org.connectors ?? {}) };
  if (entry === null) delete current[id];
  else current[id] = { ...(current[id] ?? {}), ...entry };
  for (const [k, v] of Object.entries(current[id] ?? {})) {
    if (v === undefined || v === null || v === "" || v === false) delete current[id]![k];
  }
  return withConnectors(text, current);
}
