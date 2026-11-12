/**
 * Mock backend aligned with the current frontend API contract.
 * Used when NEXT_PUBLIC_USE_MOCK=true.
 *
 * It is stateful (localStorage) and mirrors the review workflow used by the
 * live service closely enough for local/demo UI testing.
 */

import type {
  AiDisclosure,
  ApiFinding,
  BrandSource,
  CollaboratorUser,
  FindingAction,
  InsightGap,
  InsightsSummary,
  LoginResponse,
  ReviewDetail,
  ReviewListItem,
  ReviewStatus,
  SourceKind,
} from "@/types/contract";
import { ApiError } from "./api-error";

type FindingType = string;
type ApiSeverity = "high" | "medium" | "low";

const DB_KEY = "greenlight-mock-db-v1";
export const MOCK_PASSWORD = "greenlight-demo";
const LATENCY_MS = 120;

type MockUser = CollaboratorUser & {
  workspace_id: string;
};

export const MOCK_USERS: MockUser[] = [
  { id: "U-1", name: "Aarav Mehta", email: "aarav@acme.com", role: "creator", workspace_id: "W-1" },
  { id: "U-2", name: "Harshit Verma", email: "harshit@acme.com", role: "manager", workspace_id: "W-1" },
  { id: "U-3", name: "Priya Nair", email: "priya@acme.com", role: "reviewer", workspace_id: "W-1" },
  { id: "U-4", name: "Ruchir Bharadwaj", email: "ruchir@acme.com", role: "brand_admin", workspace_id: "W-1" },
];

const userById = (id: string) => MOCK_USERS.find((u) => u.id === id);

interface StoredSource extends BrandSource {
  kitVersion: number;
}

interface Decision {
  action: FindingAction;
  reason: string;
  actor: string;
  editedText?: string | null;
}

interface StoredFinding extends ApiFinding {
  reviewId: string;
  decisions: Decision[];
}

interface StoredReview {
  id: string;
  title: string;
  creatorId: string;
  status: ReviewStatus;
  kitVersion: number;
  versions: string[];
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  assignedReviewer?: string;
  escalationReason?: string;
}

interface Db {
  kitVersion: number;
  sources: StoredSource[];
  reviews: StoredReview[];
  findings: StoredFinding[];
  comments: Array<{
    id: string;
    reviewId: string;
    author: string;
    text: string;
    created_at: string;
  }>;
  audit: Array<{
    id: number;
    reviewId: string;
    actor: string;
    event_type: string;
    detail: Record<string, unknown>;
    reason: string;
    created_at: string;
  }>;
  seq: {
    review: number;
    finding: number;
    comment: number;
    audit: number;
    source: Record<SourceKind, number>;
  };
}

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const fail = (status: number, code: string, message: string) =>
  new ApiError(message, status, { error: { code, message } });

const unauthorized = (m = "Authentication required.") =>
  fail(401, "unauthorized", m);

const forbidden = (m = "You do not have permission to do this.") =>
  fail(403, "forbidden", m);

const notFound = (m = "Not found.") =>
  fail(404, "not_found", m);

const invalid = (m = "Invalid request.") =>
  fail(422, "validation_error", m);

const text = (v: unknown) => (typeof v === "string" ? v : "");

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CLAIMS =
  /#\s?1\b|\bno\.?\s?1\b|\bnumber\s+one\b|\b(?:the\s+)?best(?:-selling)?\b|\bfastest\b|\bguaranteed?\b|\b100\s?%\b|\bzero[- ]risk\b|\bclinically\s+proven\b|\bcarbon[- ]neutral\b|\bmarket[- ]lead(?:er|ers|ing)\b|\bindustry[- ]lead(?:er|ers|ing)\b|\btop[- ]ranked\b/gi;

