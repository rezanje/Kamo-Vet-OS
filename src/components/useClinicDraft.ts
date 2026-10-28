"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_AGE = 12 * 60 * 60 * 1000;
type Draft<T> = { version: 1; savedAt: number; requestKey: string; fields: Record<string, string>; snapshot: T };

// U07: saves that leave the form no longer refresh it on the server, so browser Back
// can restore the form with the request key that was just acknowledged. Reusing it
// would replay (or conflict with) the saved entry, so remember acknowledged keys for
// this tab and mint a fresh key when such a form is opened again.
const ACKED_KEYS = "vetos:clinic-draft:v1:acked";
function readAcked(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACKED_KEYS) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
}
function rememberAcked(requestKey: string) {
  try { sessionStorage.setItem(ACKED_KEYS, JSON.stringify([...readAcked().filter(k => k !== requestKey), requestKey].slice(-50))); }
  catch { /* Storage may be disabled; the server still rejects a reused key safely. */ }
}

/** Session-only drafts are isolated by the authenticated server user and encounter. */
export function useClinicDraft<T extends Record<string, unknown>>({ userId, scope, requestKey, snapshot, restore, optionalSnapshotKeys = [], uncertainMessage }: {
  userId: string; scope: string; requestKey: string; snapshot: T; restore: (value: T) => void;
  optionalSnapshotKeys?: (keyof T)[]; uncertainMessage?: string;
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
    // After an acknowledged save the draft is gone for good; never write it back.
    if (!ready.current || allowReset.current || !userId || !formRef.current) return;
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
        const acked = readAcked();
        let restoredKey: string | null = null;
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
            restoredKey = draft.requestKey;
            setSubmissionKey(draft.requestKey);
            for (const control of Array.from(formRef.current?.elements ?? [])) {
              if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
                && typeof draft.fields[control.name] === "string" && !(control instanceof HTMLInputElement && ["hidden", "file"].includes(control.type))) {
                control.value = draft.fields[control.name];
                control.dispatchEvent(new Event("vetos:numeric-sync"));
              }
            }
            lastSnapshot.current = JSON.stringify(draft.snapshot);
            setRecovered(true);
          } else sessionStorage.removeItem(key);
        }
        if (acked.includes(restoredKey ?? latest.current.submissionKey)) {
          const fresh = crypto.randomUUID();
          latest.current.submissionKey = fresh;
          setSubmissionKey(fresh);
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
  // U07: one save at a time. Buttons stay locked after success until the next page
  // replaces this form, so a slow navigation cannot invite a second click.
  const inFlight = useRef(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    // Safety valve: if navigation never replaces the form, unlock after a while.
    const timer = setTimeout(() => setLeaving(false), 20_000);
    return () => clearTimeout(timer);
  }, [leaving]);
  async function submit(data: FormData, action: (form: FormData) => Promise<{ saved: boolean; href: string }>) {
    if (inFlight.current) return;
    inFlight.current = true;
    persist();
    setSaveError("");
    try {
      const result = await action(data);
      if (result.saved) {
        allowReset.current = true; clear();
        rememberAcked(latest.current.submissionKey);
        // A revalidating action already returned the fresh current page (for the
        // initial exam, the recorded view replaces this form); pushing the same URL
        // would render that whole page a second time. Only a real navigation keeps
        // the buttons locked — a same-page success releases them at once.
        if (result.href !== window.location.pathname + window.location.search) {
          setLeaving(true);
          router.push(result.href);
        }
      }
    } catch (error) {
      // Next handles server redirects; only transport failures need an inline retry message.
      if (typeof (error as { digest?: unknown })?.digest === "string"
        && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")) throw error;
      setSaveError(uncertainMessage ?? "Belum tersimpan. Isian tetap tersedia; periksa koneksi lalu coba simpan lagi.");
    } finally {
      inFlight.current = false;
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
  return { attachForm, submissionKey, recovered, storageError, saveError, capture: persist, discard, submit, leaving };
}
