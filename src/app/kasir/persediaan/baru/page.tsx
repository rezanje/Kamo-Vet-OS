import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { loadKatalogPermintaan } from "@/lib/permintaan";
import { PersediaanBaruForm } from "./PersediaanBaruForm";

export default async function BaruPermintaanKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  // gudang tujuan: gudang DC (kode diawali "DC").
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .ilike("code", "DC%")
    .eq("is_active", true)
    .order("name");

  // katalog barang (hanya Persediaan) + satuan berjenjang buat item picker.
  const katalog = await loadKatalogPermintaan(supabase);

  // stok toko: gudang retail pertama cabang shift.
  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", shift.branch_id).eq("is_active", true).order("type").limit(1).maybeSingle();
  const stockMap: Record<string, number> = {};
  if (wh) {
    const { data: st } = await supabase.from("stock").select("item_id, qty").eq("warehouse_id", wh.id);
    for (const s of st ?? []) stockMap[s.item_id as string] = Number(s.qty);
  }

  const items = katalog.map((i) => ({ ...i, stok: stockMap[i.id] ?? 0 }));

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  return (
    <>
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <PersediaanBaruForm
        branchName={shift.branchName}
        warehouses={warehouses ?? []}
        items={items}
        userName={profile?.full_name ?? user.email ?? "Frontliner"}
      />
    </>
  );
}
