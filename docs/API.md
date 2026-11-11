# Greenlight API contract

> Fixed shapes. Backend returns exactly these; frontend expects exactly these. Changes need both of us (`docs-api-<change>` PR).

**Base URL** `http://localhost:8000` · **Format** JSON · **Auth** `Authorization: Bearer <access_token>` on everything except login
**Roles:** `creator`, `manager`, `reviewer`, `brand_admin`
**Review statuses:** `draft`, `scanned`, `resolving`, `in_review`, `approved`, `changes_requested`

### Auth

`POST /auth/login`
```json
// request
{ "email": "harshit@acme.com", "password": "secret" }

// 200
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "user": { "id": "U-1", "name": "Harshit Verma", "role": "manager", "workspace_id": "W-1" }
}
```

### Brand Kit

`GET /brand-kit/sources?kind=guideline` (`kind`: `guideline`, `fact`, `term`, `asset`; optional)
```json
[{
  "id": "G-4.2",
  "kind": "guideline",
  "title": "Avoid unsupported superlatives",
  "text": "Do not use claims such as '#1', 'best' or 'fastest' unless an approved fact substantiates them.",
  "version": "v3",
  "status": "active"
}]
```

`POST /brand-kit/sources` (brand_admin)
```json
// request
{ "kind": "fact", "title": "Delivery coverage", "text": "Fast delivery is available in select cities." }

// 201
{ "id": "F-12", "kind": "fact", "title": "Delivery coverage",
  "text": "Fast delivery is available in select cities.", "version": "v3", "status": "active" }
```

### Reviews

`GET /reviews`
```json
[{
  "id": "CL-2084",
  "title": "Summer launch announcement",
  "creator": "Aarav Mehta",
  "status": "in_review",
  "finding_count": 3,
  "updated_at": "2026-11-02T10:42:00Z"
}]
```

`POST /reviews`
```json
// request
{ "title": "Summer launch announcement",
  "content": "We offer #1 fastest delivery, guaranteed.",
  "intent_note": "Launch email for the summer campaign" }

// 201
{ "id": "CL-2084", "status": "scanned", "finding_count": 1 }
```

`GET /reviews/{id}`
```json
{
  "id": "CL-2084",
  "title": "Summer launch announcement",
  "content": "We offer #1 fastest delivery, guaranteed.",
  "status": "in_review",
  "creator": "Aarav Mehta",
  "brand_kit_version": "v3",
  "updated_at": "2026-11-02T10:42:00Z"
}
```

`GET /reviews/{id}/findings`
```json
[{
  "finding_id": "F-1042",
  "type": "unsupported_claim",
  "severity": "high",
  "span": { "start": 21, "end": 52, "text": "#1 fastest delivery, guaranteed" },
  "source": { "kind": "guideline", "id": "G-4.2", "version": "v3" },
  "fact_match": null,
  "reason": "No approved fact supports a 'fastest' claim.",
  "confidence": 0.91,
  "method": "ai_assisted",
  "suggestion": { "text": "Fast delivery is available in select cities", "fact_id": "F-12", "applied": false },
  "decision": null
}]
```
- `type`: `unsupported_claim`, `contradicted_claim`, `terminology`, `tone`, `accessibility`, `visual`
- `severity`: `high`, `medium`, `low`
- `method`: `rule_based`, `ai_assisted`
- `decision`: `null` or `{ "action": "accepted|edited|disputed", "reason": "...", "actor": "U-1" }`

`PATCH /findings/{finding_id}`
```json
// request
{ "action": "disputed", "reason": "We hold a third-party award for this claim.", "edited_text": null }

// 200
{ "finding_id": "F-1042",
  "decision": { "action": "disputed", "reason": "We hold a third-party award for this claim.", "actor": "U-1" } }
```

### Workflow

`POST /reviews/{id}/comments`
```json
// request
{ "text": "Please confirm the delivery cities with legal." }

// 201
{ "id": "C-77", "author": "Harshit Verma",
  "text": "Please confirm the delivery cities with legal.", "created_at": "2026-11-02T11:05:00Z" }
```

`POST /reviews/{id}/approve` and `POST /reviews/{id}/request-changes` (reviewer only)
```json
// request
{ "note": "Looks good after edits." }

// 200
{ "id": "CL-2084", "status": "approved" }
```

### Insights and disclosure

`GET /insights/summary`
```json
{ "reviewed_this_month": 128, "needs_attention": 8, "awaiting_approval": 12, "approved_this_month": 94,
  "top_issues": [{ "type": "unsupported_claim", "count": 31 }] }
```

`GET /insights/gaps` (brand_admin)
```json
[{ "source_id": "G-4.2", "title": "Avoid unsupported superlatives",
   "dispute_count": 9, "note": "Often disputed; may be unclear." }]
```

`GET /reviews/{id}/ai-disclosure`
```json
{ "review_id": "CL-2084",
  "steps": [
    { "step": "judge", "used_ai": true, "model": "claude", "data_sent": "1 sentence + 2 matched sources" },
    { "step": "rules", "used_ai": false }
  ] }
```

