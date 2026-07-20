"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { TINDAKAN_KATEGORI, kategoriWajibConsent } from "@/lib/tindakan";
import { simpanSku } from "./actions";

export type SkuRow = {
  id: string; name: string; code: string | null; unit: string; category_id: string | null;
  sell_price: number; buy_price: number; is_active: boolean; tindakan_kategori: string | null;
};

export function SkuForm({ categories, editing, jasaCategoryId }: {
  categories: { id: string; name: string }[];
  editing: SkuRow | null;
  jasaCategoryId: string | null;
}) {
  const [open, setOpen] = useState(!!editing);
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? "");
  const [tindakan, setTindakan] = useState(editing?.tindakan_kategori ?? "Konsultasi");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acc" style={{ background: "#2563eb" }}>
        <i className="ti ti-plus" /> SKU Baru
      </button>
    );
  }

  const isJasa = !!jasaCategoryId && categoryId === jasaCategoryId;

  return (
    <form action={simpanSku} className="crm-sec" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em" }}>
          <i className="ti ti-package" /> {editing ? "EDIT SKU" : "SKU BARU"}
        </div>
        {!editing && <i className="ti ti-x" onClick={() => setOpen(false)} style={{ cursor: "pointer", color: "var(--td)", fontSize: 15 }} />}
      </div>

      <div className="frow">
        <div>
          <label className="flab">Nama *</label>
          <input className="fi" name="name" defaultValue={editing?.name ?? ""} placeholder="mis. Konsultasi Dokter" required />
        </div>
        <div>
          <label className="flab">Kategori *</label>
          <select className="fi" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">— pilih —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="frow">
        <div>
          <label className="flab">Kode SKU</label>
          <input className="fi" name="code" defaultValue={editing?.code ?? ""} placeholder="mis. JSA-001" />
        </div>
        <div>
          <label className="flab">Satuan</label>
          <input className="fi" name="unit" defaultValue={editing?.unit ?? (isJasa ? "tindakan" : "pcs")} placeholder="pcs" />
        </div>
      </div>

      <div className="frow">
        <div>
          <label className="flab">Harga jual *</label>
          <input className="fi" name="sell_price" type="number" min={0} step={1000} defaultValue={editing?.sell_price ?? ""} required />
        </div>
        <div>
          <label className="flab">Harga beli / modal</label>
          <input className="fi" name="buy_price" type="number" min={0} step={1000} defaultValue={editing?.buy_price ?? 0} />
        </div>
      </div>

      {isJasa && (
        <div className="fg">
          <label className="flab">Kategori tindakan *</label>
          <select className="fi" name="tindakan_kategori" value={tindakan} onChange={(e) => setTindakan(e.target.value)}>
            {TINDAKAN_KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div style={{ fontSize: 9.5, color: kategoriWajibConsent(tindakan) ? "#b91c1c" : "var(--td)", marginTop: 3 }}>
            {kategoriWajibConsent(tindakan)
              ? <><i className="ti ti-file-alert" /> Tindakan ini wajib form persetujuan — pembayaran diblokir sampai pemilik tanda tangan.</>
              : "Menentukan apakah tindakan ini butuh form persetujuan saat dipakai di rekam medis."}
          </div>
        </div>
      )}

      <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
        Simpan SKU
      </SubmitButton>
    </form>
  );
}
