"use client";

import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { TINDAKAN_KATEGORI, kategoriWajibConsent } from "@/lib/tindakan";
import { ITEM_TYPES, ITEM_TYPE_HINT, type ItemType } from "@/lib/barang";
import { flatOptions, type KategoriRow } from "@/lib/kategori";
import type { ItemUnit } from "@/lib/satuan";
import { simpanBarang } from "./actions";

export type BarangRow = {
  id: string; name: string; code: string | null; unit: string; upc: string | null;
  category_id: string | null; brand_id: string | null; item_type: ItemType;
  sell_price: number; buy_price: number; min_stock: number;
  is_active: boolean; tindakan_kategori: string | null;
  supplier_id: string | null; buy_unit: string | null; min_buy: number;
  min_sell_qty: number; default_discount: number; substitute_item_id: string | null;
  units?: ItemUnit[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Tab dibiarkan tetap ter-render (display:none) — satu <form> untuk semua tab,
// jadi pindah tab tidak boleh menghapus isian yang belum disimpan.
const TABS = ["Umum", "Penjualan / Pembelian"] as const;
type Tab = (typeof TABS)[number];

// `satuanMaster` = daftar satuan resmi (tabel units). Namanya dibedakan dari state
// `units` di bawah, yang isinya satuan BERJENJANG milik barang ini.
export function BarangForm({ categories, brands, satuanMaster, suppliers = [], barangLain = [], editing }: {
  categories: KategoriRow[];
  brands: { id: string; name: string }[];
  satuanMaster: { id: string; nama: string }[];
  suppliers?: { id: string; nama: string }[];
  barangLain?: { id: string; code: string | null; name: string }[];
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
              {flatOptions(categories).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Belum ada? Tambah di <Link href="/pos/kategori" style={{ color: "#2563eb" }}>Kategori Barang</Link>.
            </div>
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
            <select className="fi" name="unit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} required>
              {/* Satuan lama yang sudah dinonaktifkan tetap ditawarkan saat mengedit
                  barang yang memakainya — kalau tidak, nilainya hilang diam-diam. */}
              {baseUnit && !satuanMaster.some((u) => u.nama === baseUnit) && (
                <option value={baseUnit}>{baseUnit} (nonaktif)</option>
              )}
              {satuanMaster.map((u) => <option key={u.id} value={u.nama}>{u.nama}</option>)}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Satuan terkecil — stok selalu dihitung di sini. Daftarnya diatur di{" "}
              <Link href="/pos/satuan" style={{ color: "#2563eb" }}>Satuan Barang</Link>.
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
                  <div style={{ width: 110, flexShrink: 0 }}>
                    {i === 0 && <label className="flab">Satuan</label>}
                    <select className="fi" value={u.unit} onChange={(e) => setUnit(i, { unit: e.target.value })}>
                      <option value="">— pilih —</option>
                      {u.unit && !satuanMaster.some((x) => x.nama === u.unit) && (
                        <option value={u.unit}>{u.unit} (nonaktif)</option>
                      )}
                      {satuanMaster.filter((x) => x.nama !== dasar).map((x) => (
                        <option key={x.id} value={x.nama}>{x.nama}</option>
                      ))}
                    </select>
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

        {/* Aturan jual & info pembelian (migrasi 0075). Info pembelian tidak relevan
            untuk jasa/non-persediaan: barangnya tidak pernah dipesan ke pemasok. */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: ".5px solid var(--bd)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 7 }}>
            <i className="ti ti-discount-2" /> Aturan penjualan
          </div>
          <div className="frow">
            <div>
              <label className="flab">Diskon default (%)</label>
              <input className="fi" name="default_discount" type="number" min={0} max={100} step="any"
                defaultValue={editing?.default_discount ?? 0} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Dipakai semua satuan. Kosongkan (0) kalau barang ini tidak pernah didiskon otomatis.
              </div>
            </div>
            <div>
              <label className="flab">Minimum jual <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
              <input className="fi" name="min_sell_qty" type="number" min={0} step="any"
                defaultValue={editing?.min_sell_qty ?? 0} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Jumlah paling sedikit yang boleh dibeli sekali transaksi. 0 = bebas.
              </div>
            </div>
          </div>
        </div>

        {punyaStok && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: ".5px solid var(--bd)" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>
              <i className="ti ti-shopping-cart" /> Informasi pembelian
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginBottom: 7 }}>
              Dipakai layar <b>Barang Stok Minimum</b> untuk membuat draft PO otomatis.
              Harga beli di atas cuma acuan PO — HPP tetap rata-rata dari pembelian yang benar-benar masuk.
            </div>

            <div className="frow">
              <div>
                <label className="flab">Pemasok utama</label>
                <select className="fi" name="supplier_id" defaultValue={editing?.supplier_id ?? ""}>
                  <option value="">— belum ditentukan —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
                </select>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Tanpa ini, usulan pesan jadi PO tanpa pemasok dan harus dibetulkan manual.
                </div>
              </div>
              <div>
                <label className="flab">Satuan beli</label>
                <select className="fi" name="buy_unit" defaultValue={editing?.buy_unit ?? ""}>
                  <option value="">Ikut satuan dasar ({dasar})</option>
                  {satuanMaster.map((u) => <option key={u.id} value={u.nama}>{u.nama}</option>)}
                </select>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Satuan saat memesan — biasanya kemasan besar (box/dus).
                </div>
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Minimum beli</label>
                <input className="fi" name="min_buy" type="number" min={0} step="any"
                  defaultValue={editing?.min_buy ?? 0} />
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Jumlah pesan paling sedikit yang mau dilayani pemasok, dalam satuan beli.
                </div>
              </div>
              <div>
                <label className="flab">Substitusi dengan</label>
                <select className="fi" name="substitute_item_id" defaultValue={editing?.substitute_item_id ?? ""}>
                  <option value="">— tidak ada —</option>
                  {barangLain.filter((b) => b.id !== editing?.id).map((b) => (
                    <option key={b.id} value={b.id}>{b.code ? `${b.code} — ` : ""}{b.name}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                  Barang pengganti saat yang ini kosong.
                </div>
              </div>
            </div>
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
