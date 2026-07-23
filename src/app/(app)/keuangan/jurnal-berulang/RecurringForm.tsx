"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatRecurring } from "./actions";

type Account = { code: string; name: string };
type Branch = { id: string; name: string };
type Row = { code: string; debit: number; credit: number };

const blank: Row = { code: "", debit: 0, credit: 0 };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function RecurringForm({ accounts, branches }: { accounts: Account[]; branches: Branch[] }) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }, { ...blank }]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 2 ? rs.filter((_, j) => j !== i) : rs));

  const totalD = rows.reduce((a, r) => a + (Number(r.debit) || 0), 0);
  const totalK = rows.reduce((a, r) => a + (Number(r.credit) || 0), 0);
  const seimbang = totalD > 0 && Math.round(totalD) === Math.round(totalK);

  return (
    <form action={buatRecurring}>
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div className="crm-sec">
        <SecHeader num="02" title="BUAT JURNAL BERULANG" desc="Jurnal langganan (sewa, iuran, dsb) yang otomatis diposting tiap bulan pada tanggal terpilih." />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div className="fg" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
            <label className="flab">Nama *</label>
            <input className="fi" name="nama" placeholder="Mis. Sewa ruko bulanan" required />
          </div>
          <div className="fg" style={{ width: 110, marginBottom: 0 }}>
            <label className="flab">Tgl posting *</label>
            <input className="fi" type="number" name="day_of_month" min={1} max={28} defaultValue={1} required />
          </div>
          <div className="fg" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="branch_id">
              <option value="">— Pusat / tanpa cabang —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="fg" style={{ marginBottom: 10 }}>
          <label className="flab">Deskripsi</label>
          <input className="fi" name="deskripsi" placeholder="Opsional" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <select className="fi" value={r.code} onChange={(e) => set(i, { code: e.target.value })} style={{ flex: 1 }}>
                <option value="">Pilih akun</option>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
              <input className="fi" type="number" min={0} step="any" placeholder="Debit" value={r.debit || ""}
                onChange={(e) => set(i, { debit: Number(e.target.value), credit: 0 })} style={{ width: 130 }} />
              <input className="fi" type="number" min={0} step="any" placeholder="Kredit" value={r.credit || ""}
                onChange={(e) => set(i, { credit: Number(e.target.value), debit: 0 })} style={{ width: 130 }} />
              <button type="button" onClick={() => del(i)} className="btn-def" style={{ padding: "0 9px", color: "#b91c1c" }}>
                <i className="ti ti-trash" />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
            + Tambah baris
          </button>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: seimbang ? "#15803d" : "#b91c1c" }}>
            D {rp(totalD)} · K {rp(totalK)} {seimbang ? "✓" : "(harus seimbang)"}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="submit" className="btn-acc" disabled={!seimbang}>
            <i className="ti ti-repeat" /> Simpan jurnal berulang
          </button>
        </div>
      </div>
    </form>
  );
}
