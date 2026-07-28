"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { TINDAKAN_KATEGORI, kategoriWajibConsent } from "@/lib/tindakan";
import type { ItemUnit } from "@/lib/satuan";
import { simpanSku } from "./actions";

export type SkuRow = {
  id: string; name: string; code: string | null; unit: string; category_id: string | null;
  sell_price: number; buy_price: number; is_active: boolean; tindakan_kategori: string | null;
  units?: ItemUnit[];
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function SkuForm({ categories, editing, jasaCategoryId }: {
  categories: { id: string; name: string }[];
  editing: SkuRow | null;
  jasaCategoryId: string | null;
}) {
  const [open, setOpen] = useState(!!editing);
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? "");
  const [tindakan, setTindakan] = useState(editing?.tindakan_kategori ?? "Konsultasi");

  const isJasa = !!jasaCategoryId && categoryId === jasaCategoryId;

  // Satuan dasar & harga dasar dipantau di state supaya panel satuan berjenjang bisa
  // menampilkan perbandingan harga per satuan dasar sambil diketik.
  const [baseUnit, setBaseUnit] = useState(editing?.unit ?? "pcs");
  const [baseSell, setBaseSell] = useState<number>(Number(editing?.sell_price) || 0);
  const [units, setUnits] = useState<ItemUnit[]>(editing?.units ?? []);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-acc" style={{ background: "#2563eb" }}>
        <i className="ti ti-plus" /> SKU Baru
      </button>
    );
  }

  const dasar = (baseUnit.trim() || (isJasa ? "tindakan" : "pcs")).trim();
  const setUnit = (i: number, patch: Partial<ItemUnit>) =>
    setUnits((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const addUnit = () => setUnits((us) => [...us, { unit: "", factor: 1, sell_price: 0, buy_price: 0 }]);
  const delUnit = (i: number) => setUnits((us) => us.filter((_, j) => j !== i));

  return (
    <form action={simpanSku} className="crm-sec" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <input type="hidden" name="units" value={JSON.stringify(isJasa ? [] : units)} />
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
          <select className="fi" name="category_id" value={categoryId} onChange={(e) => {
            const v = e.target.value;
            setCategoryId(v);
            // Satuan default ikut jenis SKU selama belum diutak-atik manual.
            const jadiJasa = !!jasaCategoryId && v === jasaCategoryId;
            if (jadiJasa && baseUnit === "pcs") setBaseUnit("tindakan");
            if (!jadiJasa && baseUnit === "tindakan") setBaseUnit("pcs");
          }} required>
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
          <label className="flab">Satuan dasar *</label>
          <input className="fi" name="unit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}
            placeholder={isJasa ? "tindakan" : "pcs"} />
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
            Satuan terkecil — stok selalu dihitung di sini.
          </div>
        </div>
      </div>

      <div className="frow">
        <div>
          <label className="flab">Harga jual * <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
          <input className="fi" name="sell_price" type="number" min={0} step={1000}
            value={baseSell || ""} onChange={(e) => setBaseSell(Number(e.target.value))} required />
        </div>
        <div>
          <label className="flab">Harga beli / modal <span style={{ color: "var(--td)", fontWeight: 400 }}>/ {dasar}</span></label>
          <input className="fi" name="buy_price" type="number" min={0} step={1000} defaultValue={editing?.buy_price ?? 0} />
        </div>
      </div>

      {/* Satuan berjenjang — tidak relevan untuk jasa (tidak punya stok/kemasan). */}
      {!isJasa && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: ".5px solid var(--bd)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}><i className="ti ti-stack-2" /> Satuan berjenjang</div>
              <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                Kemasan lain dari SKU yang sama (box, kg, sak, btl). Harga jualnya berdiri sendiri — tidak wajib kelipatan harga dasar.
              </div>
            </div>
            <button type="button" onClick={addUnit} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
              + Tambah satuan
            </button>
          </div>

          {units.length === 0 && (
            <div style={{ fontSize: 10.5, color: "var(--td)", padding: "6px 0" }}>
              Belum ada. SKU ini hanya dijual per <b>{dasar}</b>.
            </div>
          )}

          {units.map((u, i) => {
            const f = Number(u.factor) || 0;
            const perDasar = f > 0 ? Number(u.sell_price) / f : 0;
            const hemat = f > 0 && baseSell > 0 && Number(u.sell_price) > 0 ? perDasar - baseSell : 0;
            return (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ width: 92, flexShrink: 0 }}>
                  {i === 0 && <label className="flab">Satuan</label>}
                  <input className="fi" placeholder="box" value={u.unit} maxLength={20}
                    onChange={(e) => setUnit(i, { unit: e.target.value })} />
                </div>
                <div style={{ width: 104, flexShrink: 0 }}>
                  {i === 0 && <label className="flab">Isi ({dasar})</label>}
                  <input className="fi" type="number" min={0} step="any" value={u.factor || ""}
                    onChange={(e) => setUnit(i, { factor: Number(e.target.value) })} placeholder="12" />
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  {i === 0 && <label className="flab">Harga jual</label>}
                  <input className="fi" type="number" min={0} step={1000} value={u.sell_price || ""}
                    onChange={(e) => setUnit(i, { sell_price: Number(e.target.value) })} placeholder="0" />
                  {f > 0 && Number(u.sell_price) > 0 && (
                    <div style={{ fontSize: 9, color: hemat < 0 ? "#15803d" : "var(--td)", marginTop: 2 }}>
                      ≈ {rp(perDasar)}/{dasar}
                      {hemat < 0 ? ` · lebih murah ${rp(Math.abs(hemat))}/${dasar}` : ""}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  {i === 0 && <label className="flab">Harga beli</label>}
                  <input className="fi" type="number" min={0} step={1000} value={u.buy_price || ""}
                    onChange={(e) => setUnit(i, { buy_price: Number(e.target.value) })} placeholder="0" />
                </div>
                <button type="button" onClick={() => delUnit(i)} className="btn-def"
                  style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0, marginTop: i === 0 ? 17 : 0, height: 30 }}
                  title="Hapus satuan">
                  <i className="ti ti-trash" />
                </button>
              </div>
            );
          })}
        </div>
      )}

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
