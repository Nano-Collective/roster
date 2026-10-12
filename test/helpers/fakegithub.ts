import type { ApiResult, GitHub, RequestOpts } from "../../src/lib/github.js";

/**
 * A GitHub that answers from a table, for code that talks to it through `GitHub`.
 *
 * The counterpart of `fakegh.ts` for the portal's side of roster, which no longer runs a
 * process. A route matches on `METHOD path` (GraphQL is `POST graphql` and is matched on its
 * query text instead), first match wins, and anything unmatched is a 404, so a test that forgets
 * a route sees the failure rather than a pass.
 */
export interface FakeRoute {
  match: RegExp;
  /** What comes back, or a function of the request body that returns it. */
  data?: unknown | ((body: any) => unknown);
  status?: number;
  error?: string;
}

export interface Call {
  method: string;
  path: string;
  body?: any;
  /** The query, for GraphQL. */
  query?: string;
  vars?: Record<string, unknown>;
}

export function fakeGitHub(routes: FakeRoute[]): GitHub & { calls: Call[] } {
  const calls: Call[] = [];
  const answer = <T>(line: string, body: unknown): ApiResult<T> => {
    for (const r of routes) {
      if (!r.match.test(line)) continue;
      if (r.error !== undefined) return { ok: false, status: r.status ?? 422, error: r.error };
      const data =
        typeof r.data === "function" ? (r.data as (b: unknown) => unknown)(body) : r.data;
      return { ok: true, status: r.status ?? 200, data: data as T };
    }
    return { ok: false, status: 404, error: "Not Found" };
  };
  return {
    calls,
    async request<T>(method: string, path: string, opts: RequestOpts = {}) {
      calls.push({ method, path, body: opts.body });
      return answer<T>(`${method} ${path}`, opts.body);
    },
    async graphql<T>(query: string, vars: Record<string, unknown> = {}) {
      calls.push({ method: "POST", path: "graphql", query, vars });
      return answer<T>(`GRAPHQL ${query.replace(/\s+/g, " ")}`, vars);
    },
  };
}
