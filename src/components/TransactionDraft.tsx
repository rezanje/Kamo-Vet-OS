"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type DraftSnapshot = { snapshot: Record<string, unknown>; restore: (value: Record<string, unknown>) => boolean; reset?: () => void };
type Draft = { version: 1; savedAt: number; requestKey: string; fields: Record<string, string>; snapshot: Record<string, unknown> };
export const transactionDraftName = (userId: string, domain: string, scope: string) => `vetos:transaction-draft:v1:${userId}:${domain}:${scope}`;
export function clearTransactionDraft(userId: string, domain: string, scope: string, requestKey: string) {
  try {
    const name = transactionDraftName(userId, domain, scope);
    const draft = JSON.parse(sessionStorage.getItem(name) ?? "null") as Draft | null;
    if (draft?.requestKey === requestKey) sessionStorage.removeItem(name);
  } catch { /* Server confirmation remains valid when storage is unavailable. */ }
}
export function draftRecord<T>(value: unknown, valid: (entry: unknown) => entry is T): value is Record<string, T> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(valid);
}
export const draftNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const draftString = (value: unknown): value is string => typeof value === "string";

/** Like clinic drafts: browser-tab only, authenticated user scope, twelve-hour lifetime. */
export function TransactionDraft({ userId, domain, scope, requestKey, state }: {
  userId: string; domain: "purchase" | "sales" | "transaction"; scope: string; requestKey: string; state?: DraftSnapshot;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; });
  const save = useRef<() => void>(() => {});
  const [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  useLayoutEffect(() => {
    if (!fields) return;
    for (const control of Array.from(anchor.current?.closest("form")?.elements ?? [])) {
      if (eligible(control) && typeof fields[fieldKey(control)] === "string") {
        if (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)) control.checked = fields[fieldKey(control)] === "true";
        else {
          control.value = fields[fieldKey(control)];
          if (control.hasAttribute("data-draft-state")) control.dispatchEvent(new CustomEvent("vetos:draft-restore", { detail: control.value }));
        }
      }
    }
  }, [fields]);
  const serialized = JSON.stringify(state?.snapshot ?? {});
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form || !userId || !requestKey) return;
    const name = transactionDraftName(userId, domain, scope);
    let ready = false;
    let cancelled = false;
    function persist() {
      if (!ready || !form) return;
      const values: Record<string, string> = {};
      for (const control of Array.from(form.elements)) if (eligible(control)) values[fieldKey(control)] = control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? String(control.checked) : control.value;
      try {
        sessionStorage.setItem(name, JSON.stringify({ version: 1, savedAt: Date.now(), requestKey,
          fields: values, snapshot: latest.current?.snapshot ?? {} } satisfies Draft));
      } catch { setNotice("Draf browser tidak dapat disimpan. Tetap di halaman ini sampai transaksi berhasil."); }
    }
    save.current = persist;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(name);
        if (raw) {
          const draft = JSON.parse(raw) as Draft;
          const valid = draft?.version === 1 && draft.requestKey === requestKey && Number.isFinite(draft.savedAt)
            && draft.savedAt > 0 && draft.savedAt <= Date.now() && Date.now() - draft.savedAt <= 12 * 60 * 60 * 1000
            && draftRecord(draft.fields, draftString) && draft.snapshot && typeof draft.snapshot === "object"
            && !Array.isArray(draft.snapshot) && (!latest.current || latest.current.restore(draft.snapshot));
          if (valid) { setFields(draft.fields); setNotice("Draf dipulihkan. Periksa sisa barang dan isian sebelum menyimpan."); }
          else { sessionStorage.removeItem(name); setNotice("Draf lama tidak dapat dipulihkan. Periksa dan isi kembali formulir."); }
        }
      } catch { setNotice("Draf browser tidak dapat dipulihkan. Periksa isian sebelum menyimpan."); }
      ready = true;
    });
    let confirmedReset = false;
    const preventReset = (event: Event) => { if (!confirmedReset) event.preventDefault(); };
    const confirm = (event: Event) => {
      const detail = (event as CustomEvent<{scope: string; key: string}>).detail;
      if (detail?.scope === scope && detail.key === requestKey) {
        ready = false; clearTransactionDraft(userId, domain, scope, requestKey); setNotice("");
        setFields(null); latest.current?.reset?.();
        confirmedReset = true; form.reset(); confirmedReset = false;
      }
    };
    form.addEventListener("input", persist); form.addEventListener("change", persist); form.addEventListener("submit", persist);
    form.addEventListener("reset", preventReset); window.addEventListener("pagehide", persist);
    window.addEventListener(`vetos:${domain}-confirmed`, confirm);
    return () => {
      cancelled = true; ready = false; save.current = () => {};
      form.removeEventListener("input", persist); form.removeEventListener("change", persist); form.removeEventListener("submit", persist);
      form.removeEventListener("reset", preventReset); window.removeEventListener("pagehide", persist);
      window.removeEventListener(`vetos:${domain}-confirmed`, confirm);
    };
  }, [userId, domain, scope, requestKey]);
  useEffect(() => { save.current(); }, [serialized, fields]);
  return <span ref={anchor}>{notice && <span role="status" className="p2ban" style={{ display: "block", marginBottom: 12 }}>{notice}</span>}</span>;
}
export function eligible(control: Element): control is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
    && !!control.name && !(control instanceof HTMLInputElement && (["file", "password", "submit", "button"].includes(control.type) || (control.type === "hidden" && !control.hasAttribute("data-draft-state"))));
}

/** Bound row count and validate every persisted property before restoring controlled rows. */
export function draftRows<T extends object>(value: unknown, shape: T): value is T[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every(row =>
    row && typeof row === "object" && !Array.isArray(row) && Object.entries(shape).every(([key, sample]) => {
      const entry = row[key];
      return sample === null ? entry === null || typeof entry === "string"
        : typeof sample === "number" ? draftNumber(entry) : typeof entry === typeof sample;
    }));
}

function fieldKey(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  return control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type) ? `${control.name}:${control.value}` : control.name;
}
