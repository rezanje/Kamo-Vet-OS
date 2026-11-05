import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { pilihGudangDefault } from "@/lib/shopee-import-match";
import { ShopeeImportWorkspace } from "./ShopeeImportWorkspace";

type WhRow = { id: string; name: string; branches: { name: string } | { name: string }[] | null };

// Akses halaman = modul Penjualan (middleware); hak posting = RPC post_online_order (peran + cabang),
// sama seperti form order online manual.
export default async function ImporShopeePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const [{ data: whRaw, error: whErr }, { data: me }] = await Promise.all([
    db.from("warehouses").select("id, name, branches(name)").eq("type", "ONLINE").eq("is_active", true).order("name"),
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
  ]);
  if (whErr) console.error("[ImporShopeePage] gagal query gudang online:", whErr);
  const warehouses = ((whRaw ?? []) as unknown as WhRow[]).map(w => {
    const br = Array.isArray(w.branches) ? w.branches[0] : w.branches;
    return { id: w.id, name: w.name, branch_name: br?.name ?? "—" };
  });
  const isOwner = !!me?.is_active && me.role === "OWNER";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/online" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Impor pesanan Shopee</span>
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="IMPOR PESANAN SHOPEE" desc="Unggah ekspor pesanan, periksa pratinjau, lalu simpan sekaligus ke gudang online cabang." />
        {whErr ? (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
            <i className="ti ti-alert-circle" /> Gagal memuat daftar gudang online. Muat ulang halaman; bila masih gagal, hubungi admin.
          </div>
        ) : warehouses.length === 0 ? (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
            <i className="ti ti-alert-triangle" /> Belum ada gudang bertipe ONLINE yang aktif. Minta admin membuat cabang &amp; gudang online dulu.
          </div>
        ) : (
          <ShopeeImportWorkspace warehouses={warehouses} defaultWarehouseId={pilihGudangDefault(warehouses)} isOwner={isOwner} />
        )}
      </div>
    </>
  );
}
