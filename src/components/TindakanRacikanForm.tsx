"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { BMHP_MAX_COMPONENTS, bmhpInput, vaccinationOf, type BmhpRow } from "@/lib/procedure-bmhp";
import type { CompoundDraft } from "@/lib/master-compound-cart";
import type { KatalogRacikan } from "@/lib/katalog-racikan";
import type { ItemUnit } from "@/lib/satuan";
import { kategoriWajibConsent } from "@/lib/tindakan";
import { alasanRacikanBelumLengkap } from "@/lib/racikan";
import { faktorSatuanKlinik, keadaanStok, labelStok, teksStok } from "@/lib/stok-klinik";

/** Satu form untuk tindakan dan racikan (permintaan Andri 29 Okt): satu pemilih item dan
 * satu daftar "Bahan / BMHP". Komponen ini murni lapisan tampilan — bentuk data yang
 * dikirim ke server tetap draf tindakan (`bmhp`) dan `CompoundDraft` seperti sebelumnya. */
type UnitLite = Omit<ItemUnit, "buy_price">;
export type FormItem = {
  id: string; code?: string | null; name: string; unit: string; sell_price: number;
  /** Stok satuan dasar gudang klinik transaksi; null = belum terbaca. */
  stok: number | null;
  item_type?: string; tindakan_kategori?: string | null; units?: UnitLite[];
};
export type TindakanDraft<T extends FormItem = FormItem> = { item: T; bmhp: BmhpRow[]; editKey: string | null };

const rp = (value: number) => "Rp " + Math.round(value).toLocaleString("id-ID");
const BENTUK = ["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"];
const PER_HALAMAN = 40;

