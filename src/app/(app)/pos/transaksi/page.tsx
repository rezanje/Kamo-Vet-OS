import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { PosClient, type Item, type Cust } from "./PosClient";

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: items }, { data: customers }, { data: branches }] = await Promise.all([
    supabase.from("items").select("id, name, unit, sell_price, target_species").eq("is_active", true).order("name"),
    supabase.from("customers").select("id, name, phone, points, customer_categories(nama, diskon_persen), pets(id, name, species)").order("name"),
    supabase.from("branches").select("id, code, name").eq("is_active", true).order("name"),
  ]);

  // Satuan berjenjang: kasir pilih pcs/box saat menambah ke keranjang.
  const unitMap = await loadItemUnits(supabase, (items ?? []).map((i) => i.id as string));
  const katalog: Item[] = (items ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    sell_price: Number(i.sell_price),
    target_species: i.target_species as string,
    units: unitOptions({ unit: i.unit as string, sell_price: Number(i.sell_price) }, unitMap.get(i.id as string) ?? []),
  }));

  // Pengecualian harga per cabang (migrasi 0073) — jumlahnya sedikit, jadi dikirim
  // utuh ke klien supaya ganti cabang langsung mengubah harga tanpa reload.
  const { data: overrides } = await supabase
    .from("item_branch_prices").select("item_id, branch_id, unit, sell_price");
  const hargaPerCabang: Record<string, Record<string, number>> = {};
  for (const o of (overrides ?? []) as { item_id: string; branch_id: string; unit: string; sell_price: number }[]) {
    (hargaPerCabang[o.branch_id] ??= {})[`${o.item_id}|${o.unit}`] = Number(o.sell_price);
  }

  // Relasi Supabase bisa datang sebagai objek ATAU array — dinormalkan sekali di sini
  // supaya kasir cukup baca satu bentuk (`golongan`).
  const pelanggan = ((customers ?? []) as unknown as (Omit<Cust, "golongan"> & {
    customer_categories: { nama: string; diskon_persen: number } | { nama: string; diskon_persen: number }[] | null;
  })[]).map((c) => {
    const k = Array.isArray(c.customer_categories) ? c.customer_categories[0] : c.customer_categories;
    return { ...c, golongan: k ? { nama: k.nama, diskon_persen: Number(k.diskon_persen) } : null };
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { data: openShift } = await supabase
    .from("cashier_shifts").select("id").eq("opened_by", user?.id ?? "").eq("status", "open")
    .eq("shift_type", "petshop").maybeSingle();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Transaksi POS</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {!openShift && (
        <div className="p2ban" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="ti ti-clock-pause" /> Shift belum dibuka — penjualan tidak tercatat ke rekonsiliasi kas.
          </span>
          <Link href="/pos/shift" className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>Buka shift</Link>
        </div>
      )}

      <PosClient
        items={katalog}
        customers={pelanggan}
        branches={branches ?? []}
        hargaPerCabang={hargaPerCabang}
      />
    </>
  );
}
