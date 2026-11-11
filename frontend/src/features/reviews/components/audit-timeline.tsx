import { Bot, CheckCircle2, FilePlus2, Gavel, Pencil, MessageCircle, UserPlus, TriangleAlert, type LucideIcon } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AuditEntry, AuditKind } from "../types";

export const auditMeta: Record<AuditKind, { icon: LucideIcon; tone: string; label: string }> = {
  submitted: { icon: FilePlus2, tone: "bg-brand/10 text-brand", label: "Submission" },
  analysis: { icon: Bot, tone: "bg-info/10 text-info", label: "Analysis" },
  finding: { icon: Gavel, tone: "bg-warning/10 text-warning", label: "Decision" },
  edit: { icon: Pencil, tone: "bg-success/10 text-success", label: "Edit" },
  status: { icon: CheckCircle2, tone: "bg-success/10 text-success", label: "Status" },
  comment: { icon: MessageCircle, tone: "bg-info/10 text-info", label: "Comment" },
  assignment: { icon: UserPlus, tone: "bg-brand/10 text-brand", label: "Assignment" },
  escalation: { icon: TriangleAlert, tone: "bg-warning/10 text-warning", label: "Escalation" },
  decision: { icon: Gavel, tone: "bg-warning/10 text-warning", label: "Decision" }
};

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  const list = [...entries].reverse();
  return (
    <ol className="p-5">
      {list.map((e, i) => {
        const { icon: Icon, tone } = auditMeta[e.kind];
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < list.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-26px)] w-px bg-line" />}
            <span className={cn("z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone)}><Icon size={14} /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-5 text-ink">{e.message}</p>
              <p className="mt-0.5 text-xs text-muted">{e.actor} · {formatDateTime(e.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
