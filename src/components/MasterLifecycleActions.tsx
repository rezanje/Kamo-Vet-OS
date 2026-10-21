"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { changeMasterLifecycle } from "@/app/(app)/master-data/actions";
import type { MasterEntity } from "@/lib/master-lifecycle";

export function MasterLifecycleActions({ entity, id, name, active, trashed, revision }: {
  entity: MasterEntity; id: string; name: string; active: boolean; trashed?: boolean; revision?: number;
}) {
  const params = useSearchParams();
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const labels: Record<string, string> = { archive: "Nonaktifkan", activate: "Aktifkan", trash: "Pindah ke Sampah", restore: "Pulihkan" };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !action) return;
    const data = new FormData(event.currentTarget);
    data.set("entity", entity); data.set("id", id); data.set("revision", String(revision ?? 0));
    data.set("action", action); data.set("filters", params.toString());
    setBusy(true); setError("");
    try { const result = await changeMasterLifecycle(data); if (result?.error) setError(result.error); }
    catch (failure) {
      // Next handles redirect on the server action boundary; unexpected transport
      // failures retain reason and require a reload before trusting the outcome.
      if (failure instanceof Error && failure.message.includes("NEXT_REDIRECT")) throw failure;
      setError("Hasil belum terkonfirmasi. Muat ulang daftar dan periksa status sebelum mengulangi tindakan.");
    } finally { setBusy(false); }
  }
  return <div style={{ whiteSpace: "normal", minWidth: 160 }}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {(trashed ? ["restore"] : [active ? "archive" : "activate", "trash"]).map(value => <button key={value} type="button" className="btn-def" disabled={busy} onClick={() => { setAction(value); setError(""); }}>{labels[value]}</button>)}
    </div>
    {action && <form onSubmit={submit} aria-label={`${labels[action]} ${name}`} style={{ marginTop: 8, maxWidth: 320 }}>
      <strong>{labels[action]}: {name}</strong>
      <p style={{ fontSize: 11 }}>{action === "trash" ? "Hanya data tanpa pemakaian atau riwayat yang dapat masuk Sampah. Data dapat dipulihkan; tidak dihapus permanen. Jika masih dipakai, pilih Nonaktifkan." : action === "restore" ? "Data kembali ke daftar Nonaktif. Aktifkan terpisah bila diperlukan." : "Riwayat dan relasi tetap disimpan."}</p>
      {entity === "employees" && <p style={{ fontSize: 11 }}>Status karyawan tidak mencabut akses login. Kelola akses akun secara terpisah.</p>}
      <label style={{ display: "block" }}>Alasan<textarea className="fi" name="reason" required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: 11 }}>{error}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button className="btn-acc" disabled={busy}>{busy ? "Menyimpan…" : "Konfirmasi"}</button><button type="button" className="btn-def" disabled={busy} onClick={() => setAction(null)}>Batal</button></div>
    </form>}
  </div>;
}
