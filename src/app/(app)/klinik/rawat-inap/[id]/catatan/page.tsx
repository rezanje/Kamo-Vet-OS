import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { unitOptions } from "@/lib/satuan";
import { hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { CONDITION_LABEL, type Condition } from "@/lib/inpatient";
import { CatatanForm } from "./CatatanForm";
import { bolehRacikKhusus, loadKatalogRacikan } from "@/lib/katalog-racikan-server";
import { loadClinicCompoundSkus, loadClinicSkuDetails } from "@/lib/clinic-compound-skus";
import { readCompleteList } from "@/lib/checked-list";
import { daftarDokter } from '@/lib/dokter';

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function CatatanRawatInapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await (searchParams ?? Promise.resolve({} as { error?: string }));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("id, condition_status, doctor_name, admitted_at, visit_id, visits(created_at, branch_id, pets(name, species, breed, photo_url), customers(name, phone, address))")
    .eq("id", id).maybeSingle();
  if (!rec) notFound();

  const visit = one(rec.visits as Rel<{ created_at: string; branch_id: string; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const [doctors,paramedics]=await Promise.all([
    daftarDokter(supabase,{branchId:visit?.branch_id,role:'doctor'}),
    daftarDokter(supabase,{branchId:visit?.branch_id,role:'paramedic'}),
  ]);

  const masterRows = await readCompleteList<{
    id: string; name: string; unit: string; sell_price: number; is_compound_material: boolean; item_type: string;
  }>((from, to) => supabase
    .from("items").select("id, name, unit, sell_price, is_compound_material, item_type", { count: "exact" })
    .eq("is_active", true).order("name").order("id").range(from, to), "Barang klinik");
  const compoundRows = await loadClinicCompoundSkus(supabase);
  const compoundIds = new Set(compoundRows.map(item => item.id));
  const itemRows = [...new Map([...masterRows, ...compoundRows].map(item => [item.id, item])).values()];
  const ids = (itemRows ?? []).map((i) => i.id);
  const { stock: stok, units: unitMap, prices: hargaMap } = await loadClinicSkuDetails(supabase, ids, visit?.branch_id ?? null);
  const items = (itemRows ?? []).map((i) => ({
    id: i.id as string, code: "code" in i ? i.code as string | null : null, name: i.name as string, unit: (i.unit as string) ?? "pcs",
    sell_price: hargaCabang(hargaMap, i.id as string, i.unit as string, Number(i.sell_price)),
    stok: stok.get(i.id as string) ?? 0,
    is_compound_material: !!i.is_compound_material,
    item_type: i.item_type,
    units: applyHargaCabang(
      unitOptions(
        { unit: (i.unit as string) ?? "pcs", sell_price: Number(i.sell_price) },
        unitMap.get(i.id as string) ?? [],
      ),
      i.id as string,
      hargaMap,
    ),
  }));
  const bahanItems = items.filter((i) => i.is_compound_material);
  const katalogRacikan = await loadKatalogRacikan();
  const bolehManual = await bolehRacikKhusus();

  const noRM = visit
    ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(rec.visit_id as string).slice(0, 3).toUpperCase()}`
    : "—";
  const tglMasuk = new Date(rec.admitted_at as string).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

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

      <CatatanForm
        key={`${user?.id ?? ""}:${id}`}
        recordId={id}
        requestKey={crypto.randomUUID()}
        draftUserId={user?.id ?? ""}
        backHref={`/klinik/rawat-inap/${id}`}
        items={items.filter(item => !compoundIds.has(item.id) && !item.is_compound_material && item.item_type !== "Jasa")}
        racikanItems={items.filter(item => compoundIds.has(item.id))}
        bahanItems={bahanItems}
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
