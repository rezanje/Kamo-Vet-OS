import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONDITION_LABEL, type Condition } from "@/lib/inpatient";
import { CatatanForm } from "./CatatanForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function CatatanRawatInapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("id, condition_status, doctor_name, admitted_at, visit_id, visits(created_at, pets(name, species, breed, photo_url), customers(name, phone, address))")
    .eq("id", id).maybeSingle();
  if (!rec) notFound();

  const visit = one(rec.visits as Rel<{ created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);

  const { data: itemRows } = await supabase
    .from("items").select("id, name, unit, sell_price, is_compound_material").eq("is_active", true).order("name").limit(200);
  const ids = (itemRows ?? []).map((i) => i.id);
  const { data: stockRows } = ids.length
    ? await supabase.from("stock").select("item_id, qty").in("item_id", ids)
    : { data: [] as { item_id: string; qty: number }[] };
  const stok = new Map<string, number>();
  for (const s of stockRows ?? []) stok.set(s.item_id as string, (stok.get(s.item_id as string) ?? 0) + Number(s.qty));
  const items = (itemRows ?? []).map((i) => ({ id: i.id as string, name: i.name as string, unit: (i.unit as string) ?? "pcs", sell_price: Number(i.sell_price), stok: stok.get(i.id as string) ?? 0, is_compound_material: !!i.is_compound_material }));
  const bahanItems = items.filter((i) => i.is_compound_material);

  const noRM = visit
    ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(rec.visit_id as string).slice(0, 3).toUpperCase()}`
    : "—";
  const tglMasuk = new Date(rec.admitted_at as string).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={`/klinik/rawat-inap/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Laporan Rawat Inap</Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-bed" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>RAWAT INAP</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Form pencatatan perawatan pasien inap</div>
        </div>
      </div>

      <CatatanForm
        recordId={id}
        backHref={`/klinik/rawat-inap/${id}`}
        items={items}
        bahanItems={bahanItems}
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