### Errors (same shape everywhere)

```json
{ "error": { "code": "forbidden", "message": "Only reviewers can approve." } }
```
`unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `validation_error` 422 · `server_error` 500

### Permissions

| Role | Can |
|---|---|
| creator | Submit drafts, view own findings, accept/edit/dispute, comment |
| manager | View team queue, comment, assign, escalate, view insights |
| reviewer | View escalated items with evidence, approve, request changes |
| brand_admin | Manage the Brand Kit, view guideline-gap insights |

The AI has no role. It cannot approve, reject or change content.

---

---

## Conventions the backend follows (clarifications, not changes to the shapes above)

**IDs** are opaque strings: users `U-n`, workspaces `W-n`, reviews `CL-n` (from 2001), findings `FD-n` (from 1001), comments `C-n`, sources `G-`/`F-`/`T-`/`A-` + number. Source IDs are unique per workspace.

**Brand Kit versions.** Adding a source creates the next Brand Kit version (`v1`, `v2`, ...). A source's `version` is the Brand Kit version it was introduced in. A review is pinned to the Brand Kit version current when it was submitted, and findings may only cite sources that exist in that version.

**Term sources.** `title` = the wording to avoid; `text` = `Use: <preferred wording>. <optional note>`.

**Spans** are character offsets (`start` inclusive, `end` exclusive) into the review's *current* `content`. After a finding is edited, later findings' spans are shifted so they keep pointing at the same text.

**Review status flow.**
`scanned` (a scan found issues) -> `resolving` (creator is deciding) -> `in_review` (every finding is `edited` or `disputed`) -> `approved` or `changes_requested` (reviewer only). A draft with zero findings goes straight to `in_review`. `changes_requested` returns to `resolving` / `in_review` when the creator changes a decision. A finding decided `accepted` (confirmed but not fixed) still counts as unresolved. `approved` is final.
Findings can only be decided while the review is `scanned`, `resolving` or `changes_requested`.

**Validation (422 `validation_error`)**: `disputed` needs a non-empty `reason`; `edited` needs `edited_text`; `request-changes` needs a non-empty `note`; approving or requesting changes on a review that is not `in_review` is rejected. An approve/request-changes `note` is also posted to the review's comment thread.

**Visibility.** Creators see only their own reviews. Managers and brand admins see the whole workspace (brand admins read-only). Reviewers see only reviews that reached `in_review` or beyond. Everything else answers `404 not_found`. `GET /insights/summary` is scoped to the reviews the caller can see; `GET /insights/gaps` is brand_admin only.

**Rules-only mode.** If the LLM is not configured or unreachable, findings come from deterministic rules only (`method: "rule_based"`) and `GET /reviews/{id}/ai-disclosure` shows the `judge` step with `used_ai: false`. A finding with `source: null` only occurs for built-in accessibility checks (e.g. missing alt text).

**Low confidence** (`confidence < 0.6`) is labelled in `reason` and severity is capped at `medium`.

---

## Gaps found while building (NOT implemented; need both of us to agree first)

1. **No way to read comments.** `POST /reviews/{id}/comments` exists but nothing returns them. Suggest `GET /reviews/{id}/comments` -> `CommentResponse[]`.
2. **No way to read the audit trail.** It is stored (actor, time, reason) but unreadable. The Audit history screen needs e.g. `GET /reviews/{id}/audit`.
3. **No escalate/assign endpoint**, although the manager role lists "assign, escalate". Today a review reaches `in_review` automatically once every finding is resolved.
4. **No `GET /auth/me`** to restore the session after a page refresh (the token alone does not carry the user's name).
5. **No re-scan after edits.** Edits are applied to the text and recorded, but findings are not re-run.


### Collaboration and multimodal review additions

`POST /reviews` accepts optional structured content metadata in addition to the original fields:
```json
{
  "title": "Campaign review",
  "content": "Launch copy...",
  "intent_note": "Product launch",
  "content_type": "multimodal",
  "external_ref": "cms-4821",
  "content_blocks": [
    {"type": "text", "value": "Launch copy..."},
    {"type": "image", "value": "https://cdn.example/banner.png", "alt_text": "Product launch banner", "label": "Hero banner"}
  ]
}
```

`GET /reviews/{id}/collaboration` returns the review's assignment, escalation state and structured content metadata.

`GET /reviews/{id}/comments` returns the full comment thread.

`GET /reviews/{id}/audit` returns the authoritative activity history, including actor, event type, detail, reason and timestamp.

`POST /reviews/{id}/assign` (manager only)
```json
{"reviewer_id": "U-3"}
```

`POST /reviews/{id}/escalate` (manager only)
```json
{"reason": "Needs legal review before publication."}
```

`GET /insights/recurring` returns recurring issue patterns across visible reviews, including occurrence count, affected review count, review coverage rate and an actionable recommendation.

These additions are backward-compatible with the original review detail and insights summary response shapes.
