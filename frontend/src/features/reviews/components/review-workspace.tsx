"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, SearchX } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Skeleton, useToast, buttonClass } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { markTour } from "@/features/tour/store";
import { can, useSession } from "@/lib/session";
import { approveReview, decideFinding, requestChanges, rewriteFinding, useReview, useReviewsLoaded } from "../lib/store";
import type { FindingStatus } from "../types";
import { AiDisclosureCard } from "./ai-disclosure-card";
import { AnnotatedContent } from "./annotated-content";
import { AuditTimeline } from "./audit-timeline";
import { FindingEvidence } from "./finding-evidence";
import { FindingList } from "./finding-list";
import { ReviewOutcome } from "./review-outcome";
import { ReviewSummary } from "./review-summary";
import { CollaborationPanel } from "./collaboration-panel";

const toastFor = {
  Accepted: "Finding confirmed as a valid issue. Edit the wording before approval.",
  Disputed: "Finding marked not applicable. Your reason is recorded.",
} as const;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function ReviewWorkspace({ id }: { id: string }) {
  const review = useReview(id);
  const loaded = useReviewsLoaded();
  const user = useSession();
  const { toast } = useToast();
  const [selected, setSelected] = useState("");
  const pick = (id: string) => { setSelected(id); markTour("evidence"); };
  const [busy, setBusy] = useState(false);
  const findings = review?.findings ?? [];
  const current = findings.find(f => f.id === selected) ?? findings[0];

  // J / K walk through findings without leaving the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || e.metaKey || e.ctrlKey || !findings.length) return;
      const i = findings.findIndex(f => f.id === current?.id);
      if (e.key === "j") setSelected(findings[Math.min(i + 1, findings.length - 1)].id);
      if (e.key === "k") setSelected(findings[Math.max(i - 1, 0)].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [findings, current?.id]);

  if (!loaded) return <div className="space-y-5"><Skeleton className="h-10 w-72" /><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  if (!review) {
    return (
      <Card><EmptyState icon={SearchX} title="Review not found" description="It may not exist, or you may not have access to it."
        action={<Link href="/reviews" className={buttonClass("primary", "md")}>Back to reviews</Link>} /></Card>
    );
  }

  const mine = can.resolveFindings(user?.role) && review.creator === user?.name;
  const editableStatus = review.status === "Needs attention" || review.status === "Changes requested";
  const canResolve = mine && editableStatus;

  async function run(action: () => Promise<unknown>, success?: string, tone: "success" | "info" | "warning" = "success") {
    setBusy(true);
    try { await action(); if (success) toast(success, tone); return true; }
    catch (e) { toast(messageOf(e), "warning"); return false; }
    finally { setBusy(false); }
  }
  const advance = () => {
    const next = findings.find(f => f.id !== current?.id && f.status === "Open");
    if (next) setSelected(next.id);
  };
  const decide = async (status: Extract<FindingStatus, "Accepted" | "Disputed">, reason?: string) => {
    if (!current) return;
    if (await run(() => decideFinding(id, current.id, status, reason), toastFor[status])) advance();
  };
  const canApply = !!current && review.content.includes(current.quote);
  const rewrite = async (text: string, via: "suggestion" | "manual") => {
    if (!current) return;
    if (await run(() => rewriteFinding(id, current.id, text, via), via === "suggestion" ? "Suggested replacement applied to the draft." : "Replacement saved to the draft.")) advance();
  };

  return (
    <div>
      <Link href="/reviews" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted transition hover:text-brand"><ArrowLeft size={14} /> All reviews</Link>
      <PageHeader eyebrow={`${review.id} · ${review.channel}`} title={review.title}
        description={`Submitted by ${review.creator} · updated ${relativeTime(review.updatedAt)}`}
        actions={<Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Print report</Button>} />

      <ReviewSummary review={review} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <AnnotatedContent review={review} selectedId={current?.id ?? ""} onSelect={pick} />
          <FindingList findings={findings} selectedId={current?.id ?? ""} onSelect={pick} />
        </div>
        <div className="space-y-5 xl:sticky xl:top-20">
          <FindingEvidence finding={current} canApply={canApply} canResolve={canResolve} busy={busy}
            position={current ? { index: findings.findIndex(f => f.id === current.id) + 1, total: findings.length, onStep: d => { const i = findings.findIndex(f => f.id === current.id); const n = findings[i + d]; if (n) setSelected(n.id); } } : undefined}
            onDecide={decide} onApply={() => current && rewrite(current.suggestion, "suggestion")} onRewrite={t => rewrite(t, "manual")} />
          <CollaborationPanel review={review} />
          <ReviewOutcome review={review} canDecide={can.decide(user?.role)} busy={busy}
            onApprove={note => run(async () => { const ok = await approveReview(id, note); if (!ok) throw new Error("Approval is blocked until every finding is edited or marked not applicable."); }, "Review approved. Every finding has a recorded decision.")}
            onRequestChanges={note => run(() => requestChanges(id, note), "Changes requested. The creator will see your note.", "info")} />
          <details className="group rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink">
              Details: AI use and activity <span className="text-xs font-normal text-muted group-open:hidden">Show</span><span className="hidden text-xs font-normal text-muted group-open:inline">Hide</span>
            </summary>
            <div className="space-y-5 border-t border-line p-4">
              <AiDisclosureCard reviewId={id} />
              <Card><AuditTimeline entries={review.audit} />
                <p className="border-t border-line px-5 py-3 text-xs leading-5 text-muted">Shows what happened in this browser. The server keeps the authoritative audit trail.</p></Card>
            </div>
          </details>
        </div>
      </div>
      <p className="mt-8 text-center text-xs text-muted">
        {review.source === "api" ? "Each flag is tied to an exact quote and an approved source. Anything the verifier could not confirm was dropped." : "Sample data: flags come from the built-in mock backend, which uses the same workflow rules as the API."}
      </p>
    </div>
  );
}
