"use client";

import { useMemo, useState, useTransition } from "react";
import {
  previewImporRekamMedis,
  simpanBatchImporRekamMedis,
  type RekamMedisIdentityDecision,
  type RekamMedisImportState,
} from "./actions";
import {
  bagiBerkasImporRekamMedis,
  bagiBatchImporRekamMedis,
  bolehKonfirmasiImporRekamMedis,
  cariRiwayatImporRekamMedis,
  infoProgresImporRekamMedis,
  type TahapProgresImporRekamMedis,
} from "@/lib/impor-rekam-medis";

const UKURAN_BATCH_FILE = 25 * 1024 * 1024;

function pesanError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : "";
  if (/unexpected response|failed to fetch|network/i.test(message)) {
    return "Server belum memberi jawaban saat mengecek file. Data belum disimpan. Coba ulangi dengan file lebih sedikit.";
  }
  return message || fallback;
}

function key(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID").replace(/[.:]/g, "").replace(/\s+/g, " ");
}

function rowFingerprint(row: RekamMedisImportState["rows"][number]) {
  return JSON.stringify([
    row.record_no,
    row.owner_name,
    row.phone,
    row.patient_name,
    row.record_date,
    row.species,
    row.breed,
    row.gender,
    row.dob,
    row.doctor,
    row.note,
    row.anamnesis,
    row.clinical_findings,
    row.diagnosis,
    row.therapy,
  ]);
}

function decisionPayload(identityDecisions: Record<string, string>): RekamMedisIdentityDecision[] {
  return Object.entries(identityDecisions).flatMap(([source_key, decision]): RekamMedisIdentityDecision[] => {
    if (decision === "skip") return [{ source_key, decision: "skip" }];
    try {
      const parsed = JSON.parse(decision) as { customer_id?: unknown; pet_id?: unknown };
      if (typeof parsed.customer_id !== "string") return [];
      return [{
        source_key,
        decision: {
          customer_id: parsed.customer_id,
          pet_id: typeof parsed.pet_id === "string" ? parsed.pet_id : null,
        },
      }];
    } catch {
      return [];
    }
  });
}

