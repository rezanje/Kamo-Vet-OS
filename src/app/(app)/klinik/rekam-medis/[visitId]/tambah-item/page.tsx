import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadBranchGroomingPolicy, loadServiceStaff } from "@/lib/service-performers-server";
import { loadClinicItemCategories, splitClinicItems } from "@/lib/clinic-item-categories";
import { loadClinicCompoundSkus, loadClinicSkuDetails, type CompoundSkuRow } from "@/lib/clinic-compound-skus";
import { bolehRacikKhusus, loadKatalogRacikan } from "@/lib/katalog-racikan-server";
import { readCompleteList } from "@/lib/checked-list";
import { unitOptions, type ItemUnit } from "@/lib/satuan";
import { applyHargaCabang, hargaCabang } from "@/lib/harga-cabang";
import { mulai } from "@/lib/u07-waktu";
import { Popup } from "@/components/Popup";
import { StokKurangDariPesan } from "@/components/StokKurangPopup";
import { adalahKekuranganStok } from "@/lib/stok-kurang";
import { TambahItemForm, type ItemLite } from "./TambahItemForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
type MasterRow = {
  id: string; code: string | null; upc: string | null; name: string; unit: string; sell_price: number;
  is_compound_material: boolean; item_type: string; category_id: string | null; tindakan_kategori: string | null;
};

/** U07: hanya kolom yang dibaca form yang dikirim ke browser. */
function itemUntukKlien(item: {
  id: string; code: string | null; upc: string | null; name: string; unit: string; sell_price: number; stok: number;
  item_type: string; tindakan_kategori: string | null; units: ItemUnit[];
}): ItemLite {
  return {
    id: item.id, name: item.name, unit: item.unit, sell_price: item.sell_price, stok: item.stok, item_type: item.item_type,
    ...(item.code != null ? { code: item.code } : {}),
    ...(item.upc != null ? { upc: item.upc } : {}),
    ...(item.tindakan_kategori != null ? { tindakan_kategori: item.tindakan_kategori } : {}),
    units: item.units.map((unit) => ({ unit: unit.unit, factor: unit.factor, sell_price: unit.sell_price })),
  };
}

/**
 * Tambah item ke rekam medis rawat jalan yang sudah tersimpan tapi belum ditagih.
 * Syarat masuknya sama dengan tombol Edit di layar Detail (clinic_can_correct_record);
 * yang tidak memenuhi dikembalikan ke Detail dengan alasan, bukan diberi form buntu.
 */
