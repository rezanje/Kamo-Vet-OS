"use client";

import { useState } from "react";
import { barisFollowUpTerkirim, tanggalIndo, type FollowUpDraft } from "@/lib/followup";
import { FollowUpIsian } from "./FollowUpIsian";

export type { FollowUpDraft };

// Tabel rencana follow up di rekam medis. Baris dikirim sebagai JSON lewat hidden input —
// baris follow_ups baru dibuat saat form disubmit (medical_record_id belum ada saat diisi).
// Isian yang tanggalnya sudah dipilih tapi belum diklik "Tambah" ikut terkirim (masukan
// Babibu, 5 Nov): dulu isian itu hilang diam-diam saat rekam medis disimpan.
export function FollowUpTable({ name, value, onChange }: { name: string; value?: FollowUpDraft[]; onChange?: React.Dispatch<React.SetStateAction<FollowUpDraft[]>> }) {
  const [localRows, setLocalRows] = useState<FollowUpDraft[]>([]);
  const rows = value ?? localRows;
  const setRows = onChange ?? setLocalRows;
  const [jenis, setJenis] = useState<string>("Kontrol");
  const [tanggal, setTanggal] = useState("");
  const [catatan, setCatatan] = useState("");
  const terkirim = barisFollowUpTerkirim(rows, { jenis, tanggal, catatan });

  const tambah = () => {
    if (!tanggal) return;
    setRows((r) => [...r, { jenis, tanggal, catatan: catatan.trim() }]);
    setTanggal(""); setCatatan(""); setJenis("Kontrol");
  };
  const hapus = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  return (
    <div className="crm-sec" id="rencana-follow-up" style={{ marginTop: 12, marginBottom: 0 }}>
      <input type="hidden" name={name} value={JSON.stringify(terkirim)} />

      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 4 }}>
        <i className="ti ti-calendar-event" style={{ color: "#d97706" }} /> RENCANA FOLLOW UP
        <span style={{ fontSize: 10, fontWeight: 500, color: "var(--tm)", marginLeft: 6 }}>(kontrol ulang, vaksin berikutnya, dll.)</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 10 }}>
        Pilih jenis &amp; tanggal — begitu rekam medis disimpan, jadwal ini otomatis masuk daftar Klinik → Follow up untuk diingatkan ke pemilik.
      </div>

      <FollowUpIsian
        jenis={jenis} tanggal={tanggal} catatan={catatan}
        onJenis={setJenis} onTanggal={setTanggal} onCatatan={setCatatan}
        aksi={
          <button type="button" onClick={tambah} disabled={!tanggal} className="btn-acc"
            style={{ padding: "7px 13px", opacity: tanggal ? 1 : .5, cursor: tanggal ? "pointer" : "not-allowed" }}>
            <i className="ti ti-plus" /> Tambah lagi
          </button>
        }
      />
      {tanggal && (
        <div role="status" style={{ fontSize: 10, color: "#15803d", marginTop: 6 }}>
          <i className="ti ti-circle-check" /> {jenis} {tanggalIndo(tanggal)} ikut tersimpan saat rekam medis disimpan. Klik &quot;Tambah lagi&quot; kalau mau menambah jadwal lain.
        </div>
      )}

      {rows.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr><th style={{ width: 120 }}>Jenis</th><th style={{ width: 120 }}>Tanggal</th><th>Catatan</th><th style={{ width: 32 }} /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.jenis}-${r.tanggal}-${i}`}>
                <td><span className="bge b">{r.jenis}</span></td>
                <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.tanggal)}</td>
                <td style={{ fontSize: 10.5, color: r.catatan ? "var(--tx)" : "var(--td)" }}>{r.catatan || "—"}</td>
                <td style={{ textAlign: "center" }}>
                  <i className="ti ti-x" onClick={() => hapus(i)} title="Hapus" role="button" aria-label={`Hapus follow up ${r.jenis} ${tanggalIndo(r.tanggal)}`}
                    style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
