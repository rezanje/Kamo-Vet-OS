"use client";

import { useState } from "react";
import { LampiranPicker } from "@/components/LampiranPicker";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtQty } from "@/lib/inventaris-operasional";
import { catatPembelian } from "./actions";

export type PilihanBarang = { id: string; nama: string; satuan: string; qty: number };
export type PilihanKas = { id: string; nama: string; umum: boolean };

/** Catat Pembelian (Finance): barang terdaftar atau baru, jumlah, nominal total, kas sumber, nota wajib. */
export function PembelianForm({ branchId, requestKey, barang, kas }: {
  branchId: string; requestKey: string; barang: PilihanBarang[]; kas: PilihanKas[];
}) {
  const [itemId, setItemId] = useState(barang[0]?.id ?? "baru");
  const baru = itemId === "baru";
  const terpilih = barang.find(b => b.id === itemId);
  return (
    <form action={catatPembelian} style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="branch_id" value={branchId} />
      <input type="hidden" name="request_key" value={requestKey} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 11 }}>Barang
          <select className="fi" name="item_id" value={itemId} onChange={e => setItemId(e.target.value)} style={{ display: "block", width: 240 }}>
            {barang.map(b => <option key={b.id} value={b.id}>{b.nama} ({b.satuan}) · tercatat {fmtQty(b.qty)}</option>)}
            <option value="baru">+ Barang baru…</option>
          </select>
        </label>
        {baru && (
          <>
            <label style={{ fontSize: 11 }}>Nama barang baru
              <input className="fi" name="nama_baru" required minLength={2} maxLength={120} placeholder="mis. Alat pel" style={{ display: "block", width: 200 }} />
            </label>
            <label style={{ fontSize: 11 }}>Satuan
              <input className="fi" name="satuan_baru" required maxLength={30} placeholder="pcs" style={{ display: "block", width: 90 }} />
            </label>
          </>
        )}
        <label style={{ fontSize: 11 }}>Jumlah{terpilih ? ` (${terpilih.satuan})` : ""}
          <NumberInput className="fi" name="qty" type="number" min={0.01} step="0.01" required placeholder="1" style={{ display: "block", width: 100 }} />
        </label>
        <label style={{ fontSize: 11 }}>Nominal total (Rp)
          <NumberInput className="fi" name="nominal" type="number" min={0.01} step="0.01" required placeholder="0" style={{ display: "block", width: 150 }} />
        </label>
        <label style={{ fontSize: 11 }}>Kas sumber
          <select className="fi" name="account_id" required defaultValue="" style={{ display: "block", width: 220 }}>
            <option value="" disabled>Pilih kas/bank</option>
            {kas.map(k => <option key={k.id} value={k.id}>{k.nama}{k.umum ? " (umum)" : ""}</option>)}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 11 }}>Catatan (opsional)
        <input className="fi" name="catatan" maxLength={500} placeholder="mis. nama toko" style={{ display: "block", width: "100%", maxWidth: 520 }} />
      </label>
      <div style={{ fontSize: 11 }}>Nota pembelian (wajib)
        <LampiranPicker folder="pengeluaran" wajib />
      </div>
      <div>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan pembelian…" disabled={kas.length === 0}>Simpan Pembelian</SubmitButton>
      </div>
    </form>
  );
}
