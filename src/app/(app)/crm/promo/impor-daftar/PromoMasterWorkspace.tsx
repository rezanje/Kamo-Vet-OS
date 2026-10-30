"use client";

import { useState } from "react";
import Link from "next/link";
import { previewPromoMaster, periksaPromoMaster, simpanPromoMaster } from "./actions";
import { PROMO_MASTER_HEADERS } from "@/lib/promo-master-excel";
import type { PromoMasterReview } from "@/lib/promo-master-import";

const KOSONG: PromoMasterReview = { rows: [], plans: [], diffs: [], valid: false, error: null };

const WARNA_STATUS: Record<string, string> = { baru: "#15803d", ubah: "#b45309", sama: "var(--td)" };

export function PromoMasterWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [hasil, setHasil] = useState<PromoMasterReview>(KOSONG);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState("");
  const [tersimpan, setTersimpan] = useState(false);

  function terapkan(result: PromoMasterReview) {
    setHasil(result);
    const ringkas = `${result.rows.length} baris, ${result.plans.length} promo siap disimpan.`;
    setPesan(result.error ?? (result.valid ? ringkas : "Ada baris bertanda merah. Perbaiki di Excel lalu unggah ulang berkasnya."));
  }

  async function baca() {
    if (!file) { setPesan("Pilih berkas Excel .xlsx terlebih dahulu."); return; }
    setSibuk(true); setPesan(""); setTersimpan(false);
    try {
      const form = new FormData();
      form.set("file", file);
      terapkan(await previewPromoMaster(form));
    } catch { setPesan("Preview gagal dimuat. Coba berkas yang sama lagi."); }
    finally { setSibuk(false); }
  }

  async function periksa() {
    setSibuk(true); setPesan("");
    try { terapkan(await periksaPromoMaster(hasil.rows)); }
    catch { setPesan("Pemeriksaan gagal. Coba lagi sebelum menyimpan."); }
    finally { setSibuk(false); }
  }

  async function simpan() {
    if (!hasil.valid || sibuk || tersimpan) return;
    setSibuk(true); setPesan("");
    try {
      const result = await simpanPromoMaster(hasil.rows, hasil.plans.map(({ name, expected }) => ({ name, expected })));
      setPesan(result.message);
      setTersimpan(result.ok);
      if (!result.ok) setHasil(current => ({ ...current, valid: false }));
    } catch {
      setPesan("Hasil simpan belum dapat dipastikan. Buka daftar promo untuk memeriksa sebelum mengunggah ulang.");
    } finally { setSibuk(false); }
  }

  return <div style={{ display: "grid", gap: 14 }}>
    <p style={{ fontSize: 12, color: "var(--tm)" }}>
      Gunakan <Link href="/crm/promo/impor-daftar/template">Format-Daftar-Promo-VetOS.xlsx</Link>. Satu baris = satu barang;
      ulangi <b>Nama Promo</b> yang sama untuk menambah barang ke promo itu. Nama promo yang sudah ada akan
      <b> diperbarui</b>, bukan digandakan. Berlaku untuk barang petshop maupun klinik (jasa grooming, tindakan, obat).
      Maksimal 50 promo, 500 baris, dan 1 MB per berkas; rumus Excel ditolak.
    </p>

    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label className="flab">Berkas Excel (.xlsx)
        <input className="fi" type="file" disabled={sibuk} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={event => { setFile(event.target.files?.[0] ?? null); setHasil(KOSONG); setTersimpan(false); setPesan(""); }} />
      </label>
      <button type="button" className="btn-def" disabled={sibuk || !file} onClick={baca}>Baca dan preview</button>
    </div>

    {pesan && <p role="status" style={{ color: tersimpan ? "#15803d" : hasil.error ? "#b91c1c" : "var(--tm)", fontSize: 12 }}>{pesan}</p>}

    {hasil.diffs.length > 0 && <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>PERUBAHAN YANG AKAN DISIMPAN</div>
      <div style={{ display: "grid", gap: 8 }}>
        {hasil.diffs.map(diff => <div key={diff.name} className="card" style={{ padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{diff.name}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: WARNA_STATUS[diff.status] }}>
              {diff.status === "baru" ? "PROMO BARU" : diff.status === "ubah" ? "DIPERBARUI" : "TIDAK ADA PERUBAHAN"}
            </span>
          </div>
          {diff.activationNote && <p style={{ fontSize: 11, margin: "6px 0 0" }}>{diff.activationNote}</p>}
          {diff.changes.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11 }}>
            {diff.changes.map(change => <li key={change.label}>{change.label}: {change.dari} → <b>{change.ke}</b></li>)}
          </ul>}
          {diff.itemsAdded.length > 0 && <div style={{ fontSize: 11, marginTop: 4, color: "#15803d" }}>
            Barang ditambah: {diff.itemsAdded.join(", ")}
          </div>}
          {diff.itemsRemoved.length > 0 && <div style={{ fontSize: 11, marginTop: 4, color: "#b91c1c" }}>
            Barang dikeluarkan: {diff.itemsRemoved.join(", ")}
          </div>}
        </div>)}
      </div>
    </div>}

    {hasil.rows.length > 0 && <>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 1280 }}>
          <thead><tr>
            <th style={{ width: 54 }}>Baris</th>
            {PROMO_MASTER_HEADERS.map(header => <th key={header}>{header}</th>)}
            <th style={{ width: 90 }}>Barang</th>
            <th style={{ width: 230 }}>Pemeriksaan</th>
          </tr></thead>
          <tbody>
            {hasil.rows.map((row, index) => <tr key={`${row.line}:${index}`} style={row.error ? { background: "#fef2f2" } : undefined}>
              <td style={{ fontSize: 11 }}>{row.line}</td>
              {PROMO_MASTER_HEADERS.map(header => <td key={header} style={{ fontSize: 11 }}>{row[header] || "—"}</td>)}
              <td style={{ fontSize: 11, color: "var(--tm)" }}>{row.item_name ?? "—"}</td>
              <td style={{ fontSize: 10.5, fontWeight: row.error ? 700 : 400, color: row.error ? "#b91c1c" : "#15803d" }}>
                {row.error ?? "Siap"}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn-def" disabled={sibuk || tersimpan} onClick={periksa}>Periksa ulang</button>
        <button type="button" className="btn-acc" disabled={sibuk || !hasil.valid || tersimpan} onClick={simpan}>
          {sibuk ? "Memproses…" : "Simpan seluruh daftar"}
        </button>
        {tersimpan && <Link href="/crm/promo" className="back-btn">Lihat daftar promo</Link>}
      </div>
    </>}
  </div>;
}
