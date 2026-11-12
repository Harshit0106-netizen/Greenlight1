"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { BrandSource } from "@/types/contract";
import { api, getMode, isDemo } from "@/lib/api";
import { uid } from "@/lib/format";
import { resetMockDb } from "@/lib/mockData";
import { createPersistentStore } from "@/lib/persistent-store";
import { getSessionUser, onSessionChange } from "@/lib/session";
import { reviewFromApi, type ReviewMeta } from "./adapters";
import { markTour, resetTour } from "@/features/tour/store";
import { canApprove } from "./metrics";
import type { AuditEntry, AuditKind, CommentEntry, FindingStatus, Review, ReviewInput } from "../types";

/**
 * Review repository. Every read and write goes through lib/api.ts (mock or live, one switch).
 * The screens read this store; they never call fetch.
 *
 * Browser-only extras (the API has no field for them yet): channel / depth / intent, the submitted copy, the wording
 * before an edit, and an activity log of what *this browser* did. The server's own audit trail is authoritative.
 */
type State = { reviews: Review[]; loaded: boolean; error: string };
const EMPTY: Review[] = [];
const SERVER_STATE: State = { reviews: EMPTY, loaded: false, error: "" };
let state: State = SERVER_STATE;
let loading = false;
let sources = new Map<string, BrandSource>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function set(next: Partial<State>) { state = { ...state, ...next }; listeners.forEach(l => l()); }

const metaStore = createPersistentStore<Record<string, ReviewMeta>>("greenlight-review-meta-v1", () => ({}), {});
const auditStore = createPersistentStore<Record<string, AuditEntry[]>>("greenlight-audit-v1", () => ({}), {});
const dataSource = (): Review["source"] => (isDemo() ? "local-demo" : "api");
/** Local records are namespaced by mode so demo and live reviews (which share id formats) never mix. */
const key = (id: string) => `${getMode()}:${id}`;

const actorName = () => getSessionUser()?.name ?? "You";
const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s);
function log(reviewId: string, kind: AuditKind, message: string, findingId?: string, actor = actorName()) {
  const e: AuditEntry = { id: uid("AU"), at: new Date().toISOString(), actor, kind, message, findingId };
  auditStore.update(all => ({ ...all, [key(reviewId)]: [...(all[key(reviewId)] ?? []), e] }));
}

function auditMessage(event: string, detail: Record<string, unknown>, reason: string) {
  if (event === "review_submitted") return "Review submitted for brand review.";
  if (event === "scan_completed") return `Automated analysis completed with ${String(detail.findings ?? 0)} finding${Number(detail.findings) === 1 ? "" : "s"}.`;
  if (event === "structured_content_validated") return `Structured content checked: ${String(detail.image_assets ?? 0)} visual asset${Number(detail.image_assets) === 1 ? "" : "s"}, ${String(detail.missing_alt_text ?? 0)} missing alt-text item${Number(detail.missing_alt_text) === 1 ? "" : "s"}.`;
  if (event === "content_edited") return `Draft updated to version ${String(detail.version ?? "")}${reason ? ` — ${reason}` : ""}.`;
  if (event === "finding_decision") return `Finding ${String(detail.finding_id ?? "")} marked ${String(detail.action ?? "")} ${reason ? `— ${reason}` : ""}`;
  if (event === "review_assigned") return `Review assigned to ${String(detail.reviewer ?? "a reviewer")}.`;
  if (event === "review_escalated") return `Review escalated${reason ? ` — ${reason}` : ""}.`;
  if (event === "comment_added") return "Comment added to the review.";
  if (event === "approved") return `Review approved${reason ? ` — ${reason}` : ""}.`;
  if (event === "changes_requested") return `Changes requested${reason ? ` — ${reason}` : ""}.`;
  if (event === "status_changed") return `Status changed from ${String(detail.from ?? "")} to ${String(detail.to ?? "")}${reason ? ` — ${reason}` : ""}.`;
  return event.replaceAll("_", " ");
}

async function fetchReview(id: string): Promise<Review | null> {
  try {
    const [detail, findings, collaboration, audit, comments] = await Promise.all([
      api.getReview(id), api.getFindings(id), api.getCollaboration(id).catch(() => ({})),
      api.getAudit(id).catch(() => []), api.getComments(id).catch(() => []),
    ]);
    const serverAudit: AuditEntry[] = audit.map(e => ({
      id: `AU-${e.id}`, at: e.created_at, actor: e.actor,
      kind: e.event_type === "review_assigned" ? "assignment" : e.event_type === "review_escalated" ? "escalation" : e.event_type === "comment_added" ? "comment" : e.event_type === "finding_decision" ? "decision" : e.event_type === "content_edited" ? "edit" : e.event_type === "status_changed" || e.event_type === "approved" || e.event_type === "changes_requested" ? "status" : e.event_type === "scan_completed" || e.event_type === "structured_content_validated" ? "analysis" : "submitted" as AuditKind,
      message: auditMessage(e.event_type, e.detail, e.reason),
    }));
    const localAudit = auditStore.read()[key(id)] ?? [];
    const merged = serverAudit.length ? serverAudit : localAudit;
    const mappedComments: CommentEntry[] = comments.map(c => ({ id: c.id, author: c.author, text: c.text, at: c.created_at }));
    return reviewFromApi(detail, findings, sources, metaStore.read()[key(id)], merged, dataSource(), mappedComments, collaboration);
  } catch { return null; }
}
async function refreshOne(id: string) {
  const fresh = await fetchReview(id);
  if (!fresh) return;
  const exists = state.reviews.some(r => r.id === id);
  set({ reviews: exists ? state.reviews.map(r => (r.id === id ? fresh : r)) : [fresh, ...state.reviews] });
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const [list, kit] = await Promise.all([api.getReviews(), api.getBrandSources().catch(() => [] as BrandSource[])]);
    sources = new Map(kit.map(s => [s.id, s]));
    const reviews = (await Promise.all(list.map(item => fetchReview(item.id)))).filter((r): r is Review => r !== null);
    set({ reviews, loaded: true, error: "" });
  } catch (e) {
    set({ loaded: true, error: e instanceof Error ? e.message : "Could not load reviews." });
  } finally { loading = false; }
}
function ensureLoaded() { if (getSessionUser() && !state.loaded && !loading) void load(); }
/** Retry after an error, or refresh after something changed elsewhere. */
export function reloadReviews() { state = { reviews: state.reviews, loaded: false, error: "" }; listeners.forEach(l => l()); ensureLoaded(); }

