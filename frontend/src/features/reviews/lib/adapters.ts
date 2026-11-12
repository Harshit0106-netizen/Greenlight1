import type {
  ApiFinding,
  BrandSource,
  ReviewDetail,
  SourceKind,
} from "@/types/contract";

import type {
  AuditEntry,
  CommentEntry,
  Finding,
  FindingSeverity,
  FindingStatus,
  Review,
  ReviewStatus,
} from "../types";

/** Contract <-> UI mapping. */
export const statusFromApi: Record<ReviewDetail["status"], ReviewStatus> = {
  draft: "Needs attention",
  scanned: "Needs attention",
  resolving: "Needs attention",
  in_review: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

export const categoryLabel: Record<string, string> = {
  unsupported_claim: "Unsupported claim",
  contradicted_claim: "Contradicted claim",
  terminology: "Terminology",
  tone: "Tone and messaging",
  accessibility: "Accessibility",
  visual: "Visual",
};

export const kindLabel: Record<SourceKind, string> = {
  guideline: "Guideline",
  fact: "Approved fact",
  visual: "Brand asset",
  example: "Example",
  other: "Other",
};

const severityFromApi: Record<string, FindingSeverity> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const NO_SUGGESTION =
  "No approved replacement wording is available for this finding. Rewrite the phrase yourself, or mark it not applicable and say why.";

function sourceKindLabel(kind: string | null | undefined): string {
  if (kind && kind in kindLabel) {
    return kindLabel[kind as SourceKind];
  }

  return kind ?? "Unknown source";
}

function methodFromApi(method: string): Finding["method"] {
  return method === "ai_assisted" ? "ai_assisted" : "rule_based";
}

export function findingFromApi(
  f: ApiFinding,
  sources: Map<string, BrandSource>,
): Finding {
  const sourceId = f.source_id ?? undefined;
  const meta = sourceId ? sources.get(sourceId) : undefined;

  const receipt: string[] = [];

  if (sourceId) {
    const kind = sourceKindLabel(f.source_kind);
    const version =
      f.source_version !== null && f.source_version !== undefined
        ? ` · ${f.source_version}`
        : "";

    receipt.push(
      `${kind} ${sourceId}${version}${meta ? ` — ${meta.title}` : ""}.`,
    );

    if (meta?.content) {
      receipt.push(`“${meta.content}”`);
    }
  } else {
    receipt.push(
      "No approved source is attached to this finding. Treat it with extra caution.",
    );
  }

  if (f.fact_match) {
    receipt.push(`Matched approved fact ${f.fact_match}.`);
  }

  const status: FindingStatus = "Open";

  return {
    id: f.id,
    category: categoryLabel[f.type] ?? f.type,
    severity: severityFromApi[f.severity] ?? "Medium",
    quote: f.span_text,
    reason: f.reason,
    receipt: receipt.join(" "),
    suggestion: f.suggestion || NO_SUGGESTION,
    suggestionKind: f.suggestion ? "replace" : "guidance",
    confidence: Math.round(
      f.confidence <= 1 ? f.confidence * 100 : f.confidence,
    ),
    status,
    ruleId: sourceId,
    method: methodFromApi(f.method),
  };
}

export type ReviewMeta = {
  channel?: string;
  mode?: string;
  intent?: string;
  original?: string;
  originals?: Record<string, string>;
};

export function reviewFromApi(
  detail: ReviewDetail,
  findings: ApiFinding[],
  sources: Map<string, BrandSource>,
  meta: ReviewMeta | undefined,
  audit: AuditEntry[],
  source: Review["source"],
  comments: CommentEntry[] = [],
  collaboration?: {
    assigned_reviewer?: string | null;
    escalation_reason?: string;
    content_type?: string;
    external_ref?: string | null;
    content_blocks?: Array<{
      type: "text" | "image" | "asset";
      value: string;
      alt_text?: string;
      label?: string;
    }>;
  },
): Review {
  const mapped = findings.map((f) => findingFromApi(f, sources));

  const status = statusFromApi[detail.status];

  const entries = audit.length
    ? audit
    : [
        {
          id: `AU-${detail.id}`,
          at: detail.updated_at,
          actor: "Greenlight",
          kind: "status" as const,
          message: `Current status: ${status}. Earlier activity was not recorded in this browser.`,
        },
      ];

  return {
    id: detail.id,
    title: detail.title,
    channel: meta?.channel ?? "Content",
    creator: detail.creator,
    createdAt: entries[0].at,
    updatedAt: detail.updated_at,
    status,
    brandKit: `Brand Kit ${detail.brand_kit_version}`,
    mode: meta?.mode ?? "Full brand review",
    intent: meta?.intent,
    content: detail.content,
    originalContent: meta?.original ?? detail.content,
    source,
    summary: `${mapped.length} potential issue${
      mapped.length === 1 ? "" : "s"
    } found. Human review is required.`,
    findings: mapped,
    audit: entries,
    comments,
    assignedReviewer:
      collaboration?.assigned_reviewer ?? undefined,
    escalationReason:
      collaboration?.escalation_reason || undefined,
    contentType: collaboration?.content_type ?? "text",
    externalRef:
      collaboration?.external_ref ?? undefined,
    contentBlocks:
      collaboration?.content_blocks ?? [],
  };
}