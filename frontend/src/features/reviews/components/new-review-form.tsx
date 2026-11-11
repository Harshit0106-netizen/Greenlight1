"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, ScanSearch, Wand2 } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { workspace } from "@/config/site";
import { cn } from "@/lib/cn";
import { can, useSession } from "@/lib/session";
import { createReview } from "../lib/store";
import { samples } from "../lib/samples";
import { CHANNELS, REVIEW_MODES, type ReviewInput } from "../types";

const blank: ReviewInput = { title: "", channel: "Social media", content: "", intent: "", brandKit: workspace.brandKit, mode: "Full brand review", contentType: "text", contentBlocks: [], externalRef: "" };

export function NewReviewForm() {
  const router = useRouter();
  const role = useSession()?.role;
  const [form, setForm] = useState<ReviewInput>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ReviewInput>(key: K, value: ReviewInput[K]) => setForm(f => ({ ...f, [key]: value }));

  // /reviews/new?sample=risky|clean preloads sample copy.
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("sample");
    if (key === "risky" || key === "clean") setForm(samples[key].input);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.content.trim().length < 10) { setError("Add at least 10 characters so there is something to review."); return; }
    setBusy(true);
    try {
      const review = await createReview({ ...form, title: form.title.trim() || "Untitled review", content: form.content.trim() });
      router.push(`/reviews/${review.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The review could not be created. Please try again.");
      setBusy(false);
    }
  }

  if (role && !can.submit(role)) {
    return <div className="rounded-xl border border-line bg-soft p-6 text-sm text-muted">Only creators can submit drafts. Sign in as a creator to start a review.</div>;
  }

  const words = form.content.trim() ? form.content.trim().split(/\s+/).length : 0;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/reviews" className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-muted transition hover:text-ink"><ArrowLeft size={14} /> Reviews</Link>
      <PageHeader title="New review" description="Paste the copy as you intend to publish it. You’ll see every flag with its evidence in seconds."
        actions={<Button type="submit" form="new-review-form" size="lg" loading={busy}><ScanSearch size={16} /> {busy ? "Checking…" : "Run review"}</Button>} />

      <form id="new-review-form" onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader icon={FileText} title="Draft" description="Paste the copy exactly as you intend to publish it."
            action={<div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setForm(samples.risky.input)}><Wand2 size={13} /> Risky sample</Button>
              <Button size="sm" variant="ghost" onClick={() => setForm(samples.clean.input)}>Clean sample</Button>
            </div>} />
          <div className="p-5">
            <Textarea id="draft" aria-label="Draft" required autoFocus value={form.content} onChange={e => set("content", e.target.value)} rows={12} className="resize-y bg-soft/60 text-[15px] leading-7"
              placeholder="Headline, body, claims, call to action…" />
            <div className="mt-2 text-xs text-muted">{words} words</div>
            <div className="mt-5 text-xs font-semibold text-ink">Channel</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHANNELS.map(c => (
                <button key={c} type="button" onClick={() => set("channel", c)} aria-pressed={form.channel === c}
                  className={cn("rounded-full border px-3.5 py-1.5 text-xs font-semibold transition", form.channel === c ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand/40 hover:text-ink")}>{c}</button>
              ))}
            </div>
          </div>
        </Card>

        <details className="group rounded-2xl border border-line bg-surface shadow-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink">Options <span className="font-normal text-muted">· title, depth, context</span></summary>
          <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Diwali launch email" /></Field>
            <Field label="Depth"><Select value={form.mode} onChange={e => set("mode", e.target.value as ReviewInput["mode"])}>{REVIEW_MODES.map(m => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Brand knowledge"><Select value={form.brandKit} onChange={e => set("brandKit", e.target.value)}><option>{workspace.brandKit}</option></Select></Field>
            <Field label="Context" className="sm:col-span-2"><Textarea value={form.intent} onChange={e => set("intent", e.target.value)} rows={2} placeholder="Audience or goal. Optional." /></Field>
            <Field label="Content coverage"><Select value={form.contentType ?? "text"} onChange={e => set("contentType", e.target.value as ReviewInput["contentType"])}><option value="text">Text only</option><option value="multimodal">Text + visual assets</option><option value="structured">Structured content / API</option></Select></Field>
            <Field label="External content ID"><Input value={form.externalRef ?? ""} onChange={e => set("externalRef", e.target.value)} placeholder="CMS / campaign / ticket ID" /></Field>
           {(form.contentType === "multimodal" || form.contentType === "structured") && (
  <Field label="Visual / structured assets" className="sm:col-span-2">
    <div className="space-y-3">
      {(form.contentBlocks ?? []).map((block, index) => (
        <div
          key={index}
          className="rounded-xl border border-line bg-soft/40 p-3"
        >
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Field label="Type">
              <Select
                value={block.type}
                onChange={e => {
                  const blocks = [...(form.contentBlocks ?? [])];

                  blocks[index] = {
                    ...blocks[index],
                    type: e.target.value as "text" | "image" | "asset",
                  };

                  set("contentBlocks", blocks);
                }}
              >
                <option value="image">Image</option>
                <option value="asset">Asset</option>
                <option value="text">Text</option>
              </Select>
            </Field>

            <Field label="URL / value">
              <Input
                value={block.value}
                onChange={e => {
                  const blocks = [...(form.contentBlocks ?? [])];

                  blocks[index] = {
                    ...blocks[index],
                    value: e.target.value,
                  };

                  set("contentBlocks", blocks);
                }}
                placeholder="https://… or structured content"
              />
            </Field>

            <Field label="Label">
              <Input
                value={block.label ?? ""}
                onChange={e => {
                  const blocks = [...(form.contentBlocks ?? [])];

                  blocks[index] = {
                    ...blocks[index],
                    label: e.target.value,
                  };

                  set("contentBlocks", blocks);
                }}
                placeholder="Optional asset label"
              />
            </Field>

            <Field label="Alt text">
              <Input
                value={block.alt_text ?? ""}
                onChange={e => {
                  const blocks = [...(form.contentBlocks ?? [])];

                  blocks[index] = {
                    ...blocks[index],
                    alt_text: e.target.value,
                  };

                  set("contentBlocks", blocks);
                }}
                placeholder="Describe the visual"
              />
            </Field>
          </div>

          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const blocks = [...(form.contentBlocks ?? [])];
                blocks.splice(index, 1);
                set("contentBlocks", blocks);
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() =>
          set("contentBlocks", [
            ...(form.contentBlocks ?? []),
            {
              type: "image",
              value: "",
              label: "",
              alt_text: "",
            },
          ])
        }
      >
        + Add visual asset
      </Button>
    </div>

    <p className="mt-2 text-[11px] text-muted">
      Add visual or structured content that will be included in the review
      record and audit trail. Images can be checked for missing descriptive
      metadata and visual brand references.
    </p>
  </Field>
)}
          </div>
        </details>

        {error && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted">{form.contentType === "text" ? "Text review with evidence and human decisions." : "Structured and visual assets are included in the review record and audit trail."}</p>
          <Button type="submit" size="lg" loading={busy}><ScanSearch size={16} /> {busy ? "Checking…" : "Run review"}</Button>
        </div>
      </form>
    </div>
  );
}
