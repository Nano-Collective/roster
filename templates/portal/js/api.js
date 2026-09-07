/* Everything the page asks the local server for, in one place. */

const json = async (url) => (await fetch(url, { cache: "no-store" })).json();

export const getOrg = () => json("/api/org");
export const getDocs = () => json("/api/docs");
export const getInbox = (force) => json("/api/inbox" + (force ? "?refresh=1" : ""));
export const getSync = () => json("/api/sync").catch(() => null);

export const getDoc = (page) =>
  fetch("/api/doc?page=" + encodeURIComponent(page), { cache: "no-store" }).then((r) => r.text());

export const fileUrl = (path) => "/api/file?path=" + encodeURIComponent(path);
export const getFile = (path) => fetch(fileUrl(path)).then((r) => r.text());

export const getThread = (repo, number, kind) =>
  json(
    "/api/thread?repo=" + encodeURIComponent(repo) + "&number=" + number + "&kind=" + kind,
  );

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
