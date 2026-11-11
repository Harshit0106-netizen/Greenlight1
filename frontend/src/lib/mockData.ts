/**
 * Mock backend in the exact shape of the contract (docs/API.md). Used when NEXT_PUBLIC_USE_MOCK=true.
 *
 * It is stateful (kept in localStorage) and enforces the same rules as the real service:
 *   - only creators submit drafts and resolve their own findings
 *   - only reviewers approve / request changes, and only on `in_review` items
 *   - a review reaches `in_review` only when every finding is edited or disputed
 *   - creators see their own reviews, reviewers see escalated ones, managers/brand admins see all
 * so a screen that works on the mock works on the live backend. Fictional brand and people only.
 */
import type {
  AiDisclosure, ApiFinding, ApiSeverity, ApiUser, BrandSource, FindingAction, FindingType,
  InsightGap, InsightsSummary, LoginResponse, ReviewApiStatus, ReviewDetail, ReviewListItem, SourceKind,
} from "@/types/contract";
import { ApiError } from "./api-error";

const DB_KEY = "greenlight-mock-db-v1";
export const MOCK_PASSWORD = "greenlight-demo";
const LATENCY_MS = 120;

type MockUser = ApiUser & { email: string };
export const MOCK_USERS: MockUser[] = [
  { id: "U-1", name: "Aarav Mehta", email: "aarav@acme.com", role: "creator", workspace_id: "W-1" },
  { id: "U-2", name: "Harshit Verma", email: "harshit@acme.com", role: "manager", workspace_id: "W-1" },
  { id: "U-3", name: "Priya Nair", email: "priya@acme.com", role: "reviewer", workspace_id: "W-1" },
  { id: "U-4", name: "Ruchir Bharadwaj", email: "ruchir@acme.com", role: "brand_admin", workspace_id: "W-1" },
];
const userById = (id: string) => MOCK_USERS.find(u => u.id === id);

