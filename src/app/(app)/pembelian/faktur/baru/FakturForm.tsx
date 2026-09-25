"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatFaktur } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

export type PoOption = {
  id: string;
  label: string;
  /** Termin bawaan pemasoknya — jatuh tempo ikut menyesuaikan saat PO dipilih. */
  terminHari: number;
  warning: string | null;
  items: {
    po_item_id: string; item_id: string; nama: string; harga_po: number; sisa: number;
    satuan: string; faktor: number; blockedReason: string | null;
  }[];
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function FakturForm({ options }: { options: PoOption[] }) {
  const today = hariIniWIB();
  const [poId, setPoId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [harga, setHarga] = useState<Record<string, number>>({});
  const [tempo, setTempo] = useState(plusDays(today, 30));

  const po = options.find((o) => o.id === poId);

  const pilihPo = (id: string) => {
    setPoId(id);
    const o = options.find((x) => x.id === id);
    // default: fakturkan semua sisa dengan harga PO — edit yang beda dari faktur pemasok.
    setQty(Object.fromEntries((o?.items ?? []).filter((it) => !it.blockedReason).map((it) => [it.po_item_id, it.sisa])));
    setHarga(Object.fromEntries((o?.items ?? []).filter((it) => !it.blockedReason).map((it) => [it.po_item_id, it.harga_po])));
    setTempo(plusDays(today, o?.terminHari ?? 30));
  };

  const payload = (po?.items ?? [])
    .map((it) => ({
      po_item_id: it.po_item_id,
      qty: Number(qty[it.po_item_id]) || 0,
      harga: Number(harga[it.po_item_id]) || 0,
    }))
    .filter((r) => r.qty > 0);
  const total = payload.reduce((a, r) => a + r.qty * r.harga, 0);

  return (
    <form action={buatFaktur}>
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA FAKTUR" desc="PO sumber, nomor faktur pemasok, tanggal & jatuh tempo." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">PO / Pemasok *</label>
            <select className="fi" value={poId} onChange={(e) => pilihPo(e.target.value)} required>
              <option value="">Pilih PO (Diterima)</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">No. faktur pemasok</label>
            <input className="fi" name="no_faktur_pemasok" placeholder="Nomor di kertas faktur dari pemasok" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="fg" style={{ marginBottom: 10, flex: 1 }}>
              <label className="flab">Tanggal faktur *</label>
              <input className="fi" type="date" name="tanggal" defaultValue={today} required />
            </div>
            <div className="fg" style={{ marginBottom: 10, flex: 1 }}>
              <label className="flab">Jatuh tempo *</label>
              <input className="fi" type="date" name="jatuh_tempo" value={tempo}
                onChange={(e) => setTempo(e.target.value)} required />
            </div>
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2} placeholder="Opsional..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="RINCIAN TAGIHAN" desc="Terisi dari PO — ubah qty/harga sesuai faktur pemasok bila beda." />
          {!po && <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Pilih PO dulu.</div>}
          {po?.warning && (
            <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginBottom: 8 }}>
              <i className="ti ti-alert-triangle" /> {po.warning}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(po?.items ?? []).map((it) => {
              const beda = (Number(harga[it.po_item_id]) || 0) !== it.harga_po;
              return (
                <div key={it.po_item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, fontSize: 11.5 }}>
                    {it.nama}{" "}
                    <span style={{ color: "var(--td)", fontSize: 10.5 }}>
                      PO @ {rp(it.harga_po)}/{it.satuan} · {it.blockedReason ? "sisa belum dapat dihitung" : `sisa ${it.sisa} ${it.satuan}`} · {it.faktor > 0 ? `1 ${it.satuan} = ${it.faktor} unit dasar` : "faktor satuan tidak valid"}
                    </span>
                  </span>
                  {it.blockedReason ? (
                    <span style={{ width: 250, fontSize: 10.5, color: "#92400e" }}>{it.blockedReason}</span>
                  ) : (
                    <>
                      <input className="fi" type="number" min={0} max={it.sisa} step="any"
                        value={qty[it.po_item_id] ?? 0}
                        onChange={(e) => setQty((m) => ({ ...m, [it.po_item_id]: Number(e.target.value) }))}
                        style={{ width: 74 }} title={`Qty faktur dalam ${it.satuan}`} />
                      <input className="fi" type="number" min={0} step="any"
                        value={harga[it.po_item_id] ?? 0}
                        onChange={(e) => setHarga((m) => ({ ...m, [it.po_item_id]: Number(e.target.value) }))}
                        style={{ width: 110, borderColor: beda ? "#f59e0b" : undefined }} title={`Harga faktur per ${it.satuan}`} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {po && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              Total faktur: {rp(total)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc" disabled={!poId || payload.length === 0}>
          <i className="ti ti-file-invoice" /> Simpan faktur
        </button>
      </div>
    </form>
  );
}
