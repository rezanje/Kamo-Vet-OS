"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { PLACEHOLDERS } from "@/lib/consent";
import { simpanTemplate } from "./actions";

export type TemplateRow = {
  id: string; nama: string; isi: string; branch_id: string | null; is_active: boolean;
};

const CONTOH = `Saya yang bertanda tangan di bawah ini, {nama_pemilik}, selaku pemilik hewan {nama_hewan} ({jenis_hewan}), menyatakan telah menerima penjelasan mengenai tindakan {tindakan} yang akan dilakukan oleh {dokter} di {cabang}.

Saya memahami tujuan, prosedur, serta risiko yang mungkin timbul, dan dengan ini menyatakan PERSETUJUAN atas tindakan tersebut.

{cabang}, {tanggal}`;

export function TemplateForm({ branches, editing }: {
  branches: { id: string; name: string }[];
  editing: TemplateRow | null;
}) {
  const [open, setOpen] = useState(!!editing);
  const [isi, setIsi] = useState(editing?.isi ?? "");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acc" style={{ background: "#2563eb" }}>
        <i className="ti ti-plus" /> Template Baru
      </button>
    );
  }

  const sisip = (p: string) => setIsi((v) => `${v}{${p}}`);

  return (
    <form action={simpanTemplate} className="crm-sec" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em" }}>
          <i className="ti ti-file-text" /> {editing ? "EDIT TEMPLATE" : "TEMPLATE BARU"}
        </div>
        {!editing && (
          <i className="ti ti-x" onClick={() => setOpen(false)} style={{ cursor: "pointer", color: "var(--td)", fontSize: 15 }} />
        )}
      </div>

      <div className="frow">
        <div>
          <label className="flab">Nama template *</label>
          <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} placeholder="mis. Persetujuan Tindakan Operasi" required />
        </div>
        <div>
          <label className="flab">Berlaku untuk cabang</label>
          <select className="fi" name="branchId" defaultValue={editing?.branch_id ?? ""}>
            <option value="">Semua cabang</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="fg">
        <label className="flab">Isi form *</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
          <span style={{ fontSize: 9.5, color: "var(--tm)", alignSelf: "center", marginRight: 2 }}>Sisipkan:</span>
          {PLACEHOLDERS.map((p) => (
            <button key={p} type="button" onClick={() => sisip(p)} className="back-btn"
              style={{ fontSize: 9.5, border: ".5px solid var(--bd)", borderRadius: 5, padding: "2px 6px", color: "#2563eb" }}>
              {"{" + p + "}"}
            </button>
          ))}
        </div>
        <textarea className="fi" name="isi" rows={10} required value={isi} onChange={(e) => setIsi(e.target.value)}
          placeholder={CONTOH} style={{ resize: "vertical", lineHeight: 1.6 }} />
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 4 }}>
          Placeholder terisi otomatis saat form dibuat dari data kunjungan.
        </div>
        {!isi && (
          <button type="button" onClick={() => setIsi(CONTOH)} className="back-btn" style={{ fontSize: 10.5, color: "#2563eb", marginTop: 4 }}>
            <i className="ti ti-wand" /> Pakai contoh teks
          </button>
        )}
      </div>

      <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
        Simpan Template
      </SubmitButton>
    </form>
  );
}
