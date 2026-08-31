"use client";

import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { TINDAKAN_KATEGORI, kategoriWajibConsent } from "@/lib/tindakan";
import { ITEM_TYPES, ITEM_TYPE_HINT, type ItemType } from "@/lib/barang";
import { flatOptions, type KategoriRow } from "@/lib/kategori";
import type { ItemUnit } from "@/lib/satuan";
import { rapikanTingkat, type Tingkat } from "@/lib/harga-tingkat";
import type { KomponenGrupDraft } from "@/lib/grup-barang";
import { simpanBarang } from "./actions";

export type KandidatKomponenGrup = {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  item_type: Exclude<ItemType, "Grup">;
  sell_price: number;
  buy_price: number;
  units: { unit: string; factor: number }[];
};

export type BarangRow = {
  id: string; name: string; code: string | null; unit: string; upc: string | null;
  category_id: string | null; brand_id: string | null; item_type: ItemType;
  sell_price: number; buy_price: number; min_stock: number; track_expiry?: boolean;
  is_active: boolean; tindakan_kategori: string | null;
  supplier_id: string | null; buy_unit: string | null; min_buy: number;
  min_sell_qty: number; default_discount: number; substitute_item_id: string | null;
  units?: ItemUnit[];
  /** Harga jual bertingkat menurut jumlah beli (meeting 14 Agustus). */
  tiers?: Tingkat[];
  group_components?: KomponenGrupDraft[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Tab dibiarkan tetap ter-render (display:none) — satu <form> untuk semua tab,
// jadi pindah tab tidak boleh menghapus isian yang belum disimpan.
const TABS = ["Umum", "Penjualan / Pembelian", "Rincian Grup"] as const;
type Tab = (typeof TABS)[number];

// `satuanMaster` = daftar satuan resmi (tabel units). Namanya dibedakan dari state
// `units` di bawah, yang isinya satuan BERJENJANG milik barang ini.
export function BarangForm({
  categories, brands, satuanMaster, suppliers = [], barangLain = [], kandidatGrup = [], editing,
}: {
  categories: KategoriRow[];
  brands: { id: string; name: string }[];
  satuanMaster: { id: string; nama: string }[];
  suppliers?: { id: string; nama: string }[];
  barangLain?: { id: string; code: string | null; name: string }[];
  kandidatGrup?: KandidatKomponenGrup[];
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
  // Harga bertingkat: "beli minimal sekian → harga sekian". Beda dari satuan
  // berjenjang yang mengurus kemasan; ini mengurus volume dalam satuan yang sama.
  const [tiers, setTiers] = useState<Tingkat[]>(editing?.tiers ?? []);
  const [groupComponents, setGroupComponents] = useState<KomponenGrupDraft[]>(editing?.group_components ?? []);
  const addTier = () => setTiers((t) => [...t, { min_qty: 0, harga: 0 }]);
  const setTier = (i: number, patch: Partial<Tingkat>) =>
    setTiers((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delTier = (i: number) => setTiers((t) => t.filter((_, j) => j !== i));

  const isJasa = itemType === "Jasa";
  const isGroup = itemType === "Grup";
  const punyaStok = itemType === "Persediaan";
  const dasar = (baseUnit.trim() || (isJasa ? "tindakan" : "pcs")).trim();

  const setUnit = (i: number, patch: Partial<ItemUnit>) =>
    setUnits((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const addUnit = () => setUnits((us) => [...us, { unit: "", factor: 1, sell_price: 0, buy_price: 0 }]);
  const delUnit = (i: number) => setUnits((us) => us.filter((_, j) => j !== i));
  const setGroupComponent = (i: number, patch: Partial<KomponenGrupDraft>) =>
    setGroupComponents((rows) => rows.map((row, j) => j === i ? { ...row, ...patch } : row));
  const addGroupComponent = () => setGroupComponents((rows) => [...rows, {
    component_item_id: "", qty: 1, unit: "", factor: 1,
  }]);
  const delGroupComponent = (i: number) =>
    setGroupComponents((rows) => rows.filter((_, j) => j !== i));

  const gantiJenis = (v: ItemType) => {
    setItemType(v);
    // Satuan default ikut jenis selama belum diutak-atik manual.
    if (v === "Jasa" && baseUnit === "pcs") setBaseUnit("tindakan");
    if (v !== "Jasa" && baseUnit === "tindakan") setBaseUnit("pcs");
    if (v !== "Grup" && tab === "Rincian Grup") setTab("Umum");
  };

  const visibleTabs = isGroup ? TABS : TABS.filter((t) => t !== "Rincian Grup");

  // Isian wajib yang sedang berada di tab tersembunyi bikin tombol Simpan MATI TOTAL:
  // browser menolak submit, lalu gagal menampilkan peringatannya karena field-nya
  // display:none — jadi diklik berkali-kali pun tidak ada reaksi apa pun. Di sini
  // tabnya dipindah dulu ke field yang bermasalah, baru peringatannya dimunculkan.
  const keTabYangBermasalah = (e: React.FormEvent<HTMLFormElement>) => {
    const el = e.target as HTMLInputElement;
    const tujuan = el.closest<HTMLElement>("[data-tab]")?.dataset.tab as Tab | undefined;
    if (!tujuan || tujuan === tab) return; // sudah kelihatan — biarkan browser yang bicara
    setTab(tujuan);
    // Panggilan kedua ini tidak berulang: setelah tab pindah, syarat di atas gagal.
    requestAnimationFrame(() => el.reportValidity?.());
  };

  return (
    <form action={simpanBarang} className="crm-sec" onInvalid={keTabYangBermasalah}>
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <input type="hidden" name="item_type" value={itemType} />
      <input type="hidden" name="units" value={JSON.stringify(isJasa || isGroup ? [] : units)} />
      <input type="hidden" name="tiers" value={JSON.stringify(isJasa || isGroup ? [] : rapikanTingkat(tiers))} />
      <input type="hidden" name="group_components" value={JSON.stringify(isGroup ? groupComponents : [])} />

      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: ".5px solid var(--bd)" }}>
        {visibleTabs.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={tabStyle(tab === t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Umum ───────────────────────────────────────────────────────────── */}
      <div data-tab="Umum" style={{ display: tab === "Umum" ? "block" : "none" }}>
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
          <div style={{ display: punyaStok ? "block" : "none" }}>
            <label className="flab">Masa kadaluarsa</label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, height: 34 }}>
              <input type="checkbox" name="track_expiry" value="1" defaultChecked={editing?.track_expiry ?? false} />
              Barang ini punya tanggal kadaluarsa
            </label>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Kalau dicentang, petugas diminta mengisi tanggalnya saat barang datang, dan barangnya diawasi di{" "}
              <Link href="/pos/expired" style={{ color: "#2563eb" }}>Monitor Expired</Link>.
            </div>
          </div>
        </div>
      </div>

      {/* ── Penjualan / Pembelian ───────────────────────────────────────────── */}
      <div data-tab="Penjualan / Pembelian" style={{ display: tab === "Penjualan / Pembelian" ? "block" : "none" }}>
        <div className="frow">
          <div>
            <label className="flab">Harga jual * <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
            <input className="fi" name="sell_price" type="number" min={0} step="any"
              value={baseSell || ""} onChange={(e) => setBaseSell(Number(e.target.value))} required />
          </div>
          {!isGroup && (
            <div>
              <label className="flab">Harga beli / modal <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
              <input className="fi" name="buy_price" type="number" min={0} step="any" defaultValue={editing?.buy_price ?? 0} />
            </div>
          )}
        </div>

        {/* Satuan berjenjang — tidak relevan untuk jasa (tidak punya stok/kemasan). */}
        {!isJasa && !isGroup && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: ".5px solid var(--bd)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}><i className="ti ti-discount-2" /> Harga bertingkat (beli banyak)</div>
                <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                  Harga per {dasar} kalau belinya minimal sekian. Yang dipakai tingkat tertinggi yang tercapai;
                  di bawah semua tingkat berarti harga normal {rp(baseSell)}.
                </div>
              </div>
              <button type="button" onClick={addTier} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah tingkat
              </button>
            </div>

            {tiers.length === 0 && (
              <div style={{ fontSize: 10.5, color: "var(--td)", padding: "6px 0" }}>
                Belum ada. Semua jumlah pakai harga normal.
              </div>
            )}

            {tiers.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 6 }}>
                <div style={{ width: 150 }}>
                  {i === 0 && <label className="flab">Beli minimal ({dasar})</label>}
                  <input className="fi" type="number" min={1} step="any" value={t.min_qty || ""}
                    onChange={(e) => setTier(i, { min_qty: Number(e.target.value) })} placeholder="12" />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  {i === 0 && <label className="flab">Harga per {dasar}</label>}
                  <input className="fi" type="number" min={0} step="any" value={t.harga || ""}
                    onChange={(e) => setTier(i, { harga: Number(e.target.value) })} placeholder="0" />
                  {baseSell > 0 && Number(t.harga) > 0 && Number(t.harga) < baseSell && (
                    <div style={{ fontSize: 9, color: "#15803d", marginTop: 2 }}>
                      lebih murah {rp(baseSell - Number(t.harga))}/{dasar}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => delTier(i)} className="btn-def"
                  style={{ padding: "4px 9px", fontSize: 10.5, color: "#b91c1c" }}>×</button>
              </div>
            ))}
          </div>
        )}

        {!isJasa && !isGroup && (
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
                    <input className="fi" type="number" min={0} step="any" value={u.sell_price || ""}
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
                    <input className="fi" type="number" min={0} step="any" value={u.buy_price || ""}
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

      {/* ── Rincian Grup ────────────────────────────────────────────────────── */}
      {isGroup && (
        <div data-tab="Rincian Grup" style={{ display: tab === "Rincian Grup" ? "block" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                <i className="ti ti-packages" /> Komponen tetap Grup
              </div>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>
                Harga dijual dari Grup. Stok dan HPP mengikuti komponen Persediaan; kasir tidak dapat mengubah rincian.
              </div>
            </div>
            <button type="button" className="btn-def" onClick={addGroupComponent}
              style={{ padding: "4px 10px", fontSize: 10.5, flexShrink: 0 }}>
              + Tambah komponen
            </button>
          </div>

          {groupComponents.length === 0 && (
            <div style={{ fontSize: 10.5, color: "#b91c1c", padding: "10px 0" }}>
              Grup belum punya komponen. Tambahkan minimal satu sebelum menyimpan.
            </div>
          )}

          {groupComponents.map((row, i) => {
            const item = kandidatGrup.find((candidate) => candidate.id === row.component_item_id);
            const unitOptions = item?.units ?? (row.unit ? [{ unit: row.unit, factor: row.factor }] : []);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 110px 120px 38px", gap: 7, alignItems: "end", marginBottom: 8 }}>
                <div>
                  {i === 0 && <label className="flab">Barang / jasa komponen *</label>}
                  <select className="fi" value={row.component_item_id} required
                    onChange={(e) => {
                      const selected = kandidatGrup.find((candidate) => candidate.id === e.target.value);
                      const firstUnit = selected?.units[0] ?? { unit: "", factor: 1 };
                      setGroupComponent(i, {
                        component_item_id: e.target.value,
                        unit: firstUnit.unit,
                        factor: firstUnit.factor,
                      });
                    }}>
                    <option value="">— pilih komponen —</option>
                    {kandidatGrup.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.code ? `${candidate.code} — ` : ""}{candidate.name} · {candidate.item_type}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  {i === 0 && <label className="flab">Qty *</label>}
                  <input className="fi" type="number" min={0.0001} step="any" required
                    value={row.qty || ""}
                    onChange={(e) => setGroupComponent(i, { qty: Number(e.target.value) })} />
                </div>
                <div>
                  {i === 0 && <label className="flab">Satuan *</label>}
                  <select className="fi" value={row.unit} required
                    onChange={(e) => {
                      const selected = unitOptions.find((unit) => unit.unit === e.target.value);
                      setGroupComponent(i, { unit: e.target.value, factor: selected?.factor ?? 1 });
                    }}>
                    <option value="">— pilih —</option>
                    {unitOptions.map((unit) => (
                      <option key={unit.unit} value={unit.unit}>{unit.unit}</option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn-def" onClick={() => delGroupComponent(i)}
                  style={{ height: 30, padding: 0, color: "#b91c1c" }} title="Hapus komponen">
                  <i className="ti ti-trash" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
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
