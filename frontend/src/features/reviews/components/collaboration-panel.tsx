"use client";
import { useEffect, useState } from "react";
import { MessageCircle, Send, UserPlus, TriangleAlert } from "lucide-react";
import { Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";
import { can, useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { Review } from "../types";
import { reloadReviews } from "../lib/store";

export function CollaborationPanel({ review }: { review: Review }) {
  const user = useSession();
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [reviewers, setReviewers] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const canComment = can.comment(user?.role);
  const canManage = user?.role === "manager";
  useEffect(() => { if (canManage) void api.getWorkspaceUsers("reviewer").then(users => { setReviewers(users); if (users[0]) setReviewerId(users[0].id); }).catch(() => undefined); }, [canManage]);

  async function submitComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try { await api.addComment(review.id, { text: comment.trim() }); setComment(""); toast("Comment added.", "success"); await reloadReviews(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not add comment.", "warning"); }
    finally { setBusy(false); }
  }
  async function assign() {
    setBusy(true);
    try { await api.assignReviewer(review.id, { reviewer_id: reviewerId }); toast("Reviewer assigned.", "success"); await reloadReviews(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not assign reviewer.", "warning"); }
    finally { setBusy(false); }
  }
  async function escalate() {
    if (!reason.trim()) return;
    setBusy(true);
    try { await api.escalateReview(review.id, { reason: reason.trim() }); setReason(""); toast("Review escalated to the review queue.", "info"); await reloadReviews(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not escalate review.", "warning"); }
    finally { setBusy(false); }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={MessageCircle} title="Collaborative review" description="Comments, ownership and escalations stay attached to this review." />
      <div className="space-y-5 p-5">
        {review.assignedReviewer && <div className="rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-3 text-xs text-ink"><span className="font-semibold">Assigned reviewer:</span> {review.assignedReviewer}</div>}
        {review.escalationReason && <div className="rounded-lg border border-warning/25 bg-warning/10 px-3.5 py-3 text-xs text-ink"><div className="flex items-center gap-2 font-semibold text-warning"><TriangleAlert size={13} /> Escalated</div><p className="mt-1">{review.escalationReason}</p></div>}

        <div className="space-y-3">
          {(review.comments ?? []).length ? review.comments.map(c => (
            <div key={c.id} className="rounded-lg border border-line bg-soft/40 p-3.5">
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-ink">{c.author}</span><span className="text-[11px] text-muted">{relativeTime(c.at)}</span></div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-ink/80">{c.text}</p>
            </div>
          )) : <p className="text-sm text-muted">No comments yet. Use the thread to explain a decision or unblock the next reviewer.</p>}
        </div>

        {canComment && <div className="flex gap-2"><Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Add a review note…" /><Button onClick={submitComment} disabled={!comment.trim() || busy}><Send size={14} /> Comment</Button></div>}

        {canManage && <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <div className="space-y-2"><div className="flex items-center gap-2 text-xs font-semibold text-ink"><UserPlus size={13} /> Assign reviewer</div><div className="flex gap-2"><Select value={reviewerId} onChange={e => setReviewerId(e.target.value)}><option value="">Select reviewer</option>{reviewers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select><Button variant="secondary" onClick={assign} disabled={busy || !reviewerId}>Assign</Button></div><p className="text-[11px] text-muted">Assignment is recorded in the server audit trail.</p></div>
          <div className="space-y-2"><div className="flex items-center gap-2 text-xs font-semibold text-ink"><TriangleAlert size={13} /> Escalate</div><div className="flex gap-2"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why does this need attention?" /><Button variant="secondary" onClick={escalate} disabled={busy || !reason.trim()}>Escalate</Button></div></div>
        </div>}
      </div>
    </Card>
  );
}
