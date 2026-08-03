"use client";

// Editor baris dokumen penjualan — dipakai Penawaran & Pesanan.
// ponytail: baris dinamis diserialisasi ke satu input hidden JSON, pola sama dgn POForm.

import { useState } from "react";

export type ItemJual = { id: string; code: string; name: string; unit: string; sell_price: number };
type Row = { nama: string; qty: number; harga: number; item_id: string | null; satuan: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const blank: Row = { nama: "", qty: 1, harga: 0, item_id: null, satuan: "" };
const label = (it: ItemJual) => `${it.code} — ${it.name}`;

export function BarisJualForm({ items, listId }: { items: ItemJual[]; listId: string }) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const byLabel = new Map(items.map((it) => [label(it), it]));

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Pilih dari master SKU → harga jual ikut terisi; teks bebas tetap boleh (item_id null,
  // tidak memotong stok saat dikirim).
  const setNama = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, it
      ? { nama: v, item_id: it.id, harga: Number(it.sell_price) || 0, satuan: it.unit ?? "" }
      : { nama: v, item_id: null, satuan: "" });
  };

  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);

  return (
    <>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <datalist id={listId}>
        {items.map((it) => <option key={it.id} value={label(it)} />)}
      </datalist>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Barang / jasa</th>
              <th style={{ width: 90, textAlign: "right" }}>Qty</th>
              <th style={{ width: 80 }}>Satuan</th>
              <th style={{ width: 130, textAlign: "right" }}>Harga</th>
              <th style={{ width: 130, textAlign: "right" }}>Subtotal</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input className="fi" list={listId} value={r.nama}
                    onChange={(e) => setNama(i, e.target.value)}
                    placeholder="ketik atau pilih dari master" style={{ minWidth: 220 }} />
                </td>
                <td>
                  <input className="fi" type="number" min={0} step="any" value={r.qty}
                    onChange={(e) => set(i, { qty: Number(e.target.value) })}
                    style={{ width: 80, textAlign: "right" }} />
                </td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.satuan || "—"}</td>
                <td>
                  <input className="fi" type="number" min={0} step="any" value={r.harga}
                    onChange={(e) => set(i, { harga: Number(e.target.value) })}
                    style={{ width: 120, textAlign: "right" }} />
                </td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>
                  {rp((Number(r.qty) || 0) * (Number(r.harga) || 0))}
                </td>
                <td>
                  <button type="button" className="btn-def"
                    style={{ padding: "3px 8px", fontSize: 10.5 }}
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>Total</td>
              <td style={{ textAlign: "right", fontSize: 12.5, fontWeight: 800 }}>{rp(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button type="button" className="btn-def" style={{ marginTop: 8, fontSize: 11 }}
        onClick={() => setRows((rs) => [...rs, { ...blank }])}>
        + Tambah baris
      </button>
    </>
  );
}
