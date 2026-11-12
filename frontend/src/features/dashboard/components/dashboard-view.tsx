"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, Clock3, ShieldAlert, Wand2 } from "lucide-react";
import { Card, CardHeader, EmptyState, Skeleton, StatCard, StatusBadge, buttonClass } from "@/components/ui";
import { openCount } from "@/features/reviews/lib/metrics";
import { useReviews, useReviewsLoaded } from "@/features/reviews/lib/store";
import type { Review } from "@/features/reviews/types";
import { api } from "@/lib/api";
import { pad, relativeTime } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useAsync } from "@/lib/use-api";
import type { UserRole } from "@/types/contract";
import { DashboardHero } from "./dashboard-hero";

const FOCUS: Record<UserRole, { title: string; empty: string; pick: (r: Review) => boolean; cta: string }> = {
  creator: { title: "Needs your attention", empty: "Nothing waiting on you.", pick: r => r.status === "Needs attention" || r.status === "Changes requested", cta: "Resolve" },
  reviewer: { title: "Waiting for your decision", empty: "No reviews are waiting for a decision.", pick: r => r.status === "In review", cta: "Review" },
  manager: { title: "In progress", empty: "Nothing is in progress.", pick: r => r.status !== "Approved", cta: "Open" },
  brand_admin: { title: "In progress", empty: "Nothing is in progress.", pick: r => r.status !== "Approved", cta: "Open" },
};

function Row({ r, cta }: { r: Review; cta?: string }) {
  return (
    <Link href={`/reviews/${r.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition hover:bg-soft">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{r.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{r.creator} · {openCount(r)} open · {relativeTime(r.updatedAt)}</div>
      </div>
      <StatusBadge>{r.status}</StatusBadge>
      {cta ? <span className="hidden items-center gap-1 text-xs font-semibold text-brand sm:flex">{cta} <ArrowRight size={13} /></span> : <ChevronRight size={15} className="text-muted" />}
    </Link>
  );
}

export function DashboardView() {
  const user = useSession();
  const reviews = useReviews();
  const loaded = useReviewsLoaded();
  const summary = useAsync(() => api.getInsightsSummary()).data;
  const role = (user?.role ?? "creator") as UserRole;
  const focus = FOCUS[role];
  const next = reviews.filter(focus.pick).slice(0, 5);
  const recent = [...reviews].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 6);
  const first = (user?.name ?? "").split(" ")[0];

  return (
    <div className="space-y-6">
      <DashboardHero firstName={first} canSubmit={can.submit(role)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={ShieldAlert} tone="danger" label="Needs attention" value={summary ? pad(summary.needs_attention) : "—"} hint="Open findings to resolve" />
        <StatCard icon={Clock3} tone="warning" label="Awaiting approval" value={summary ? pad(summary.awaiting_approval) : "—"} hint="Ready for a reviewer" />
        <StatCard icon={CheckCircle2} tone="success" label="Approved this month" value={summary ? pad(summary.approved_this_month) : "—"} hint="Final human decision made" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader icon={ShieldAlert} title={focus.title} action={<Link href="/reviews" className="text-xs font-bold text-brand hover:text-brand-strong">View all</Link>} />
        {!loaded && <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {loaded && !next.length && (
          <EmptyState icon={CheckCircle2} title={focus.empty} description={can.submit(role) ? "Start a review to see how Greenlight flags risky wording." : "New items appear here as soon as they need you."}
            action={can.submit(role) ? <Link href="/reviews/new?sample=risky" className={buttonClass("primary", "md")}><Wand2 size={14} /> Try a sample draft</Link> : undefined} />
        )}
        <div className="divide-y divide-line">{next.map(r => <Row key={r.id} r={r} cta={focus.cta} />)}</div>
      </Card>

      {loaded && recent.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader icon={Clock3} title="Recent activity" />
          <div className="divide-y divide-line">{recent.map(r => <Row key={r.id} r={r} />)}</div>
        </Card>
      )}
    </div>
  );
}