const URGENCY =
  /!{2,}|\b(?:don't miss out|miss out|act now|hurry|last chance|limited time only)\b/gi;

const SHOUTING = /\b[A-Z]{5,}\b/g;

const IMAGE_REF =
  /\b[\w-]+\.(?:png|jpe?g|gif|webp)\b|\[image\]/gi;

interface Hit {
  type: FindingType;
  severity: ApiSeverity;
  start: number;
  end: number;
  text: string;
  source: StoredSource | null;
  reason: string;
  confidence: number;
  suggestion: string;
}

function parseTerm(
  source: StoredSource,
): { avoid: string; use: string | null; note: string } {
  const match =
    /^\s*use\s*[:\-–]?\s*["“'‘]?([^"”'’.;—–]+?)["”'’]?\s*(?:[.;—–]\s*([\s\S]*))?$/i.exec(
      source.content,
    );

  return {
    avoid: source.title,
    use: match ? match[1].trim() : null,
    note: match?.[2]?.trim() ?? "",
  };
}

function detect(textValue: string, kit: StoredSource[]): Hit[] {
  const hits: Hit[] = [];
  const taken: Array<[number, number]> = [];

  const guideline = (...keys: string[]) =>
    kit.find(
      (source) =>
        source.kind === "guideline" &&
        keys.some((key) =>
          `${source.title} ${source.content}`.toLowerCase().includes(key),
        ),
    ) ?? null;

  const add = (hit: Hit) => {
    if (taken.some(([a, b]) => hit.start < b && hit.end > a)) return;
    taken.push([hit.start, hit.end]);
    hits.push(hit);
  };

  for (const match of textValue.matchAll(CLAIMS)) {
    const start = match.index ?? 0;
    const tail =
      /^[\w\s,'’-]{0,30}?(?:guaranteed|delivery|shipping|quality)?[\w,'’-]*/i.exec(
        textValue.slice(start + match[0].length),
      )?.[0] ?? "";

    const span = (match[0] + tail).replace(/[\s,]+$/, "");
    const fact =
      /deliver|fast|ship/i.test(span)
        ? kit.find(
            (source) =>
              source.kind === "fact" &&
              /deliver/i.test(`${source.title} ${source.content}`),
          )
        : undefined;

    add({
      type: "unsupported_claim",
      severity: "high",
      start,
      end: start + span.length,
      text: span,
      source: guideline("superlative", "claim"),
      reason:
        "No approved fact supports this claim. It is unsupported, not proven false.",
      confidence: 0.91,
      suggestion: fact ? fact.content.replace(/\.$/, "") : "",
    });
  }

  for (const match of textValue.matchAll(URGENCY)) {
    const start = match.index ?? 0;

    add({
      type: "tone",
      severity: "medium",
      start,
      end: start + match[0].length,
      text: match[0],
      source: guideline("tone", "pressure"),
      reason:
        "Pressure language or repeated exclamation marks conflict with the helpful, confident brand voice.",
      confidence: 0.86,
      suggestion: "",
    });
  }

  // The current contract uses SourceKind "example" for these terminology entries.
  for (const source of kit.filter((item) => item.kind === "example")) {
    const { avoid, use, note } = parseTerm(source);
    if (!avoid.trim()) continue;

    for (const match of textValue.matchAll(
      new RegExp(`\\b${esc(avoid.trim())}\\b`, "gi"),
    )) {
      if (use && match[0] === use) continue;

      const start = match.index ?? 0;

      add({
        type: "terminology",
        severity: "medium",
        start,
        end: start + match[0].length,
        text: match[0],
        source,
        reason: `“${match[0]}” does not match the approved terminology.${
          note ? ` ${note}` : ""
        }`,
        confidence: 0.97,
        suggestion: use ?? "",
      });
    }
  }

  if (!/alt\s*text\s*:/i.test(textValue)) {
    for (const match of textValue.matchAll(IMAGE_REF)) {
      const start = match.index ?? 0;

      add({
        type: "accessibility",
        severity: "low",
        start,
        end: start + match[0].length,
        text: match[0],
        source: guideline("alt text", "accessib"),
        reason:
          "An image is referenced without descriptive alt text in the submitted copy.",
        confidence: 0.94,
        suggestion: "",
      });
    }
  }

  for (const match of textValue.matchAll(SHOUTING)) {
    const start = match.index ?? 0;

    add({
      type: "tone",
      severity: "low",
      start,
      end: start + match[0].length,
      text: match[0],
      source: guideline("tone"),
      reason:
        "All-caps words read as shouting and conflict with the calm, confident voice.",
      confidence: 0.8,
      suggestion:
        match[0].charAt(0) + match[0].slice(1).toLowerCase(),
    });
  }

  const rank: Record<ApiSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return hits.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start,
  );
}

