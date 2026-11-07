"use client";

import { useRef, useState, useTransition } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { labelStok } from "@/lib/stok-klinik";
import { koreksiKomposisiOwner, koreksiKomposisiOwnerTagihan, pratinjauKoreksiOwner, pratinjauKoreksiOwnerTagihan, type PratinjauKoreksi } from "../actions";
import { PratinjauTagihan } from "./PratinjauTagihan";
import type { BahanPilihan, BahanRacikanBaris } from "./RacikanAksi";

const rupiah = (value: unknown) => `Rp${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
type Efek = { name?: string; delta?: number; cost?: number; direction?: string };

export const NOTICE_TAGIHAN = "Tagihan sudah terbit: HPP dan jurnal dikoreksi, harga dan tagihan tidak berubah";

/** Kartu khusus Owner: koreksi komposisi racikan rawat inap walau kunjungan sudah ada DP/pembayaran. Aturan sebenarnya ditegakkan
 * database; kartu ini hanya jalan masuknya. Tanpa `tagihan`: racikan belum di baris invoice (clinic_owner_correct_compound).
 * Dengan `tagihan`: racikan SUDAH di baris tagihan (clinic_owner_correct_compound_invoiced): HPP baris + jurnal selisih hari ini, harga tetap. */
export function KoreksiOwnerRacikan({ recipeId, visitId, ingredients, materials, tagihan }: {
  recipeId: string; visitId: string; ingredients: BahanRacikanBaris[]; materials: BahanPilihan[]; tagihan?: { invoiceNo: string | null };
}) {
  const [rows, setRows] = useState<BahanRacikanBaris[]>(ingredients);
  // Kunci permintaan dibuat di browser saat kirim pertama dan dipakai ulang oleh kirim ulang formulir yang sama
  // (tidak dibuat saat render server, jadi tidak beda antara server dan browser).
  const kunci = useRef<string | null>(null);
  const [preview, setPreview] = useState<PratinjauKoreksi | null>(null);
  const [pending, startTransition] = useTransition();
  const tersedia = materials.filter(item => !rows.some(row => row.item_id === item.id));
  const valid = rows.length > 0 && rows.every(row => Number.isFinite(row.qty) && row.qty > 0);
  const muatan = rows.map(row => ({ item_id: row.item_id, quantity: row.qty }));
  const ubah = (next: BahanRacikanBaris[]) => { setRows(next); setPreview(null); kunci.current = null; };
  const hasil = preview?.ok ? preview.data : null;
  return <section id="koreksi-owner" aria-label="Koreksi komposisi (Owner)" data-mode={tagihan ? "tagihan" : "biasa"} style={{ marginTop: 16, border: ".5px solid #fcd34d", background: "#fffbeb", borderRadius: 10, padding: 12 }}>
    <div style={{ fontSize: 12.5, fontWeight: 800, color: "#92400e" }}><i className="ti ti-shield-check" /> Koreksi komposisi (Owner)</div>
    {tagihan
      ? <div style={{ fontSize: 11, color: "#92400e", margin: "4px 0 8px" }}>
        <p role="note" style={{ fontWeight: 700, margin: "0 0 4px" }}>{NOTICE_TAGIHAN}{tagihan.invoiceNo ? ` (${tagihan.invoiceNo})` : ""}.</p>
        <p style={{ margin: 0 }}>
          Khusus Owner, lunas maupun belum lunas. Hanya selisih jumlah yang menggerakkan stok (bahan yang berkurang kembali pada harga pokok aslinya).
          HPP baris racikan di tagihan dihitung ulang dan selisihnya dijurnal bertanggal hari ini (HPP lawan Persediaan). Total tagihan, harga jual, dan pembayaran tidak disentuh.
        </p>
      </div>
      : <p style={{ fontSize: 11, color: "#92400e", margin: "4px 0 8px" }}>
        Khusus Owner. Boleh walau pasien sudah DP/pembayaran, selama racikan ini belum masuk baris tagihan. Hanya selisih jumlah yang menggerakkan stok;
        bahan yang berkurang kembali ke stok pada harga pokok aslinya. Harga jual tidak berubah, dan aturan jual di bawah HPP tetap berlaku saat membayar.
      </p>}
    <form action={async (data: FormData) => {
      kunci.current ??= globalThis.crypto.randomUUID();
      data.set("requestKey", kunci.current);
      await (tagihan ? koreksiKomposisiOwnerTagihan(data) : koreksiKomposisiOwner(data));
    }}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="ingredients" value={JSON.stringify(muatan)} />
      {rows.map(row => <div key={row.item_id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginBottom: 4 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{row.nama}</span>
        <NumberInput className="fi" type="number" min={0.001} step="any" aria-label={`Jumlah bahan ${row.nama} (koreksi Owner)`} value={row.qty || ""}
          onChange={event => ubah(rows.map(item => item.item_id === row.item_id ? { ...item, qty: Number(event.target.value) } : item))}
          style={{ width: 70, padding: "2px 5px" }} />
        <span style={{ width: 54, color: "var(--tm)" }}>{row.satuan}</span>
        <button type="button" className="btn-def" aria-label={`Hapus bahan ${row.nama} (koreksi Owner)`} style={{ padding: "0 7px" }}
          onClick={() => ubah(rows.filter(item => item.item_id !== row.item_id))}>×</button>
      </div>)}
      {rows.length === 0 && <p role="alert" style={{ fontSize: 10.5, color: "#b91c1c" }}>Racikan harus memiliki minimal satu bahan.</p>}
      <SearchableItemPicker items={tersedia.map(item => ({ id: item.id, code: "", name: labelStok(item) }))}
        value="" ariaLabel="Tambah bahan racikan (koreksi Owner)" placeholder="Tambah bahan racikan"
        onChange={id => { const item = materials.find(row => row.id === id); if (item) ubah([...rows, { item_id: item.id, nama: item.name, qty: 1, satuan: item.unit }]); }} />
      <label className="flab" htmlFor="alasan-koreksi-owner" style={{ marginTop: 8 }}>Alasan koreksi * (minimal 5 huruf)</label>
      <textarea className="fi" id="alasan-koreksi-owner" name="reason" required minLength={5} maxLength={500} rows={2} onChange={() => { kunci.current = null; }}
        placeholder="mis. jumlah bahan B sebenarnya hanya 2 ml setelah ditimbang ulang" />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn-def" disabled={!valid || pending}
          onClick={() => startTransition(async () => { setPreview(await (tagihan ? pratinjauKoreksiOwnerTagihan(recipeId, muatan) : pratinjauKoreksiOwner(recipeId, muatan))); })}>
          <i className="ti ti-calculator" /> {pending ? "Menghitung…" : tagihan ? "Lihat dampak HPP dan jurnal" : "Lihat dampak biaya"}
        </button>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" disabled={!valid} pendingText="Menyimpan…">Simpan koreksi (Owner)</SubmitButton>
      </div>
    </form>
    {preview && !preview.ok && <p role="alert" style={{ fontSize: 11, color: "#b91c1c", marginTop: 8 }}>{preview.pesan}</p>}
    {hasil && tagihan && <PratinjauTagihan hasil={hasil} />}
    {hasil && !tagihan && <div role="status" style={{ fontSize: 11.5, marginTop: 8, borderTop: ".5px solid #fcd34d", paddingTop: 8 }}>
      <div>HPP racikan: <b>{rupiah(hasil.cost_before)}</b> → <b>{rupiah(hasil.cost_after)}</b> · Harga jual tetap <b>{rupiah(hasil.price)}</b></div>
      <div style={{ color: hasil.price_below_hpp_after ? "#b91c1c" : "#15803d" }}>
        {hasil.price_below_hpp_after ? "Setelah koreksi harga jual MASIH di bawah HPP: kasir akan menolak pembayaran." : "Setelah koreksi harga jual tidak di bawah HPP: kasir bisa membayar."}
      </div>
      {Array.isArray(hasil.stock) && (hasil.stock as Efek[]).map((efek, index) => <div key={index} style={{ color: "var(--tm)" }}>
        {efek.name}: {efek.direction === "keluar" ? "keluar dari stok" : "kembali ke stok"} {Math.abs(Number(efek.delta) || 0)} (nilai {rupiah(efek.cost)})
      </div>)}
    </div>}
  </section>;
}
