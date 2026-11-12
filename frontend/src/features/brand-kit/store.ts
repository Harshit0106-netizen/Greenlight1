"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { BrandSource } from "@/types/contract";
import { api } from "@/lib/api";
import { markTour } from "@/features/tour/store";
import { getSessionUser, onSessionChange } from "@/lib/session";
import { seedKit } from "./data";
import type { ApprovedFact, BrandKit, BrandRule, BrandTerm } from "./types";

/**
 * Brand Kit, read and written through the API (guideline / fact / term sources).
 * Contract limits shown honestly in the UI: sources can be added but not deleted, and a guideline has no
 * category or source-reference field, so those are not offered.
 */
type State = { kit: BrandKit; version: string; loaded: boolean; error: string };
const EMPTY_KIT: BrandKit = { rules: [], facts: [], terms: [] };
const BLANK: State = { kit: EMPTY_KIT, version: "", loaded: false, error: "" };
let state: State = BLANK;
let loading = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()); };

/** Term convention shared with the backend: title = wording to avoid; text = "Use: <preferred>. <note>". */
function parseTerm(text: string): { use: string; note: string } {
  const m = /^\s*use\s*[:\-–]?\s*["“'‘]?([^"”'’.;—–]+?)["”'’]?\s*(?:[.;—–]\s*([\s\S]*))?$/i.exec(text);
  return { use: m ? m[1].trim() : text, note: m?.[2]?.trim() ?? "" };
}
const versionNumber = (v: string) => Number(v.replace(/\D/g, "")) || 0;

export function kitFromSources(list: BrandSource[]): { kit: BrandKit; version: string } {
  const rules: BrandRule[] = [];
  const facts: ApprovedFact[] = [];
  const terms: BrandTerm[] = [];

  let top = 0;

  for (const s of list) {
    top = Math.max(top, s.version);

    if (s.kind === "guideline") {
      rules.push({
        id: s.id,
        title: s.title,
        category: "Guideline",
        description: s.content,
        source: `Brand Kit ${s.version}`,
        status: "Active",
      });
    } else if (s.kind === "fact") {
      facts.push({
        id: s.id,
        subject: s.title,
        approvedText: s.content,
        source: `Brand Kit ${s.version}`,
        updatedAt: String(s.version),
      });
    } else if (s.kind === "other") {
  const { use, note } = parseTerm(s.content);

  terms.push({
    id: s.id,
    avoid: s.title,
    use,
    note: note || "Approved terminology",
  });
} 
  }

  return {
    kit: { rules, facts, terms },
    version: top ? `v${top}` : "",
  };
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const { kit, version } = kitFromSources(await api.getBrandSources());
    set({ kit, version, loaded: true, error: "" });
  } catch (e) { set({ loaded: true, error: e instanceof Error ? e.message : "Could not load the Brand Kit." }); }
  finally { loading = false; }
}
const ensureLoaded = () => { if (getSessionUser() && !state.loaded && !loading) void load(); };
if (typeof window !== "undefined") onSessionChange(() => { state = BLANK; loading = false; listeners.forEach(l => l()); ensureLoaded(); });

const useEnsure = () => useEffect(() => { ensureLoaded(); }, []);
export function useBrandKit(): BrandKit { useEnsure(); return useSyncExternalStore(subscribe, () => state.kit, () => EMPTY_KIT); }
export function useBrandKitMeta() { useEnsure(); return { version: useSyncExternalStore(subscribe, () => state.version, () => ""), loaded: useSyncExternalStore(subscribe, () => state.loaded, () => false), error: useSyncExternalStore(subscribe, () => state.error, () => "") }; }
/** Synchronous read for non-React code. Falls back to the built-in sample kit before the first load. */
export const getBrandKit = (): BrandKit => (state.loaded ? state.kit : seedKit);
export function resetBrandKit() { state = BLANK; listeners.forEach(l => l()); ensureLoaded(); }

async function add(kind: BrandSource["kind"], title: string, text: string) {
  await api.createBrandSource({ kind, title: title.trim(), content: text.trim() });
  markTour("kit");
  await load();
}
export const addRule = (r: { title: string; description: string }) => add("guideline", r.title, r.description);
export const addFact = (f: { subject: string; approvedText: string }) => add("fact", f.subject, f.approvedText);
export const addTerm = (t: { avoid: string; use: string; note: string }) =>
  add(
    "other",
    t.avoid,
    `Use: ${t.use.trim()}.${t.note.trim() ? ` ${t.note.trim()}` : ""}`
  );