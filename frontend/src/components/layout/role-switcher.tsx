"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Avatar, useToast } from "@/components/ui";
import { MOCK_USERS } from "@/lib/mockData";
import { ROLE_LABEL, switchDemoRole, useSession } from "@/lib/session";
import type { UserRole } from "@/types/contract";

const HINT: Record<UserRole, string> = {
  creator: "Submits drafts, fixes findings",
  reviewer: "Approves or sends back",
  brand_admin: "Owns rules and facts",
  manager: "Sees everything, read-only",
};
const ORDER: UserRole[] = ["creator", "reviewer", "brand_admin", "manager"];

/** Demo only. Switch roles in one click so every view is reachable without signing out. */
export function RoleSwitcher() {
  const user = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function pick(role: UserRole) {
    setOpen(false);
    if (role === user?.role) return;
    setBusy(true);
    try { await switchDemoRole(role); router.push("/dashboard"); toast(`Now viewing as ${ROLE_LABEL[role]}.`, "info"); }
    catch { toast("Could not switch role.", "warning"); }
    finally { setBusy(false); }
  }

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-left transition hover:border-brand/40 hover:bg-soft disabled:opacity-60">
        <Avatar name={user?.name ?? "—"} size={28} />
        <span className="hidden sm:block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Viewing as</span>
          <span className="block text-xs font-bold leading-tight text-ink">{user ? ROLE_LABEL[user.role as UserRole] : "—"}</span>
        </span>
        <ChevronDown size={14} className={`text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 animate-fade-in rounded-2xl border border-line bg-surface p-2 shadow-lift">
          <div className="px-3 pb-2 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Switch role · demo data</div>
          {ORDER.map(role => {
            const u = MOCK_USERS.find(x => x.role === role);
            const active = role === user?.role;
            return (
              <button key={role} role="menuitem" onClick={() => pick(role)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-soft ${active ? "bg-brand/10" : ""}`}>
                <Avatar name={u?.name ?? role} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{ROLE_LABEL[role]} <span className="font-normal text-muted">· {u?.name.split(" ")[0]}</span></span>
                  <span className="block truncate text-xs text-muted">{HINT[role]}</span>
                </span>
                {active && <Check size={15} className="text-brand" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
