"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buatPermintaanKasir } from "../actions";

type Warehouse = { id: string; name: string };
type Item = { id: string; code: string; name: string; unit: string; kategori: string; stok: number };
type Row = { item_id: string; qty_diminta: number; catatan: string };

const today = "2026-07-01";

export function PersediaanBaruForm({
  branchName, warehouses, items, userName,
}: { branchName: string; warehouses: Warehouse[]; items: Item[]; userName: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { item_id: "", qty_diminta: 1, catatan: "" }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // payload dikirim ke server: nama diambil dari master by item_id.
  const payload = rows
    .filter((r) => r.item_id)
    .map((r) => ({ item_id: r.item_id, nama: itemMap[r.item_id]?.name ?? "", qty_diminta: r.qty_diminta, catatan: r.catatan }));
  const totalItem = rows.reduce((a, r) => a + (Number(r.qty_diminta) || 0), 0);

  return (
    <form action={buatPermintaanKasir}>
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {/* Header halaman */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-file-invoice" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", letterSpacing: ".01em" }}>BUAT PERMINTAAN BARANG</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 1 }}>Ajukan permintaan barang ke gudang pusat</div>
          </div>
        </div>
        <Link href="/kasir/persediaan" className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
      </div>

      {/* INFORMASI PERMINTAAN — baris field horizontal */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 12, letterSpacing: ".03em" }}>INFORMASI PERMINTAAN</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <div>
            <label className="flab">Tanggal Permintaan</label>
            <input className="fi" type="date" defaultValue={today} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Dari Toko</label>
            <input className="fi" value={branchName} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Tujuan (Gudang) *</label>
            <select className="fi" name="to_warehouse_id" required defaultValue="">
              <option value="" disabled>Pilih gudang DC</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flab">Prioritas</label>
            <select className="fi" name="priority" defaultValue="normal">
              <option value="normal">Normal</option>
              <option value="tinggi">Tinggi</option>
            </select>
          </div>
          <div>
            <label className="flab">Catatan (Opsional)</label>
            <input className="fi" name="catatan" type="text" placeholder="Contoh: Untuk kebutuhan stok minggu ini" />
          </div>
        </div>
      </div>

      {/* DAFTAR BARANG YANG DIMINTA — tabel item picker */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", letterSpacing: ".03em" }}>DAFTAR BARANG YANG DIMINTA</div>
          <button type="button" onClick={add} className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, borderColor: "var(--posb)", color: "var(--posb)" }}>
            <i className="ti ti-plus" /> Tambah Barang
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Kode</th><th>Nama Barang</th><th>Kategori</th><th>Satuan</th>
                <th style={{ textAlign: "center" }}>Stok Toko</th>
                <th style={{ textAlign: "center", width: 130 }}>Diminta</th>
                <th>Keterangan</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const it = itemMap[r.item_id];
                return (
                  <tr key={i}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{it?.code ?? "—"}</td>
                    <td style={{ minWidth: 200 }}>
                      <select className="fi" value={r.item_id} onChange={(e) => set(i, { item_id: e.target.value })} style={{ fontSize: 11 }}>
                        <option value="">Pilih barang...</option>
                        {items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{it?.kategori ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{it?.unit ?? "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: it && it.stok === 0 ? "#b91c1c" : "var(--tm)" }}>{it?.stok ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <button type="button" className="kpos-qtybtn" onClick={() => set(i, { qty_diminta: Math.max(0, (Number(r.qty_diminta) || 0) - 1) })}>−</button>
                        <input className="fi" type="number" min={0} value={r.qty_diminta}
                          onChange={(e) => set(i, { qty_diminta: Number(e.target.value) })}
                          style={{ width: 48, textAlign: "center", padding: "4px 4px" }} />
                        <button type="button" className="kpos-qtybtn" onClick={() => set(i, { qty_diminta: (Number(r.qty_diminta) || 0) + 1 })}>+</button>
                      </div>
                    </td>
                    <td>
                      <input className="fi" placeholder="mis. stok menipis" value={r.catatan}
                        onChange={(e) => set(i, { catatan: e.target.value })} style={{ fontSize: 11, minWidth: 140 }} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button type="button" onClick={() => del(i)} className="kpos-qtybtn" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} title="Hapus">
                        <i className="ti ti-trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Belum ada barang. Klik &ldquo;Tambah Barang&rdquo; untuk mulai.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: ".5px solid var(--bd)" }}>
          <span style={{ fontSize: 9.5, color: "var(--td)" }}>Baris tanpa barang terpilih diabaikan saat disimpan.</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Total Item <span style={{ color: "var(--posb)", marginLeft: 6 }}>{totalItem} Item</span></span>
        </div>
      </div>

      {/* Footer: dibuat oleh + aksi */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--tm)" }}>Dibuat Oleh</span>
          <input className="fi" value={userName} disabled style={{ background: "var(--sf1)", color: "var(--tm)", width: 220 }} />
        </div>
        <button type="submit" className="pay-btn" style={{ width: "auto", padding: "9px 22px" }}>
          <i className="ti ti-send" /> Kirim Permintaan
        </button>
      </div>
    </form>
  );
}
