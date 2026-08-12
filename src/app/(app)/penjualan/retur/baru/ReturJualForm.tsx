"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatReturJual } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

type Row = {
  item_id: string; nama: string; harga: number; sisa: number;
  /** Barang berstok? Jasa tidak punya kondisi barang. */
  berstok?: boolean;
  /** Barang yang dipantau kadaluarsanya — hanya ini yang butuh isian tanggal. */
  trackExpiry?: boolean;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function ReturJualForm({
  saleId, info, rows, dari, lockBranchId,
}: {
  saleId: string; info: string; rows: Row[];
  // "kasir" = dipakai dari layar POS: redirect & pembatasan cabang ikut kasir.
  dari?: "kasir"; lockBranchId?: string;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [kondisi, setKondisi] = useState<Record<string, string>>({});
  const [exp, setExp] = useState<Record<string, string>>({});

  const payload = rows
    .map((r) => ({
      item_id: r.item_id,
      qty: Number(qty[r.item_id]) || 0,
      kondisi: r.berstok === false ? "baik" : (kondisi[r.item_id] ?? "baik"),
      exp_date: exp[r.item_id] || undefined,
    }))
    .filter((r) => r.qty > 0);
  const total = rows.reduce((a, r) => a + (Number(qty[r.item_id]) || 0) * r.harga, 0);
  const adaRusak = payload.some((r) => r.kondisi === "rusak");

  return (
    <form action={buatReturJual}>
      <input type="hidden" name="sale_id" value={saleId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      {dari && <input type="hidden" name="dari" value={dari} />}
      {lockBranchId && <input type="hidden" name="lock_branch_id" value={lockBranchId} />}

      <div className="crm-sec">
        <SecHeader num="02" title="RINCIAN BARANG" desc={`Struk ${info}. Isi qty yang dikembalikan.`} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 220px))", gap: 10, marginBottom: 10 }}>
          <div className="fg">
            <label className="flab">Tanggal retur *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <input className="fi" name="keterangan" placeholder="Alasan retur (opsional)" />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const dipilih = (Number(qty[r.item_id]) || 0) > 0;
            const kond = kondisi[r.item_id] ?? "baik";
            const punyaStok = r.berstok !== false;
            return (
              <div key={r.item_id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 140, fontSize: 11.5 }}>
                  {r.nama} <span style={{ color: "var(--td)", fontSize: 10.5 }}>@{rp(r.harga)}</span>
                </span>
                <span style={{ fontSize: 10.5, color: "var(--tm)" }}>maks {r.sisa}</span>
                <input className="fi" type="number" min={0} max={r.sisa} step="any"
                  value={qty[r.item_id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [r.item_id]: Number(e.target.value) }))}
                  style={{ width: 90 }} title="Qty retur" />

                {/* Kondisi menentukan nasib barangnya: yang rusak TIDAK kembali ke rak.
                    Jasa tidak punya stok, jadi tidak perlu ditanya. */}
                {dipilih && punyaStok && (
                  <select className="fi" style={{ width: 150 }} title="Kondisi barang"
                    value={kond}
                    onChange={(e) => setKondisi((k) => ({ ...k, [r.item_id]: e.target.value }))}>
                    <option value="baik">Bisa dijual lagi</option>
                    <option value="rusak">Rusak / kadaluarsa</option>
                  </select>
                )}

                {dipilih && punyaStok && kond === "baik" && r.trackExpiry && (
                  <input className="fi" type="date" style={{ width: 150 }}
                    title="Tanggal kadaluarsa barang yang kembali"
                    value={exp[r.item_id] ?? ""}
                    onChange={(e) => setExp((x) => ({ ...x, [r.item_id]: e.target.value }))} />
                )}
              </div>
            );
          })}
        </div>

        {rows.some((r) => r.berstok !== false && r.trackExpiry) && (
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
            Isi tanggal kadaluarsa untuk barang yang kembali dijual — kalau dikosongkan,
            barang itu tidak akan muncul di Monitor Kadaluarsa.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "var(--tm)" }}>
            Refund tunai dicatat sebagai pengeluaran kasir (kategori Retur Penjualan).
            {adaRusak && " Barang rusak/kadaluarsa tidak dikembalikan ke stok jualan — uangnya tetap kembali penuh."}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Total refund: {rp(total)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="submit" className="btn-acc" disabled={payload.length === 0}>
            <i className="ti ti-receipt-refund" /> Simpan retur & refund
          </button>
        </div>
      </div>
    </form>
  );
}