export function RekamMedisImportForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<RekamMedisImportState | null>(null);
  const [error, setError] = useState("");
  const [tahapProgres, setTahapProgres] = useState<TahapProgresImporRekamMedis | null>(null);
  const [identityDecisions, setIdentityDecisions] = useState<Record<string, string>>({});
  const [detailProgres, setDetailProgres] = useState({ current: 0, total: 0 });
  const [kataKunciReview, setKataKunciReview] = useState("");
  const [pending, startTransition] = useTransition();
  const filteredRows = useMemo(() => cariRiwayatImporRekamMedis(state?.rows ?? [], kataKunciReview), [state?.rows, kataKunciReview]);
  const filteredHeld = useMemo(() => cariRiwayatImporRekamMedis(state?.held ?? [], kataKunciReview), [state?.held, kataKunciReview]);
  const visibleRows = useMemo(() => filteredRows.slice(0, 200), [filteredRows]);
  const visibleHeld = useMemo(() => filteredHeld.slice(0, 200), [filteredHeld]);
  const summary = useMemo(() => {
    const rows = state?.rows ?? [];
    const owners = new Set(rows.map((row) => `${row.owner_name?.toLocaleLowerCase("id-ID")}::${row.phone?.replace(/\D/g, "")}`));
    const pets = new Set(rows.map((row) => `${row.owner_name?.toLocaleLowerCase("id-ID")}::${row.phone?.replace(/\D/g, "")}::${row.patient_name?.toLocaleLowerCase("id-ID")}`));
    return { owners: owners.size, pets: pets.size };
  }, [state]);
  const clarificationComplete = (state?.clarifications ?? []).every((row) => Boolean(identityDecisions[row.source_key]));
  const selectedRows = (state?.rows ?? []).filter((row) => identityDecisions[row.source_key] !== "skip").length;
  const canConfirm = bolehKonfirmasiImporRekamMedis(selectedRows, approved) && clarificationComplete;
  const progres = tahapProgres ? infoProgresImporRekamMedis(tahapProgres) : null;

  const runPreview = () => {
    if (!files.length) return setError("Pilih file kartu medis .xlsx terlebih dulu.");
    setError("");
    setTahapProgres("baca");
    const fileBatches = bagiBerkasImporRekamMedis(files, UKURAN_BATCH_FILE);
    setDetailProgres({ current: 0, total: fileBatches.length });
    startTransition(async () => {
      const rows: RekamMedisImportState["rows"] = [];
      const held: RekamMedisImportState["held"] = [];
      const clarifications: RekamMedisImportState["clarifications"] = [];
      let ignoredSheets = 0;
      const errors: string[] = [];
      try {
        for (let index = 0; index < fileBatches.length; index += 1) {
          const batch = fileBatches[index];
          setDetailProgres({ current: index + 1, total: fileBatches.length });
          const form = new FormData();
          batch.forEach((file) => {
            form.append("files", file);
            form.append("paths", file.webkitRelativePath || file.name);
          });
          let result: RekamMedisImportState;
          try {
            result = await previewImporRekamMedis(form);
          } catch (cause) {
            const message = pesanError(cause, "File gagal dicek.");
            const namaBatch = batch.length === 1 ? batch[0].name : `${batch.length} file`;
            errors.push(`${namaBatch}: ${message}`);
            held.push({ source_key: `error::${index}::${namaBatch}`, source_file: namaBatch, source_sheet: "—", reason: message });
            continue;
          }
          rows.push(...result.rows);
          held.push(...result.held);
          clarifications.push(...result.clarifications);
          ignoredSheets += result.ignored_sheets;
          if (!result.ok && result.rows.length === 0 && result.held.length === 0) {
            const namaBatch = batch.length === 1 ? batch[0].name : `${batch.length} file`;
            errors.push(`${namaBatch}: ${result.message}`);
            held.push({ source_key: `error::${index}::${namaBatch}`, source_file: namaBatch, source_sheet: "—", reason: result.message });
          }
        }

        const seen = new Map<string, string>();
        const uniqueRows: RekamMedisImportState["rows"] = [];
        let duplicateSheets = 0;
        rows.forEach((row) => {
          const duplicateKey = [key(row.owner_name), row.phone?.replace(/\D/g, ""), key(row.patient_name), row.record_date].join("::");
          const fingerprint = rowFingerprint(row);
          const previous = seen.get(duplicateKey);
          if (previous === fingerprint) {
            duplicateSheets += 1;
            return;
          }
          if (previous) {
            held.push({
              source_key: `duplicate::${row.source_key}::${held.length}`,
              source_file: row.source_file,
              source_sheet: row.source_sheet,
              reason: "Kemungkinan riwayat ganda: pemilik, pasien, dan tanggal sama",
            });
            return;
          }
          seen.set(duplicateKey, fingerprint);
          uniqueRows.push(row);
        });

        const uniqueKeys = new Set(uniqueRows.map((row) => row.source_key));
        const uniqueClarifications = [...new Map(clarifications.map((row) => [row.source_key, row])).values()]
          .filter((row) => uniqueKeys.has(row.source_key));
        setState({
          ok: uniqueRows.length > 0,
          phase: "preview",
          message: uniqueRows.length
            ? `${uniqueRows.length} riwayat siap dicek. ${held.length} riwayat ditahan.${uniqueClarifications.length ? ` ${uniqueClarifications.length} perlu keputusan.` : ""}${errors.length ? ` ${errors.length} file perlu dicek ulang.` : ""}`
            : "Tidak ada riwayat yang aman untuk diimpor.",
          rows: uniqueRows,
          held,
          ignored_sheets: ignoredSheets + duplicateSheets,
          clarifications: uniqueClarifications,
        });
      } catch (cause) {
        setError(pesanError(cause, "File gagal dibaca. Coba pilih ulang file."));
      } finally {
        setTahapProgres(null);
        setDetailProgres({ current: 0, total: 0 });
      }
    });
  };

  const runImport = () => {
    if (!approved) return setError("Centang persetujuan impor setelah meninjau hasil cek.");
    if (!clarificationComplete) return setError("Tentukan keputusan untuk setiap data yang mirip lebih dulu.");
    if (!selectedRows) return setError("Tidak ada riwayat yang dipilih untuk diimpor.");
    setError("");
    setTahapProgres("simpan");
    startTransition(async () => {
      try {
        const batches = bagiBatchImporRekamMedis(state?.rows ?? [], 25);
        const decisions = decisionPayload(identityDecisions);
        setDetailProgres({ current: 0, total: batches.length });
        let tersimpan = 0;
        let sudahAda = 0;
        let dilewati = 0;
        for (let index = 0; index < batches.length; index += 1) {
          setDetailProgres({ current: index + 1, total: batches.length });
          const result = await simpanBatchImporRekamMedis(batches[index], decisions, true, index === batches.length - 1);
          if (!result.ok) throw new Error(result.message);
          tersimpan += result.tersimpan;
          sudahAda += result.sudah_ada;
          dilewati += result.dilewati;
        }
        const existingMessage = sudahAda ? ` ${sudahAda} riwayat sudah ada dan tidak digandakan.` : "";
        const skippedMessage = dilewati ? ` ${dilewati} riwayat dipilih untuk tidak diimpor.` : "";
        setState((current) => current ? {
          ...current,
          ok: true,
          phase: "done",
          message: `${tersimpan} riwayat baru berhasil disimpan.${existingMessage}${skippedMessage}`,
        } : current);
      } catch (cause) {
        setError(pesanError(cause, "Impor gagal. Data yang sudah masuk aman dan tidak akan digandakan saat dicoba lagi."));
      } finally {
        setTahapProgres(null);
        setDetailProgres({ current: 0, total: 0 });
      }
    });
  };

  return (
    <div className="crm-sec">
      <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af" }}>
        <i className="ti ti-shield-check" /> Pilih folder utama yang berisi folder owner. Sistem membaca owner dari folder, nama hewan dari kartu, dan setiap sheet sebagai satu histori bersama untuk semua cabang klinik.
      </div>
      <div className="p2ban" style={{ marginTop: 8, background: "#f8fafc", border: ".5px solid #cbd5e1", color: "#475569" }}>
        <i className="ti ti-info-circle" /> Tidak ada batas jumlah file. Excel tidak dikonversi ulang; sistem membagi otomatis per maksimal 25 MB supaya folder besar tetap diproses bertahap. Batas ukuran: 5 MB per file.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-folder" /> Pilih folder rekam medis
          <input type="file" multiple ref={(input) => { if (input) input.webkitdirectory = true; }} style={{ display: "none" }} onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".xlsx") && !file.name.startsWith("~$"));
            setFiles(selected); setState(null); setApproved(false); setIdentityDecisions({}); setError(selected.length ? "" : "Folder tidak berisi kartu medis .xlsx.");
          }} />
        </label>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-files" /> Pilih file satuan
          <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={(event) => {
            setFiles(Array.from(event.target.files ?? [])); setState(null); setApproved(false); setIdentityDecisions({}); setError("");
          }} />
        </label>
        <button type="button" className="btn-acc" disabled={pending || Boolean(tahapProgres) || !files.length} onClick={runPreview} style={{ background: "var(--posb)" }}>
          {pending || tahapProgres ? <span className="btn-spin" /> : <i className="ti ti-eye" />} {pending || tahapProgres ? "Memproses…" : "Cek data"}
        </button>
      </div>
      {files.length > 0 && <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>{files.length} file dipilih. Total data belum disimpan.</div>}
      {progres && <div role="status" style={{ marginTop: 12, padding: "10px 12px", border: ".5px solid #bfdbfe", borderRadius: 8, background: "#eff6ff", color: "#1e40af" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800 }}><span className="btn-spin" /> {progres.label} {detailProgres.total ? `(${detailProgres.current}/${detailProgres.total})` : ""}</div>
        <div aria-label={progres.label} role="progressbar" aria-valuemin={0} aria-valuemax={detailProgres.total || 1} aria-valuenow={detailProgres.current} style={{ width: "100%", height: 8, marginTop: 8, borderRadius: 999, background: "#dbeafe", overflow: "hidden" }}>
          <div style={{ width: `${detailProgres.total ? Math.max(4, Math.round((detailProgres.current / detailProgres.total) * 100)) : 4}%`, height: "100%", background: "#2563eb", borderRadius: 999, transition: "width .2s ease" }} />
        </div>
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
          <input
            className="fi"
            value={kataKunciReview}
            onChange={(event) => setKataKunciReview(event.target.value)}
            placeholder="Cari nama owner, hewan, atau file…"
            style={{ marginTop: 10, maxWidth: 420 }}
          />
          {state.clarifications.length > 0 && (
            <div style={{ marginTop: 10, padding: 11, borderRadius: 8, background: "#fffbeb", border: ".5px solid #fcd34d", color: "#854d0e" }}>
              <div style={{ fontSize: 11.5, fontWeight: 900 }}><i className="ti ti-git-compare" /> {state.clarifications.length} data mirip perlu keputusan</div>
              <div style={{ fontSize: 10.5, marginTop: 4 }}>Sistem tidak akan menggabungkan pemilik atau anabul hanya karena namanya mirip atau nomor teleponnya sama.</div>
              <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
                {state.clarifications.map((clarification) => (
                  <div key={clarification.source_key} style={{ padding: 9, borderRadius: 7, background: "white", border: ".5px solid #fde68a" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800 }}>
                      Dari file: {clarification.owner_name} · {clarification.phone} · anabul {clarification.patient_name}
                    </div>
                    <select
                      value={identityDecisions[clarification.source_key] ?? ""}
                      onChange={(event) => setIdentityDecisions((current) => ({ ...current, [clarification.source_key]: event.target.value }))}
                      style={{ marginTop: 7, width: "100%", maxWidth: 560, padding: "7px 8px", borderRadius: 6, border: ".5px solid #d6d3d1", background: "white", fontSize: 10.5 }}
                    >
                      <option value="">Pilih keputusan…</option>
                      {clarification.candidates.map((candidate) => (
                        <option key={`${candidate.customer_id}-${candidate.pet_id ?? "baru"}`} value={JSON.stringify({ customer_id: candidate.customer_id, pet_id: candidate.pet_id })}>
                          Ini sama: {candidate.customer_name} · {candidate.customer_phone || "tanpa nomor"} · {candidate.pet_name ? `anabul ${candidate.pet_name}` : "buat anabul baru"}
                        </option>
                      ))}
                      <option value="skip">Beda — jangan impor riwayat ini</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                {visibleHeld.map((row) => <tr key={row.source_key} style={{ background: "#fff7f7" }}><td>{row.source_file} — {row.source_sheet}</td><td colSpan={6} style={{ color: "#b91c1c" }}>{row.reason}</td></tr>)}
              </tbody>
            </table>
          </div>
          {(filteredRows.length > visibleRows.length || filteredHeld.length > visibleHeld.length) && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Menampilkan maksimal 200 hasil pencarian. Sempitkan kata kunci untuk melihat data lain.</div>}
          {state.phase === "preview" && <div style={{ marginTop: 12, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> Saya sudah meninjau hasil cek dan setuju menyimpan riwayat yang siap. Data yang ditahan tidak ikut disimpan.</label>
            <button type="button" className="btn-acc" disabled={pending || Boolean(tahapProgres) || !state.ok || !canConfirm} onClick={runImport} style={{ background: "#15803d" }}>{pending || tahapProgres ? <span className="btn-spin" /> : <i className="ti ti-database-import" />} {pending || tahapProgres ? "Menyimpan…" : `Simpan ${selectedRows} riwayat yang siap`}</button>
          </div>}
          {state.phase === "done" && <div className="p2ban" style={{ marginTop: 12, background: "#ecfdf5", border: ".5px solid #86efac", color: "#166534" }}><i className="ti ti-check" /> {state.message}</div>}
        </>
      )}
    </div>
  );
}
