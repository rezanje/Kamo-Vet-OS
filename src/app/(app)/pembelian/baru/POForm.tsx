"use client";

// ponytail: dynamic item rows serialized to hidden JSON, same pattern as PermintaanForm.

import Link from "next/link";
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { pickUnit, type ItemUnit } from "@/lib/satuan";
import { buatPO } from "../actions";

type Supplier = { id: string; nama: string };
type Warehouse = { id: string; name: string };
type Branch = { id: string; name: string };
export type Item = { id: string; code: string; name: string; unit: string; buy_price: number; units: ItemUnit[] };
type Row = { nama: string; qty: number; harga_beli: number; item_id?: string | null; satuan?: string; faktor?: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { nama: "", qty: 1, harga_beli: 0, item_id: null, satuan: "", faktor: 1 };
const itemLabel = (it: Item) => `${it.code} — ${it.name}`;

export function POForm({
  suppliers,
  warehouses,
  branches,
  items,
}: {
  suppliers: Supplier[];
  warehouses: Warehouse[];
  branches: Branch[];
  items: Item[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const byLabel = new Map(items.map((it) => [itemLabel(it), it]));

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const byId = new Map(items.map((it) => [it.id, it]));
  const unitsOf = (r: Row) => (r.item_id ? byId.get(r.item_id)?.units ?? [] : []);

  // Pilih dari master SKU → link item_id + prefill harga beli; teks bebas tetap boleh (item_id null).
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v);
    const dasar = it?.units[0];
    set(i, it
      ? { nama: v, item_id: it.id, harga_beli: dasar?.buy_price || Number(it.buy_price) || 0, satuan: dasar?.unit ?? it.unit ?? "", faktor: 1 }
      : { nama: v, item_id: null, satuan: "", faktor: 1 });
  };

  // Beli per box → harga beli & faktor ikut satuan yang dipilih.
  const setSatuan = (i: number, r: Row, unit: string) => {
    const u = pickUnit(unitsOf(r), unit);
    if (!u) return;
    set(i, { satuan: u.unit, faktor: u.factor, harga_beli: u.buy_price || r.harga_beli });
  };
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const total = rows.reduce(
    (acc, r) => acc + (Number(r.qty) || 0) * (Number(r.harga_beli) || 0),
    0
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={buatPO}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <datalist id="po-items">
        {items.map((it) => <option key={it.id} value={itemLabel(it)} />)}
      </datalist>

      <div className="grid2">
        {/* Kolom kiri: detail PO */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PO" desc="Supplier, gudang tujuan & cabang." />

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Supplier</label>
            <select className="fi" name="supplier_id">
              <option value="">— Tanpa supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nama}</option>
              ))}
            </select>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Tambah supplier baru di halaman{" "}
              <Link href="/pembelian?tab=supplier" style={{ color: "var(--tm)" }}>Pembelian → Supplier</Link>.
            </div>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang tujuan *</label>
            <select className="fi" name="to_warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Cabang *</label>
            <select className="fi" name="branch_id" required>
              <option value="">Pilih cabang</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal PO</label>
            <input className="fi" type="date" name="tanggal" defaultValue={today} />
          </div>

          {total > 0 && (
            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "var(--bg2, #f9fafb)",
              borderRadius: 6,
              border: ".5px solid var(--bd)",
              fontSize: 13,
              fontWeight: 700,
              display: "flex",
              justifyContent: "space-between",
            }}>
              <span style={{ color: "var(--tm)", fontWeight: 500 }}>Total PO</span>
              <span>{rp(total)}</span>
            </div>
          )}
        </div>

        {/* Kolom kanan: item rows */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader
            num="02"
            title="DAFTAR ITEM"
            desc="Nama barang, jumlah, satuan, & harga beli per satuan."
            action={
              <button
                type="button"
                onClick={add}
                className="btn-def"
                style={{ padding: "4px 10px", fontSize: 10.5 }}
              >
                + Tambah baris
              </button>
            }
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const opts = unitsOf(r);
              const dasar = opts[0]?.unit;
              const faktor = Number(r.faktor) || 1;
              return (
                <div key={i}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      className="fi"
                      list="po-items"
                      placeholder="Kode / nama barang"
                      value={r.nama}
                      onChange={(e) => setNama(i, e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      className="fi"
                      type="number"
                      min={0}
                      step="any"
                      value={r.qty}
                      onChange={(e) => set(i, { qty: Number(e.target.value) })}
                      style={{ width: 62 }}
                      title="Qty"
                      placeholder="Qty"
                    />
                    {/* Satuan berjenjang dari master SKU; item teks bebas tetap tanpa satuan. */}
                    {opts.length > 1 ? (
                      <select
                        className="fi"
                        value={r.satuan || ""}
                        onChange={(e) => setSatuan(i, r, e.target.value)}
                        style={{ width: 74, flexShrink: 0, padding: "3px 5px", fontSize: 10.5 }}
                        title="Satuan beli"
                      >
                        {opts.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                      </select>
                    ) : (
                      <span
                        style={{ width: 74, flexShrink: 0, fontSize: 10.5, color: r.satuan ? "var(--tm)" : "var(--td)" }}
                        title="Satuan (dari master SKU)"
                      >
                        {r.satuan || "—"}
                      </span>
                    )}
                    <input
                      className="fi"
                      type="number"
                      min={0}
                      step="any"
                      value={r.harga_beli}
                      onChange={(e) => set(i, { harga_beli: Number(e.target.value) })}
                      style={{ width: 110 }}
                      title={`Harga beli per ${r.satuan || "satuan"}`}
                      placeholder="Harga beli"
                    />
                    <button
                      type="button"
                      onClick={() => del(i)}
                      className="btn-def"
                      style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0 }}
                      title="Hapus baris"
                    >
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                  {faktor !== 1 && dasar && (
                    <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>
                      Stok masuk {(Number(r.qty) || 0) * faktor} {dasar} ({faktor} {dasar} per {r.satuan})
                      {Number(r.harga_beli) > 0 && ` · modal ≈ ${rp(Number(r.harga_beli) / faktor)}/${dasar}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Pilih dari daftar master SKU agar stok otomatis bertambah saat PO diterima (dan bisa diretur).
            Baris tanpa nama diabaikan.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/pembelian" className="btn-def" style={{ textDecoration: "none" }}>
          Batal
        </Link>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan PO
        </button>
      </div>
    </form>
  );
}
