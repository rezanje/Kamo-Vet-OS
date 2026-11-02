"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { LampiranPicker } from "@/components/LampiranPicker";
import { ExpenseForm, ExpenseSubmitButton } from "@/components/pengeluaran/ExpenseForm";
import { simpanPengeluaranKlinik } from "./actions";

const KATEGORI = ["Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan", "Lain-lain"];

export function TambahPengeluaran({ userId, today, shiftId }: { userId: string; today: string; shiftId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-acc" style={{ background: "var(--posb)", padding: "8px 16px" }}>
        <i className="ti ti-plus" /> Tambah Pengeluaran
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 440, padding: 20, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah Pengeluaran</div>
              <button type="button" aria-label="Tutup" onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--tm)", fontSize: 16 }}><i className="ti ti-x" /></button>
            </div>
            {!shiftId ? (
              <div className="p2ban" role="alert">Mulai shift klinik dulu — pengeluaran klinik dicatat ke laci shift yang sedang dibuka.</div>
            ) : (
              <ExpenseForm userId={userId} scope={`clinic-expense:${shiftId}`} action={simpanPengeluaranKlinik}>
                <div className="frow">
                  <div>
                    <label className="flab">Tanggal *</label>
                    <input className="fi" name="tanggal" type="date" defaultValue={today} max={today} required />
                  </div>
                  <div>
                    <label className="flab">Kategori *</label>
                    <select className="fi" name="kategori" required defaultValue="">
                      <option value="" disabled>Pilih kategori</option>
                      {KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
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
                    <NumberInput className="fi" name="jumlah" type="number" min={0} step="any" placeholder="0" required />
                  </div>
                  <div>
                    <label className="flab">Metode</label>
                    <select className="fi" name="metode_bayar" defaultValue="Tunai">
                      <option>Tunai</option><option>Transfer</option><option>Debit</option><option>QRIS</option>
                    </select>
                  </div>
                </div>
                <div className="fg">
                  <label className="flab">Lampiran bukti * <span style={{ fontWeight: 400, color: "var(--tm)" }}>(foto nota / struk / bukti transfer)</span></label>
                  <LampiranPicker folder="pengeluaran" wajib />
                </div>
                <ExpenseSubmitButton className="kpos-bayar" style={{ marginTop: 8, width: "100%" }}>Simpan Pengeluaran</ExpenseSubmitButton>
              </ExpenseForm>
            )}
          </div>
        </div>
      )}
    </>
  );
}
