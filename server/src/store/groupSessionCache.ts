/**
 * Lightweight in-memory cache of portal sessions keyed by groupId.
 * Populated on user login, consumed by background workers (FileIngestionWorker, etc.)
 * that need portal cookies to call FTP API.
 */

interface CachedSession {
  portalCookies: string[];
  env: string;
  username: string;
  updatedAt: number;
}

const cache = new Map<string, CachedSession>();

/** Store (or update) session for a group. Called from auth route on successful login. */
export function cacheGroupSession(groupId: string, session: { portalCookies: string[]; env: string; username: string }) {
  cache.set(groupId, { ...session, updatedAt: Date.now() });
}

/** Get cached session for a group. Returns undefined if no user has logged in for this group. */
export function getCachedGroupSession(groupId: string): CachedSession | undefined {
  return cache.get(groupId);
}

/** Check if any session is cached. */
export function hasAnyCachedSession(): boolean {
  return cache.size > 0;
}