interface StoredSource extends BrandSource { kitVersion: number }
interface Decision { action: FindingAction; reason: string; actor: string; editedText?: string | null }
interface StoredFinding extends Omit<ApiFinding, "decision"> { reviewId: string; decisions: Decision[] }
interface StoredReview {
  id: string; title: string; creatorId: string; status: ReviewApiStatus; kitVersion: number;
  versions: string[]; createdAt: string; updatedAt: string; decidedAt: string | null; assignedReviewer?: string; escalationReason?: string;
}
interface Db {
  kitVersion: number; sources: StoredSource[]; reviews: StoredReview[]; findings: StoredFinding[]; comments: Array<{ id: string; reviewId: string; author: string; text: string; created_at: string }>; audit: Array<{ id: number; reviewId: string; actor: string; event_type: string; detail: Record<string, unknown>; reason: string; created_at: string }>;
  seq: { review: number; finding: number; comment: number; audit: number; source: Record<string, number> };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// ---- error helpers ------------------------------------------------------------------------------
const fail = (status: number, code: string, message: string) =>
  new ApiError(message, status, { error: { code, message } });
const unauthorized = (m = "Authentication required.") => fail(401, "unauthorized", m);
const forbidden = (m = "You do not have permission to do this.") => fail(403, "forbidden", m);
const notFound = (m = "Not found.") => fail(404, "not_found", m);
const invalid = (m = "Invalid request.") => fail(422, "validation_error", m);

// ---- detection (a small, honest stand-in for the backend's rules step) --------------------------
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLAIMS = /#\s?1\b|\bno\.?\s?1\b|\bnumber\s+one\b|\b(?:the\s+)?best(?:-selling)?\b|\bfastest\b|\bguaranteed?\b|\b100\s?%\b|\bzero[- ]risk\b|\bclinically\s+proven\b|\bcarbon[- ]neutral\b|\bmarket[- ]lead(?:er|ers|ing)\b|\bindustry[- ]lead(?:er|ers|ing)\b|\btop[- ]ranked\b/gi;
const URGENCY = /!{2,}|\b(?:don['’]t miss out|miss out|act now|hurry|last chance|limited time only)\b/gi;
const SHOUTING = /\b[A-Z]{5,}\b/g;
const IMAGE_REF = /\b[\w-]+\.(?:png|jpe?g|gif|webp)\b|\[image\]/gi;

interface Hit { type: FindingType; severity: ApiSeverity; start: number; end: number; text: string; source: StoredSource | null; reason: string; confidence: number; suggestion: ApiFinding["suggestion"] }

function parseTerm(s: StoredSource): { avoid: string; use: string | null; note: string } {
  const m = /^\s*use\s*[:\-–]?\s*["“'‘]?([^"”'’.;—–]+?)["”'’]?\s*(?:[.;—–]\s*([\s\S]*))?$/i.exec(s.text);
  return { avoid: s.title, use: m ? m[1].trim() : null, note: m?.[2]?.trim() ?? "" };
}

function detect(text: string, kit: StoredSource[]): Hit[] {
  const hits: Hit[] = [];
  const taken: Array<[number, number]> = [];
  const guideline = (...keys: string[]) => kit.find(s => s.kind === "guideline" && keys.some(k => `${s.title} ${s.text}`.toLowerCase().includes(k))) ?? null;
  const add = (h: Hit) => {
    if (taken.some(([a, b]) => h.start < b && h.end > a)) return;
    taken.push([h.start, h.end]);
    hits.push(h);
  };

  for (const m of text.matchAll(CLAIMS)) {
    const start = m.index ?? 0;
    // Extend a claim over the rest of its phrase so the flagged span reads naturally.
    const tail = /^[\w\s,'’-]{0,30}?(?:guaranteed|delivery|shipping|quality)?[\w,'’-]*/i.exec(text.slice(start + m[0].length))?.[0] ?? "";
    const span = (m[0] + tail).replace(/[\s,]+$/, "");
    const fact = /deliver|fast|ship/i.test(span) ? kit.find(s => s.kind === "fact" && /deliver/i.test(`${s.title} ${s.text}`)) : undefined;
    add({
      type: "unsupported_claim", severity: "high", start, end: start + span.length, text: span,
      source: guideline("superlative", "claim"),
      reason: "No approved fact supports this claim. It is unsupported, not proven false.", confidence: 0.91,
      suggestion: fact ? { text: fact.text.replace(/\.$/, ""), fact_id: fact.id, applied: false } : null,
    });
  }
  for (const m of text.matchAll(URGENCY)) {
    const start = m.index ?? 0;
    add({ type: "tone", severity: "medium", start, end: start + m[0].length, text: m[0], source: guideline("tone", "pressure"),
      reason: "Pressure language or repeated exclamation marks conflict with the helpful, confident brand voice.", confidence: 0.86, suggestion: null });
  }
  for (const t of kit.filter(s => s.kind === "term")) {
    const { avoid, use, note } = parseTerm(t);
    if (!avoid.trim()) continue;
    for (const m of text.matchAll(new RegExp(`\\b${esc(avoid.trim())}\\b`, "gi"))) {
      if (use && m[0] === use) continue;
      const start = m.index ?? 0;
      add({ type: "terminology", severity: "medium", start, end: start + m[0].length, text: m[0], source: t,
        reason: `“${m[0]}” does not match the approved terminology.${note ? ` ${note}` : ""}`, confidence: 0.97,
        suggestion: use ? { text: use, fact_id: null, applied: false } : null });
    }
  }
  if (!/alt\s*text\s*:/i.test(text)) {
    for (const m of text.matchAll(IMAGE_REF)) {
      const start = m.index ?? 0;
      add({ type: "accessibility", severity: "low", start, end: start + m[0].length, text: m[0], source: guideline("alt text", "accessib"),
        reason: "An image is referenced without descriptive alt text in the submitted copy.", confidence: 0.94, suggestion: null });
    }
  }
  for (const m of text.matchAll(SHOUTING)) {
    const start = m.index ?? 0;
    add({ type: "tone", severity: "low", start, end: start + m[0].length, text: m[0], source: guideline("tone"),
      reason: "All-caps words read as shouting and conflict with the calm, confident voice.", confidence: 0.8,
      suggestion: { text: m[0].charAt(0) + m[0].slice(1).toLowerCase(), fact_id: null, applied: false } });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return hits.sort((a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start);
}

// ---- database -----------------------------------------------------------------------------------
const src = (id: string, kind: SourceKind, title: string, text: string, kitVersion = 1): StoredSource =>
  ({ id, kind, title, text, version: `v${kitVersion}`, status: "active", kitVersion });

function emptyDb(): Db {
  return {
    kitVersion: 3, reviews: [], findings: [],
    comments: [], audit: [],
    seq: { review: 2001, finding: 1001, comment: 1, audit: 1, source: { guideline: 6, fact: 22, term: 11, asset: 2 } },
    sources: [
      src("G-4.2", "guideline", "Avoid unsupported superlatives", "Do not use claims such as '#1', 'best' or 'fastest' unless an approved fact substantiates them."),
      src("G-2.1", "guideline", "Use a helpful, confident tone", "Be clear and reassuring in the brand voice. Avoid pressure tactics, excessive exclamation marks and fear-based language."),
      src("G-5.1", "guideline", "Accessibility basics", "Every image needs descriptive alt text, link text must make sense on its own, and text needs WCAG AA contrast."),
      src("F-12", "fact", "Delivery coverage", "Fast delivery is available in select cities.", 2),
      src("F-18", "fact", "Bottle capacity", "The Zippy Bottle has a 750 ml capacity.", 2),
      src("F-21", "fact", "Material", "Made with BPA-free, food-grade stainless steel.", 2),
      src("T-8", "term", "Zippy bottle", "Use: Zippy Bottle. Approved product name and capitalisation.", 3),
      src("T-9", "term", "Cheap", "Use: Affordable. Preferred value-proposition language.", 3),
      src("T-10", "term", "Best ever", "Use: Reliable. Superlatives need an approved fact.", 3),
      src("A-1", "asset", "Brand palette", "Approved colours: Primary #315CE8, Ink #111827, Accent #A5B4FC, Canvas #F6F7FB.", 3),
    ],
  };
}

function submit(db: Db, userId: string, title: string, content: string, minutesAgo: number): StoredReview {
  const id = `CL-${db.seq.review++}`;
  const at = ago(minutesAgo);
  const review: StoredReview = { id, title, creatorId: userId, status: "scanned", kitVersion: db.kitVersion, versions: [content], createdAt: at, updatedAt: at, decidedAt: null };
  db.reviews.push(review);
  db.audit.push({ id: db.seq.audit++, reviewId: id, actor: userById(userId)?.name ?? "You", event_type: "review_submitted", detail: {}, reason: "", created_at: at });
  for (const h of detect(content, db.sources)) {
    db.findings.push({
      finding_id: `FD-${db.seq.finding++}`, reviewId: id, type: h.type, severity: h.severity,
      span: { start: h.start, end: h.end, text: h.text },
      source: h.source ? { kind: h.source.kind, id: h.source.id, version: h.source.version } : null,
      fact_match: null, reason: h.reason, confidence: h.confidence, method: "rule_based", suggestion: h.suggestion, decisions: [],
    });
  }
  db.audit.push({ id: db.seq.audit++, reviewId: id, actor: "Greenlight", event_type: "scan_completed", detail: { findings: db.findings.filter(f => f.reviewId === id).length }, reason: "", created_at: at });
  if (!db.findings.some(f => f.reviewId === id)) review.status = "in_review";
  return review;
}

function seedDb(): Db {
  const db = emptyDb();
  const aarav = "U-1";
  const risky = submit(db, aarav, "Summer launch announcement",
    "Introducing the all-new Zippy bottle.\n\nIndia's #1 fastest delivery, guaranteed.\n\nGrab one today, or miss out!!!\n\nImage: banner.png", 190);
  risky.updatedAt = ago(46);

  const ready = submit(db, aarav, "Product feature email",
    "Hi there,\n\nMeet the Zippy bottle — made with BPA-free, food-grade stainless steel.\n\nIt ships this week.", 330);
  for (const f of db.findings.filter(x => x.reviewId === ready.id)) {
    f.decisions.push({ action: "edited", reason: "Edited the flagged wording.", actor: aarav, editedText: "Zippy Bottle" });
    ready.versions.push(ready.versions[ready.versions.length - 1].replace(f.span.text, "Zippy Bottle"));
    f.span = { start: f.span.start, end: f.span.start + "Zippy Bottle".length, text: "Zippy Bottle" };
  }
  ready.status = "in_review"; ready.updatedAt = ago(120);

  const done = submit(db, aarav, "October product update",
    "October product update\n\nThe Zippy Bottle has a 750 ml capacity. Fast delivery is available in select cities.", 1800);
  done.status = "approved"; done.decidedAt = ago(1500); done.updatedAt = ago(1500);

  const bounced = submit(db, aarav, "Back-to-school banner",
    "Back to school with the Zippy Bottle.\n\nOur best ever bottle, in the best colours.\n\nImage: school-banner.png", 2600);
  for (const f of db.findings.filter(x => x.reviewId === bounced.id)) {
    f.decisions.push({ action: "disputed", reason: "Approved by legal for this campaign.", actor: aarav });
  }
  bounced.status = "changes_requested"; bounced.updatedAt = ago(2200);
  return db;
}

let cache: Db | null = null;
function load(): Db {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DB_KEY) : null;
    if (raw) { cache = JSON.parse(raw) as Db; return cache; }
  } catch { /* fall through to a fresh seed */ }
  cache = seedDb();
  save();
  return cache;
}
function save() {
  try { if (cache && typeof window !== "undefined") window.localStorage.setItem(DB_KEY, JSON.stringify(cache)); } catch { /* quota / private mode */ }
}
/** Restores the demo workspace (used by Settings → Reset demo data). */
export function resetMockDb(): void {
  cache = seedDb();
  save();
}

// ---- the same state machine and visibility rules as the backend ---------------------------------
const REVIEWER_VISIBLE: ReviewApiStatus[] = ["in_review", "approved", "changes_requested"];
const EDITABLE: ReviewApiStatus[] = ["scanned", "resolving", "changes_requested"];
const TRANSITIONS: Record<ReviewApiStatus, ReviewApiStatus[]> = {
  draft: ["scanned"], scanned: ["resolving", "in_review"], resolving: ["resolving", "in_review"],
  in_review: ["approved", "changes_requested"], changes_requested: ["resolving", "in_review"], approved: [],
};
const canView = (u: MockUser, r: StoredReview) =>
  u.role === "creator" ? r.creatorId === u.id : u.role === "reviewer" ? REVIEWER_VISIBLE.includes(r.status) || r.assignedReviewer === u.id || Boolean(r.escalationReason) : true;
const content = (r: StoredReview) => r.versions[r.versions.length - 1];
const latest = (f: StoredFinding) => f.decisions[f.decisions.length - 1] ?? null;
const unresolved = (db: Db, id: string) => db.findings.filter(f => f.reviewId === id && (latest(f) === null || latest(f)!.action === "accepted")).length;

function transition(r: StoredReview, to: ReviewApiStatus) {
  if (!TRANSITIONS[r.status].includes(to)) throw invalid(`A review cannot move from ${r.status} to ${to}.`);
  r.status = to;
  r.updatedAt = new Date().toISOString();
}
function reviewFor(db: Db, u: MockUser, id: string): StoredReview {
  const r = db.reviews.find(x => x.id === id);
  if (!r || !canView(u, r)) throw notFound("Review not found.");
  return r;
}
const toFinding = (f: StoredFinding): ApiFinding => {
  const { reviewId: _r, decisions: _d, ...rest } = f; void _r; void _d;
  const d = latest(f);
  return { ...rest, decision: d ? { action: d.action, reason: d.reason, actor: d.actor } : null };
};

// ---- request router -----------------------------------------------------------------------------
export async function mockRequest<T>(path: string, init: RequestInit = {}, token: string | null = null): Promise<T> {
  await new Promise(r => setTimeout(r, LATENCY_MS));
  const method = (init.method ?? "GET").toUpperCase();
  const body = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
  const [route, query = ""] = path.split("?");
  const db = load();

  if (route === "/auth/login" && method === "POST") {
    const user = MOCK_USERS.find(u => u.email === String(body.email ?? "").trim().toLowerCase());
    if (!user || body.password !== MOCK_PASSWORD) throw unauthorized("Incorrect email or password.");
    const { email: _e, ...publicUser } = user; void _e;
    const out: LoginResponse = { access_token: `mock.${user.id}`, token_type: "bearer", user: publicUser };
    return out as T;
  }

  const user = token?.startsWith("mock.") ? userById(token.slice(5)) : undefined;
  if (!user) throw unauthorized();

  if (route === "/auth/users") {
    const role = new URLSearchParams(query).get("role");
    if (!(user.role === "manager" || user.role === "reviewer")) throw forbidden("Only managers and reviewers can view workspace reviewers.");
    out = MOCK_USERS.filter(u => u.workspace_id === user.workspace_id && (!role || u.role === role)).map(({ email: _e, ...u }) => { void _e; return u; });
    return out as T;
  }
  let out: unknown;
  let m: RegExpExecArray | null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");

  if (route === "/brand-kit/sources") {
    if (method === "POST") {
      if (user.role !== "brand_admin") throw forbidden("Only brand admins can change the Brand Kit.");
      const kind = body.kind as SourceKind;
      const title = text(body.title).trim(), t = text(body.text).trim();
      if (!["guideline", "fact", "term", "asset"].includes(kind)) throw invalid("kind: invalid value");
      if (!title || !t) throw invalid("title and text are required.");
      db.kitVersion += 1;
      const prefix = { guideline: "G", fact: "F", term: "T", asset: "A" }[kind];
      const n = db.seq.source[kind]++;
      const created = src(`${prefix}-${n}`, kind, title, t, db.kitVersion);
      db.sources.push(created);
      out = { id: created.id, kind, title, text: t, version: created.version, status: "active" } satisfies BrandSource;
    } else {
      const kind = new URLSearchParams(query).get("kind");
      out = db.sources.filter(s => !kind || s.kind === kind).map(({ kitVersion: _k, ...s }) => { void _k; return s; });
    }
  } else if (route === "/reviews" && method === "POST") {
    if (user.role !== "creator") throw forbidden("Only creators can submit drafts.");
    const title = text(body.title).trim(), draft = text(body.content);
    if (!title) throw invalid("title: field required");
    if (!draft.trim()) throw invalid("content: field required");
    const r = submit(db, user.id, title, draft, 0);
    out = { id: r.id, status: r.status, finding_count: db.findings.filter(f => f.reviewId === r.id).length };
  } else if (route === "/reviews") {
    const rows = db.reviews.filter(r => canView(user, r)).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    out = rows.map(r => ({
      id: r.id, title: r.title, creator: userById(r.creatorId)?.name ?? "Unknown", status: r.status,
      finding_count: db.findings.filter(f => f.reviewId === r.id).length, updated_at: r.updatedAt,
    } satisfies ReviewListItem));
  } else if ((m = /^\/reviews\/([^/]+)$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = { id: r.id, title: r.title, content: content(r), status: r.status, creator: userById(r.creatorId)?.name ?? "Unknown",
      brand_kit_version: `v${r.kitVersion}`, updated_at: r.updatedAt, assigned_reviewer: userById(r.assignedReviewer ?? "")?.name ?? null, escalation_reason: r.escalationReason ?? "", content_type: "text", content_blocks: [] } satisfies ReviewDetail;
  } else if ((m = /^\/reviews\/([^/]+)\/findings$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    const rank = { high: 0, medium: 1, low: 2 };
    out = db.findings.filter(f => f.reviewId === r.id).sort((a, b) => rank[a.severity] - rank[b.severity] || a.span.start - b.span.start).map(toFinding);
  } else if ((m = /^\/findings\/([^/]+)$/.exec(route)) && method === "PATCH") {
    const f = db.findings.find(x => x.finding_id === decodeURIComponent(m![1]));
    const r = f && db.reviews.find(x => x.id === f.reviewId);
    if (!f || !r) throw notFound("Finding not found.");
    if (user.role !== "creator" || r.creatorId !== user.id) throw forbidden("Only the creator of this review can accept, edit or dispute its findings.");
    if (!EDITABLE.includes(r.status)) throw invalid(`Findings cannot be changed while the review is ${r.status}.`);
    const action = body.action as FindingAction;
    if (!["accepted", "edited", "disputed"].includes(action)) throw invalid("action: invalid value");
    let reason = text(body.reason).trim();
    if (action === "disputed" && !reason) throw invalid("A reason is required to dispute a finding.");
    const edited = typeof body.edited_text === "string" ? body.edited_text : null;
    if (action === "edited") {
      if (!edited || !edited.trim()) throw invalid("edited_text is required when action is 'edited'.");
      const current = content(r);
      if (current.slice(f.span.start, f.span.end) !== f.span.text) throw invalid("The flagged text has changed; reload the review.");
      const delta = edited.length - (f.span.end - f.span.start);
      r.versions.push(current.slice(0, f.span.start) + edited + current.slice(f.span.end));
      for (const o of db.findings) if (o.reviewId === r.id && o !== f && o.span.start >= f.span.end) o.span = { ...o.span, start: o.span.start + delta, end: o.span.end + delta };
      f.span = { start: f.span.start, end: f.span.start + edited.length, text: edited };
      if (f.suggestion) f.suggestion = { ...f.suggestion, applied: edited === f.suggestion.text };
      reason = reason || "Edited the flagged wording.";
    }
    f.decisions.push({ action, reason, actor: user.id, editedText: action === "edited" ? edited : null });
    transition(r, unresolved(db, r.id) === 0 ? "in_review" : "resolving");
    out = { finding_id: f.finding_id, decision: { action, reason, actor: user.id } };
  } else if ((m = /^\/reviews\/([^/]+)\/collaboration$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = { assigned_reviewer: userById(r.assignedReviewer ?? "")?.name ?? null, escalation_reason: r.escalationReason ?? "", content_type: "text", content_blocks: [] };
  } else if ((m = /^\/reviews\/([^/]+)\/comments$/.exec(route)) && method === "GET") {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = db.comments.filter(c => c.reviewId === r.id).map(c => ({ id: c.id, author: c.author, text: c.text, created_at: c.created_at }));
  } else if ((m = /^\/reviews\/([^/]+)\/audit$/.exec(route)) && method === "GET") {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = db.audit.filter(a => a.reviewId === r.id).map(a => ({ id: a.id, actor: a.actor, event_type: a.event_type, detail: a.detail, reason: a.reason, created_at: a.created_at }));
  } else if ((m = /^\/reviews\/([^/]+)\/assign$/.exec(route)) && method === "POST") {
    if (user.role !== "manager") throw forbidden("Only managers can assign reviewers.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    const reviewer = userById(text(body.reviewer_id));
    if (!reviewer || reviewer.role !== "reviewer" || reviewer.workspace_id !== user.workspace_id) throw invalid("Reviewer must be a reviewer in the same workspace.");
    r.assignedReviewer = reviewer.id; r.updatedAt = new Date().toISOString();
    db.audit.push({ id: db.seq.audit++, reviewId: r.id, actor: user.name, event_type: "review_assigned", detail: { reviewer_id: reviewer.id, reviewer: reviewer.name }, reason: "Assigned for collaborative review", created_at: new Date().toISOString() });
    out = { id: r.id, status: r.status };
  } else if ((m = /^\/reviews\/([^/]+)\/escalate$/.exec(route)) && method === "POST") {
    if (user.role !== "manager") throw forbidden("Only managers can escalate reviews.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    const reason = text(body.reason).trim(); if (!reason) throw invalid("reason: field required");
    r.escalationReason = reason; r.updatedAt = new Date().toISOString();
    db.audit.push({ id: db.seq.audit++, reviewId: r.id, actor: user.name, event_type: "review_escalated", detail: { reason }, reason, created_at: new Date().toISOString() });
    out = { id: r.id, status: r.status };
  } else if ((m = /^\/reviews\/([^/]+)\/comments$/.exec(route)) && method === "POST") {
    if (!["creator", "manager"].includes(user.role)) throw forbidden("Only creators and managers can comment.");
    reviewFor(db, user, decodeURIComponent(m[1]));
    const t = text(body.text).trim();
    if (!t) throw invalid("text: field required");
    const created_at = new Date().toISOString();
    const id = `C-${db.seq.comment++}`;
    db.comments.push({ id, reviewId: decodeURIComponent(m[1]), author: user.name, text: t, created_at });
    db.audit.push({ id: db.seq.audit++, reviewId: decodeURIComponent(m[1]), actor: user.name, event_type: "comment_added", detail: { comment_id: id }, reason: "", created_at });
    out = { id, author: user.name, text: t, created_at };
  } else if ((m = /^\/reviews\/([^/]+)\/(approve|request-changes)$/.exec(route)) && method === "POST") {
    if (user.role !== "reviewer") throw forbidden("Only reviewers can approve or request changes.");
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    if (r.status !== "in_review") throw invalid(`Only reviews that are in_review can be decided (this one is ${r.status}).`);
    const approving = m[2] === "approve";
    const note = text(body.note).trim();
    if (approving && unresolved(db, r.id)) throw invalid("Every finding must be edited or disputed before approval.");
    if (!approving && !note) throw invalid("A note is required when requesting changes.");
    transition(r, approving ? "approved" : "changes_requested");
    r.decidedAt = approving ? new Date().toISOString() : null;
    out = { id: r.id, status: r.status };
  } else if ((m = /^\/reviews\/([^/]+)\/ai-disclosure$/.exec(route))) {
    const r = reviewFor(db, user, decodeURIComponent(m[1]));
    out = { review_id: r.id, steps: [
      { step: "rules", used_ai: false },
      { step: "retrieve", used_ai: false, data_sent: "none (embeddings computed on our own server)" },
      { step: "judge", used_ai: false, data_sent: "none (rules-only mode: LLM unavailable)" },
    ] } satisfies AiDisclosure;
  } else if (route === "/insights/summary") {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const rows = db.reviews.filter(r => canView(user, r));
    const counts = new Map<FindingType, number>();
    for (const f of db.findings) if (rows.some(r => r.id === f.reviewId)) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    out = {
      reviewed_this_month: rows.filter(r => +new Date(r.createdAt) >= monthStart).length,
      needs_attention: rows.filter(r => ["scanned", "resolving", "changes_requested"].includes(r.status)).length,
      awaiting_approval: rows.filter(r => r.status === "in_review").length,
      approved_this_month: rows.filter(r => r.status === "approved" && r.decidedAt && +new Date(r.decidedAt) >= monthStart).length,
      top_issues: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([type, count]) => ({ type, count })),
    } satisfies InsightsSummary;
  } else if (route === "/insights/recurring") {
    const rows = db.reviews.filter(r => canView(user, r));
    const counts = new Map<FindingType, number>();
    for (const f of db.findings) if (rows.some(r => r.id === f.reviewId)) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    out = [...counts].filter(([, count]) => count >= 2).slice(0, 5).map(([type, count]) => {
      const review_count = new Set(db.findings.filter(f => f.type === type && rows.some(r => r.id === f.reviewId)).map(f => f.reviewId)).size;
      return { type, count, review_count, rate: review_count / Math.max(1, rows.length), recommendation: "Review the related Brand Kit guidance and publishing workflow." };
    });
  } else if (route === "/insights/gaps") {
    if (user.role !== "brand_admin") throw forbidden("Only brand admins can view guideline-gap insights.");
    const counts = new Map<string, number>();
    for (const f of db.findings) if (f.source && latest(f)?.action === "disputed") counts.set(f.source.id, (counts.get(f.source.id) ?? 0) + 1);
    out = [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({
      source_id: id, title: db.sources.find(s => s.id === id)?.title ?? id, dispute_count: n,
      note: n >= 5 ? "Often disputed; may be unclear." : `Disputed ${n} time(s); consider clarifying the wording.`,
    } satisfies InsightGap));
  } else {
    throw notFound(`No mock for ${method} ${route}`);
  }
  save();
  return out as T;
}
