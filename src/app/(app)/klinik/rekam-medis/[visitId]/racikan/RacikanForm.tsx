"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { createCompounding } from "@/app/(app)/klinik/racik/actions";
import { DOSAGE_FORMS } from "@/lib/compounding";

type Ing = { ingredient_name: string; item_id: string | null; quantity: number; unit: string };
export type ItemOpt = { id: string; name: string; unit: string };

export function RacikanForm({ visitId, medicalRecordId, items }: {
  visitId: string; medicalRecordId: string; items: ItemOpt[];
}) {
  const [ings, setIngs] = useState<Ing[]>([{ ingredient_name: "", item_id: null, quantity: 1, unit: "pcs" }]);

  const set = (i: number, patch: Partial<Ing>) => setIngs((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setIngs((rs) => [...rs, { ingredient_name: "", item_id: null, quantity: 1, unit: "pcs" }]);
  const del = (i: number) => setIngs((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const pickItem = (i: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (it) set(i, { item_id: it.id, ingredient_name: it.name, unit: it.unit });
    else set(i, { item_id: null });
  };

  return (
    <form action={createCompounding}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="medicalRecordId" value={medicalRecordId} />
      <input type="hidden" name="ingredients" value={JSON.stringify(ings)} />

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA RACIKAN" desc="Nama, aturan pakai, bentuk sediaan, petunjuk racik." />

          <label className="flab">Nama racikan *</label>
          <input className="fi" name="recipe_name" required placeholder="mis. Mix Sirup" style={{ marginBottom: 10 }} />

          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Aturan pakai *</label>
              <input className="fi" name="dosage_instruction" required placeholder="mis. 2x sehari 1 sendok" />
            </div>
            <div>
              <label className="flab">Jumlah racikan *</label>
              <input className="fi" name="total_volume" required placeholder="mis. 60 ml" />
            </div>
          </div>

          <label className="flab">Bentuk sediaan *</label>
          <select className="fi" name="dosage_form" required defaultValue="sirup" style={{ marginBottom: 10 }}>
            {DOSAGE_FORMS.map((f) => <option key={f} value={f} style={{ textTransform: "capitalize" }}>{f}</option>)}
          </select>

          <label className="flab">Petunjuk racik (satu langkah per baris) *</label>
          <textarea className="fi" name="compounding_steps" required rows={5}
            placeholder={"1. Haluskan CTM 4 mg, larutkan dengan sedikit air matang.\n2. Tambahkan Mix Sirup, aduk rata.\n3. Kocok hingga homogen."} />
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="KOMPOSISI BAHAN" desc="Bahan + takaran — stok bahan terpotong otomatis saat disimpan."
            action={<button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>+ Tambah bahan</button>} />

          <table className="tbl">
            <thead>
              <tr><th>Bahan (link inventory opsional)</th><th style={{ width: 70, textAlign: "center" }}>Qty</th><th style={{ width: 80 }}>Satuan</th><th style={{ width: 28 }} /></tr>
            </thead>
            <tbody>
              {ings.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input className="fi" list="racik-items" value={r.ingredient_name} placeholder="Nama bahan / pilih dari inventory"
                      onChange={(e) => {
                        const it = items.find((x) => x.name === e.target.value);
                        if (it) pickItem(i, it.id);
                        else set(i, { ingredient_name: e.target.value, item_id: null });
                      }} />
                  </td>
                  <td><input className="fi" type="number" min={0.01} step={0.01} value={r.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} style={{ textAlign: "center" }} /></td>
                  <td><input className="fi" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder="ml / tablet" /></td>
                  <td style={{ textAlign: "center" }}>
                    <button type="button" onClick={() => del(i)} className="back-btn" style={{ color: "#b91c1c" }} title="Hapus"><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="racik-items">
            {items.map((it) => <option key={it.id} value={it.name} />)}
          </datalist>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Bahan yang cocok dengan inventory otomatis memotong stok cabang (Addendum §2).
          </div>

          <SubmitButton className="pay-btn" icon="ti-flask" style={{ marginTop: 14 }} pendingText="Menyimpan…">Simpan Racikan</SubmitButton>
        </div>
      </div>
    </form>
  );
}
