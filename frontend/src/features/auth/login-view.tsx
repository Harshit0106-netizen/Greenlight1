"use client";
import type { UserRole } from "@/types/contract";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Compass, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { LogoMark, Wordmark } from "@/components/layout/logo";
import { workspace } from "@/config/site";
import { LIVE_AVAILABLE, pingApi } from "@/lib/api";
import { useHydrated } from "@/lib/hooks";
import { MOCK_PASSWORD, MOCK_USERS } from "@/lib/mockData";
import { ROLE_LABEL, signIn, useSession } from "@/lib/session";
import { resetReviews } from "@/features/reviews/lib/store";
import { resetTour, setTourOpen } from "@/features/tour/store";

type Health = "checking" | "online" | "offline";
const ORDER = ["creator", "reviewer", "brand_admin", "manager"] as const;
const accounts = ORDER.map(role => MOCK_USERS.find(u => u.role === role)!);
const ROLE_HINT = {
  creator: "Submit a draft and fix what is flagged",
  reviewer: "Approve it or send it back",
  brand_admin: "Own the rules and facts",
  manager: "See everything, read-only",
} as const;

export function LoginView() {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "live" | "demo">("");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health>(LIVE_AVAILABLE ? "checking" : "offline");

  useEffect(() => { if (hydrated && user) router.replace("/dashboard"); }, [hydrated, user, router]);
  useEffect(() => {
    if (!LIVE_AVAILABLE) return;
    let live = true;
    pingApi().then(ok => { if (live) setHealth(ok ? "online" : "offline"); });
    return () => { live = false; };
  }, []);

  async function liveSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy("live"); setError("");
    try { await signIn(email, password, "live"); router.replace("/dashboard"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not sign in."); setBusy(""); }
  }
  async function demoSignIn(target: (typeof accounts)[number], fresh = false) {
    setBusy("demo"); setError("");
    try {
      if (fresh) { resetReviews("demo"); resetTour(); }
      setTourOpen(true);
      await signIn(target.email, MOCK_PASSWORD, "demo");
      router.replace("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start the demo."); setBusy(""); }
  }

  return (
    <main className="grid min-h-screen bg-surface text-ink lg:grid-cols-[minmax(520px,1.75fr)_1fr]">
      <section className="flex flex-col px-6 py-8 sm:px-14 lg:px-20 xl:px-28">
        <div className="flex items-center gap-3"><LogoMark size={34} /><Wordmark className="text-xl" /></div>

        <div className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center py-10">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-xs font-semibold text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />{workspace.name} workspace
          </div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight">Welcome to Greenlight</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">
            {LIVE_AVAILABLE ? "Run the demo with sample data, or sign in to the live workspace." : "This deployment runs on built-in sample data. Pick a role to try the product."}
          </p>

          {/* 1. Demo first: sample data, four people, nothing to sign in to */}
          <div className="mt-7">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">Run the demo</span>
              <span className="text-[11px] text-muted">Sample data · stays in your browser</span>
            </div>
            <button type="button" disabled={busy !== ""} onClick={() => demoSignIn(accounts[0], true)}
              className="group flex w-full items-center gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-4 text-left transition hover:border-brand hover:bg-brand/10 disabled:opacity-60">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink"><Compass size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">Start the guided demo</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">A two-minute walk through the whole workflow, with a checklist at the top of every page.</span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-brand transition group-hover:translate-x-0.5" />
            </button>
            <div className="mt-3 text-xs font-semibold text-muted">Or jump straight into a role</div>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {accounts.map(a => (
                <button key={a.id} type="button" disabled={busy !== ""} onClick={() => demoSignIn(a)}
                  className="rounded-xl border border-line p-3.5 text-left transition hover:border-brand/50 hover:bg-brand/5 disabled:opacity-60">
                  <span className="block text-sm font-semibold">{ROLE_LABEL[a.role as UserRole]}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted">{ROLE_HINT[a.role as UserRole]}</span>
                </button>
              ))}
            </div>
            {!LIVE_AVAILABLE && error && <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</p>}
          </div>

          {/* 2. Live backend below */}
          {LIVE_AVAILABLE && (
            <>
              <div className="my-8 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or sign in to the live backend<span className="h-px flex-1 bg-line" /></div>

              <p className="flex items-center gap-2 text-xs text-muted" role="status">
                <span className={`h-2 w-2 rounded-full ${health === "online" ? "bg-success" : health === "checking" ? "animate-pulse bg-warning" : "bg-danger"}`} />
                {health === "online" ? "Live backend online" : health === "checking" ? "Connecting to the live backend. The first request can take about 10 seconds." : "The live backend is not responding. The demo above still works."}
              </p>

              <form onSubmit={liveSignIn} className="mt-4 space-y-4">
                <Field label="Email"><Input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-12 text-[15px]" /></Field>
                <Field label="Password"><Input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="h-12 text-[15px]" /></Field>
                {error && <p role="alert" className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-sm text-danger">{error}</p>}
                <Button type="submit" size="lg" loading={busy === "live"} disabled={busy === "demo"} className="h-12 w-full text-[15px]">Sign in <ArrowRight size={16} /></Button>
              </form>

              <div className="mt-5 rounded-2xl border border-line bg-soft/60 p-4">
                <p className="text-sm font-semibold text-ink">Sample email and password are below. Click one to fill them in.</p>
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {accounts.map(a => (
                    <li key={a.id}>
                      <button type="button" onClick={() => { setEmail(a.email); setPassword(MOCK_PASSWORD); setError(""); }}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left transition hover:border-brand/50">
                        <span className="min-w-0"><span className="block text-xs font-bold">{ROLE_LABEL[a.role as UserRole]}</span><span className="block truncate text-[11px] text-muted">{a.email}</span></span>
                        <span className="shrink-0 text-[11px] font-semibold text-brand">Use</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-4 text-muted">Password for all: <code className="rounded bg-surface px-1.5 py-0.5 font-semibold text-ink">{MOCK_PASSWORD}</code>. These are sample accounts on a demo workspace, so feel free to create reviews.</p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-muted">Need an account? Ask your workspace admin. Sessions end after one hour.</p>
      </section>

      <aside className="relative hidden flex-col justify-center overflow-hidden bg-[linear-gradient(115deg,#12142e_0%,#161d3d_50%,#0f2f40_100%)] px-10 py-12 text-white lg:flex xl:px-14" aria-label="About Greenlight">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand/25 blur-[90px]" />
        <div className="relative">
          <h2 className="text-[28px] font-bold leading-[1.15] tracking-tight">Know what you’re publishing <span className="text-gradient">before you publish it.</span></h2>
          <div className="mt-8 rounded-2xl border border-white/15 bg-white/[.07] p-4 shadow-2xl backdrop-blur-xl" aria-hidden>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/50"><ShieldCheck size={12} /> High · Unsupported claim</div>
            <p className="mt-2.5 text-sm leading-6 text-white/85">
              Order today.{" "}
              <mark className="rounded bg-rose-400/25 px-1 text-white underline decoration-rose-300 decoration-wavy decoration-[1.5px] underline-offset-[5px]">India’s #1 fastest delivery, guaranteed.</mark>
            </p>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-4 text-white/65">Guideline G-4.2 · no approved fact supports “#1”.</div>
          </div>
          <p className="mt-6 text-xs leading-5 text-white/55">Every flag shows its evidence. A person makes the final call.</p>
        </div>
      </aside>
    </main>
  );
}
