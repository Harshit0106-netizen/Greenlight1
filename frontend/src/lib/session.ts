"use client";
import { useSyncExternalStore } from "react";
import type { ApiUser, UserRole } from "@/types/contract";
import { api, clearAccessToken, getAccessToken, getMode, isDemo, setMode, setUnauthorizedHandler, type DataMode } from "./api";
import { MOCK_PASSWORD, MOCK_USERS } from "./mockData";

/**
 * Who is signed in. The token lives in sessionStorage (see api.ts); the public user profile sits next to it.
 * Closing the tab signs you out. Never store passwords here.
 */
const USER_KEY = "greenlight-session-user";
let cached: ApiUser | null | undefined;
const listeners = new Set<() => void>();
const sessionListeners = new Set<() => void>();

function read(): ApiUser | null {
  if (typeof window === "undefined") return null;
  if (cached !== undefined) return cached;
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    cached = raw && getAccessToken() ? (JSON.parse(raw) as ApiUser) : null;
  } catch { cached = null; }
  return cached;
}
function write(user: ApiUser | null) {
  cached = user;
  try {
    if (user) window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.sessionStorage.removeItem(USER_KEY);
  } catch { /* private mode */ }
  listeners.forEach(l => l());
  sessionListeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The signed-in user, or null. Always null on the server and during the first client render. */
export const useSession = (): ApiUser | null => useSyncExternalStore(subscribe, read, () => null);
export const getSessionUser = read;
/** Data stores subscribe here to drop and reload their data when the user changes. */
export function onSessionChange(fn: () => void): () => void { sessionListeners.add(fn); return () => { sessionListeners.delete(fn); }; }

/** Sign in against the live API or the built-in demo. The mode is remembered for this tab only. */
export async function signIn(email: string, password: string, mode: DataMode = getMode()): Promise<ApiUser> {
  const previous = getMode();
  setMode(mode);
  try {
    const result = await api.login({ email: email.trim(), password });
    write(result.user);
    return result.user;
  } catch (error) {
    setMode(previous);
    throw error;
  }
}
/** Demo only: jump to another role without signing out. Lets anyone see every role's view in seconds. */
export async function switchDemoRole(role: UserRole): Promise<void> {
  const target = MOCK_USERS.find(u => u.role === role);
  if (target) await signIn(target.email, MOCK_PASSWORD, "demo");
}
/** True while the signed-in session is the built-in demo. Re-renders when the user or mode changes. */
export const useIsDemo = (): boolean => useSyncExternalStore(subscribe, () => isDemo(), () => false);
export function signOut(): void {
  api.logout();
  clearAccessToken();
  write(null);
}
if (typeof window !== "undefined") setUnauthorizedHandler(() => write(null));

export const ROLE_LABEL: Record<UserRole, string> = { creator: "Creator", manager: "Manager", reviewer: "Reviewer", brand_admin: "Brand admin" };

/** What each role can do. The server enforces the same rules; this only decides what the UI offers. */
export const can = {
  submit: (r?: UserRole) => r === "creator",
  resolveFindings: (r?: UserRole) => r === "creator",
  decide: (r?: UserRole) => r === "reviewer",
  editBrandKit: (r?: UserRole) => r === "brand_admin",
  seeApprovals: (r?: UserRole) => r === "reviewer" || r === "manager",
  seeGaps: (r?: UserRole) => r === "brand_admin",
  comment: (r?: UserRole) => r === "creator" || r === "manager",
};