const src = (
  id: string,
  kind: SourceKind,
  title: string,
  content: string,
  kitVersion = 1,
): StoredSource => ({
  id,
  public_id: id,
  title,
  kind,
  content,
  version: kitVersion,
  active: true,
  kitVersion,
});

function emptyDb(): Db {
  return {
    kitVersion: 3,
    reviews: [],
    findings: [],
    comments: [],
    audit: [],
    seq: {
      review: 2001,
      finding: 1001,
      comment: 1,
      audit: 1,
      source: {
        guideline: 6,
        fact: 22,
        visual: 2,
        example: 11,
        other: 1,
      },
    },
    sources: [
      src(
        "G-4.2",
        "guideline",
        "Avoid unsupported superlatives",
        "Do not use claims such as '#1', 'best' or 'fastest' unless an approved fact substantiates them.",
      ),
      src(
        "G-2.1",
        "guideline",
        "Use a helpful, confident tone",
        "Be clear and reassuring in the brand voice. Avoid pressure tactics, excessive exclamation marks and fear-based language.",
      ),
      src(
        "G-5.1",
        "guideline",
        "Accessibility basics",
        "Every image needs descriptive alt text, link text must make sense on its own, and text needs WCAG AA contrast.",
      ),
      src(
        "F-12",
        "fact",
        "Delivery coverage",
        "Fast delivery is available in select cities.",
        2,
      ),
      src(
        "F-18",
        "fact",
        "Bottle capacity",
        "The Zippy Bottle has a 750 ml capacity.",
        2,
      ),
      src(
        "F-21",
        "fact",
        "Material",
        "Made with BPA-free, food-grade stainless steel.",
        2,
      ),
      src(
        "T-8",
        "example",
        "Zippy bottle",
        "Use: Zippy Bottle. Approved product name and capitalisation.",
        3,
      ),
      src(
        "T-9",
        "example",
        "Cheap",
        "Use: Affordable. Preferred value-proposition language.",
        3,
      ),
      src(
        "T-10",
        "example",
        "Best ever",
        "Use: Reliable. Superlatives need an approved fact.",
        3,
      ),
      src(
        "A-1",
        "visual",
        "Brand palette",
        "Approved colours: Primary #315CE8, Ink #111827, Accent #A5B4FC, Canvas #F6F7FB.",
        3,
      ),
    ],
  };
}

function submit(
  db: Db,
  userId: string,
  title: string,
  content: string,
  minutesAgo: number,
): StoredReview {
  const id = `CL-${db.seq.review++}`;
  const at = ago(minutesAgo);

  const review: StoredReview = {
    id,
    title,
    creatorId: userId,
    status: "scanned",
    kitVersion: db.kitVersion,
    versions: [content],
    createdAt: at,
    updatedAt: at,
    decidedAt: null,
  };

  db.reviews.push(review);

  db.audit.push({
    id: db.seq.audit++,
    reviewId: id,
    actor: userById(userId)?.name ?? "You",
    event_type: "review_submitted",
    detail: {},
    reason: "",
    created_at: at,
  });

  for (const hit of detect(content, db.sources)) {
    db.findings.push({
      id: `FD-${db.seq.finding++}`,
      reviewId: id,
      type: hit.type,
      severity: hit.severity,
      span_start: hit.start,
      span_end: hit.end,
      span_text: hit.text,
      source_kind: hit.source?.kind ?? null,
      source_id: hit.source?.id ?? null,
      source_version: hit.source?.version ?? null,
      fact_match: null,
      reason: hit.reason,
      confidence: hit.confidence,
      method: "rule_based",
      suggestion: hit.suggestion,
      decisions: [],
    });
  }

  db.audit.push({
    id: db.seq.audit++,
    reviewId: id,
    actor: "Greenlight",
    event_type: "scan_completed",
    detail: {
      findings: db.findings.filter((f) => f.reviewId === id).length,
    },
    reason: "",
    created_at: at,
  });

  if (!db.findings.some((f) => f.reviewId === id)) {
    review.status = "in_review";
  }

  return review;
}

