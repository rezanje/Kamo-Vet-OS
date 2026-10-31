"use client";
import { PreservedForm, LocalTransactionDraft } from "@/components/LocalTransactionDraft";
import { draftRows } from "@/components/TransactionDraft";
import { useState, useTransition } from "react";
import { addRacikan, bahanRacikanUntukKunjungan, katalogRacikanUntukKunjungan, obatRacikUntukKunjungan, type BahanRacikan } from "@/app/(app)/klinik/racik/actions";
import { TindakanRacikanForm } from "@/components/TindakanRacikanForm";
import type { CompoundDraft } from "@/lib/master-compound-cart";
import type { KatalogRacikan } from "@/lib/katalog-racikan";

/** Racikan pada rekam medis yang dibuka ulang memakai form yang sama dengan pemeriksaan
 * (laporan Andri 29 Okt: editor lama menyembunyikan daftar bahan sampai dokter mengetik,
 * dan tombol simpannya mati tanpa alasan). Muatan `addRacikan` tidak berubah. */
type ItemRacik = { id: string; code: string | null; name: string; unit: string; sell_price: number; stok: number | null };
const toItem = (row: { id: string; code?: string | null; name: string; unit: string; sell_price: number; stok: number | null }): ItemRacik =>
  ({ id: row.id, code: row.code ?? null, name: row.name, unit: row.unit, sell_price: row.sell_price, stok: row.stok });
const KOSONG: CompoundDraft = { saleItemId: "", formulaId: "", dosageForm: "sirup", instruction: "", ingredients: [] };

export function RacikanInline({ visitId, medicalRecordId, bahanItems, bolehManual }: {
  visitId: string; medicalRecordId: string; bahanItems: BahanRacikan[]; bolehManual: boolean;
}) {
  const [open, setOpen] = useState(false), [materials, setMaterials] = useState<ItemRacik[]>(bahanItems.map(toItem));
  const [items, setItems] = useState<ItemRacik[]>([]), [catalog, setCatalog] = useState<KatalogRacikan[]>([]);
  const [value, setValue] = useState<CompoundDraft>(KOSONG);
  const [requestKey, setRequestKey] = useState(""), [loadError, setLoadError] = useState(""), [loading, startTransition] = useTransition();
  const sku = items.find(item => item.id === value.saleItemId), formula = catalog.find(row => row.version_id === value.formulaId);
  const load = () => {
    setLoadError("");
    startTransition(async () => {
      try {
        const [loadedMaterials, loadedCatalog, loadedItems] = await Promise.all([
          bahanRacikanUntukKunjungan(visitId), katalogRacikanUntukKunjungan(visitId), obatRacikUntukKunjungan(visitId),
        ]);
        setMaterials(loadedMaterials.map(toItem)); setCatalog(loadedCatalog); setItems(loadedItems.map(toItem));
        setRequestKey(crypto.randomUUID()); setOpen(true);
      } catch { setLoadError("Obat atau bahan racikan belum bisa dimuat. Coba lagi."); }
    });
  };
  if (!open) return <div>
    <button type="button" className="btn-acc" disabled={loading} onClick={load}>{loading ? "Menyiapkan racikan…" : "Racikan baru"}</button>
    {loadError && <div role="alert">{loadError}</div>}
  </div>;
  return <PreservedForm action={addRacikan} style={{ padding: 12, border: ".5px solid var(--bd)", borderRadius: 8 }}>
    <LocalTransactionDraft scope={`clinic-racik:${visitId}:${medicalRecordId}`} state={{ snapshot: { value, requestKey }, restore: s => { const v = s.value as CompoundDraft | undefined; if (!v || typeof v.saleItemId !== "string" || typeof v.formulaId !== "string" || typeof v.dosageForm !== "string" || typeof v.instruction !== "string" || !Array.isArray(v.ingredients) || (v.ingredients.length > 0 && !draftRows(v.ingredients, { item_id: "", nama: "", qty: 0, satuan: "", harga: 0 })) || typeof s.requestKey !== "string" || !s.requestKey || (v.saleItemId && !items.some(i => i.id === v.saleItemId)) || (v.formulaId && !catalog.some(c => c.version_id === v.formulaId)) || !v.ingredients.every(i => materials.some(m => m.id === i.item_id))) return false; setValue(v); setRequestKey(s.requestKey); return true; }, reset: () => { setValue(KOSONG); setRequestKey(crypto.randomUUID()); } }} />
    <input type="hidden" name="visitId" value={visitId} /><input type="hidden" name="medicalRecordId" value={medicalRecordId} /><input type="hidden" name="requestKey" value={requestKey} />
    <input type="hidden" name="sale_item_id" value={value.saleItemId} /><input type="hidden" name="recipe_name" value={sku?.name ?? ""} /><input type="hidden" name="official_version_id" value={value.formulaId} />
    <input type="hidden" name="dosage_form" value={formula?.dosage_form ?? value.dosageForm} /><input type="hidden" name="aturan_pakai" value={formula ? (formula.dosage_instruction ?? "") : value.instruction} /><input type="hidden" name="ingredients" value={JSON.stringify(value.ingredients)} />
    <TindakanRacikanForm racikanItems={items} bahanItems={materials} katalogRacikan={catalog} bolehManual={bolehManual}
      racikan={value} editing={false} harga={sku?.sell_price ?? 0} labelSimpan="Simpan racikan"
      onPilihRacikan={item => setValue(current => current.saleItemId === item.id ? current : { ...KOSONG, saleItemId: item.id })}
      onUbahRacikan={setValue} onBatal={() => setValue(KOSONG)} />
    <button type="button" className="btn-def" onClick={() => { setOpen(false); setValue(KOSONG); }} style={{ marginTop: 8 }}>Tutup</button>
  </PreservedForm>;
}