if (typeof window !== "undefined") {
  onSessionChange(() => { state = { reviews: EMPTY, loaded: false, error: "" }; loading = false; listeners.forEach(l => l()); ensureLoaded(); });
}

function useEnsure() { useEffect(() => { ensureLoaded(); }, []); }
export function useReviews(): Review[] { useEnsure(); return useSyncExternalStore(subscribe, () => state.reviews, () => EMPTY); }
export function useReview(id: string): Review | undefined { useEnsure(); return useSyncExternalStore(subscribe, () => state.reviews.find(r => r.id === id), () => undefined); }
/** False until the first load finishes (server render included). Use it to show skeletons. */
export function useReviewsLoaded(): boolean { useEnsure(); return useSyncExternalStore(subscribe, () => state.loaded, () => false); }
export function useReviewsError(): string { return useSyncExternalStore(subscribe, () => state.error, () => ""); }

/** Clears this browser's records for the current mode. In demo it also restores the sample workspace; the live backend is never touched. */
export function resetReviews(mode = getMode()) {
  const keep = <T,>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(`${mode}:`)));
  metaStore.update(keep); auditStore.update(keep);
  if (mode === "demo") { resetMockDb(); resetTour(); }
  reloadReviews();
}

export async function createReview(input: ReviewInput): Promise<Review> {
  const created = await api.createReview({ title: input.title, content: input.content, intent_note: input.intent ?? "", content_type: input.contentType, content_blocks: input.contentBlocks, external_ref: input.externalRef });
  metaStore.update(m => ({ ...m, [key(created.id)]: { channel: input.channel, mode: input.mode, intent: input.intent, original: input.content } }));
  markTour("submit");
  log(created.id, "submitted", "Submitted for review");
  log(created.id, "analysis", `${created.finding_count} potential issue${created.finding_count === 1 ? "" : "s"} found by the checks. Human review is required.`, undefined, "Greenlight");
  await refreshOne(created.id);
  const review = state.reviews.find(r => r.id === created.id);
  if (!review) throw new Error("The review was created but could not be loaded. Open it from the reviews list.");
  return review;
}

const verb = { Accepted: "Confirmed finding", Disputed: "Marked not applicable" } as const;

/** Confirm a finding as valid, or dispute it. Disputing needs a reason (the server requires one too). */
export async function decideFinding(id: string, findingId: string, status: Extract<FindingStatus, "Accepted" | "Disputed">, reason = "") {
  const f = state.reviews.find(r => r.id === id)?.findings.find(x => x.id === findingId);
 await api.updateFinding(findingId, {
  action: status === "Accepted" ? "accepted" : "disputed",});
  log(id, "finding", `${verb[status]} “${clip(f?.quote ?? "")}”${reason.trim() ? ` — ${reason.trim()}` : ""}`, findingId);
  await refreshOne(id);
  if (state.reviews.find(r => r.id === id)?.status === "In review") markTour("resolve");
}

/** Replaces the flagged phrase through the API (the server rewrites the draft and records a new version). */
export async function rewriteFinding(id: string, findingId: string, replacement: string, via: "suggestion" | "manual") {
  const f = state.reviews.find(r => r.id === id)?.findings.find(x => x.id === findingId);
  if (!f || !replacement.trim()) return;
  await api.updateFinding(findingId, { action: "edited", });
  metaStore.update(m => {
    const cur = m[key(id)] ?? {};
    return { ...m, [key(id)]: { ...cur, originals: { ...cur.originals, [findingId]: cur.originals?.[findingId] ?? f.quote } } };
  });
  log(id, "edit", `${via === "suggestion" ? "Applied suggested wording to" : "Replaced flagged wording in"} “${clip(f.quote)}”`, findingId);
  await refreshOne(id);
  if (state.reviews.find(r => r.id === id)?.status === "In review") markTour("resolve");
}

/** Reviewer only (the server enforces it). Approval is blocked while any finding is open or only confirmed. */
export async function approveReview(id: string, note = ""): Promise<boolean> {
  const review = state.reviews.find(r => r.id === id);
  if (!review || !canApprove(review)) return false;
  await api.approveReview(id, { note });
  log(id, "status", `Approved content for publication${note.trim() ? ` — ${note.trim()}` : ""}`);
  markTour("approve");
  await refreshOne(id);
  return true;
}
export async function requestChanges(id: string, note: string) {
  await api.requestChanges(id, { note });
  log(id, "status", `Requested changes — ${note.trim()}`);
  await refreshOne(id);
}
