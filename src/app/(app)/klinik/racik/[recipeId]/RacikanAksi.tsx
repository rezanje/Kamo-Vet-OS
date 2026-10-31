"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { labelStok } from "@/lib/stok-klinik";
import { ubahKomposisiRacikan, kembalikanBahanRacikan } from "../actions";

export type BahanRacikanBaris = { item_id: string; nama: string; qty: number; satuan: string };
export type BahanPilihan = { id: string; name: string; unit: string; stok: number | null };

/** Mengganti tombol "Void" lama: koreksi komposisi (hanya selisihnya yang menggerakkan stok)
 * dan pengembalian seluruh bahan. Keduanya wajib beralasan; syarat racikan belum diserahkan
 * dan tagihan belum dibayar ditegakkan ulang di database. */
export function RacikanAksi({ recipeId, visitId, ingredients, materials }: {
  recipeId: string; visitId: string; ingredients: BahanRacikanBaris[]; materials: BahanPilihan[];
}) {
  const [rows, setRows] = useState<BahanRacikanBaris[]>(ingredients);
  const tersedia = materials.filter(item => !rows.some(row => row.item_id === item.id));
  const valid = rows.length > 0 && rows.every(row => Number.isFinite(row.qty) && row.qty > 0);
  const payload = JSON.stringify(rows.map(row => ({ item_id: row.item_id, quantity: row.qty })));
  return <details aria-label="Aksi racikan" style={{ marginTop: 16, border: ".5px solid var(--bd)", borderRadius: 10, padding: 12 }}>
    <summary style={{ fontSize: 12, fontWeight: 700, cursor: "pointer" }}><i className="ti ti-dots" /> Aksi</summary>

    <form action={ubahKomposisiRacikan} style={{ marginTop: 12 }}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="ingredients" value={payload} />
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--posb)" }}>Ubah komposisi</div>
      <p style={{ fontSize: 10.5, color: "var(--tm)" }}>
        Hanya selisih jumlahnya yang menggerakkan stok bahan. Bahan yang jumlahnya tetap tidak diambil ulang.
      </p>
      {rows.map(row => <div key={row.item_id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{row.nama}</span>
        <NumberInput className="fi" type="number" min={0.001} step="any" aria-label={`Jumlah bahan ${row.nama}`} value={row.qty || ""}
          onChange={event => setRows(list => list.map(item => item.item_id === row.item_id ? { ...item, qty: Number(event.target.value) } : item))}
          style={{ width: 70, padding: "2px 5px" }} />
        <span style={{ width: 54, color: "var(--tm)" }}>{row.satuan}</span>
        <button type="button" className="btn-def" aria-label={`Hapus bahan ${row.nama}`} style={{ padding: "0 7px" }}
          onClick={() => setRows(list => list.filter(item => item.item_id !== row.item_id))}>×</button>
      </div>)}
      {rows.length === 0 && <p role="alert" style={{ fontSize: 10.5, color: "#b91c1c" }}>Racikan harus memiliki minimal satu bahan.</p>}
      <SearchableItemPicker items={tersedia.map(item => ({ id: item.id, code: "", name: labelStok(item) }))}
        value="" ariaLabel="Tambah bahan racikan" placeholder="Tambah bahan racikan"
        onChange={id => { const item = materials.find(row => row.id === id); if (item) setRows(list => [...list, { item_id: item.id, nama: item.name, qty: 1, satuan: item.unit }]); }} />
      <label className="flab" htmlFor="alasan-komposisi" style={{ marginTop: 8 }}>Alasan perubahan komposisi *</label>
      <textarea className="fi" id="alasan-komposisi" name="reason" required minLength={3} maxLength={500} rows={2}
        placeholder="mis. dosis disesuaikan setelah berat badan ditimbang ulang" />
      <SubmitButton className="btn-acc" icon="ti-device-floppy" disabled={!valid} pendingText="Menyimpan…">Simpan komposisi baru</SubmitButton>
    </form>

    <form action={kembalikanBahanRacikan} style={{ marginTop: 16, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="visitId" value={visitId} />
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>Kembalikan bahan</div>
      <p style={{ fontSize: 10.5, color: "var(--tm)" }}>
        Seluruh bahan kembali ke stok pada harga pokok saat diambil, dan racikan ini ditandai void (tetap tersimpan).
      </p>
      <label className="flab" htmlFor="alasan-kembali">Alasan pengembalian bahan *</label>
      <textarea className="fi" id="alasan-kembali" name="reason" required minLength={3} maxLength={500} rows={2}
        placeholder="mis. resep dibatalkan dokter sebelum diracik" />
      <SubmitButton className="btn-def" icon="ti-arrow-back-up" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} pendingText="Memproses…">Kembalikan bahan</SubmitButton>
    </form>
  </details>;
}
