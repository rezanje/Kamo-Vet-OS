"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_AGE = 12 * 60 * 60 * 1000;
type Draft<T> = { version: 1; savedAt: number; requestKey: string; fields: Record<string, string>; snapshot: T };

/** Session-only drafts are isolated by the authenticated server user and encounter. */
export function useClinicDraft<T extends Record<string, unknown>>({ userId, scope, requestKey, snapshot, restore, optionalSnapshotKeys = [] }: {
  userId: string; scope: string; requestKey: string; snapshot: T; restore: (value: T) => void;
  optionalSnapshotKeys?: (keyof T)[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const key = `vetos:clinic-draft:v1:${userId}:${scope}`;
  const [submissionKey, setSubmissionKey] = useState(requestKey);
  const [recovered, setRecovered] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const initial = useRef(snapshot);
  const optionalKeys = useRef(optionalSnapshotKeys);
  const latest = useRef({ snapshot, restore, submissionKey });
  useLayoutEffect(() => { latest.current = { snapshot, restore, submissionKey }; });
  const ready = useRef(false);
  const skipPersist = useRef(true);
  const allowReset = useRef(false);
  const lastSnapshot = useRef(JSON.stringify(snapshot));

  function persist() {
    if (!ready.current || !userId || !formRef.current) return;
    const fields: Record<string, string> = {};
    for (const control of Array.from(formRef.current.elements)) {
      if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
        && control.name && !(control instanceof HTMLInputElement && ["hidden", "file", "submit", "button"].includes(control.type))) {
        fields[control.name] = control.value;
      }
    }
    try {
      sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: latest.current.submissionKey,
        fields, snapshot: latest.current.snapshot } satisfies Draft<T>));
      setStorageError("");
    } catch {
      setStorageError("Draf browser tidak dapat disimpan. Tetap di halaman ini sampai penyimpanan berhasil.");
    }
  }

  useEffect(() => {
    ready.current = false;
    if (!userId) { ready.current = true; return; }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const draft = JSON.parse(raw) as Draft<T>;
          const valid = draft.version === 1 && typeof draft.requestKey === "string" && !!draft.requestKey
            && Number.isFinite(draft.savedAt) && draft.savedAt > 0 && draft.savedAt <= Date.now()
            && Date.now() - draft.savedAt <= MAX_AGE
            && draft.fields && typeof draft.fields === "object" && draft.snapshot && typeof draft.snapshot === "object"
            && Object.entries(initial.current).every(([name, value]) =>
              draft.snapshot[name] === undefined && optionalKeys.current.includes(name)
                ? true : Array.isArray(value) ? Array.isArray(draft.snapshot[name]) : typeof draft.snapshot[name] === typeof value);
          if (valid) {
            latest.current.restore(draft.snapshot);
            setSubmissionKey(draft.requestKey);
            for (const control of Array.from(formRef.current?.elements ?? [])) {
              if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
                && typeof draft.fields[control.name] === "string" && !(control instanceof HTMLInputElement && ["hidden", "file"].includes(control.type))) {
                control.value = draft.fields[control.name];
              }
            }
            lastSnapshot.current = JSON.stringify(draft.snapshot);
            setRecovered(true);
          } else sessionStorage.removeItem(key);
        }
      } catch {
        // Malformed or unavailable storage must never prevent the clinic form opening.
        setStorageError("Draf browser tidak dapat dipulihkan. Periksa kembali isian sebelum menyimpan.");
      }
      ready.current = true;
    });
    return () => { cancelled = true; };
  }, [key, userId]);

  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    if (serialized === lastSnapshot.current) return;
    lastSnapshot.current = serialized;
    if (ready.current) persist();
  });

  // Clear only after the server acknowledges its atomic save. Errors retain the key.
  function clear() {
    ready.current = false;
    try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }
  function discard() {
    clear();
    allowReset.current = true;
    formRef.current?.reset();
    allowReset.current = false;
    latest.current.restore(initial.current);
    lastSnapshot.current = JSON.stringify(initial.current);
    setSubmissionKey(crypto.randomUUID());
    setRecovered(false);
    setSaveError("");
    ready.current = true;
  }
  async function submit(data: FormData, action: (form: FormData) => Promise<{ saved: boolean; href: string }>) {
    persist();
    setSaveError("");
    try {
      const result = await action(data);
      if (result.saved) { allowReset.current = true; clear(); router.push(result.href); }
    } catch (error) {
      // Next handles server redirects; only transport failures need an inline retry message.
      if (typeof (error as { digest?: unknown })?.digest === "string"
        && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")) throw error;
      setSaveError("Belum tersimpan. Isian tetap tersedia; periksa koneksi lalu coba simpan lagi.");
    }
  }
  function preventFailedReset(event: Event) {
    if (!allowReset.current) event.preventDefault();
  }
  function attachForm(node: HTMLFormElement | null) {
    formRef.current?.removeEventListener("reset", preventFailedReset);
    formRef.current = node;
    node?.addEventListener("reset", preventFailedReset);
  }
  return { attachForm, submissionKey, recovered, storageError, saveError, capture: persist, discard, submit };
}
