import { loadWarehouseStock } from "@/lib/warehouse-stock";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadKatalogPermintaan } from "@/lib/permintaan";
import { PemindahanForm } from "./PemindahanForm";
import { StokKurangDariPesan } from "@/components/StokKurangPopup";

export default async function PemindahanBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: whs }, items] = await Promise.all([
    supabase.from("warehouses").select("id, name").eq("is_active", true).neq("type", "TRANSIT").order("name"),
    loadKatalogPermintaan(supabase),
  ]);

  const stock = await loadWarehouseStock(supabase, (whs ?? []).map(w => w.id));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/pemindahan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kirim Barang</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {/* Penolakan `post_stock_transfer_atomic` memakai popup yang sama dengan
          pemeriksaan di layar; gudang asalnya sudah disebut di kalimat database. */}
      <StokKurangDariPesan pesan={error} />

      <PemindahanForm warehouses={whs ?? []} items={items} stock={stock} userId={user?.id ?? ""} />
    </>
  );
}
