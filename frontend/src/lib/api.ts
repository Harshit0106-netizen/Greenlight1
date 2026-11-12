import { ApiError } from "./api-error";
import { mockRequest } from "./mockData";

import type {
  LoginRequest,
  LoginResponse,
  UserRole,
  CollaboratorUser,
  SourceKind,
  BrandSource,
  CreateBrandSourceRequest,
  ReviewListItem,
  CreateReviewRequest,
  CreateReviewResponse,
  ReviewDetail,
  ApiFinding,
  PatchFindingRequest,
  PatchFindingResponse,
  CreateCommentRequest,
  CommentResponse,
  ReviewCollaboration,
  AuditResponse,
  AssignmentRequest,
  WorkflowResponse,
  EscalationRequest,
  WorkflowNoteRequest,
  InsightsSummary,
  InsightGap,
  RecurringIssue,
  AiDisclosure,
  FindingAction,
} from "../types/contract";

const DEFAULT_TIMEOUT_MS = 12_000;
const TOKEN_KEY = "greenlight-access-token";

/**
 * Demo or live is chosen at sign-in, not at build time, so one deployment can offer both.
 *   NEXT_PUBLIC_USE_MOCK=false + NEXT_PUBLIC_API_URL set -> live sign-in is available (demo is still offered)
 *   anything else                                       -> demo only (built-in sample data, no server)
 */
export const LIVE_AVAILABLE = Boolean(
  process.env.NEXT_PUBLIC_API_URL?.trim()
);
export type DataMode = "demo" | "live";
const MODE_KEY = "greenlight-mode";
export function getMode(): DataMode {
  if (!LIVE_AVAILABLE) return "demo";
  try { return window.sessionStorage.getItem(MODE_KEY) === "demo" ? "demo" : "live"; } catch { return "live"; }
}
export function setMode(mode: DataMode): void {
  try { window.sessionStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ }
}
export const isDemo = (): boolean => getMode() === "demo";

/** Is the live backend reachable? Used by the login page. The first call after idle can take ~10s (cold start). */
export async function pingApi(): Promise<boolean> {
  if (!LIVE_AVAILABLE) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try { return (await fetch(`${apiBaseUrl()}/health`, { signal: controller.signal })).ok; }
  catch { return false; }
  finally { clearTimeout(timer); }
}

let unauthorizedHandler: (() => void) | null = null;
/** The session module registers this so an expired token sends the user back to /login. */
export function setUnauthorizedHandler(fn: (() => void) | null): void { unauthorizedHandler = fn; }
export function getAccessToken(): string | null {
  return typeof window !== "undefined" ? window.sessionStorage.getItem(TOKEN_KEY) : null;
}

export { ApiError };

function apiBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  return value.replace(/\/$/, "");
}

/** Store only the short-lived access token; never store passwords or secrets. */
export function saveAccessToken(token: string): void {
  if (typeof window !== "undefined") window.sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearAccessToken(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(TOKEN_KEY);
}
export function hasAccessToken(): boolean {
  return typeof window !== "undefined" && Boolean(window.sessionStorage.getItem(TOKEN_KEY));
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (isDemo()) {
    try { return await mockRequest<T>(path, init, getAccessToken()); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401 && authenticated) { clearAccessToken(); unauthorizedHandler?.(); }
      throw error;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const token = typeof window !== "undefined" ? window.sessionStorage.getItem(TOKEN_KEY) : null;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (authenticated && token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try { payload = JSON.parse(raw); }
      catch { throw new ApiError("The server returned an invalid JSON response.", response.status, raw); }
    }
    if (!response.ok) {
      // Contract error shape: { "error": { "code": "...", "message": "..." } }
      const err = (payload as { error?: { message?: unknown } } | null)?.error;
      const detail = typeof err?.message === "string" ? err.message : `Request failed (${response.status}).`;
      if (response.status === 401 && authenticated) { clearAccessToken(); unauthorizedHandler?.(); }
      throw new ApiError(detail, response.status, payload);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Could not reach the Greenlight API. Check the backend and try again.");
  } finally {
    clearTimeout(timeout);
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const enc = (value: string) => encodeURIComponent(value);

/** Wire-level API methods. UI components should call repository/adapters, not fetch directly. */
export const api = {
  login: async (body: LoginRequest) => {
    const result = await request<LoginResponse>("/auth/login", json("POST", body), false);
    saveAccessToken(result.access_token);
    return result;
  },
  logout: () => clearAccessToken(),

  getWorkspaceUsers: (role?: UserRole) => request<CollaboratorUser[]>(`/auth/users${role ? `?role=${enc(role)}` : ""}`),

  getBrandSources: (kind?: SourceKind) => request<BrandSource[]>(
    `/brand-kit/sources${kind ? `?kind=${enc(kind)}` : ""}`,
  ),
  createBrandSource: (body: CreateBrandSourceRequest) => request<BrandSource>("/brand-kit/sources", json("POST", body)),

  getReviews: () => request<ReviewListItem[]>("/reviews"),
  createReview: (body: CreateReviewRequest) => request<CreateReviewResponse>("/reviews", json("POST", body)),
  getReview: (id: string) => request<ReviewDetail>(`/reviews/${enc(id)}`),
  getFindings: (id: string) => request<ApiFinding[]>(`/reviews/${enc(id)}/findings`),
  updateFinding: (findingId: string, body: PatchFindingRequest) => request<PatchFindingResponse>(`/findings/${enc(findingId)}`, json("PATCH", body)),
  addComment: (reviewId: string, body: CreateCommentRequest) => request<CommentResponse>(`/reviews/${enc(reviewId)}/comments`, json("POST", body)),
  getCollaboration: (reviewId: string) => request<ReviewCollaboration>(`/reviews/${enc(reviewId)}/collaboration`),
  getComments: (reviewId: string) => request<CommentResponse[]>(`/reviews/${enc(reviewId)}/comments`),
  getAudit: (reviewId: string) => request<AuditResponse[]>(`/reviews/${enc(reviewId)}/audit`),
  assignReviewer: (reviewId: string, body: AssignmentRequest) => request<WorkflowResponse>(`/reviews/${enc(reviewId)}/assign`, json("POST", body)),
  escalateReview: (reviewId: string, body: EscalationRequest) => request<WorkflowResponse>(`/reviews/${enc(reviewId)}/escalate`, json("POST", body)),
  approveReview: (reviewId: string, body: WorkflowNoteRequest) => request<WorkflowResponse>(`/reviews/${enc(reviewId)}/approve`, json("POST", body)),
  requestChanges: (reviewId: string, body: WorkflowNoteRequest) => request<WorkflowResponse>(`/reviews/${enc(reviewId)}/request-changes`, json("POST", body)),

  getInsightsSummary: () => request<InsightsSummary>("/insights/summary"),
  getInsightGaps: () => request<InsightGap[]>("/insights/gaps"),
  getRecurringInsights: () => request<RecurringIssue[]>("/insights/recurring"),
  getAiDisclosure: (reviewId: string) => request<AiDisclosure>(`/reviews/${enc(reviewId)}/ai-disclosure`),
};

export type { FindingAction };