function seedDb(): Db {
  const db = emptyDb();
  const aarav = "U-1";

  const risky = submit(
    db,
    aarav,
    "Summer launch announcement",
    "Introducing the all-new Zippy bottle.\n\nIndia's #1 fastest delivery, guaranteed.\n\nGrab one today, or miss out!!!\n\nImage: banner.png",
    190,
  );
  risky.updatedAt = ago(46);

  const ready = submit(
    db,
    aarav,
    "Product feature email",
    "Hi there,\n\nMeet the Zippy bottle — made with BPA-free, food-grade stainless steel.\n\nIt ships this week.",
    330,
  );

  for (const finding of db.findings.filter((f) => f.reviewId === ready.id)) {
    finding.decisions.push({
      action: "edited",
      reason: "Edited the flagged wording.",
      actor: aarav,
      editedText: "Zippy Bottle",
    });

    const current = ready.versions[ready.versions.length - 1];
    ready.versions.push(
      current.replace(finding.span_text, "Zippy Bottle"),
    );

    finding.span_end =
      finding.span_start + "Zippy Bottle".length;
    finding.span_text = "Zippy Bottle";
  }

  ready.status = "in_review";
  ready.updatedAt = ago(120);

  const done = submit(
    db,
    aarav,
    "October product update",
    "October product update\n\nThe Zippy Bottle has a 750 ml capacity. Fast delivery is available in select cities.",
    1800,
  );
  done.status = "approved";
  done.decidedAt = ago(1500);
  done.updatedAt = ago(1500);

  const bounced = submit(
    db,
    aarav,
    "Back-to-school banner",
    "Back to school with the Zippy Bottle.\n\nOur best ever bottle, in the best colours.\n\nImage: school-banner.png",
    2600,
  );

  for (const finding of db.findings.filter(
    (f) => f.reviewId === bounced.id,
  )) {
    finding.decisions.push({
      action: "disputed",
      reason: "Approved by legal for this campaign.",
      actor: aarav,
    });
  }

  bounced.status = "changes_requested";
  bounced.updatedAt = ago(2200);

  return db;
}

let cache: Db | null = null;

function load(): Db {
  if (cache) return cache;

  try {
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(DB_KEY)
        : null;

    if (raw) {
      cache = JSON.parse(raw) as Db;
      return cache;
    }
  } catch {
    // Fall through to a fresh seed.
  }

  cache = seedDb();
  save();
  return cache;
}

function save() {
  try {
    if (cache && typeof window !== "undefined") {
      window.localStorage.setItem(DB_KEY, JSON.stringify(cache));
    }
  } catch {
    // Ignore quota/private-mode errors.
  }
}

/** Restores the demo workspace. */
export function resetMockDb(): void {
  cache = seedDb();
  save();
}

const REVIEWER_VISIBLE: ReviewStatus[] = [
  "in_review",
  "approved",
  "changes_requested",
];

const EDITABLE: ReviewStatus[] = [
  "scanned",
  "resolving",
  "changes_requested",
];

const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ["scanned"],
  scanned: ["resolving", "in_review"],
  resolving: ["resolving", "in_review"],
  in_review: ["approved", "changes_requested"],
  changes_requested: ["resolving", "in_review"],
  approved: [],
};

const canView = (user: MockUser, review: StoredReview) =>
  user.role === "creator"
    ? review.creatorId === user.id
    : user.role === "reviewer"
      ? REVIEWER_VISIBLE.includes(review.status) ||
        review.assignedReviewer === user.id ||
        Boolean(review.escalationReason)
      : true;

const reviewContent = (review: StoredReview) =>
  review.versions[review.versions.length - 1];

const latest = (finding: StoredFinding) =>
  finding.decisions[finding.decisions.length - 1] ?? null;

const unresolved = (db: Db, reviewId: string) =>
  db.findings.filter(
    (finding) =>
      finding.reviewId === reviewId &&
      (latest(finding) === null ||
        latest(finding)?.action === "accepted"),
  ).length;

function transition(review: StoredReview, to: ReviewStatus) {
  if (!TRANSITIONS[review.status].includes(to)) {
    throw invalid(
      `A review cannot move from ${review.status} to ${to}.`,
    );
  }

  review.status = to;
  review.updatedAt = new Date().toISOString();
}

