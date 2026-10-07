"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatReturJual } from "../actions";
import { type ReturnFormRow } from "@/lib/return-source-units";
import { usePreservedAction } from "@/components/LocalTransactionDraft";
import { draftRecord, draftNumber, draftString } from "@/components/TransactionDraft";
import { PostingRequestIdentity } from "@/components/PostingRequestIdentity";
import { hariIniWIB } from "@/lib/tanggal";

type Row = ReturnFormRow;

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function ReturJualForm({
  saleId, info, rows, dari, lockBranchId, userId, confirmedScope, confirmedKey,
}: {
  confirmedScope?:string; confirmedKey?:string; userId?: string; saleId: string; info: string; rows: Row[];
  // "kasir" = dipakai dari layar POS: redirect & pembatasan cabang ikut kasir.
  dari?: "kasir"; lockBranchId?: string;
}) {
  const {save,failure}=usePreservedAction(buatReturJual);
  const [unit, setUnit] = useState<Record<string, string>>({});
  const chosen = (r: Row) => r.units.find(u => u.unit === unit[r.source_line_id]) ?? r.units[0];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [kondisi, setKondisi] = useState<Record<string, string>>({});
  const [exp, setExp] = useState<Record<string, string>>({});

  const payload = rows
    .map((r) => ({
      item_id: r.item_id, source_line_id: r.source_line_id, satuan: chosen(r)?.unit,
      qty: Number(qty[r.source_line_id]) || 0,
      kondisi: r.berstok === false ? "baik" : (kondisi[r.source_line_id] ?? "baik"),
      exp_date: exp[r.source_line_id] || undefined,
    }))
    .filter((r) => r.qty > 0);
  const total = rows.reduce((a, r) => a + (Number(qty[r.source_line_id]) || 0) * (chosen(r)?.factor ?? 1) * r.harga, 0);
  const adaRusak = payload.some((r) => r.kondisi === "rusak");

  return (
    <form action={save}>
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <PostingRequestIdentity scope={`sales-return:${saleId}`} userId={userId} confirmedScope={confirmedScope} confirmedKey={confirmedKey} state={{snapshot:{qty,unit,kondisi,exp},reset:()=>{setQty({});setUnit({});setKondisi({});setExp({});},restore:value=>{
        if(!draftRecord(value.qty,draftNumber)||!draftRecord(value.unit,draftString)||!draftRecord(value.kondisi,draftString)||!draftRecord(value.exp,draftString))return false;
        setQty(value.qty);setUnit(value.unit);setKondisi(value.kondisi);setExp(value.exp);return true;
      }}} />
      <input type="hidden" name="source_ref" value={info.split(" — ")[0]} />
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
            const qtyDipilih = Number(qty[r.source_line_id]) || 0;
            const dipilih = qtyDipilih > 0;
            const kond = kondisi[r.source_line_id] ?? "baik";
            const punyaStok = r.berstok !== false;
            return (
              <div key={r.source_line_id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 140, fontSize: 11.5 }}>
                  {r.nama} <small style={{color:"var(--td)"}}>({r.source_qty} {r.source_unit})</small> <span style={{ color: "var(--td)", fontSize: 10.5 }}>@{rp(r.harga * (chosen(r)?.factor ?? 1))}</span>
                  {r.components?.map((component) => (
                    <span key={`${component.component_item_id}:${component.unit}`} style={{ display: "block", paddingLeft: 10, fontSize: 9.5, color: "var(--td)" }}>
                      ↳ {dipilih ? qtyDipilih * component.qty_per_group : component.qty_per_group} {component.unit} {component.component_name}
                      {!dipilih && " / Grup"}
                    </span>
                  ))}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--tm)" }}>maks {r.sisa / (chosen(r)?.factor ?? 1)} {chosen(r)?.unit}</span>
                <select className="fi" title="Satuan retur" value={chosen(r)?.unit ?? ""} onChange={e => setUnit(u => ({...u, [r.source_line_id]: e.target.value}))}>
                  {r.units.map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                </select>
                <input className="fi" type="number" min={0} max={r.sisa / (chosen(r)?.factor ?? 1)} step="any"
                  value={qty[r.source_line_id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [r.source_line_id]: Number(e.target.value) }))}
                  style={{ width: 90 }} title="Qty retur" />

                {/* Kondisi menentukan nasib barangnya: yang rusak TIDAK kembali ke rak.
                    Jasa tidak punya stok, jadi tidak perlu ditanya. */}
                {dipilih && punyaStok && (
                  <select className="fi" style={{ width: 150 }} title="Kondisi barang"
                    value={kond}
                    onChange={(e) => setKondisi((k) => ({ ...k, [r.source_line_id]: e.target.value }))}>
                    <option value="baik">Bisa dijual lagi</option>
                    <option value="rusak">Rusak / kadaluarsa</option>
                  </select>
                )}

                {dipilih && punyaStok && kond === "baik" && r.trackExpiry && (
                  <input className="fi" type="date" style={{ width: 150 }}
                    title="Tanggal kadaluarsa barang yang kembali"
                    value={exp[r.source_line_id] ?? ""}
                    onChange={(e) => setExp((x) => ({ ...x, [r.source_line_id]: e.target.value }))} />
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
