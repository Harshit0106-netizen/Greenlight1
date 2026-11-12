export type UserRole =
  | "creator"
  | "reviewer"
  | "manager"
  | "brand_admin";

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    workspace_id: string;
  };
};

export type CollaboratorUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type SourceKind =
  | "guideline"
  | "fact"
  | "visual"
  | "example"
  | "other";

export type BrandSource = {
  id: string;
  public_id: string;
  title: string;
  kind: SourceKind;
  content: string;
  version: number;
  active: boolean;
};

export type CreateBrandSourceRequest = {
  title: string;
  kind: SourceKind;
  content: string;
};

export type ContentBlock = {
  type: "text" | "image" | "asset";
  value: string;
  alt_text?: string;
  label?: string;
};

export type ReviewStatus =
  | "draft"
  | "scanned"
  | "resolving"
  | "in_review"
  | "approved"
  | "changes_requested";

export type CreateReviewRequest = {
  title: string;
  content: string;
  intent_note?: string;
  content_type?: "text" | "multimodal" | "structured";
  content_blocks?: ContentBlock[];
  external_ref?: string | null;
};

export type CreateReviewResponse = {
  id: string;
  status: ReviewStatus;
  finding_count: number;
};

export type ReviewListItem = {
  id: string;
  title: string;
  creator: string;
  status: ReviewStatus;
  finding_count: number;
  updated_at: string;
};

export type ReviewDetail = {
  id: string;
  title: string;
  content: string;
  status: ReviewStatus;
  creator: string;
  brand_kit_version: string;
  updated_at: string;
};

export type ApiFinding = {
  id: string;
  type: string;
  severity: string;
  span_start: number;
  span_end: number;
  span_text: string;
  source_kind?: string | null;
  source_id?: string | null;
  source_version?: number | null;
  fact_match?: string | null;
  reason: string;
  confidence: number;
  method: string;
  suggestion: string;
};

export type FindingAction =
  | "accepted"
  | "edited"
  | "disputed"
  | "dismissed"
  | "resolved";
export type PatchFindingRequest = {
  action: FindingAction;
  note?: string;
  edited_text?: string | null;
};


export type PatchFindingResponse = {
  id: string;
  decision: string;
};

export type CreateCommentRequest = {
  text: string;
};

export type CommentResponse = {
  id: string;
  author: string;
  text: string;
  created_at: string;
};

export type ReviewCollaboration = {
  assigned_reviewer?: string | null;
  reviewer?: string | null;
  status: ReviewStatus;
  comments?: CommentResponse[];
  approvals?: unknown[];
};

export type AuditResponse = {
  id: number;
  actor: string;
  event_type: string;
  detail: Record<string, unknown>;
  reason: string;
  created_at: string;
};

export type AssignmentRequest = {
  reviewer_id: string;
};

export type EscalationRequest = {
  reason: string;
};

export type WorkflowNoteRequest = {
  note?: string;
};

export type WorkflowResponse = {
  id: string;
  status: ReviewStatus;
};

export type TopIssue = {
  type: string;
  count: number;
};

export type InsightsSummary = {
  reviewed_this_month: number;
  needs_attention: number;
  awaiting_approval: number;
  approved_this_month: number;
  top_issues: TopIssue[];
};

export type InsightGap = {
  source_id: string;
  title: string;
  dispute_count: number;
  note: string;
};

export type RecurringIssue = {
  type: string;
  count: number;
  review_count: number;
  rate: number;
  recommendation: string;
};

export type DisclosureStep = {
  step: string;
  used_ai: boolean;
  model?: string | null;
  data_sent?: string | null;
};

export type AiDisclosure = {
  review_id: string;
  steps: DisclosureStep[];
};

// -----------------------------------------------------------------------------
// Backward-compatible frontend aliases
// -----------------------------------------------------------------------------

export type ApiUser = LoginResponse["user"];

export type FindingType = string;

export type ApiSeverity = "high" | "medium" | "low";

export type ReviewApiStatus = ReviewStatus;
