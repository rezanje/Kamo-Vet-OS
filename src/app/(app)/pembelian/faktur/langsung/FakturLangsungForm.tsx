"use client";

import { useMemo, useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB, geserHari } from "@/lib/tanggal";
import { buatFakturLangsung } from "./actions";

type SatuanOpsi = { unit: string; factor: number; buy_price: number };
type ItemOpsi = {
  id: string; code: string; name: string; hargaBeli: number;
  trackExpiry: boolean; satuan: SatuanOpsi[];
};
type Baris = { key: number; item_id: string; qty: number; harga: number; satuan: string; exp_date: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function FakturLangsungForm({
  suppliers, warehouses, items,
}: {
  suppliers: { id: string; nama: string; terminHari: number }[];
  warehouses: { id: string; label: string }[];
  items: ItemOpsi[];
}) {
  const [supplierId, setSupplierId] = useState("");
  const [tanggal, setTanggal] = useState(hariIniWIB());
  const [jatuhTempo, setJatuhTempo] = useState(geserHari(hariIniWIB(), 30));
  const [baris, setBaris] = useState<Baris[]>([{ key: 1, item_id: "", qty: 1, harga: 0, satuan: "", exp_date: "" }]);

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
  const total = isi.reduce((a, r) => a + r.qty * r.harga, 0);
  const payload = isi.map((r) => ({
    item_id: r.item_id, qty: r.qty, harga: r.harga,
    satuan: r.satuan || undefined,
    exp_date: r.exp_date || undefined,
  }));

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
            <label className="flab">Gudang tujuan *</label>
            <select className="fi" name="warehouse_id" required defaultValue="">
              <option value="">— pilih gudang —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">No. faktur pemasok</label>
            <input className="fi" name="no_faktur_pemasok" placeholder="Nomor di kertas fakturnya" />
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
        </div>
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
          Faktur ini khusus <b>barang yang masuk gudang</b>. Tagihan jasa atau biaya
          (listrik, sewa, service) dicatat lewat Buku Besar → Pencatatan Beban.
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
