"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanPengeluaranKlinik } from "./actions";

const KATEGORI = ["Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan", "Lain-lain"];

export function TambahPengeluaran({ branchId, today }: { branchId: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-acc" style={{ background: "#2563eb", padding: "8px 16px" }}>
        <i className="ti ti-plus" /> Tambah Pengeluaran
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <form action={simpanPengeluaranKlinik} onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 440, padding: 20 }}>
            <input type="hidden" name="branchId" value={branchId} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah Pengeluaran</div>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--tm)", fontSize: 16 }}><i className="ti ti-x" /></button>
            </div>
            <div className="frow">
              <div>
                <label className="flab">Tanggal *</label>
                <input className="fi" name="tanggal" type="date" defaultValue={today} required />
              </div>
              <div>
                <label className="flab">Kategori *</label>
                <select className="fi" name="kategori" required defaultValue="">
                  <option value="" disabled>Pilih kategori</option>
                  {KATEGORI.map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="fg">
              <label className="flab">Deskripsi</label>
              <input className="fi" name="deskripsi" placeholder="mis. Beli air galon" />
            </div>
            <div className="frow">
              <div>
                <label className="flab">Jumlah (Rp) *</label>
                <input className="fi" name="jumlah" type="number" min={0} step={500} placeholder="0" required />
              </div>
              <div>
                <label className="flab">Metode</label>
                <select className="fi" name="metode_bayar" defaultValue="Tunai">
                  <option>Tunai</option><option>Transfer</option><option>Debit</option><option>QRIS</option>
                </select>
              </div>
            </div>
            <SubmitButton className="kpos-bayar" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ marginTop: 8 }}>Simpan Pengeluaran</SubmitButton>
          </form>
        </div>
      )}
    </>
  );
}
