"use client";

import Link from "next/link";
import { useState } from "react";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { FollowUpIsian } from "@/components/FollowUpIsian";
import { tanggalIndo } from "@/lib/followup";
import { tambahFollowUpKunjungan } from "./actions";

export type FollowUpKunjungan = { id: string; jenis: string; tanggal: string; catatan: string | null; status: string };

/**
 * Follow up kunjungan ini di halaman detail rekam medis (masukan Babibu, 5 Nov). Jadwal
 * yang dibuat di form pemeriksaan terlihat di sini, dan dokter tetap bisa menambah jadwal
 * kontrol / vaksin berikutnya setelah rekam medis tersimpan atau tagihan lunas.
 */
export function FollowUpPanel({ visitId, rows, loadFailed, bolehTambah }: {
  visitId: string; rows: FollowUpKunjungan[]; loadFailed: boolean; bolehTambah: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [jenis, setJenis] = useState("Kontrol");
  const [tanggal, setTanggal] = useState("");
  const [catatan, setCatatan] = useState("");
  return (
    <div className="card" id="follow-up" style={{ marginTop: 12, scrollMarginTop: 20 }}>
      <div className="card-hd" style={{ justifyContent: "space-between" }}>
        <span><i className="ti ti-calendar-event" style={{ color: "#d97706" }} /> Follow up (kontrol / vaksin berikutnya)</span>
        <span style={{ display: "flex", gap: 6 }}>
          <Link href="/klinik/follow-up?tab=mendatang" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5, textDecoration: "none" }}>
            Daftar follow up
          </Link>
          {bolehTambah && (
            <button type="button" className="btn-acc" style={{ padding: "4px 9px", fontSize: 10.5 }} onClick={() => setOpen((v) => !v)}>
              <i className="ti ti-plus" /> Tambah follow up
            </button>
          )}
        </span>
      </div>
      {open && bolehTambah && (
        <TransactionForm scope={`clinic-follow-up:${visitId}`} action={tambahFollowUpKunjungan} style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <input type="hidden" name="visit_id" value={visitId} />
          <FollowUpIsian jenis={jenis} tanggal={tanggal} catatan={catatan} onJenis={setJenis} onTanggal={setTanggal} onCatatan={setCatatan}
            names={{ jenis: "jenis", tanggal: "tanggal", catatan: "catatan" }} />
          <div style={{ fontSize: 10, color: "var(--td)" }}>Hanya menambah pengingat ke pemilik — tagihan, stok, dan isi rekam medis tidak berubah.</div>
          <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" disabled={!tanggal} style={{ justifySelf: "start" }}>
            Simpan follow up
          </SubmitButton>
        </TransactionForm>
      )}
      {loadFailed ? (
        <div role="alert" style={{ fontSize: 11, color: "#b91c1c" }}>Daftar follow up kunjungan ini belum dapat dimuat. Muat ulang halaman.</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada follow up untuk kunjungan ini.</div>
      ) : (
        <table className="tbl">
          <thead><tr><th style={{ width: 110 }}>Tanggal</th><th style={{ width: 100 }}>Jenis</th><th>Catatan</th><th style={{ width: 90 }}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.tanggal)}</td>
                <td><span className="bge b">{r.jenis}</span></td>
                <td style={{ fontSize: 10.5, color: r.catatan ? "var(--tx)" : "var(--td)" }}>{r.catatan || "—"}</td>
                <td><span className={`bge ${r.status === "Selesai" ? "g" : r.status === "Batal" ? "x" : "b"}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
