from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.finding import FindingType
ReviewStatus = Literal["draft", "scanned", "resolving", "in_review", "approved", "changes_requested"]
class ReviewListItem(BaseModel):
    id: str; title: str; creator: str; status: ReviewStatus; finding_count: int; updated_at: datetime
class ContentBlock(BaseModel):
    type: Literal["text", "image", "asset"] = "text"
    value: str = Field(min_length=1, max_length=100_000)
    alt_text: str = Field(default="", max_length=1000)
    label: str = Field(default="", max_length=300)
class ReviewCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, max_length=50_000)
    intent_note: str = Field(default="", max_length=2000)
    content_type: Literal["text", "multimodal", "structured"] = "text"
    content_blocks: list[ContentBlock] = Field(default_factory=list, max_length=50)
    external_ref: str | None = Field(default=None, max_length=300)
class ReviewCreated(BaseModel):
    id: str; status: ReviewStatus; finding_count: int
class ReviewDetail(BaseModel):
    id: str; title: str; content: str; status: ReviewStatus; creator: str; brand_kit_version: str; updated_at: datetime
class AuditOut(BaseModel):
    id: int; actor: str; event_type: str; detail: dict; reason: str; created_at: datetime
class AssignmentRequest(BaseModel): reviewer_id: str
class EscalationRequest(BaseModel): reason: str = Field(min_length=1, max_length=2000)
class CommentCreate(BaseModel): text: str = Field(min_length=1, max_length=5000)
class CommentOut(BaseModel): id: str; author: str; text: str; created_at: datetime
class WorkflowNote(BaseModel): note: str = Field(default="", max_length=2000)
class WorkflowOut(BaseModel): id: str; status: ReviewStatus
class TopIssue(BaseModel): type: FindingType; count: int
class RecurringIssue(BaseModel):
    type: FindingType; count: int; review_count: int; rate: float; recommendation: str
class InsightsSummary(BaseModel):
    reviewed_this_month: int; needs_attention: int; awaiting_approval: int; approved_this_month: int
    top_issues: list[TopIssue]
class InsightGap(BaseModel): source_id: str; title: str; dispute_count: int; note: str
class DisclosureStep(BaseModel): step: str; used_ai: bool; model: str | None = None; data_sent: str | None = None
class AiDisclosure(BaseModel): review_id: str; steps: list[DisclosureStep]
