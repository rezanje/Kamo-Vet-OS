"use client";

import { useMemo, useState, useTransition } from "react";
import { konfirmasiImporRekamMedis, previewImporRekamMedis, type RekamMedisImportState } from "./actions";

type Branch = { id: string; name: string };

export function RekamMedisImportForm({ branches }: { branches: Branch[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [branchId, setBranchId] = useState("");
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<RekamMedisImportState | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const visibleRows = useMemo(() => (state?.rows ?? []).slice(0, 200), [state]);

  const data = () => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.set("branch_id", branchId);
    if (approved) form.set("approved", "true");
    return form;
  };

  const runPreview = () => {
    if (!files.length) return setError("Pilih file kartu medis .xlsx terlebih dulu.");
    setError("");
    startTransition(async () => setState(await previewImporRekamMedis(data())));
  };

  const runImport = () => {
    if (!branchId) return setError("Pilih cabang tujuan.");
    if (!approved) return setError("Centang persetujuan impor setelah meninjau hasil cek.");
    setError("");
    startTransition(async () => setState(await konfirmasiImporRekamMedis(data())));
  };

  return (
    <div className="crm-sec">
      <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
        <i className="ti ti-shield-check" /> Sistem tidak menebak cabang dari alamat lama. Pilih cabang asal data, cek hasil, lalu konfirmasi penyimpanan.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-files" /> Pilih kartu medis .xlsx
          <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={(event) => {
            setFiles(Array.from(event.target.files ?? [])); setState(null); setApproved(false); setError("");
          }} />
        </label>
        <select className="inp" value={branchId} onChange={(event) => setBranchId(event.target.value)} style={{ minWidth: 250 }}>
          <option value="">Pilih cabang tujuan</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <button type="button" className="btn-acc" disabled={pending || !files.length} onClick={runPreview} style={{ background: "var(--posb)" }}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Mengecek…" : "Cek data"}
        </button>
      </div>
      {files.length > 0 && <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>{files.length} file dipilih. Total data belum disimpan.</div>}
      {(error || (state && !state.ok)) && <div className="p2ban" style={{ marginTop: 12, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error || state?.message}</div>}

      {state && (state.rows.length > 0 || state.held.length > 0) && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 999, padding: "5px 9px" }}>Siap dicek {state.rows.length}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c", background: "#fee2e2", borderRadius: 999, padding: "5px 9px" }}>Ditahan {state.held.length}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#475569", background: "#f1f5f9", borderRadius: 999, padding: "5px 9px" }}>Tab diabaikan {state.ignored_sheets}</span>
          </div>
          <div style={{ marginTop: 10, maxHeight: 390, overflow: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
            <table className="dt" style={{ width: "100%", minWidth: 760 }}>
              <thead><tr><th>File / tab</th><th>Pasien</th><th>Pemilik</th><th>Tanggal</th><th>Catatan</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => <tr key={row.source_key}><td>{row.source_file} — {row.source_sheet}</td><td>{row.patient_name}</td><td>{row.owner_name}</td><td>{row.record_date}</td><td style={{ fontSize: 10.5 }}>{row.warning.join(", ") || "Siap"}</td></tr>)}
                {state.held.map((row) => <tr key={row.source_key} style={{ background: "#fff7f7" }}><td>{row.source_file} — {row.source_sheet}</td><td colSpan={4} style={{ color: "#b91c1c" }}>{row.reason}</td></tr>)}
              </tbody>
            </table>
          </div>
          {state.rows.length > visibleRows.length && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Menampilkan 200 riwayat pertama dari {state.rows.length} riwayat siap cek.</div>}
          {state.phase === "preview" && <div style={{ marginTop: 12, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} disabled={state.held.length > 0} /> Saya sudah meninjau hasil cek dan setuju menyimpan riwayat yang siap.</label>
            <button type="button" className="btn-acc" disabled={pending || !state.ok || state.held.length > 0 || !approved} onClick={runImport} style={{ background: "#15803d" }}><i className="ti ti-database-import" /> {pending ? "Mengimpor…" : "Konfirmasi impor rekam medis"}</button>
          </div>}
          {state.phase === "done" && <div className="p2ban" style={{ marginTop: 12, background: "#ecfdf5", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-check" /> {state.message}</div>}
        </>
      )}
    </div>
  );
}
