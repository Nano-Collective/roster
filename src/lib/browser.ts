import { spawn } from "node:child_process";

/**
 * Whether starting the portal should open a browser. A person at a terminal expects the page
 * the docs promise; CI, a pipe or a remote shell has nobody to show it to, and BROWSER=none is
 * the convention other dev servers already honour for "don't".
 */
export function shouldOpen(env: NodeJS.ProcessEnv, isTTY: boolean, noOpen: boolean): boolean {
  if (noOpen || !isTTY) return false;
  if (env.CI || env.BROWSER === "none" || env.SSH_CONNECTION) return false;
  return true;
}

/** The platform's own opener, so a browser the person chose is the one that appears. */
export function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/** Never fatal: the URL is already printed, and a missing opener is not worth an error. */
export function openBrowser(url: string): void {
  const [cmd, args] = openerFor(process.platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed URL is the fallback.
  }
}