export function TindakanRacikanForm<T extends FormItem>({
  tindakanItems = [], racikanItems, bmhpItems = [], bahanItems, katalogRacikan, bolehManual,
  tindakan = null, racikan, editing, harga, labelSimpan,
  onPilihTindakan, onPilihRacikan, onUbahBmhp, onUbahRacikan, onSimpan, onBatal,
}: {
  /** Tanpa daftar tindakan form ini jadi form racikan saja (halaman detail rekam medis). */
  tindakanItems?: T[]; racikanItems: T[]; bmhpItems?: T[]; bahanItems: T[];
  katalogRacikan: KatalogRacikan[]; bolehManual: boolean;
  tindakan?: TindakanDraft<T> | null; racikan: CompoundDraft; editing: boolean; harga: number;
  /** Teks tombol simpan bila bukan "tambah ke keranjang". */
  labelSimpan?: string;
  onPilihTindakan?: (item: T) => void; onPilihRacikan: (item: T) => void;
  onUbahBmhp?: (rows: BmhpRow[]) => void; onUbahRacikan: (value: CompoundDraft) => void;
  /** Tanpa onSimpan tombolnya menyimpan form induk (submit), bukan memanggil keranjang. */
  onSimpan?: () => void; onBatal: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const sku = racikanItems.find(item => item.id === racikan.saleItemId) ?? null;
  const terpilih = tindakan ? tindakan.item : sku;
  const isRacikan = !tindakan && !!sku;
  // Halaman detail rekam medis memakai form yang sama, tapi hanya untuk racikan.
  const hanyaRacikan = !tindakanItems.length;
  const judul = hanyaRacikan ? "racikan" : "tindakan / racikan";

  // Vial vaksin yang tercatat di TINDAKAN selalu dibuka sebagai jasa vaksinasinya, jadi daftar
  // menampilkan jasa itu (nama & harga yang akan masuk keranjang), bukan harga vial. Nama/kode
  // vial tetap bisa dicari (Anisa 1 Nov: "Vaccine F4" tampil 250rb, masuk keranjang 235rb).
  const tindakanTampil = new Map<string, { item: T; vial: T[] }>();
  for (const item of tindakanItems) {
    const target = item.item_type !== "Jasa" ? vaccinationOf(item, tindakanItems) ?? item : item;
    const row = tindakanTampil.get(target.id) ?? { item: target, vial: [] };
    if (target !== item) row.vial.push(item);
    tindakanTampil.set(target.id, row);
  }
  const daftar = [
    ...[...tindakanTampil.values()].map(({ item, vial }) => ({ item, vial, jenis: "Tindakan" as const })),
    ...racikanItems.map(item => ({ item, vial: [] as T[], jenis: "Racikan" as const })),
  ];
  const term = search.trim().toLowerCase();
  const cocok = term ? daftar.filter(row => [row.item, ...row.vial].some(item => `${item.name} ${item.code ?? ""}`.toLowerCase().includes(term))) : daftar;
  const halaman = Math.max(1, Math.ceil(cocok.length / PER_HALAMAN));
  const halamanKini = Math.min(page, halaman);
  const jumlahResep = (id: string) => katalogRacikan.filter(row => row.active && row.sale_item_id === id).length;

  const katalogSku = sku ? katalogRacikan.filter(row => row.active && row.sale_item_id === sku.id) : [];
  const formula = katalogSku.find(row => row.version_id === racikan.formulaId);
  const bahanById = new Map(bahanItems.map(item => [item.id, item]));
  // Aturan lama dipertahankan: resep resmi hanya bisa disalin bila bahan & satuannya masih cocok.
  const bolehSesuaikan = !!formula && bolehManual && formula.ingredients.length > 0 && formula.ingredients.every(row => {
    const bahan = bahanById.get(row.item_id);
    return !!bahan && bahan.unit === row.unit && Number.isFinite(row.quantity) && row.quantity > 0;
  });

  let bmhpValid = true;
  try { bmhpInput(tindakan?.bmhp ?? []); } catch { bmhpValid = false; }
  // Tombol simpan yang mati selalu menyebut alasannya, bukan diam saja.
  const alasan = tindakan
    ? (bmhpValid ? "" : "Periksa jumlah dan satuan BMHP.")
    : alasanRacikanBelumLengkap({
      skuDipilih: !!sku, resepResmiDipilih: !!formula, resepResmiTerisi: !!racikan.formulaId,
      adaResepResmi: katalogSku.length > 0, bolehManual, bahan: racikan.ingredients,
    });
  const valid = !alasan;

  const pilih = (item: T, jenis: "Tindakan" | "Racikan") => {
    setSearch(""); setPage(1);
    if (jenis === "Tindakan") onPilihTindakan?.(item); else onPilihRacikan(item);
  };
  // Stok bahan/BMHP dalam satuan barisnya (pak isi 10 → stok dibagi 10), bersama kekurangannya.
  const stokTeks = (id: string, satuan: string, qty: number) => {
    const item = (tindakan ? bmhpItems : bahanItems).find(row => row.id === id);
    return item ? teksStok(keadaanStok({ stok: item.stok, satuanDasar: item.unit, satuan, faktor: faktorSatuanKlinik(item, satuan), butuh: qty })) : satuan;
  };
  const satuanPilihan = (id: string) => {
    const item = bmhpItems.find(row => row.id === id);
    const extra = item?.units?.map(unit => unit.unit) ?? [];
    return item ? [item.unit, ...extra.filter(unit => unit !== item.unit)] : [];
  };

  return <section aria-label={`Pilih ${judul}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <input className="fi" aria-label={`Cari ${judul}`} placeholder={hanyaRacikan ? "Cari obat racik…" : "Cari tindakan atau racikan…"}
      value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
    <div style={{ maxHeight: 210, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
      {!daftar.length && <div style={{ fontSize: 10.5, color: "var(--td)", padding: 10 }}>
        {hanyaRacikan ? "Belum ada obat racik aktif." : "Belum ada tindakan atau obat racik aktif."} Tambahkan di Barang &amp; Jasa.
      </div>}
      {!!daftar.length && !cocok.length && <div style={{ fontSize: 10.5, color: "var(--td)", padding: 10 }}>Tidak ada {judul} cocok.</div>}
      {cocok.slice((halamanKini - 1) * PER_HALAMAN, halamanKini * PER_HALAMAN).map(({ item, vial, jenis }) => <div key={`${jenis}-${item.id}`}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderBottom: ".5px solid var(--bd)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            <span className={`bge ${jenis === "Racikan" ? "b" : "g"}`} style={{ fontSize: 8 }}>{jenis}</span>
            <span>{item.name}</span>
          </div>
          <div style={{ fontSize: 9, color: "var(--tm)", display: "flex", alignItems: "center", gap: 5 }}>
            {rp(item.sell_price)}
            {jenis === "Tindakan" && item.tindakan_kategori
              && <span className={`bge ${kategoriWajibConsent(item.tindakan_kategori) ? "r" : "b"}`} style={{ fontSize: 8 }}>{item.tindakan_kategori}</span>}
            {!!vial.length && <span>vial: {vial.map(row => row.name).join(", ")}</span>}
            {jenis === "Racikan" && <span>{jumlahResep(item.id) ? `${jumlahResep(item.id)} resep resmi` : bolehManual ? "Racikan khusus pasien" : "Belum ada resep resmi"}</span>}
          </div>
        </div>
        <button type="button" aria-label={`Pilih ${item.name}`} onClick={() => pilih(item, jenis)} className="btn-acc"
          style={{ padding: "3px 8px", background: "var(--posb)" }}><i className="ti ti-plus" /></button>
      </div>)}
      {halaman > 1 && <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10.5, padding: 6 }}>
        <button type="button" className="btn-def" disabled={halamanKini <= 1} onClick={() => setPage(halamanKini - 1)}>Sebelumnya</button>
        <span>{halamanKini}/{halaman}</span>
        <button type="button" className="btn-def" disabled={halamanKini >= halaman} onClick={() => setPage(halamanKini + 1)}>Berikutnya</button>
      </div>}
    </div>

    {terpilih && <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className={`bge ${isRacikan ? "b" : "g"}`} style={{ fontSize: 8 }}>{isRacikan ? "Racikan" : "Tindakan"}</span>
        <strong style={{ fontSize: 12 }}>{terpilih.name}</strong>
        <span style={{ fontSize: 11, color: "var(--tm)" }}>{rp(harga)}</span>
      </div>

      {isRacikan && <>
        <label className="flab">Komposisi racikan</label>
        <SearchableItemPicker items={katalogSku.map(row => ({ id: row.version_id, code: row.code, name: `${row.name} (v${row.version})` }))}
          value={racikan.formulaId} ariaLabel="Komposisi racikan"
          placeholder={bolehManual ? "Racikan khusus pasien / cari resep resmi" : "Pilih resep resmi"}
          onChange={id => onUbahRacikan({ ...racikan, formulaId: id })} />
        {!katalogSku.length && <span style={{ fontSize: 10.5, color: "var(--tm)" }}>
          Resep resmi belum ditautkan ke SKU ini. OWNER/ADMIN dapat mengaturnya di Katalog Racikan Resmi.
        </span>}
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="flab">Bentuk sediaan</label>
            {formula
              ? <input className="fi" aria-label="Bentuk racikan" value={formula.dosage_form} readOnly />
              : <select className="fi" aria-label="Bentuk racikan" value={racikan.dosageForm}
                onChange={event => onUbahRacikan({ ...racikan, dosageForm: event.target.value })}>
                {BENTUK.map(bentuk => <option key={bentuk}>{bentuk}</option>)}
              </select>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="flab">Aturan pakai</label>
            <input className="fi" aria-label="Aturan pakai racikan" placeholder="Petunjuk pemakaian (opsional)"
              value={formula ? formula.dosage_instruction ?? "" : racikan.instruction} readOnly={!!formula}
              onChange={event => onUbahRacikan({ ...racikan, instruction: event.target.value })} />
          </div>
        </div>
      </>}

      <fieldset style={{ border: 0, padding: 0, margin: "2px 0", minWidth: 0 }}>
        <legend style={{ fontSize: 11, fontWeight: 600 }}>{hanyaRacikan ? "Bahan racikan" : "Bahan / BMHP"} · {terpilih.name}</legend>

        {tindakan && <>
          {tindakan.bmhp.map(row => <BahanBaris key={row.item_id} nama={row.nama} keterangan={stokTeks(row.item_id, row.unit, row.qty)}
            qtyLabel={`Jumlah BMHP ${row.nama}`} qty={row.qty}
            onQty={qty => onUbahBmhp?.(tindakan.bmhp.map(item => item.item_id === row.item_id ? { ...item, qty } : item))}
            satuan={row.unit} satuanPilihan={satuanPilihan(row.item_id)} satuanLabel={`Satuan BMHP ${row.nama}`}
            onSatuan={unit => onUbahBmhp?.(tindakan.bmhp.map(item => item.item_id === row.item_id ? { ...item, unit } : item))}
            hapusLabel={`Hapus BMHP ${row.nama}`}
            onHapus={() => onUbahBmhp?.(tindakan.bmhp.filter(item => item.item_id !== row.item_id))} />)}
          {tindakan.bmhp.length < BMHP_MAX_COMPONENTS && <SearchableItemPicker
            items={bmhpItems.filter(item => !tindakan.bmhp.some(row => row.item_id === item.id))
              .map(item => ({ id: item.id, code: item.code ?? "", name: labelStok(item) }))}
            value="" ariaLabel={`Tambah BMHP ${terpilih.name}`} placeholder="Tambah BMHP dipakai (opsional)"
            onChange={id => {
              const item = bmhpItems.find(row => row.id === id);
              if (item) onUbahBmhp?.([...tindakan.bmhp, { item_id: item.id, nama: item.name, qty: 1, unit: item.unit }]);
            }} />}
          <div style={{ fontSize: 9, color: "var(--tm)" }}>Stok BMHP dipotong saat tagihan klinik disimpan; biayanya masuk HPP tindakan, harga jual tidak berubah.</div>
        </>}

        {isRacikan && formula && <>
          {/* Bahan dari resep resmi: terkunci sampai dokter memilih menyesuaikannya untuk pasien. */}
          <div style={{ fontSize: 11, padding: 9, background: "#f4f0ff", borderRadius: 8 }}>
            <strong>{formula.name} (v{formula.version})</strong>
            {formula.ingredients.map(row => <div key={row.item_id} style={{ fontSize: 10.5 }}>{row.name} × {row.quantity} {row.unit}</div>)}
          </div>
          {bolehSesuaikan && <button type="button" className="btn-def" onClick={() => onUbahRacikan({
            ...racikan, formulaId: "", dosageForm: formula.dosage_form, instruction: formula.dosage_instruction ?? "",
            ingredients: formula.ingredients.map(row => {
              const bahan = bahanById.get(row.item_id)!;
              return { item_id: bahan.id, nama: bahan.name, qty: row.quantity, satuan: bahan.unit, harga: bahan.sell_price };
            }),
          })}>Sesuaikan komposisi untuk pasien</button>}
          {bolehManual && !bolehSesuaikan && <div role="status" style={{ fontSize: 10.5, color: "var(--tm)" }}>
            Komposisi ini belum dapat disalin: bahan atau satuan aktif tidak cocok. Pilih bahan racikan khusus dari awal.
          </div>}
        </>}

        {isRacikan && !formula && (bolehManual ? <>
          {racikan.ingredients.map(row => <BahanBaris key={row.item_id} nama={row.nama} keterangan={stokTeks(row.item_id, row.satuan, row.qty)}
            qtyLabel={`Jumlah bahan ${row.nama}`} qty={row.qty}
            onQty={qty => onUbahRacikan({ ...racikan, ingredients: racikan.ingredients.map(item => item.item_id === row.item_id ? { ...item, qty } : item) })}
            satuan={row.satuan} hapusLabel={`Hapus bahan ${row.nama}`}
            onHapus={() => onUbahRacikan({ ...racikan, ingredients: racikan.ingredients.filter(item => item.item_id !== row.item_id) })} />)}
          <SearchableItemPicker
            items={bahanItems.filter(item => !racikan.ingredients.some(row => row.item_id === item.id))
              .map(item => ({ id: item.id, code: item.code ?? "", name: labelStok(item) }))}
            value="" ariaLabel={`Tambah bahan ${terpilih.name}`} placeholder="Tambah bahan racikan"
            onChange={id => {
              const item = bahanItems.find(row => row.id === id);
              if (item) onUbahRacikan({ ...racikan, ingredients: [...racikan.ingredients, { item_id: item.id, nama: item.name, qty: 1, satuan: item.unit, harga: item.sell_price }] });
            }} />
          <div style={{ fontSize: 9, color: "var(--tm)" }}>Stok bahan diperiksa saat racikan disimpan.</div>
        </> : <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Pilih resep resmi untuk mengisi bahan racikan.</div>)}
      </fieldset>

      {!!alasan && <div role="alert" style={{ fontSize: 10, color: "#b91c1c" }}>{alasan}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type={onSimpan ? "button" : "submit"} className="btn-acc" disabled={!valid} onClick={onSimpan}
          aria-label={labelSimpan ?? (editing ? `Simpan ${terpilih.name}` : `Tambah ${terpilih.name} ke keranjang`)}>
          {labelSimpan ?? (editing ? "Simpan" : "Tambah ke keranjang")}
        </button>
        <button type="button" className="btn-def" onClick={onBatal}>Batal</button>
      </div>
    </div>}
  </section>;
}

/** Satu baris daftar "Bahan / BMHP": nama, jumlah, satuan, sisa stok. */
function BahanBaris({ nama, keterangan, qty, qtyLabel, onQty, satuan, satuanPilihan, satuanLabel, onSatuan, hapusLabel, onHapus }: {
  nama: string; keterangan: string; qty: number; qtyLabel: string; onQty: (qty: number) => void;
  satuan: string; satuanPilihan?: string[]; satuanLabel?: string; onSatuan?: (unit: string) => void;
  hapusLabel: string; onHapus: () => void;
}) {
  return <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, marginBottom: 3 }}>
    <span style={{ flex: 1, minWidth: 0 }}>{nama}<small style={{ display: "block", color: "var(--tm)", fontSize: 9 }}>{keterangan}</small></span>
    <JumlahInput label={qtyLabel} qty={qty} onChange={onQty} />
    {onSatuan && satuanPilihan
      ? <select className="fi" aria-label={satuanLabel} value={satuan} style={{ width: 66, padding: "1px 3px", fontSize: 10 }}
        onChange={event => onSatuan(event.target.value)}>
        {satuanPilihan.map(unit => <option key={unit} value={unit}>{unit}</option>)}
      </select>
      : <span style={{ width: 66, fontSize: 10, color: "var(--tm)" }}>{satuan}</span>}
    <button type="button" className="btn-def" aria-label={hapusLabel} style={{ padding: "0 6px" }} onClick={onHapus}>×</button>
  </div>;
}

// Menahan apa yang diketik: menurunkan isian dari angka menghapus "0" di depan, sehingga "0.5" tampil ".5".
function JumlahInput({ label, qty, onChange }: { label: string; qty: number; onChange: (qty: number) => void }) {
  const [text, setText] = useState(qty ? String(qty) : "");
  const shown = Number(text) === qty ? text : qty ? String(qty) : "";
  return <NumberInput className="fi" type="number" min={0.001} step="any" aria-label={label} value={shown}
    onChange={event => { setText(event.target.value); onChange(Number(event.target.value)); }}
    style={{ width: 54, padding: "1px 4px", fontSize: 10 }} />;
}
