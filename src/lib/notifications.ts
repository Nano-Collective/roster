import { api, ghJson } from "./gh.js";

/**
 * Unread activity, from GitHub's own notifications.
 *
 * What GitHub already tracks as unread for you: a new comment, a mention, an assignment. Using it
 * rather than keeping our own "seen" list means reading a thread on GitHub or a phone clears it
 * here too, and opening it here clears it there.
 */
export interface Unread {
  /** The notification thread, which is what marking read acts on. */
  thread: string;
  /** Why GitHub told you: comment, mention, assign, review_requested and so on. */
  reason: string;
  updatedAt: string;
}

interface Notification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  repository?: { full_name?: string; owner?: { login?: string } };
  subject?: { url?: string | null };
}

/** Every unread notification on an issue or PR in `owner`'s repos, keyed `owner/repo#n`. */
export async function unreadFor(owner: string, pages = 5): Promise<Map<string, Unread>> {
  const out = new Map<string, Unread>();
  for (let page = 1; page <= pages; page++) {
    const res = await ghJson<Notification[]>(["api", `notifications?per_page=100&page=${page}`]);
    if (!res.ok || !res.data?.length) break;
    for (const n of res.data) {
      if (!n.unread || n.repository?.owner?.login?.toLowerCase() !== owner.toLowerCase()) continue;
      const number = /\/(?:issues|pulls)\/(\d+)$/.exec(n.subject?.url ?? "")?.[1];
      if (!number || !n.repository?.full_name) continue;
      out.set(`${n.repository.full_name}#${number}`, {
        thread: n.id,
        reason: n.reason,
        updatedAt: n.updated_at,
      });
    }
    if (res.data.length < 100) break;
  }
  return out;
}

/** Mark one notification thread read on GitHub. */
export async function markRead(thread: string): Promise<boolean> {
  if (!/^\d+$/.test(thread)) return false;
  const res = await api(`notifications/threads/${thread}`, ["-X", "PATCH"]);
  return res.ok;
}
