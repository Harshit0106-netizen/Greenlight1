"use client";
import { useEffect } from "react";
import Link from "next/link";
import { markTour } from "@/features/tour/store";
import { Activity, AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, Clock3, Lightbulb, Repeat2 } from "lucide-react";
import { Card, CardHeader, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { categoryLabel } from "@/features/reviews/lib/adapters";
import { api } from "@/lib/api";
import { pad } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useAsync } from "@/lib/use-api";

/** Live numbers only. Nothing on this page is sample data. */
export function InsightsView() {
  const role = useSession()?.role;
  useEffect(() => { markTour("insights"); }, []);
  const summary = useAsync(() => api.getInsightsSummary());
  const gaps = useAsync(() => api.getInsightGaps(), can.seeGaps(role));
  const recurring = useAsync(() => api.getRecurringInsights(), true);
  const issues = (summary.data?.top_issues ?? []).map(t => ({ name: categoryLabel[t.type] ?? t.type, count: t.count }));
  const max = Math.max(1, ...issues.map(i => i.count));
  const colors = ["bg-brand", "bg-info", "bg-warning", "bg-success", "bg-danger"];

  return (
    <div className="space-y-6">
      <PageHeader title="Insights" description="Where drafts most often diverge from your brand, and which rules creators keep disputing." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Activity} label="Reviewed this month" value={summary.data ? pad(summary.data.reviewed_this_month) : "—"} />
        <StatCard icon={Clock3} tone="warning" label="Awaiting approval" value={summary.data ? pad(summary.data.awaiting_approval) : "—"} />
        <StatCard icon={CheckCircle2} tone="success" label="Approved this month" value={summary.data ? pad(summary.data.approved_this_month) : "—"} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader icon={Repeat2} title="Recurring issues" description="Patterns that show up across multiple reviews, not just one document." />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          {recurring.loading && <Skeleton className="h-24" />}
          {!recurring.loading && !(recurring.data ?? []).length && <p className="text-sm text-muted">No recurring pattern is strong enough yet. More reviews will make these signals more useful.</p>}
          {(recurring.data ?? []).map(issue => (
            <div key={issue.type} className="rounded-xl border border-line bg-soft/40 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{categoryLabel[issue.type] ?? issue.type}</p><p className="mt-1 text-xs text-muted">{issue.count} findings across {issue.review_count} reviews · {Math.round(issue.rate * 100)}% of visible reviews</p></div><span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">Recurring</span></div>
              <p className="mt-3 text-xs leading-5 text-ink/75">{issue.recommendation}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader icon={BarChart3} title="Most common findings" description="By type, across the reviews you can see" />
          <div className="space-y-4 p-5">
            {recurring.loading && <Skeleton className="h-24" />}
            {!summary.loading && !issues.length && <p className="text-sm text-muted">No findings yet. Submit a draft to see patterns.</p>}
            {issues.map((i, n) => (
              <div key={i.name}>
                <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink">{i.name}</span><span className="tabular-nums text-muted">{i.count}</span></div>
                <div className="h-1.5 rounded-full bg-soft"><div className={`h-full rounded-full ${colors[n % colors.length]}`} style={{ width: `${(i.count / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader icon={Lightbulb} title="Guideline gaps" description="Rules creators dispute repeatedly. They may be unclear." />
          <div className="space-y-3 p-5">
            {!can.seeGaps(role) && <p className="text-sm text-muted">Guideline gaps are visible to brand admins.</p>}
            {can.seeGaps(role) && gaps.loading && <Skeleton className="h-16" />}
            {can.seeGaps(role) && !gaps.loading && !(gaps.data ?? []).length && <p className="text-sm text-muted">No rule is being disputed repeatedly right now.</p>}
            {(gaps.data ?? []).map(g => (
              <div key={g.source_id} className="rounded-lg border border-warning/25 bg-warning/10 p-3.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-warning"><AlertTriangle size={13} /> {g.title} · {g.source_id}</div>
                <p className="mt-1.5 text-sm leading-6 text-ink/80">{g.note}</p>
              </div>
            ))}
            {can.seeGaps(role) && <Link href="/brand-kit" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-strong">Open Brand Kit <ArrowUpRight size={12} /></Link>}
          </div>
        </Card>
      </div>
    </div>
  );
}