export default async function TambahItemPage({
  params, searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams?: Promise<{ error?: string; tab?: string }>;
}) {
  const { visitId } = await params;
  const { error, tab } = await (searchParams ?? Promise.resolve({} as { error?: string; tab?: string }));
  const supabase = await createClient();
  const back = `/klinik/rekam-medis/${visitId}`;

  const userP = mulai(supabase.auth.getUser());
  const visitP = mulai(supabase.from("visits")
    .select("id, branch_id, poli, status, dokter, doctor_id, checked_out_at, pets(name, species, breed), customers(name)")
    .eq("id", visitId).maybeSingle());
  const recordP = mulai(supabase.from("medical_records").select("id")
    .eq("visit_id", visitId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  const masterP = mulai(readCompleteList<MasterRow>((from, to) => supabase
    .from("items").select("id, code, upc, name, unit, sell_price, is_compound_material, item_type, category_id, tindakan_kategori", { count: "exact" })
    .eq("is_active", true).order("name").order("id").range(from, to), "Barang klinik"));
  const categoriesP = mulai(loadClinicItemCategories(supabase));
  const compoundP = mulai(categoriesP.then((categories) => loadClinicCompoundSkus(supabase, categories)));
  const katalogP = mulai(loadKatalogRacikan());
  const bolehP = mulai(bolehRacikKhusus());

  const [{ data: { user } }, { data: visit }, record] = await Promise.all([userP, visitP, recordP]);
  if (!visit) notFound();
  if (record.error) redirect(`${back}?error=${encodeURIComponent("Rekam medis belum dapat dibaca. Muat ulang lalu coba lagi.")}`);
  const recordId = record.data?.id ?? null;
  if (!recordId) redirect(`${back}?error=${encodeURIComponent("Rekam medis belum tersimpan. Simpan pemeriksaan dulu sebelum menambah item.")}`);

  // Syarat tunggal: database yang memutuskan, bukan layar. Gagal baca = tertutup.
  const gate = await supabase.rpc("clinic_can_correct_record", { p_record_id: recordId });
  if (gate.error || gate.data !== true) {
    redirect(`${back}?error=${encodeURIComponent("Tambah item susulan sudah tertutup untuk kunjungan ini. Tagihan sudah terbit atau kunjungan sudah selesai — gunakan koreksi tagihan di Pembayaran.")}`);
  }

  const branchId = (visit.branch_id as string) ?? null;
  const [serviceStaff, categories, [itemRows, compoundIds, sku], katalogRacikan, bolehManual, groomingPolicy] = await Promise.all([
    loadServiceStaff(supabase, branchId),
    categoriesP,
    Promise.all([masterP, compoundP]).then(async ([masterRows, compoundRows]) => {
      const rows = [...new Map<string, MasterRow | CompoundSkuRow>([...masterRows, ...compoundRows].map(item => [item.id, item])).values()];
      return [rows, new Set(compoundRows.map(item => item.id)), await loadClinicSkuDetails(supabase, rows.map((i) => i.id), branchId)] as const;
    }),
    katalogP,
    bolehP,
    branchId ? loadBranchGroomingPolicy(supabase, branchId) : Promise.resolve(null),
  ]);
  const { stock: stok, units: unitMap, prices: hargaMap } = sku;
  const items = itemRows.map((i) => ({
    id: i.id as string,
    code: "code" in i ? (i.code as string | null) : null,
    upc: "upc" in i ? (i.upc as string | null) : null,
    name: i.name as string,
    unit: (i.unit as string) ?? "pcs",
    sell_price: hargaCabang(hargaMap, i.id as string, i.unit as string, Number(i.sell_price)),
    stok: stok.get(i.id as string) ?? 0,
    is_compound_material: !!i.is_compound_material,
    item_type: i.item_type,
    category_id: i.category_id,
    tindakan_kategori: i.tindakan_kategori,
    units: applyHargaCabang(
      unitOptions({ unit: (i.unit as string) ?? "pcs", sell_price: Number(i.sell_price) }, unitMap.get(i.id as string) ?? []),
      i.id as string, hargaMap,
    ),
  }));
  const split = splitClinicItems(items, categories, compoundIds);
  const ringkas = new Map(items.map((item) => [item.id, itemUntukKlien(item)]));
  const keKlien = (list: typeof items) => list.map((item) => ringkas.get(item.id)!);

  const pet = one(visit.pets as Rel<{ name: string; species: string | null; breed: string | null }>);
  const cust = one(visit.customers as Rel<{ name: string }>);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href={back} className="back-btn"><i className="ti ti-arrow-left" /> Rekam Medis</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Tambah tindakan / obat</span>
      </div>

      <StokKurangDariPesan pesan={error} />
      <Popup message={adalahKekuranganStok(error) ? null : error} />

      <div className="p2ban" style={{ marginBottom: 12 }}>
        <i className="ti ti-info-circle" /> Item yang ditambah di sini langsung masuk rekam medis{" "}
        <b>{pet?.name ?? "pasien"}</b>{cust?.name ? ` · ${cust.name}` : ""} dan otomatis ikut tagihan di layar Pembayaran.
        Catatan klinis pemeriksaan tidak berubah.
      </div>

      <TambahItemForm
        key={`${user?.id ?? ""}:${visitId}`}
        visitId={visit.id as string}
        requestKey={crypto.randomUUID()}
        draftUserId={user?.id ?? ""}
        tabAwal={tab}
        serviceStaff={serviceStaff}
        visitDoctorId={(visit.doctor_id as string | null) ?? null}
        groomingDoctorRequired={groomingPolicy?.doctorRequired ?? false}
        groomingApplies={groomingPolicy?.applies ?? false}
        items={keKlien(split.obat)}
        jasaItems={keKlien(split.jasa)}
        tindakanItems={keKlien(split.tindakan)}
        racikanItems={keKlien(split.racikan)}
        bahanItems={keKlien(split.bahan)}
        katalogRacikan={katalogRacikan}
        bolehManual={bolehManual}
      />
    </>
  );
}
