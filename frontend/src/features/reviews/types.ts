export type FindingSeverity = "High" | "Medium" | "Low";
export type FindingStatus = "Open" | "Accepted" | "Edited" | "Disputed";
export type ReviewStatus = "Needs attention" | "In review" | "Approved" | "Changes requested";
export type AnalysisSource = "local-demo" | "api";
export type AuditKind = "submitted" | "analysis" | "finding" | "edit" | "status" | "comment" | "assignment" | "escalation" | "decision";

export const CHANNELS = ["Social media", "Website", "Email", "Presentation", "Advertisement", "Print"] as const;
export const REVIEW_MODES = ["Full brand review", "Essential checks only"] as const;

export interface Finding {
  id: string;
  category: string;
  severity: FindingSeverity;
  /** Always an exact substring of the submitted content (enforced by the verification layer). */
  quote: string;
  reason: string;
  /** Source record + version that backs this finding. */
  receipt: string;
  suggestion: string;
  /** "replace" suggestions can be applied to the copy; "guidance" ones are instructions for a human. */
  suggestionKind?: "replace" | "guidance";
  /** Percentage, 0–100. */
  confidence: number;
  status: FindingStatus;
  ruleId?: string;
  /** The wording now in the copy once a finding has been edited (used to highlight the fix). */
  resolvedText?: string;
  /** The wording that was flagged before an edit, when this browser saw it (the API only keeps the current span). */
  originalQuote?: string;
  /** How the finding was produced. Shown as a badge, never hidden. */
  method?: "rule_based" | "ai_assisted";
  /** The reason the creator gave when deciding (required for "not applicable"). */
  decisionReason?: string;
}

export interface CommentEntry { id: string; author: string; text: string; at: string }

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  kind: AuditKind;
  message: string;
  findingId?: string;
}

export interface Review {
  id: string;
  title: string;
  channel: string;
  creator: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  brandKit: string;
  mode: string;
  intent?: string;
  content: string;
  originalContent: string;
  source: AnalysisSource;
  summary?: string;
  findings: Finding[];
  audit: AuditEntry[];
  comments: CommentEntry[];
  assignedReviewer?: string;
  escalationReason?: string;
  contentType?: string;
  externalRef?: string;
  contentBlocks?: Array<{ type: "text" | "image" | "asset"; value: string; alt_text?: string; label?: string }>;
}

export type ReviewInput = { title: string; channel: string; content: string; intent?: string; brandKit: string; mode: string; contentType?: "text" | "multimodal" | "structured"; contentBlocks?: Array<{ type: "text" | "image" | "asset"; value: string; alt_text?: string; label?: string }>; externalRef?: string };
export type ReviewAnalysis = { findings: Finding[]; provider: AnalysisSource; summary: string; discarded?: number };
