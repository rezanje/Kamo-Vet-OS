import { loadBranchGroomingPolicy, loadServiceStaff } from "@/lib/service-performers-server";
import { loadClinicItemCategories, splitClinicItems } from "@/lib/clinic-item-categories";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { unitOptions, type ItemUnit } from "@/lib/satuan";
import { hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { CONDITION_LABEL, type Condition } from "@/lib/inpatient";
import { CatatanForm, type ItemLite } from "./CatatanForm";
import { bolehRacikKhusus, loadKatalogRacikan } from "@/lib/katalog-racikan-server";
import { loadClinicCompoundSkus, loadClinicSkuDetails, type CompoundSkuRow } from "@/lib/clinic-compound-skus";
import { readCompleteList } from "@/lib/checked-list";
import { daftarDokter } from '@/lib/dokter';
import { readStayTypesChecked } from "@/lib/inpatient-stay";
import { catatWaktu, mulai } from "@/lib/u07-waktu";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type MasterRow = {
  id: string; code: string | null; upc: string | null; name: string; unit: string; sell_price: number; is_compound_material: boolean; item_type: string; category_id: string | null; tindakan_kategori: string | null;
};

/** U07: payload katalog ke browser — hanya kolom yang dibaca form. `category_id` &
 * `is_compound_material` cuma dipakai server untuk membagi grup; nilai kosong tidak
 * dikirim (form memperlakukan null & tidak ada sama); harga beli satuan tidak dipakai
 * form klinik, jadi tidak ada di tipe satuan untuk browser (`UnitLite`). */
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

export default async function CatatanRawatInapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string; tab?: string }> }) {
  const { id } = await params;
  const { error, tab } = await (searchParams ?? Promise.resolve({} as { error?: string; tab?: string }));
  const supabase = await createClient();
  const waktu = catatWaktu("catatanRawatInap", id);

  // U07: dulu ±22–25 bacaan berurutan. Gelombang 1 memulai semua bacaan yang tidak
  // butuh data rawat inap (katalog, kategori, racikan, izin racik, tipe inap) bersama
  // data rawat inap; gelombang 2 (butuh cabang) langsung menyusul. Galat bacaan tetap
  // dilempar seperti sebelumnya.
  const userP = mulai(supabase.auth.getUser());
  const recP = mulai(supabase
    .from("inpatient_records")
    .select("id, condition_status, doctor_name, admitted_at, visit_id, visits(created_at, branch_id, doctor_id, pets(name, species, breed, photo_url), customers(name, phone, address))")
    .eq("id", id).maybeSingle());
  const stayP = mulai(readStayTypesChecked(supabase, [id]));
  const masterP = mulai(readCompleteList<MasterRow>((from, to) => supabase
    .from("items").select("id, code, upc, name, unit, sell_price, is_compound_material, item_type, category_id, tindakan_kategori", { count: "exact" })
    .eq("is_active", true).order("name").order("id").range(from, to), "Barang klinik"));
  const categoriesP = mulai(loadClinicItemCategories(supabase));
  const compoundP = mulai(categoriesP.then((categories) => loadClinicCompoundSkus(supabase, categories)));
  const katalogP = mulai(loadKatalogRacikan());
  const bolehP = mulai(bolehRacikKhusus());

  const [{ data: { user } }, { data: rec }] = await Promise.all([userP, recP]);
  if (!rec) notFound();
  waktu.tandai("rawatInap");

  const visit = one(rec.visits as Rel<{ created_at: string; branch_id: string; doctor_id: string | null; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branchId = visit?.branch_id ?? null;
  const [serviceStaff, stay, doctors, paramedics, categories, [itemRows, compoundIds, sku], katalogRacikan, bolehManual, groomingPolicy] = await Promise.all([
    loadServiceStaff(supabase, branchId),
    stayP,
    daftarDokter(supabase,{branchId:visit?.branch_id,role:'doctor'}),
    daftarDokter(supabase,{branchId:visit?.branch_id,role:'paramedic'}),
    categoriesP,
    Promise.all([masterP, compoundP]).then(async ([masterRows, compoundRows]) => {
      const rows = [...new Map<string, MasterRow | CompoundSkuRow>([...masterRows, ...compoundRows].map(item => [item.id, item])).values()];
      return [rows, new Set(compoundRows.map(item => item.id)), await loadClinicSkuDetails(supabase, rows.map((i) => i.id), branchId)] as const;
    }),
    katalogP,
    bolehP,
    visit?.branch_id ? loadBranchGroomingPolicy(supabase, visit.branch_id) : Promise.resolve(null),
  ]);
  waktu.tandai("katalog");
  const petHotel = stay.types.get(id) === "pet_hotel";
  const { stock: stok, units: unitMap, prices: hargaMap } = sku;
  const items = itemRows.map((i) => ({
    id: i.id as string, code: "code" in i ? i.code as string | null : null, upc: "upc" in i ? i.upc as string | null : null, name: i.name as string, unit: (i.unit as string) ?? "pcs",
    sell_price: hargaCabang(hargaMap, i.id as string, i.unit as string, Number(i.sell_price)),
    stok: stok.get(i.id as string) ?? 0,
    is_compound_material: !!i.is_compound_material,
    item_type: i.item_type,
    category_id: i.category_id,
    tindakan_kategori: i.tindakan_kategori,
    units: applyHargaCabang(
      unitOptions(
        { unit: (i.unit as string) ?? "pcs", sell_price: Number(i.sell_price) },
        unitMap.get(i.id as string) ?? [],
      ),
      i.id as string,
      hargaMap,
    ),
  }));
  const split = splitClinicItems(items, categories, compoundIds);
  // U07: satu salinan ringkas per barang, dipakai bersama oleh semua grup (barang yang
  // muncul di dua grup tetap dikirim sekali), tanpa kolom yang tidak dipakai form.
  const ringkas = new Map(items.map((item) => [item.id, itemUntukKlien(item)]));
  const keKlien = (list: typeof items) => list.map((item) => ringkas.get(item.id)!);
  const groups = { obat: keKlien(split.obat), jasa: keKlien(split.jasa), tindakan: keKlien(split.tindakan), racikan: keKlien(split.racikan), bahan: keKlien(split.bahan) };

  const noRM = visit
    ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(rec.visit_id as string).slice(0, 3).toUpperCase()}`
    : "—";
  const tglMasuk = new Date(rec.admitted_at as string).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const groomingDoctorRequired = groomingPolicy?.doctorRequired ?? false;
  waktu.selesai();
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={`/klinik/rawat-inap/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Laporan Rawat Inap</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-bed" style={{ fontSize: 22, color: "var(--posb)" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>RAWAT INAP</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Form pencatatan perawatan pasien inap</div>
        </div>
      </div>

      {error && <div role="alert" className="p2ban" style={{ color: "#b91c1c" }}>{error}</div>}
      {stay.failed && <div role="alert" className="p2ban" style={{ color: "#b91c1c" }}>Tipe rawat inap belum dapat diverifikasi. Muat ulang sebelum mengisi catatan.</div>}

      <CatatanForm
        key={`${user?.id ?? ""}:${id}`}
        tabAwal={tab}
        serviceStaff={serviceStaff}
        visitDoctorId={visit?.doctor_id ?? null}
        groomingDoctorRequired={groomingDoctorRequired}
        groomingApplies={groomingPolicy?.applies ?? false}
        recordId={id}
        petHotel={petHotel}
        requestKey={crypto.randomUUID()}
        draftUserId={user?.id ?? ""}
        backHref={`/klinik/rawat-inap/${id}`}
        items={groups.obat}
        jasaItems={groups.jasa}
        tindakanItems={groups.tindakan}
        racikanItems={groups.racikan}
        bahanItems={groups.bahan}
        katalogRacikan={katalogRacikan}
        bolehManual={bolehManual}
        doctors={doctors}
        paramedics={paramedics}
        patient={{
          name: pet?.name ?? "—",
          species: pet?.species ?? "—",
          breed: pet?.breed ?? null,
          noRM,
          owner: cust?.name ?? "—",
          phone: cust?.phone ?? "—",
          address: cust?.address ?? "—",
          tglMasuk,
          dokter: rec.doctor_name ?? "",
          kondisi: CONDITION_LABEL[rec.condition_status as Condition] ?? String(rec.condition_status),
          photo: pet?.photo_url ?? null,
        }}
      />
    </>
  );
}
