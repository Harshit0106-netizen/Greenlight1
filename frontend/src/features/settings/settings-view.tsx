"use client";
import type { UserRole } from "@/types/contract";
import { useState } from "react";
import { Bell, Building2, Database, Moon, Palette, RotateCcw, Save, Sun, UserRound } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Modal, PageHeader, StatusBadge, useToast } from "@/components/ui";
import { workspace } from "@/config/site";
import { ROLE_LABEL, useIsDemo, useSession } from "@/lib/session";
import { resetBrandKit } from "@/features/brand-kit/store";
import { resetReviews } from "@/features/reviews/lib/store";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { settingsStore, useSettings, type Settings } from "./store";

const sections = [["workspace", "Workspace", Building2], ["profile", "Profile", UserRound], ["notifications", "Notifications", Bell], ["appearance", "Appearance", Palette], ["data", "Demo data", Database]] as const;

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-brand" : "bg-line")}>
      <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-6" : "left-1")} />
    </button>
  );
}

export function SettingsView() {
  const saved = useSettings();
  const role = useSession()?.role;
  const USE_MOCK = useIsDemo();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [confirm, setConfirm] = useState(false);
  const form = draft ?? saved;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...form, [k]: v });
  const dirty = draft !== null;

  return (
    <div>
      <PageHeader eyebrow="Workspace configuration" title="Settings" description="Manage workspace details, personal preferences and demo data." />
      <div className="grid gap-5 xl:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto xl:flex-col xl:sticky xl:top-24 xl:self-start">
          {sections.map(([id, label, Icon]) => (
            <a key={id} href={`#${id}`} className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface hover:text-ink"><Icon size={15} />{label}</a>
          ))}
        </nav>

        <div className="space-y-5">
          <Card id="workspace" className="scroll-mt-24 overflow-hidden">
            <CardHeader icon={Building2} title="Workspace details" description="Basic information about your brand workspace." />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field label="Workspace name"><Input value={form.workspaceName} onChange={e => set("workspaceName", e.target.value)} /></Field>
              <Field label="Workspace URL"><Input value={`greenlight.app/${workspace.slug}`} disabled readOnly /></Field>
              <div className="flex items-center justify-between rounded-xl border border-line bg-soft/70 p-3.5 sm:col-span-2">
                <div><div className="text-sm font-semibold">Demo workspace</div><div className="mt-0.5 text-xs text-muted">Prototype environment · sample data</div></div><StatusBadge>Active</StatusBadge>
              </div>
            </div>
          </Card>

          <Card id="profile" className="scroll-mt-24 overflow-hidden">
            <CardHeader icon={UserRound} title="Personal profile" />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field label="Display name"><Input value={form.displayName} onChange={e => set("displayName", e.target.value)} /></Field>
              <Field label="Email address"><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></Field>
              <div className="sm:col-span-2"><div className="text-xs font-semibold">Workspace role</div><div className="mt-2"><StatusBadge>{role ? ROLE_LABEL[role as UserRole] : "—"}</StatusBadge></div></div>
            </div>
          </Card>

          <Card id="notifications" className="scroll-mt-24">
            <CardHeader icon={Bell} title="Notifications" />
            <div className="divide-y divide-line px-5">
              {([["notifications", "Review activity", "Updates when reviews are submitted or decisions are made."], ["weeklyDigest", "Weekly digest", "A summary of findings and approvals every Monday."]] as const).map(([k, t, d]) => (
                <div key={k} className="flex items-center justify-between gap-4 py-4"><div><div className="text-sm font-semibold">{t}</div><div className="mt-0.5 text-xs text-muted">{d}</div></div><Toggle on={form[k]} onChange={v => set(k, v)} label={t} /></div>
              ))}
            </div>
          </Card>

          <Card id="appearance" className="scroll-mt-24">
            <CardHeader icon={Palette} title="Appearance" description="Applies instantly and is remembered on this device." />
            <div className="grid grid-cols-2 gap-3 p-5 sm:max-w-md">
              {([["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTheme(id)} aria-pressed={theme === id}
                  className={cn("flex items-center gap-3 rounded-xl border p-4 text-sm font-semibold transition", theme === id ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:text-ink")}><Icon size={17} />{label}</button>
              ))}
            </div>
          </Card>

          <Card id="data" className="scroll-mt-24">
            <CardHeader icon={Database} title="Demo data" description="Reviews and the Brand Kit live in this browser only." />
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="max-w-md text-sm leading-6 text-muted">{USE_MOCK ? "Reset to the original sample reviews and Brand Kit. Useful before a live demo." : "Clear what this browser stored (activity log, form details). Nothing on the server is changed."}</p>
              <Button variant="danger" onClick={() => setConfirm(true)}><RotateCcw size={14} /> {USE_MOCK ? "Reset demo data" : "Clear local records"}</Button>
            </div>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {dirty && <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>}
            <Button disabled={!dirty} onClick={() => { settingsStore.write(form); setDraft(null); toast("Preferences saved on this device."); }}><Save size={14} /> Save preferences</Button>
          </div>
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={USE_MOCK ? "Reset demo data?" : "Clear local records?"} description={USE_MOCK ? "This replaces the mock reviews and Brand Kit with the original samples." : "This only clears this browser. The server keeps all reviews and the Brand Kit."}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { resetReviews(); resetBrandKit(); setConfirm(false); toast(USE_MOCK ? "Demo data restored." : "Local records cleared."); }}>Reset</Button>
        </div>
      </Modal>
    </div>
  );
}