function reviewFor(
  db: Db,
  user: MockUser,
  id: string,
): StoredReview {
  const review = db.reviews.find((item) => item.id === id);

  if (!review || !canView(user, review)) {
    throw notFound("Review not found.");
  }

  return review;
}

const toFinding = (finding: StoredFinding): ApiFinding => {
  const {
    reviewId: _reviewId,
    decisions: _decisions,
    ...apiFinding
  } = finding;

  void _reviewId;
  void _decisions;

  return apiFinding;
};

export async function mockRequest<T>(
  path: string,
  init: RequestInit = {},
  token: string | null = null,
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  const method = (init.method ?? "GET").toUpperCase();
  const body = (
    init.body ? JSON.parse(String(init.body)) : {}
  ) as Record<string, unknown>;

  const [route, query = ""] = path.split("?");
  const db = load();

  if (route === "/auth/login" && method === "POST") {
    const user = MOCK_USERS.find(
      (item) =>
        item.email ===
        String(body.email ?? "").trim().toLowerCase(),
    );

    if (!user || body.password !== MOCK_PASSWORD) {
      throw unauthorized("Incorrect email or password.");
    }

    const out: LoginResponse = {
      access_token: `mock.${user.id}`,
      token_type: "bearer",
      user,
    };

    return out as T;
  }

  const user = token?.startsWith("mock.")
    ? userById(token.slice(5))
    : undefined;

  if (!user) throw unauthorized();

  if (route === "/auth/users") {
    const role = new URLSearchParams(query).get("role");

    if (user.role !== "manager" && user.role !== "reviewer") {
      throw forbidden(
        "Only managers and reviewers can view workspace reviewers.",
      );
    }

    const out = MOCK_USERS
      .filter(
        (item) =>
          item.workspace_id === user.workspace_id &&
          (!role || item.role === role),
      )
      .map(({ email: _email, ...publicUser }) => {
        void _email;
        return publicUser;
      });

    return out as T;
  }

  let out: unknown;
  let match: RegExpExecArray | null;

  if (route === "/brand-kit/sources") {
    if (method === "POST") {
      if (user.role !== "brand_admin") {
        throw forbidden(
          "Only brand admins can change the Brand Kit.",
        );
      }

      const kind = body.kind as SourceKind;
      const title = text(body.title).trim();
      const contentValue = text(
        body.content ?? body.text,
      ).trim();

      if (
        !["guideline", "fact", "visual", "example", "other"].includes(
          kind,
        )
      ) {
        throw invalid("kind: invalid value");
      }

      if (!title || !contentValue) {
        throw invalid("title and content are required.");
      }

      db.kitVersion += 1;

      const prefix: Record<SourceKind, string> = {
        guideline: "G",
        fact: "F",
        visual: "A",
        example: "T",
        other: "O",
      };

      const n = db.seq.source[kind]++;
      const created = src(
        `${prefix[kind]}-${n}`,
        kind,
        title,
        contentValue,
        db.kitVersion,
      );

      db.sources.push(created);

      out = {
        id: created.id,
        public_id: created.public_id,
        title: created.title,
        kind: created.kind,
        content: created.content,
        version: created.version,
        active: created.active,
      } satisfies BrandSource;
    } else {
      const kind = new URLSearchParams(query).get("kind");

      out = db.sources
        .filter((source) => !kind || source.kind === kind)
        .map(({ kitVersion: _kitVersion, ...source }) => {
          void _kitVersion;
          return source;
        });
    }
  } else if (route === "/reviews" && method === "POST") {
    if (user.role !== "creator") {
      throw forbidden("Only creators can submit drafts.");
    }

    const title = text(body.title).trim();
    const draft = text(body.content);

    if (!title) throw invalid("title: field required");
    if (!draft.trim()) throw invalid("content: field required");

    const review = submit(db, user.id, title, draft, 0);

    out = {
      id: review.id,
      status: review.status,
      finding_count: db.findings.filter(
        (finding) => finding.reviewId === review.id,
      ).length,
    };
  } else if (route === "/reviews") {
    const rows = db.reviews
      .filter((review) => canView(user, review))
      .sort(
        (a, b) =>
          +new Date(b.updatedAt) - +new Date(a.updatedAt),
      );

    out = rows.map(
      (review) =>
        ({
          id: review.id,
          title: review.title,
          creator:
            userById(review.creatorId)?.name ?? "Unknown",
          status: review.status,
          finding_count: db.findings.filter(
            (finding) => finding.reviewId === review.id,
          ).length,
          updated_at: review.updatedAt,
        }) satisfies ReviewListItem,
    );
  } else if (
    (match = /^\/reviews\/([^/]+)$/.exec(route))
  ) {
    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );

    out = {
      id: review.id,
      title: review.title,
      content: reviewContent(review),
      status: review.status,
      creator:
        userById(review.creatorId)?.name ?? "Unknown",
      brand_kit_version: `v${review.kitVersion}`,
      updated_at: review.updatedAt,
      assigned_reviewer:
        userById(review.assignedReviewer ?? "")?.name ?? null,
      escalation_reason: review.escalationReason ?? "",
      content_type: "text",
      content_blocks: [],
    };
  } else if (
    (match = /^\/reviews\/([^/]+)\/findings$/.exec(route))
  ) {
    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );

    const rank: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    out = db.findings
      .filter((finding) => finding.reviewId === review.id)
      .sort(
        (a, b) =>
          (rank[a.severity] ?? 99) -
            (rank[b.severity] ?? 99) ||
          a.span_start - b.span_start,
      )
      .map(toFinding);
  } else if (
    (match = /^\/findings\/([^/]+)$/.exec(route)) &&
    method === "PATCH"
  ) {
    const finding = db.findings.find(
      (item) => item.id === decodeURIComponent(match![1]),
    );
    const review = finding
      ? db.reviews.find((item) => item.id === finding.reviewId)
      : undefined;

    if (!finding || !review) {
      throw notFound("Finding not found.");
    }

    if (
      user.role !== "creator" ||
      review.creatorId !== user.id
    ) {
      throw forbidden(
        "Only the creator of this review can accept, edit or dispute its findings.",
      );
    }

    if (!EDITABLE.includes(review.status)) {
      throw invalid(
        `Findings cannot be changed while the review is ${review.status}.`,
      );
    }

    const action = body.action as FindingAction;

    if (
      !["accepted", "edited", "disputed"].includes(action)
    ) {
      throw invalid("action: invalid value");
    }

    // The current contract calls this field "note".
    const note = text(body.note ?? body.reason).trim();

    if (action === "disputed" && !note) {
      throw invalid(
        "A note is required to dispute a finding.",
      );
    }

    const edited =
      typeof body.edited_text === "string"
        ? body.edited_text
        : null;

    if (action === "edited") {
      if (!edited || !edited.trim()) {
        // Keep the mock compatible with older demo data while
        // accepting the current request contract.
        throw invalid(
          "An edited value is required for an edited finding.",
        );
      }

      const current = reviewContent(review);

      if (
        current.slice(
          finding.span_start,
          finding.span_end,
        ) !== finding.span_text
      ) {
        throw invalid(
          "The flagged text has changed; reload the review.",
        );
      }

      const delta =
        edited.length -
        (finding.span_end - finding.span_start);

      review.versions.push(
        current.slice(0, finding.span_start) +
          edited +
          current.slice(finding.span_end),
      );

      for (const other of db.findings) {
        if (
          other.reviewId === review.id &&
          other !== finding &&
          other.span_start >= finding.span_end
        ) {
          other.span_start += delta;
          other.span_end += delta;
        }
      }

      finding.span_end =
        finding.span_start + edited.length;
      finding.span_text = edited;
    }

    const reason =
      note ||
      (action === "edited"
        ? "Edited the flagged wording."
        : "");

    finding.decisions.push({
      action,
      reason,
      actor: user.id,
      editedText:
        action === "edited" ? edited : null,
    });

    transition(
      review,
      unresolved(db, review.id) === 0
        ? "in_review"
        : "resolving",
    );

    out = {
      id: finding.id,
      decision: {
        action,
        reason,
        actor: user.id,
      },
    };
  } else if (
    (match = /^\/reviews\/([^/]+)\/collaboration$/.exec(
      route,
    ))
  ) {
    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );

    out = {
      assigned_reviewer:
        userById(review.assignedReviewer ?? "")?.name ??
        null,
      escalation_reason: review.escalationReason ?? "",
      content_type: "text",
      content_blocks: [],
    };
  } else if (
    (match = /^\/reviews\/([^/]+)\/comments$/.exec(route)) &&
    method === "GET"
  ) {
    reviewFor(db, user, decodeURIComponent(match[1]));

    out = db.comments
      .filter((comment) => comment.reviewId === decodeURIComponent(match![1]))
      .map((comment) => ({
        id: comment.id,
        author: comment.author,
        text: comment.text,
        created_at: comment.created_at,
      }));
  } else if (
    (match = /^\/reviews\/([^/]+)\/audit$/.exec(route)) &&
    method === "GET"
  ) {
    reviewFor(db, user, decodeURIComponent(match[1]));

    out = db.audit
      .filter((event) => event.reviewId === decodeURIComponent(match![1]))
      .map((event) => ({
        id: event.id,
        actor: event.actor,
        event_type: event.event_type,
        detail: event.detail,
        reason: event.reason,
        created_at: event.created_at,
      }));
  } else if (
    (match = /^\/reviews\/([^/]+)\/assign$/.exec(route)) &&
    method === "POST"
  ) {
    if (user.role !== "manager") {
      throw forbidden("Only managers can assign reviewers.");
    }

    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );
    const reviewer = userById(
      text(body.reviewer_id),
    );

    if (
      !reviewer ||
      reviewer.role !== "reviewer" ||
      reviewer.workspace_id !== user.workspace_id
    ) {
      throw invalid(
        "Reviewer must be a reviewer in the same workspace.",
      );
    }

    review.assignedReviewer = reviewer.id;
    review.updatedAt = new Date().toISOString();

    db.audit.push({
      id: db.seq.audit++,
      reviewId: review.id,
      actor: user.name,
      event_type: "review_assigned",
      detail: {
        reviewer_id: reviewer.id,
        reviewer: reviewer.name,
      },
      reason: "Assigned for collaborative review",
      created_at: new Date().toISOString(),
    });

    out = { id: review.id, status: review.status };
  } else if (
    (match = /^\/reviews\/([^/]+)\/escalate$/.exec(route)) &&
    method === "POST"
  ) {
    if (user.role !== "manager") {
      throw forbidden("Only managers can escalate reviews.");
    }

    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );
    const reason = text(body.reason).trim();

    if (!reason) throw invalid("reason: field required");

    review.escalationReason = reason;
    review.updatedAt = new Date().toISOString();

    db.audit.push({
      id: db.seq.audit++,
      reviewId: review.id,
      actor: user.name,
      event_type: "review_escalated",
      detail: { reason },
      reason,
      created_at: new Date().toISOString(),
    });

    out = { id: review.id, status: review.status };
  } else if (
    (match = /^\/reviews\/([^/]+)\/comments$/.exec(route)) &&
    method === "POST"
  ) {
    if (
      user.role !== "creator" &&
      user.role !== "manager"
    ) {
      throw forbidden(
        "Only creators and managers can comment.",
      );
    }

    reviewFor(db, user, decodeURIComponent(match[1]));

    const commentText = text(body.text).trim();
    if (!commentText) {
      throw invalid("text: field required");
    }

    const created_at = new Date().toISOString();
    const id = `C-${db.seq.comment++}`;
    const reviewId = decodeURIComponent(match[1]);

    db.comments.push({
      id,
      reviewId,
      author: user.name,
      text: commentText,
      created_at,
    });

    db.audit.push({
      id: db.seq.audit++,
      reviewId,
      actor: user.name,
      event_type: "comment_added",
      detail: { comment_id: id },
      reason: "",
      created_at,
    });

    out = {
      id,
      author: user.name,
      text: commentText,
      created_at,
    };
  } else if (
    (match =
      /^\/reviews\/([^/]+)\/(approve|request-changes)$/.exec(
        route,
      )) &&
    method === "POST"
  ) {
    if (user.role !== "reviewer") {
      throw forbidden(
        "Only reviewers can approve or request changes.",
      );
    }

    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );

    if (review.status !== "in_review") {
      throw invalid(
        `Only reviews that are in_review can be decided (this one is ${review.status}).`,
      );
    }

    const approving = match[2] === "approve";
    const note = text(body.note).trim();

    if (approving && unresolved(db, review.id)) {
      throw invalid(
        "Every finding must be edited or disputed before approval.",
      );
    }

    if (!approving && !note) {
      throw invalid(
        "A note is required when requesting changes.",
      );
    }

    transition(
      review,
      approving ? "approved" : "changes_requested",
    );

    review.decidedAt = approving
      ? new Date().toISOString()
      : null;

    out = { id: review.id, status: review.status };
  } else if (
    (match = /^\/reviews\/([^/]+)\/ai-disclosure$/.exec(
      route,
    ))
  ) {
    const review = reviewFor(
      db,
      user,
      decodeURIComponent(match[1]),
    );

    out = {
      review_id: review.id,
      steps: [
        { step: "rules", used_ai: false },
        {
          step: "retrieve",
          used_ai: false,
          data_sent:
            "none (embeddings computed on our own server)",
        },
        {
          step: "judge",
          used_ai: false,
          data_sent:
            "none (rules-only mode: LLM unavailable)",
        },
      ],
    } satisfies AiDisclosure;
  } else if (route === "/insights/summary") {
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).getTime();

    const rows = db.reviews.filter((review) =>
      canView(user, review),
    );

    const counts = new Map<string, number>();

    for (const finding of db.findings) {
      if (rows.some((review) => review.id === finding.reviewId)) {
        counts.set(
          finding.type,
          (counts.get(finding.type) ?? 0) + 1,
        );
      }
    }

    out = {
      reviewed_this_month: rows.filter(
        (review) =>
          +new Date(review.createdAt) >= monthStart,
      ).length,
      needs_attention: rows.filter((review) =>
        ["scanned", "resolving", "changes_requested"].includes(
          review.status,
        ),
      ).length,
      awaiting_approval: rows.filter(
        (review) => review.status === "in_review",
      ).length,
      approved_this_month: rows.filter(
        (review) =>
          review.status === "approved" &&
          review.decidedAt &&
          +new Date(review.decidedAt) >= monthStart,
      ).length,
      top_issues: [...counts]
        .sort(
          (a, b) =>
            b[1] - a[1] || a[0].localeCompare(b[0]),
        )
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    } satisfies InsightsSummary;
  } else if (route === "/insights/recurring") {
    const rows = db.reviews.filter((review) =>
      canView(user, review),
    );

    const counts = new Map<string, number>();

    for (const finding of db.findings) {
      if (rows.some((review) => review.id === finding.reviewId)) {
        counts.set(
          finding.type,
          (counts.get(finding.type) ?? 0) + 1,
        );
      }
    }

    out = [...counts]
      .filter(([, count]) => count >= 2)
      .slice(0, 5)
      .map(([type, count]) => {
        const review_count = new Set(
          db.findings
            .filter(
              (finding) =>
                finding.type === type &&
                rows.some(
                  (review) =>
                    review.id === finding.reviewId,
                ),
            )
            .map((finding) => finding.reviewId),
        ).size;

        return {
          type,
          count,
          review_count,
          rate:
            review_count / Math.max(1, rows.length),
          recommendation:
            "Review the related Brand Kit guidance and publishing workflow.",
        };
      });
  } else if (route === "/insights/gaps") {
    if (user.role !== "brand_admin") {
      throw forbidden(
        "Only brand admins can view guideline-gap insights.",
      );
    }

    const counts = new Map<string, number>();

    for (const finding of db.findings) {
      if (
        finding.source_id &&
        latest(finding)?.action === "disputed"
      ) {
        counts.set(
          finding.source_id,
          (counts.get(finding.source_id) ?? 0) + 1,
        );
      }
    }

    out = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({
        source_id: id,
        title:
          db.sources.find((source) => source.id === id)
            ?.title ?? id,
        dispute_count: count,
        note:
          count >= 5
            ? "Often disputed; may be unclear."
            : `Disputed ${count} time(s); consider clarifying the wording.`,
      } satisfies InsightGap));
  } else {
    throw notFound(`No mock for ${method} ${route}`);
  }

  save();
  return out as T;
}
