import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { ghJson } from "./gh.js";

const run = promisify(execFile);

export interface AppSpec {
  /** The App's name, which becomes its slug and therefore its bot login. */
  name: string;
  org: string;
  /** `private` writes to a staff member's own trackers; `public` pushes to the product repo. */
  scope: "private" | "public";
  description: string;
}

export interface CreatedApp {
  id: number;
  slug: string;
  /** The private key. Held in memory, written straight to a repo secret, never to disk. */
  pem: string;
  html_url: string;
}

/**
 * What a staff member's App is allowed to do.
 *
 * Deliberately not `workflows: write`. Agents do not update their own workflows — upgrades are
 * human-run by design, and `roster upgrade` is the thing that carries a template change into a
 * brain repo. One of the live apps declares it anyway, which is a good illustration of the trap
 * this whole area is full of: a *declaration* is not an installation's *grant*, and the two are
 * reported separately.
 */
export const PERMISSIONS: Record<AppSpec["scope"], Record<string, string>> = {
  private: { contents: "write", issues: "write", pull_requests: "write", metadata: "read" },
  public: { contents: "write", issues: "write", pull_requests: "write", metadata: "read" },
};

/**
 * The manifest GitHub turns into an App.
 *
 * There is no API that creates one: you POST this to a settings page in a browser, a human
 * confirms, and GitHub hands back a one-time code. That browser leg is why `hire` has always
 * ended with "now go and make the App yourself".
 */
export function buildManifest(spec: AppSpec, redirectUrl: string) {
  return {
    name: spec.name,
    url: `https://github.com/${spec.org}`,
    description: spec.description,
    redirect_url: redirectUrl,
    // Nothing here listens for webhooks: the agents are woken by Actions, not by callbacks.
    hook_attributes: { url: `https://github.com/${spec.org}`, active: false },
    public: false,
    default_permissions: PERMISSIONS[spec.scope],
    default_events: [],
  };
}

/** The page that hands the browser over to GitHub. It submits itself; there is nothing to read. */
export function handoffPage(spec: AppSpec, manifest: object, state: string): string {
  const action = `https://github.com/organizations/${spec.org}/settings/apps/new?state=${encodeURIComponent(state)}`;
  return `<!doctype html>
<meta charset="utf-8"><title>Creating ${esc(spec.name)}…</title>
<style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;margin:14vh auto;max-width:32rem;
padding:0 1.5rem;color:#1b1f26}code{background:#f4f5f7;padding:1px 5px;border-radius:4px}
button{font:inherit;padding:.6rem 1rem;border-radius:8px;border:1px solid #ccc;cursor:pointer}
@media(prefers-color-scheme:dark){body{background:#0e1013;color:#e6e9ef}code{background:#1b1f26}
button{background:#15181d;color:#e6e9ef;border-color:#252a33}}</style>
<h2>Creating <code>${esc(spec.name)}</code></h2>
<p>Handing over to GitHub to create the App under <code>${esc(spec.org)}</code>. Confirm there,
and you will come straight back here.</p>
<form id="f" method="post" action="${esc(action)}">
  <input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}">
  <button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById("f").submit()</script>`;
}

function esc(s: string): string {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

export interface FlowOptions {
  port?: number;
  /** Skip opening a browser; the URL is printed instead. */
  noOpen?: boolean;
  log?: (line: string) => void;
}

/**
 * Run the manifest flow: serve the hand-off, wait for GitHub to come back, exchange the code.
 *
 * Bound to 127.0.0.1, and the `state` GitHub echoes back has to match the one issued. Without
 * that check any page in the browser could drive this while it is listening.
 */
export async function createApp(spec: AppSpec, opts: FlowOptions = {}): Promise<CreatedApp> {
  const port = opts.port ?? 4310;
  const log = opts.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const state = randomBytes(16).toString("hex");
  const redirectUrl = `http://localhost:${port}/callback`;
  const manifest = buildManifest(spec, redirectUrl);

  return new Promise<CreatedApp>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      server.close();
      fn();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(handoffPage(spec, manifest, state));
        return;
      }

      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }

      if (url.searchParams.get("state") !== state) {
        res
          .writeHead(400, { "content-type": "text/html" })
          .end(
            page(
              "Wrong state",
              "That did not come from the hand-off this command started. Nothing was created.",
            ),
          );
        finish(() => reject(new Error("state did not match; refusing the callback")));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res
          .writeHead(400, { "content-type": "text/html" })
          .end(page("No code", "GitHub came back without a code."));
        finish(() => reject(new Error("no code in the callback")));
        return;
      }

      exchange(code)
        .then((app) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(
            page(
              `${app.slug} created`,
              "The private key went straight into the repository's secrets and was never written to disk. " +
                "You can close this tab; the terminal has the next step.",
            ),
          );
          finish(() => resolve(app));
        })
        .catch((err: Error) => {
          res
            .writeHead(502, { "content-type": "text/html" })
            .end(page("Exchange failed", esc(err.message)));
          finish(() => reject(err));
        });
    });

    server.on("error", (err) => finish(() => reject(err)));
    server.listen(port, "127.0.0.1", () => {
      const url = `http://localhost:${port}/`;
      log(`\n  Creating the GitHub App "${spec.name}" under ${spec.org}.`);
      log(`  Your browser should open. If it does not, go to: ${url}\n`);
      if (!opts.noOpen) void open(url);
    });
  });
}

/** Trade the one-time code for the App's id and private key. The code is good for one hour. */
export async function exchange(code: string): Promise<CreatedApp> {
  const res = await ghJson<CreatedApp & { message?: string }>([
    "api",
    "-X",
    "POST",
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
  ]);
  if (!res.ok || !res.data?.pem) {
    throw new Error(
      `could not convert the manifest code: ${res.error ?? "no private key came back"}`,
    );
  }
  return res.data;
}

/**
 * Put a value into a repository secret without it touching disk or a command line.
 *
 * A private key on argv shows up in the process table; in a file it survives whatever happens
 * next. gh reads the value from stdin, which is neither.
 */
export async function setSecret(repo: string, name: string, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile("gh", ["secret", "set", name, "--repo", repo], (err) =>
      err ? reject(new Error(`gh secret set ${name}: ${err.message}`)) : resolve(),
    );
    child.stdin?.end(value);
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;margin:14vh auto;max-width:32rem;
padding:0 1.5rem;color:#1b1f26}@media(prefers-color-scheme:dark){body{background:#0e1013;color:#e6e9ef}}</style>
<h2>${esc(title)}</h2><p>${body}</p>`;
}

async function open(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    await run(cmd, [url]);
  } catch {
    /* Printing the URL is the fallback, and it was printed before this was tried. */
  }
}
