/* Everything the page asks the local server for, in one place. */

const json = async (url) => (await fetch(url, { cache: "no-store" })).json();

export const getOrg = () => json("/api/org");
export const getDocs = () => json("/api/docs");
export const getInbox = (force) => json("/api/inbox" + (force ? "?refresh=1" : ""));
export const getSync = () => json("/api/sync").catch(() => null);

/** The repos org.yaml lists. Off disk, so the new-issue form does not wait on the inbox. */
export const getRepos = () => json("/api/repos");

/** What one repo's labels actually are, so they can be offered rather than typed. */
export const getLabels = (repo) => json("/api/labels?repo=" + encodeURIComponent(repo));

/** Full-text across the docs. Titles are not enough: what you want is usually a paragraph. */
export const searchDocs = (q) => json("/api/docsearch?q=" + encodeURIComponent(q));

/** Every file in the org layer that the portal may write, off disk rather than hardcoded. */
export const getOrgLayer = () => json("/api/orglayer");

export const getDoc = (page) =>
  fetch("/api/doc?page=" + encodeURIComponent(page), { cache: "no-store" }).then((r) => r.text());

export const fileUrl = (path) => "/api/file?path=" + encodeURIComponent(path);
export const getFile = (path) => fetch(fileUrl(path)).then((r) => r.text());

export const getThread = (repo, number, kind) =>
  json(
    "/api/thread?repo=" + encodeURIComponent(repo) + "&number=" + number + "&kind=" + kind,
  );

/** A pull request's commits and its diff. Asked for on the Files or Commits tab, not before. */
export const getPr = (repo, number) =>
  json("/api/pr?repo=" + encodeURIComponent(repo) + "&number=" + number);

export const diffUrl = (dir, sha, path) =>
  "/api/diff?dir=" + encodeURIComponent(dir) + "&sha=" + encodeURIComponent(sha) +
  (path ? "&path=" + encodeURIComponent(path) : "");

/* Writes need a POST with a custom header, which is what stops a random page in the
   browser from reaching this server. */
export async function post(payload, url = "/api/act") {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-roster": "1" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "failed with " + res.status);
  return data;
}

/**
 * Put a file in the repo an issue lives in, and get back the path and the link.
 *
 * Read here rather than posted as a form because everything else on this server speaks JSON,
 * and a file small enough to belong in a repo is small enough to base64.
 */
export async function upload(repo, file) {
  const data = await new Promise((ok, no) => {
    const r = new FileReader();
    r.onerror = () => no(new Error("could not read " + file.name));
    // A data URL is "data:<type>;base64,<payload>"; only the payload travels.
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
  return post({ repo, name: file.name, data }, "/api/upload");
}

/* ------------------------------- setup and authoring ------------------------------- */

export const getSetup = () => json("/api/setup/status");

export const planTenant = (params) =>
  json("/api/setup/plan?" + new URLSearchParams(params).toString());

export const createTenant = (params) => post(params, "/api/setup/apply");

/** The copyable prompt, with every file it refers to carried inside it. */
export const getBrief = (kind, staff) =>
  json("/api/brief?kind=" + encodeURIComponent(kind) + (staff ? "&staff=" + encodeURIComponent(staff) : ""));

/** Parse what came back from the model. Reads only: saving is a second, deliberate step. */
export const parsePaste = (kind, staff, answer) =>
  fetch("/api/paste", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, staff, answer }),
  }).then((r) => r.json());

export const saveFile = (path, text, message) => post({ path, text, message }, "/api/save");

/** The scan every checklist is derived from. */
export const getDoctor = (offline) => json("/api/doctor" + (offline ? "?offline=1" : ""));

/** Those findings as one brief for a coding agent, plus the split into who can do what. */
export const getFix = (offline) => json("/api/fix" + (offline ? "?offline=1" : ""));

export const listRepos = (org) => json("/api/setup/repos?org=" + encodeURIComponent(org));
export const addRepo = (name, role) => post({ name, role }, "/api/setup/add-repo");
export const startApp = (staff, scope) => post({ staff, scope }, "/api/setup/app");
export const appResult = (state) => json("/api/setup/app-result?state=" + encodeURIComponent(state));

/** Does this org already run roster. "Create" and "join" are different answers. */
export const checkOrg = (org) => json("/api/setup/check-org?org=" + encodeURIComponent(org));
export const joinOrg = (org) => post({ org }, "/api/setup/join");
