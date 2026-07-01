"use client";

// ponytail: dynamic item rows serialized to hidden JSON, same pattern as PermintaanForm.

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatPO } from "../actions";

type Supplier = { id: string; nama: string };
type Warehouse = { id: string; name: string };
type Branch = { id: string; name: string };
type Row = { nama: string; qty: number; harga_beli: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { nama: "", qty: 1, harga_beli: 0 };

export function POForm({
  suppliers,
  warehouses,
  branches,
}: {
  suppliers: Supplier[];
  warehouses: Warehouse[];
  branches: Branch[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
              <a href="/pembelian?tab=supplier" style={{ color: "var(--tm)" }}>Pembelian → Supplier</a>.
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
            desc="Nama barang, jumlah, & harga beli per unit."
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
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="fi"
                  placeholder="Nama barang"
                  value={r.nama}
                  onChange={(e) => set(i, { nama: e.target.value })}
                  style={{ flex: 2 }}
                />
                <input
                  className="fi"
                  type="number"
                  min={0}
                  step="any"
                  value={r.qty}
                  onChange={(e) => set(i, { qty: Number(e.target.value) })}
                  style={{ width: 70 }}
                  title="Qty"
                  placeholder="Qty"
                />
                <input
                  className="fi"
                  type="number"
                  min={0}
                  step="any"
                  value={r.harga_beli}
                  onChange={(e) => set(i, { harga_beli: Number(e.target.value) })}
                  style={{ width: 110 }}
                  title="Harga beli"
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
            ))}
          </div>

          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris tanpa nama barang akan diabaikan. Item linked ke master katalog bisa diisi setelah PO diterima.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <a href="/pembelian" className="btn-def" style={{ textDecoration: "none" }}>
          Batal
        </a>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan PO
        </button>
      </div>
    </form>
  );
}
