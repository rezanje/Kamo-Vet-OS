"use client";

import { useMemo, useState, useTransition } from "react";
import { konfirmasiImporRekamMedis, previewImporRekamMedis, type RekamMedisImportState } from "./actions";
import {
  bolehKonfirmasiImporRekamMedis,
  infoProgresImporRekamMedis,
  type TahapProgresImporRekamMedis,
} from "@/lib/impor-rekam-medis";

export function RekamMedisImportForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<RekamMedisImportState | null>(null);
  const [error, setError] = useState("");
  const [tahapProgres, setTahapProgres] = useState<TahapProgresImporRekamMedis | null>(null);
  const [pending, startTransition] = useTransition();
  const visibleRows = useMemo(() => (state?.rows ?? []).slice(0, 200), [state]);
  const summary = useMemo(() => {
    const rows = state?.rows ?? [];
    const owners = new Set(rows.map((row) => `${row.owner_name?.toLocaleLowerCase("id-ID")}::${row.phone?.replace(/\D/g, "")}`));
    const pets = new Set(rows.map((row) => `${row.owner_name?.toLocaleLowerCase("id-ID")}::${row.phone?.replace(/\D/g, "")}::${row.patient_name?.toLocaleLowerCase("id-ID")}`));
    return { owners: owners.size, pets: pets.size };
  }, [state]);
  const canConfirm = bolehKonfirmasiImporRekamMedis(state?.rows.length ?? 0, approved);
  const progres = tahapProgres ? infoProgresImporRekamMedis(tahapProgres) : null;

  const data = () => {
    const form = new FormData();
    files.forEach((file) => {
      form.append("files", file);
      form.append("paths", file.webkitRelativePath || file.name);
    });
    if (approved) form.set("approved", "true");
    return form;
  };

  const runPreview = () => {
    if (!files.length) return setError("Pilih file kartu medis .xlsx terlebih dulu.");
    setError("");
    setTahapProgres("baca");
    startTransition(async () => {
      try {
        setState(await previewImporRekamMedis(data()));
      } finally {
        setTahapProgres(null);
      }
    });
  };

  const runImport = () => {
    if (!approved) return setError("Centang persetujuan impor setelah meninjau hasil cek.");
    setError("");
    setTahapProgres("simpan");
    startTransition(async () => {
      try {
        setState(await konfirmasiImporRekamMedis(data()));
      } finally {
        setTahapProgres(null);
      }
    });
  };

  return (
    <div className="crm-sec">
      <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
        <i className="ti ti-shield-check" /> Pilih folder utama yang berisi folder owner. Sistem membaca owner dari folder, nama hewan dari kartu, dan setiap sheet sebagai satu histori bersama untuk semua cabang klinik.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-folder" /> Pilih folder rekam medis
          <input type="file" multiple ref={(input) => { if (input) input.webkitdirectory = true; }} style={{ display: "none" }} onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".xlsx") && !file.name.startsWith("~$"));
            setFiles(selected); setState(null); setApproved(false); setError(selected.length ? "" : "Folder tidak berisi kartu medis .xlsx.");
          }} />
        </label>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-files" /> Pilih file satuan
          <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={(event) => {
            setFiles(Array.from(event.target.files ?? [])); setState(null); setApproved(false); setError("");
          }} />
        </label>
        <button type="button" className="btn-acc" disabled={pending || !files.length} onClick={runPreview} style={{ background: "var(--posb)" }}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Mengecek…" : "Cek data"}
        </button>
      </div>
      {files.length > 0 && <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>{files.length} file dipilih. Total data belum disimpan.</div>}
      {progres && <div role="status" style={{ marginTop: 12, padding: "10px 12px", border: ".5px solid #bfdbfe", borderRadius: 8, background: "#eff6ff", color: "#1e40af" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800 }}><i className="ti ti-loader-2" /> {progres.label}</div>
        <progress aria-label={progres.label} style={{ width: "100%", height: 8, marginTop: 8, accentColor: "#2563eb" }} />
        <div style={{ fontSize: 10.5, marginTop: 5 }}>Jangan tutup halaman sampai proses selesai.</div>
      </div>}
      {(error || (state && !state.ok)) && <div className="p2ban" style={{ marginTop: 12, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error || state?.message}</div>}

      {state && (state.rows.length > 0 || state.held.length > 0) && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#1e40af", background: "#dbeafe", borderRadius: 999, padding: "5px 9px" }}>Owner {summary.owners}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#1e40af", background: "#dbeafe", borderRadius: 999, padding: "5px 9px" }}>Hewan {summary.pets}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 999, padding: "5px 9px" }}>Siap dicek {state.rows.length}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c", background: "#fee2e2", borderRadius: 999, padding: "5px 9px" }}>Ditahan {state.held.length}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#475569", background: "#f1f5f9", borderRadius: 999, padding: "5px 9px" }}>Sheet dilewati {state.ignored_sheets}</span>
          </div>
          <div style={{ marginTop: 10, maxHeight: 390, overflow: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
            <table className="dt" style={{ width: "100%", minWidth: 1120 }}>
              <thead><tr><th>File / sheet</th><th>Hewan</th><th>Owner</th><th>Tanggal</th><th>Catatan kunjungan</th><th>Isi medis</th><th>Status</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => <tr key={row.source_key}>
                  <td>{row.source_file} — {row.source_sheet}</td><td>{row.patient_name}</td><td>{row.owner_name}</td><td>{row.record_date}</td>
                  <td style={{ fontSize: 10.5 }}>{row.note || "—"}</td>
                  <td style={{ fontSize: 10.5, minWidth: 260 }}><details><summary style={{ cursor: "pointer", fontWeight: 700 }}>Lihat isi</summary><div style={{ marginTop: 5, whiteSpace: "pre-wrap", lineHeight: 1.45 }}><b>Anamnesa:</b> {row.anamnesis || "—"}<br /><b>Gambaran klinis:</b> {row.clinical_findings || "—"}<br /><b>Diagnosa:</b> {row.diagnosis || "—"}<br /><b>Terapi:</b> {row.therapy || "—"}</div></details></td>
                  <td style={{ fontSize: 10.5 }}>{row.warning.join(", ") || "Siap"}</td>
                </tr>)}
                {state.held.map((row) => <tr key={row.source_key} style={{ background: "#fff7f7" }}><td>{row.source_file} — {row.source_sheet}</td><td colSpan={6} style={{ color: "#b91c1c" }}>{row.reason}</td></tr>)}
              </tbody>
            </table>
          </div>
          {state.rows.length > visibleRows.length && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Menampilkan 200 riwayat pertama dari {state.rows.length} riwayat siap cek.</div>}
          {state.phase === "preview" && <div style={{ marginTop: 12, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> Saya sudah meninjau hasil cek dan setuju menyimpan riwayat yang siap. Data yang ditahan tidak ikut disimpan.</label>
            <button type="button" className="btn-acc" disabled={pending || !state.ok || !canConfirm} onClick={runImport} style={{ background: "#15803d" }}><i className="ti ti-database-import" /> {pending ? "Mengimpor…" : "Simpan riwayat yang siap"}</button>
          </div>}
          {state.phase === "done" && <div className="p2ban" style={{ marginTop: 12, background: "#ecfdf5", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-check" /> {state.message}</div>}
        </>
      )}
    </div>
  );
}
