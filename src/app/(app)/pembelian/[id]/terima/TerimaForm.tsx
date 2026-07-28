"use client";

// ponytail: qty diterima default = qty PO; user tinggal ubah baris yang tidak sesuai.

import Link from "next/link";
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { terimaBarang } from "../../actions";

export type BarisPO = {
  id: string;
  nama: string;
  qty: number;
  harga_beli: number;
  satuan: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function TerimaForm({
  poId,
  noPo,
  supplier,
  gudang,
  totalPO,
  rows,
}: {
  poId: string;
  noPo: string;
  supplier: string;
  gudang: string;
  totalPO: number;
  rows: BarisPO[];
}) {
  const [terima, setTerima] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.id, r.qty])),
  );

  const qtyOf = (r: BarisPO) => Number(terima[r.id]) || 0;
  const totalTerima = rows.reduce((a, r) => a + qtyOf(r) * r.harga_beli, 0);
  const selisih = totalTerima - totalPO;
  const today = new Date().toISOString().slice(0, 10);

  const payload = rows.map((r) => ({ id: r.id, qty_terima: qtyOf(r) }));

  return (
    <form action={terimaBarang}>
      <input type="hidden" name="id" value={poId} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PENERIMAAN BARANG"
          desc={`${noPo} · ${supplier} · masuk gudang ${gudang}.`}
        />

        <div className="fg" style={{ marginBottom: 12, maxWidth: 220 }}>
          <label className="flab">Tanggal terima</label>
          <input className="fi" type="date" name="tanggal" defaultValue={today} />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ textAlign: "right" }}>Qty PO</th>
                <th style={{ textAlign: "right" }}>Qty Diterima</th>
                <th>Satuan</th>
                <th style={{ textAlign: "right" }}>Harga</th>
                <th style={{ textAlign: "right" }}>Subtotal</th>
                <th>Selisih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const q = qtyOf(r);
                const beda = q - r.qty;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.nama}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, color: "var(--tm)" }}>{r.qty}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="fi"
                        type="number"
                        min={0}
                        step="any"
                        value={terima[r.id] ?? 0}
                        onChange={(e) =>
                          setTerima((t) => ({ ...t, [r.id]: Number(e.target.value) }))
                        }
                        style={{ width: 80, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.satuan || "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(r.harga_beli)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(q * r.harga_beli)}</td>
                    <td style={{ fontSize: 10.5, color: beda === 0 ? "var(--td)" : beda < 0 ? "#b91c1c" : "#b45309" }}>
                      {beda === 0 ? "sesuai" : `${beda > 0 ? "+" : ""}${beda} ${r.satuan}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 6,
            border: ".5px solid var(--bd)", background: "var(--bg2, #f9fafb)",
            display: "flex", justifyContent: "space-between", fontSize: 12.5,
          }}
        >
          <span style={{ color: "var(--tm)" }}>
            Nilai PO {rp(totalPO)} → nilai diterima
          </span>
          <span style={{ fontWeight: 700 }}>
            {rp(totalTerima)}
            {selisih !== 0 && (
              <span style={{ fontWeight: 500, color: selisih < 0 ? "#b91c1c" : "#b45309", marginLeft: 8 }}>
                ({selisih > 0 ? "+" : "−"}{rp(Math.abs(selisih))})
              </span>
            )}
          </span>
        </div>

        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
          Stok & jurnal penerimaan (Dr Persediaan / Cr Hutang Belum Difakturkan) memakai qty diterima,
          bukan qty PO. Faktur pembelian & retur nanti dibatasi qty diterima ini.
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Link href="/pembelian" className="btn-def" style={{ textDecoration: "none" }}>
          Batal
        </Link>
        <button type="submit" className="btn-acc">
          <i className="ti ti-package-import" /> Simpan penerimaan
        </button>
      </div>
    </form>
  );
}
