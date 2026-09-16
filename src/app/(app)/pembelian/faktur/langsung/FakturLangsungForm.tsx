"use client";

import { useMemo, useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { LampiranPicker } from "@/components/LampiranPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB, geserHari } from "@/lib/tanggal";
import { buatFakturLangsung } from "./actions";

type SatuanOpsi = { unit: string; factor: number; buy_price: number };
type ItemOpsi = {
  id: string; code: string; name: string; hargaBeli: number;
  trackExpiry: boolean; satuan: SatuanOpsi[];
};
type Baris = { key: number; item_id: string; qty: number; harga: number; satuan: string; exp_date: string };
type AssetBaris = { key: number; name: string; category_id: string; useful_life_months: number; residual_value: number; price: number; location: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function FakturLangsungForm({
  suppliers, warehouses, items, branches, categories, accounts,
}: {
  suppliers: { id: string; nama: string; terminHari: number }[];
  warehouses: { id: string; label: string }[];
  items: ItemOpsi[];
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  accounts: { id: string; label: string }[];
}) {
  const [supplierId, setSupplierId] = useState("");
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [jatuhTempo, setJatuhTempo] = useState(geserHari(hariIniWIB(), 30));
  const [baris, setBaris] = useState<Baris[]>([{ key: 1, item_id: "", qty: 1, harga: 0, satuan: "", exp_date: "" }]);
  const [aset, setAset] = useState<AssetBaris[]>([]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Jatuh tempo ikut termin pemasok — sama seperti faktur dari PO, supaya umur
  // hutang di layar Hutang tidak selalu meleset.
  const gantiSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    if (s && s.terminHari > 0) setJatuhTempo(geserHari(tanggal, s.terminHari));
  };
  const gantiTanggal = (t: string) => {
    setTanggal(t);
    const s = suppliers.find((x) => x.id === supplierId);
    setJatuhTempo(geserHari(t, s?.terminHari && s.terminHari > 0 ? s.terminHari : 30));
  };

  const set = (key: number, patch: Partial<Baris>) =>
    setBaris((b) => b.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Ganti barang → harga & satuan ikut master, biar tidak perlu diketik ulang.
  const gantiBarang = (key: number, itemId: string) => {
    const it = itemMap.get(itemId);
    const dasar = it?.satuan?.[0];
    set(key, {
      item_id: itemId,
      satuan: dasar?.unit ?? "",
      harga: dasar?.buy_price || it?.hargaBeli || 0,
      exp_date: "",
    });
  };

  const gantiSatuan = (key: number, unit: string) => {
    const r = baris.find((x) => x.key === key);
    const opsi = r ? itemMap.get(r.item_id)?.satuan.find((o) => o.unit === unit) : undefined;
    set(key, { satuan: unit, ...(opsi && opsi.buy_price > 0 ? { harga: opsi.buy_price } : {}) });
  };

  const isi = baris.filter((r) => r.item_id && r.qty > 0);
  const total = isi.reduce((a, r) => a + r.qty * r.harga, 0) + aset.reduce((a, r) => a + Math.max(0, r.price), 0);
  const payload = [...isi.map((r) => ({
    kind: "stock", item_id: r.item_id, qty: r.qty, price: r.harga,
    satuan: r.satuan || undefined,
    unit: r.satuan || undefined, expiry_date: r.exp_date || undefined,
  })), ...aset.filter((r) => r.name && r.category_id && r.price > 0).map((r) => ({
    kind: "fixed_asset", name: r.name, category_id: r.category_id,
    useful_life_months: r.useful_life_months, residual_value: r.residual_value,
    price: r.price, location: r.location,
  }))];
  const setAsset = (key: number, patch: Partial<AssetBaris>) => setAset((rows) => rows.map((r) => r.key === key ? { ...r, ...patch } : r));

  return (
    <form action={buatFakturLangsung}>
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="DATA FAKTUR"
          desc="Pembelian tanpa PO. Barang langsung masuk gudang yang dipilih, dan utang ke pemasok langsung tercatat."
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <div className="fg">
            <label className="flab">Pemasok *</label>
            <select className="fi" name="supplier_id" required value={supplierId}
              onChange={(e) => gantiSupplier(e.target.value)}>
              <option value="">— pilih pemasok —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">Gudang tujuan (wajib bila ada stok)</label>
            <select className="fi" name="warehouse_id" defaultValue="">
              <option value="">— tanpa gudang (aset saja) —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </div>
          <div className="fg"><label className="flab">Cabang/lokasi *</label><select className="fi" name="branch_id" required defaultValue=""><option value="">— pilih cabang —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div className="fg"><label className="flab">Sumber pembayaran *</label><select className="fi" name="funding" required defaultValue="accounts_payable"><option value="accounts_payable">Hutang Usaha</option><option value="cash">Kas</option><option value="bank">Bank</option></select></div>
          <div className="fg"><label className="flab">Rekening Kas/Bank</label><select className="fi" name="account_id" defaultValue=""><option value="">— sesuai peta pembayaran —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
          <div className="fg">
            <label className="flab">No. faktur pemasok</label>
            <input className="fi" name="no_faktur_pemasok" placeholder="Nomor di kertas fakturnya" />
          </div>
          {/* Surat jalan (permintaan Bu Nisa, meeting 14 Agustus): pembelian lewat PO
              menyimpannya di dokumen penerimaan, pembelian langsung dulu tidak punya
              tempat sama sekali. */}
          <div className="fg">
            <label className="flab">No. surat jalan</label>
            <input className="fi" name="surat_jalan" maxLength={60} placeholder="Nomor di surat jalannya" />
          </div>
          <div className="fg">
            <label className="flab">Tanggal faktur *</label>
            <input className="fi" type="date" name="tanggal" required value={tanggal}
              onChange={(e) => gantiTanggal(e.target.value)} />
          </div>
          <div className="fg">
            <label className="flab">Jatuh tempo *</label>
            <input className="fi" type="date" name="jatuh_tempo" required value={jatuhTempo}
              onChange={(e) => setJatuhTempo(e.target.value)} />
          </div>
          <div className="fg" style={{ gridColumn: "span 2" }}>
            <label className="flab">Keterangan</label>
            <input className="fi" name="keterangan" placeholder="Opsional" />
          </div>
          <div className="fg" style={{ gridColumn: "span 2" }}>
            <label className="flab">Lampiran surat jalan / nota</label>
            <LampiranPicker folder="pembelian" />
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="03" title="ASET TETAP" desc="Setiap baris membuat satu aset individual dan tidak menambah stok." />
        {aset.map((r) => <div key={r.key} className="frow" style={{ marginBottom: 10 }}>
          <div><label className="flab">Nama aset</label><input className="fi" value={r.name} onChange={(e) => setAsset(r.key, { name: e.target.value })} /></div>
          <div><label className="flab">Kategori</label><select className="fi" value={r.category_id} onChange={(e) => setAsset(r.key, { category_id: e.target.value })}><option value="">— pilih —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="flab">Umur (bulan)</label><input className="fi" type="number" min={1} value={r.useful_life_months} onChange={(e) => setAsset(r.key, { useful_life_months: Number(e.target.value) })} /></div>
          <div><label className="flab">Harga</label><input className="fi" type="number" min={1} value={r.price} onChange={(e) => setAsset(r.key, { price: Number(e.target.value) })} /></div>
          <div><label className="flab">Nilai sisa</label><input className="fi" type="number" min={0} value={r.residual_value} onChange={(e) => setAsset(r.key, { residual_value: Number(e.target.value) })} /></div>
          <div><label className="flab">Lokasi fisik</label><input className="fi" value={r.location} onChange={(e) => setAsset(r.key, { location: e.target.value })} /></div>
          <button type="button" className="btn-def" onClick={() => setAset((rows) => rows.filter((x) => x.key !== r.key))}>Hapus</button>
        </div>)}
        <button type="button" className="btn-def" onClick={() => setAset((rows) => [...rows, { key: Math.max(0, ...rows.map((x) => x.key)) + 1, name: "", category_id: "", useful_life_months: 48, residual_value: 0, price: 0, location: "" }])}><i className="ti ti-plus" /> Tambah baris aset</button>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="BARANG YANG DIBELI"
          desc="Isi jumlah yang benar-benar diterima. Stok bertambah persis sebanyak ini."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ width: 120 }}>Satuan</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 130 }}>Harga beli</th>
                <th style={{ width: 140 }}>Kadaluarsa</th>
                <th style={{ width: 110, textAlign: "right" }}>Subtotal</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {baris.map((r) => {
                const it = itemMap.get(r.item_id);
                return (
                  <tr key={r.key}>
                    <td>
                      <select className="fi" value={r.item_id} onChange={(e) => gantiBarang(r.key, e.target.value)}>
                        <option value="">— pilih barang —</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
                      </select>
                    </td>
                    <td>
                      {it && it.satuan.length > 1 ? (
                        <select className="fi" value={r.satuan} onChange={(e) => gantiSatuan(r.key, e.target.value)}>
                          {it.satuan.map((o) => (
                            <option key={o.unit} value={o.unit}>
                              {o.unit}{o.factor > 1 ? ` (isi ${o.factor})` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--tm)" }}>{r.satuan || "—"}</span>
                      )}
                    </td>
                    <td>
                      <input className="fi" type="number" min={0} step="any" value={r.qty}
                        onChange={(e) => set(r.key, { qty: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="fi" type="number" min={0} step="any" value={r.harga}
                        onChange={(e) => set(r.key, { harga: Number(e.target.value) })} />
                    </td>
                    <td>
                      {it?.trackExpiry ? (
                        <input className="fi" type="date" value={r.exp_date}
                          onChange={(e) => set(r.key, { exp_date: e.target.value })} />
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--td)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(r.qty * r.harga)}</td>
                    <td style={{ textAlign: "center" }}>
                      {baris.length > 1 && (
                        <i className="ti ti-x" title="Hapus baris"
                          style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }}
                          onClick={() => setBaris((b) => b.filter((x) => x.key !== r.key))} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn-def"
            onClick={() => setBaris((b) => [...b, { key: Math.max(0, ...b.map((x) => x.key)) + 1, item_id: "", qty: 1, harga: 0, satuan: "", exp_date: "" }])}>
            <i className="ti ti-plus" /> Tambah baris
          </button>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total faktur: {rp(total)}</span>
        </div>

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Baris barang menambah stok gudang; baris aset membuat aset individual tanpa memengaruhi stok.
          Tagihan jasa atau biaya dicatat lewat Buku Besar → Pencatatan Beban.
          Isi tanggal kadaluarsa untuk barang bermasa simpan — kalau dikosongkan,
          barangnya tidak akan muncul di Monitor Kadaluarsa.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <SubmitButton className="btn-acc" disabled={payload.length === 0 || total <= 0}>
            <i className="ti ti-device-floppy" /> Simpan faktur &amp; terima barang
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
