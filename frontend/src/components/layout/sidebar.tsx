"use client";
import type { UserRole } from "@/types/contract";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Plus, Settings2, Sparkles } from "lucide-react";
import { navFor } from "@/config/navigation";
import { site } from "@/config/site";
import { useReviews } from "@/features/reviews/lib/store";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ROLE_LABEL, can, signOut, useSession } from "@/lib/session";
import { LogoMark, Wordmark } from "./logo";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const reviews = useReviews();
  const user = useSession();
  const waiting = reviews.filter(r => r.status === "In review").length;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const quiet = "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-rail-ink/60 transition hover:bg-rail-ink/5 hover:text-rail-ink";

  return (
    <div className="flex h-full flex-col bg-rail text-rail-ink">
      <div className="flex h-[72px] items-center gap-3 border-b border-rail-ink/10 px-5">
        <LogoMark size={38} />
        <div>
          <Wordmark />
          <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-rail-ink/45">Brand intelligence</div>
        </div>
      </div>

      {can.submit(user?.role) && (
        <div className="px-4 pt-5">
          <Link href="/reviews/new" onClick={onNavigate}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-brand-ink shadow-glow transition hover:bg-brand-strong active:scale-[.98]">
            <Plus size={16} /> New content review
          </Link>
        </div>
      )}

      <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-5">
        {navFor(user?.role).map(item => {
          const active = isActive(item.href);
          const Icon = item.icon;
          const count = item.badge === "approvals" ? waiting : 0;
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition",
                active ? "bg-brand/15 text-rail-ink" : "text-rail-ink/60 hover:bg-rail-ink/5 hover:text-rail-ink")}>
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand" />}
              <Icon size={17} className={active ? "text-brand" : "text-rail-ink/45 group-hover:text-rail-ink/80"} />
              <span className="flex-1">{item.name}</span>
              {count > 0 && <span className="rounded-md bg-brand/25 px-1.5 py-0.5 text-[10px] font-bold text-brand">{count}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-rail-ink/10 p-3">
        <Link href="/ai-transparency" onClick={onNavigate} className={quiet}><Sparkles size={17} className="text-rail-ink/45" /> How AI is used</Link>
        <Link href="/settings" onClick={onNavigate} className={quiet}><Settings2 size={17} className="text-rail-ink/45" /> Settings</Link>
        <div className="mt-1 flex items-center gap-2.5 rounded-xl p-2.5">
          <Avatar name={user?.name ?? "—"} size={32} className="bg-brand/20 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold">{user?.name ?? "—"}</div>
            <div className="text-[11px] text-rail-ink/50">{user ? ROLE_LABEL[user.role as UserRole] : ""}</div>
          </div>
          <button onClick={signOut} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-rail-ink/50 transition hover:bg-rail-ink/10 hover:text-rail-ink"><LogOut size={15} /></button>
        </div>
      </div>
    </div>
  );
}
