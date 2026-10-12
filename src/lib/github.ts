import type { GhResult } from "./gh.js";

/**
 * GitHub over `fetch`, with a token.
 *
 * The portal used to shell out to the human's own `gh` for everything, which is why it could
 * only ever run on the machine that had `gh` signed in. This is the same reach without the
 * process: REST and GraphQL with a token, so the portal runs anywhere `fetch` does — under Node
 * on your machine, or on a Worker in front of a sign-in.
 *
 * Whose token it is decides who the portal acts as. Locally it is the one `gh auth token`
 * prints, so nothing changes about who posts; hosted it is the signed-in person's own.
 *
 * Results are values, never exceptions, and in the same `GhResult` shape `gh.ts` returns, so a
 * caller that used to read `ghJson` reads this without learning anything new.
 */
export interface GitHub {
  /** REST. `path` is relative to the API root: `repos/acme/cto/issues`. */
  request<T = unknown>(method: string, path: string, opts?: RequestOpts): Promise<ApiResult<T>>;
  /** GraphQL. Errors in the response body are failures, not data. */
  graphql<T = unknown>(query: string, vars?: Record<string, unknown>): Promise<ApiResult<T>>;
}

export interface RequestOpts {
  body?: unknown;
  /** `application/vnd.github.raw`, `application/vnd.github.sha`… Default JSON. */
  accept?: string;
  /** Hand back the body as text or bytes rather than parsed JSON. */
  as?: "json" | "text" | "bytes";
  /** Safe to ask again after a timeout. Always true of a GET; a GraphQL query sets it. */
  retry?: boolean;
}

export interface ApiResult<T> extends GhResult<T> {
  /** True when the answer came from the ETag cache on a 304, which costs no rate limit. */
  cached?: boolean;
}

interface Remembered {
  etag: string;
  data: unknown;
}

/**
 * A client for one token.
 *
 * GETs are conditional: the last ETag for a URL is sent back, and a 304 is answered from what
 * was kept. GitHub does not count a 304 against the hour's allowance, which is what makes
 * polling live runs every few seconds affordable. The memory is per client, so per token: one
 * person's cached answer is never handed to another.
 */
export function githubClient(
  token: string,
  opts: { fetch?: typeof fetch; base?: string; userAgent?: string; remember?: number } = {},
): GitHub {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.base ?? "https://api.github.com").replace(/\/$/, "");
  const limit = opts.remember ?? 500;
  const seen = new Map<string, Remembered>();

  const headers = (accept: string): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    accept,
    "user-agent": opts.userAgent ?? "roster-portal",
    "x-github-api-version": "2022-11-28",
  });

  const request = async <T>(
    method: string,
    path: string,
    o: RequestOpts = {},
  ): Promise<ApiResult<T>> => {
    const url = path.startsWith("https://") ? path : `${base}/${path.replace(/^\//, "")}`;
    const accept = o.accept ?? "application/vnd.github+json";
    const as = o.as ?? "json";
    const h = headers(accept);
    const key = `${accept} ${url}`;
    const kept = method === "GET" ? seen.get(key) : undefined;
    if (kept) h["if-none-match"] = kept.etag;
    let body: string | undefined;
    if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      h["content-type"] = "application/json";
    }

    /* GitHub times out on its heavier queries now and then (a 502 or 504 that succeeds a second
       later). A read is asked once more; a write never is, so nothing can be posted twice. */
    const reads = method === "GET" || o.retry === true;
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await doFetch(url, { method, headers: h, body });
      } catch (err) {
        if (reads && attempt === 0) continue;
        return { ok: false, error: `GitHub could not be reached: ${(err as Error).message}` };
      }
      if (reads && attempt === 0 && [502, 503, 504].includes(res.status)) {
        await res.body?.cancel().catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }

    if (res.status === 304 && kept) {
      // Most recently used goes to the back, so the oldest is what gets dropped.
      seen.delete(key);
      seen.set(key, kept);
      return { ok: true, status: 304, data: kept.data as T, cached: true };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: message(res, text) };
    }

    let data: unknown;
    if (res.status === 204) data = undefined;
    else if (as === "bytes") data = new Uint8Array(await res.arrayBuffer());
    else if (as === "text") data = await res.text();
    else {
      const text = await res.text();
      data = text ? JSON.parse(text) : undefined;
    }

    const etag = res.headers.get("etag");
    if (method === "GET" && etag && as !== "bytes") {
      seen.set(key, { etag, data });
      if (seen.size > limit) seen.delete(seen.keys().next().value!);
    }
    return { ok: true, status: res.status, data: data as T };
  };

  const graphql = async <T>(query: string, vars: Record<string, unknown> = {}) => {
    const res = await request<{ data?: T; errors?: Array<{ message: string }> }>(
      "POST",
      "graphql",
      // A query reads; a mutation writes, and is never asked twice.
      { body: { query, variables: vars }, retry: !/^\s*mutation\b/.test(query) },
    );
    if (!res.ok) return { ok: false, status: res.status, error: res.error } as ApiResult<T>;
    const errors = res.data?.errors ?? [];
    // A partial answer with errors is still an error: half an inbox looks like a quiet day.
    if (errors.length) return { ok: false, status: 200, error: errors[0]!.message };
    return { ok: true, status: 200, data: res.data?.data as T };
  };

  return { request, graphql };
}

/** What went wrong, in GitHub's own words where it gave some, said plainly where it did not. */
function message(res: Response, text: string): string {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && remaining === "0") {
    return "GitHub's API limit for this hour is used up. It resets within the hour.";
  }
  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    // not JSON
  }
  if (res.status === 401) return "GitHub did not accept the token. Sign in again.";
  if (res.status === 404) return "Not Found";
  return `GitHub answered ${res.status} ${res.statusText}`.trim();
}

/** `owner/name` as the two halves REST paths and GraphQL variables want. */
export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, name };
}
