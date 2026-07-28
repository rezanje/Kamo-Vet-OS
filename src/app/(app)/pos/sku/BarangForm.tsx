"use client";

import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { TINDAKAN_KATEGORI, kategoriWajibConsent } from "@/lib/tindakan";
import { ITEM_TYPES, ITEM_TYPE_HINT, type ItemType } from "@/lib/barang";
import type { ItemUnit } from "@/lib/satuan";
import { simpanBarang } from "./actions";

export type BarangRow = {
  id: string; name: string; code: string | null; unit: string; upc: string | null;
  category_id: string | null; brand_id: string | null; item_type: ItemType;
  sell_price: number; buy_price: number; min_stock: number;
  is_active: boolean; tindakan_kategori: string | null;
  units?: ItemUnit[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Tab dibiarkan tetap ter-render (display:none) — satu <form> untuk semua tab,
// jadi pindah tab tidak boleh menghapus isian yang belum disimpan.
const TABS = ["Umum", "Penjualan / Pembelian"] as const;
type Tab = (typeof TABS)[number];

export function BarangForm({ categories, brands, editing }: {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  editing: BarangRow | null;
}) {
  const [tab, setTab] = useState<Tab>("Umum");
  const [itemType, setItemType] = useState<ItemType>(editing?.item_type ?? "Persediaan");
  const [tindakan, setTindakan] = useState(editing?.tindakan_kategori ?? "Konsultasi");

  // Satuan dasar & harga dasar dipantau di state supaya panel satuan berjenjang bisa
  // menampilkan perbandingan harga per satuan dasar sambil diketik.
  const [baseUnit, setBaseUnit] = useState(editing?.unit ?? "pcs");
  const [baseSell, setBaseSell] = useState<number>(Number(editing?.sell_price) || 0);
  const [units, setUnits] = useState<ItemUnit[]>(editing?.units ?? []);

  const isJasa = itemType === "Jasa";
  const punyaStok = itemType === "Persediaan";
  const dasar = (baseUnit.trim() || (isJasa ? "tindakan" : "pcs")).trim();

  const setUnit = (i: number, patch: Partial<ItemUnit>) =>
    setUnits((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const addUnit = () => setUnits((us) => [...us, { unit: "", factor: 1, sell_price: 0, buy_price: 0 }]);
  const delUnit = (i: number) => setUnits((us) => us.filter((_, j) => j !== i));

  const gantiJenis = (v: ItemType) => {
    setItemType(v);
    // Satuan default ikut jenis selama belum diutak-atik manual.
    if (v === "Jasa" && baseUnit === "pcs") setBaseUnit("tindakan");
    if (v !== "Jasa" && baseUnit === "tindakan") setBaseUnit("pcs");
  };

  return (
    <form action={simpanBarang} className="crm-sec">
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <input type="hidden" name="item_type" value={itemType} />
      <input type="hidden" name="units" value={JSON.stringify(isJasa ? [] : units)} />

      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: ".5px solid var(--bd)" }}>
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={tabStyle(tab === t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Umum ───────────────────────────────────────────────────────────── */}
      <div style={{ display: tab === "Umum" ? "block" : "none" }}>
        <div className="frow">
          <div>
            <label className="flab">Nama barang *</label>
            <input className="fi" name="name" defaultValue={editing?.name ?? ""} placeholder="mis. ANC Cat Litter 5,5L" required />
          </div>
          <div>
            <label className="flab">Kategori barang *</label>
            <select className="fi" name="category_id" defaultValue={editing?.category_id ?? ""} required>
              <option value="">— pilih —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="frow">
          <div>
            <label className="flab">Jenis barang *</label>
            <select className="fi" value={itemType} onChange={(e) => gantiJenis(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>{ITEM_TYPE_HINT[itemType]}</div>
          </div>
          <div>
            <label className="flab">Merek barang</label>
            <select className="fi" name="brand_id" defaultValue={editing?.brand_id ?? ""}>
              <option value="">— tanpa merek —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Belum ada di daftar? Tambah di <Link href="/pos/merek" style={{ color: "#2563eb" }}>Merek Barang</Link>.
            </div>
          </div>
        </div>

        <div className="frow">
          <div>
            <label className="flab">Kode barang *</label>
            <input className="fi" name="code" defaultValue={editing?.code ?? ""} placeholder="mis. 100511" required />
          </div>
          <div>
            <label className="flab">UPC / Barcode</label>
            <input className="fi" name="upc" defaultValue={editing?.upc ?? ""} placeholder="kosongkan kalau tidak ada" />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Angka yang terbaca alat scan di kasir.</div>
          </div>
        </div>

        <div className="frow">
          <div>
            <label className="flab">Satuan dasar *</label>
            <input className="fi" name="unit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}
              placeholder={isJasa ? "tindakan" : "pcs"} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Satuan terkecil — stok selalu dihitung di sini.
            </div>
          </div>
          <div style={{ display: punyaStok ? "block" : "none" }}>
            <label className="flab">Stok minimum</label>
            <input className="fi" name="min_stock" type="number" min={0} step="any" defaultValue={editing?.min_stock ?? 0} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Batas bawah sebelum barang dianggap perlu dipesan lagi.
            </div>
          </div>
        </div>
      </div>

      {/* ── Penjualan / Pembelian ───────────────────────────────────────────── */}
      <div style={{ display: tab === "Penjualan / Pembelian" ? "block" : "none" }}>
        <div className="frow">
          <div>
            <label className="flab">Harga jual * <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
            <input className="fi" name="sell_price" type="number" min={0} step={1000}
              value={baseSell || ""} onChange={(e) => setBaseSell(Number(e.target.value))} required />
          </div>
          <div>
            <label className="flab">Harga beli / modal <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
            <input className="fi" name="buy_price" type="number" min={0} step={1000} defaultValue={editing?.buy_price ?? 0} />
          </div>
        </div>

        {/* Satuan berjenjang — tidak relevan untuk jasa (tidak punya stok/kemasan). */}
        {!isJasa && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: ".5px solid var(--bd)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}><i className="ti ti-stack-2" /> Satuan berjenjang</div>
                <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                  Kemasan lain dari barang yang sama (box, kg, sak, btl). Harga jualnya berdiri sendiri — tidak wajib kelipatan harga dasar.
                </div>
              </div>
              <button type="button" onClick={addUnit} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah satuan
              </button>
            </div>

            {units.length === 0 && (
              <div style={{ fontSize: 10.5, color: "var(--td)", padding: "6px 0" }}>
                Belum ada. Barang ini hanya dijual per <b>{dasar}</b>.
              </div>
            )}

            {units.map((u, i) => {
              const f = Number(u.factor) || 0;
              const perDasar = f > 0 ? Number(u.sell_price) / f : 0;
              const hemat = f > 0 && baseSell > 0 && Number(u.sell_price) > 0 ? perDasar - baseSell : 0;
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ width: 92, flexShrink: 0 }}>
                    {i === 0 && <label className="flab">Satuan</label>}
                    <input className="fi" placeholder="box" value={u.unit} maxLength={20}
                      onChange={(e) => setUnit(i, { unit: e.target.value })} />
                  </div>
                  <div style={{ width: 104, flexShrink: 0 }}>
                    {i === 0 && <label className="flab">Isi ({dasar})</label>}
                    <input className="fi" type="number" min={0} step="any" value={u.factor || ""}
                      onChange={(e) => setUnit(i, { factor: Number(e.target.value) })} placeholder="12" />
                  </div>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    {i === 0 && <label className="flab">Harga jual</label>}
                    <input className="fi" type="number" min={0} step={1000} value={u.sell_price || ""}
                      onChange={(e) => setUnit(i, { sell_price: Number(e.target.value) })} placeholder="0" />
                    {f > 0 && Number(u.sell_price) > 0 && (
                      <div style={{ fontSize: 9, color: hemat < 0 ? "#15803d" : "var(--td)", marginTop: 2 }}>
                        ≈ {rp(perDasar)}/{dasar}
                        {hemat < 0 ? ` · lebih murah ${rp(Math.abs(hemat))}/${dasar}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 110 }}>
                    {i === 0 && <label className="flab">Harga beli</label>}
                    <input className="fi" type="number" min={0} step={1000} value={u.buy_price || ""}
                      onChange={(e) => setUnit(i, { buy_price: Number(e.target.value) })} placeholder="0" />
                  </div>
                  <button type="button" onClick={() => delUnit(i)} className="btn-def"
                    style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0, marginTop: i === 0 ? 17 : 0, height: 30 }}
                    title="Hapus satuan">
                    <i className="ti ti-trash" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {isJasa && (
          <div className="fg">
            <label className="flab">Kategori tindakan *</label>
            <select className="fi" name="tindakan_kategori" value={tindakan} onChange={(e) => setTindakan(e.target.value)}>
              {TINDAKAN_KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: kategoriWajibConsent(tindakan) ? "#b91c1c" : "var(--td)", marginTop: 3 }}>
              {kategoriWajibConsent(tindakan)
                ? <><i className="ti ti-file-alert" /> Tindakan ini wajib form persetujuan — pembayaran diblokir sampai pemilik tanda tangan.</>
                : "Menentukan apakah tindakan ini butuh form persetujuan saat dipakai di rekam medis."}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
          Simpan barang
        </SubmitButton>
        <Link href="/pos/sku" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>
      </div>
    </form>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "7px 14px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
    background: "none", border: "none", borderBottom: active ? "2px solid #2563eb" : "2px solid transparent",
    color: active ? "#2563eb" : "var(--tm)", marginBottom: -1,
  };
}
