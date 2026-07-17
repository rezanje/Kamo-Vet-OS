"use client";

import { useState } from "react";
import { addRacikan } from "@/app/(app)/klinik/racik/actions";

type ItemLite = { id: string; name: string; unit: string; sell_price: number; stok: number };
type Bahan = { item_id: string; nama: string; qty: number; satuan: string; harga: number };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Builder racikan ringkas — field & alur sama seperti tab "Racikan" di form pemeriksaan,
// tapi berdiri sendiri utk nambah racikan setelah rekam medis tersimpan (recorded view).
export function RacikanInline({ visitId, medicalRecordId, bahanItems }: {
  visitId: string; medicalRecordId: string; bahanItems: ItemLite[];
}) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [form, setForm] = useState("sirup");
  const [aturan, setAturan] = useState("");
  const [search, setSearch] = useState("");
  const [bahan, setBahan] = useState<Bahan[]>([]);

  const filtered = search.trim()
    ? bahanItems.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : bahanItems;
  const subtotal = bahan.reduce((a, b) => a + b.qty * b.harga, 0);

  const addBahan = (it: ItemLite) => {
    if (bahan.some((b) => b.item_id === it.id)) return;
    setBahan([...bahan, { item_id: it.id, nama: it.name, qty: 1, satuan: it.unit, harga: it.sell_price }]);
  };
  const setQty = (id: string, qty: number) => setBahan(bahan.map((b) => (b.item_id === id ? { ...b, qty } : b)));
  const delBahan = (id: string) => setBahan(bahan.filter((b) => b.item_id !== id));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acc"
        style={{ padding: "4px 10px", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <i className="ti ti-plus" /> Racikan baru
      </button>
    );
  }

  return (
    <form action={addRacikan} style={{ display: "flex", flexDirection: "column", gap: 8, border: ".5px solid var(--bd)", borderRadius: 10, padding: 12, marginTop: 4 }}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="medicalRecordId" value={medicalRecordId} />
      <input type="hidden" name="ingredients" value={JSON.stringify(bahan)} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#7c3aed" }}><i className="ti ti-flask" /> Racikan baru</span>
        <i className="ti ti-x" onClick={() => setOpen(false)} style={{ cursor: "pointer", color: "var(--td)", fontSize: 14 }} />
      </div>

      <input className="fi" name="recipe_name" placeholder="Nama racikan (mis. Puyer Batuk)" value={nama} onChange={(e) => setNama(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <select className="fi" name="dosage_form" value={form} onChange={(e) => setForm(e.target.value)} style={{ fontSize: 11.5 }}>
          {["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input className="fi" name="aturan_pakai" placeholder="Aturan pakai (opsional)" value={aturan} onChange={(e) => setAturan(e.target.value)} />
      </div>

      <div style={{ position: "relative" }}>
        <input className="fi" placeholder="Cari bahan baku..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingRight: 28 }} />
        <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
      </div>
      <div style={{ maxHeight: 140, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
        {bahanItems.length === 0 && <div style={{ fontSize: 10.5, color: "var(--td)", padding: "8px 10px" }}>Belum ada bahan baku. Tandai di menu Kelola Bahan Baku.</div>}
        {filtered.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderBottom: ".5px solid var(--bd)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500 }}>{it.name}</div>
              <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Stok {it.stok} {it.unit} · {rp(it.sell_price)}</div>
            </div>
            <button type="button" onClick={() => addBahan(it)} className="btn-acc" style={{ padding: "2px 7px", fontSize: 11, background: "#16a34a" }}><i className="ti ti-plus" /></button>
          </div>
        ))}
      </div>

      {bahan.length > 0 && (
        <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 8 }}>
          {bahan.map((b) => (
            <div key={b.item_id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.nama}</span>
              <input className="fi" type="number" min={1} value={b.qty} onChange={(e) => setQty(b.item_id, Number(e.target.value))} style={{ width: 46, padding: "2px 4px", textAlign: "center", fontSize: 10.5 }} />
              <span style={{ fontSize: 10, color: "var(--tm)" }}>{b.satuan}</span>
              <span style={{ fontSize: 10.5, width: 62, textAlign: "right" }}>{rp(b.qty * b.harga)}</span>
              <i className="ti ti-x" onClick={() => delBahan(b.item_id)} style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: ".5px solid var(--bd)", paddingTop: 5, marginTop: 3, fontSize: 11.5, fontWeight: 700 }}>
            <span>Estimasi</span><span style={{ color: "#2563eb" }}>{rp(subtotal)}</span>
          </div>
        </div>
      )}

      <button type="submit" disabled={!nama.trim() || bahan.length === 0}
        className="btn-acc" style={{ justifyContent: "center", background: "#2563eb", opacity: (!nama.trim() || bahan.length === 0) ? .5 : 1 }}>
        <i className="ti ti-plus" /> Simpan racikan
      </button>
    </form>
  );
}
