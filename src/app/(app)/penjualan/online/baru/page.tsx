import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnlineForm } from "./OnlineForm";

type WhRow = { id: string; name: string; branches: { name: string } | { name: string }[] | null };

export default async function OnlineBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const [{ data: whRaw, error: whErr }, { data: items }, { data: customers }] = await Promise.all([
    supabase
      .from("warehouses").select("id, name, branches(name)")
      .eq("type", "ONLINE").eq("is_active", true).order("name"),
    supabase.from("items").select("id, code, name, sell_price").eq("is_active", true).order("name").limit(2000),
    supabase.from("customers").select("id, name, phone").order("name").limit(2000),
  ]);
  // `data` juga null kalau query gagal (RLS/jaringan) — bedakan dari "memang belum ada
  // gudang ONLINE" (M6), supaya operator tidak disuruh minta admin buat sesuatu yang sudah ada.
  if (whErr) console.error("[OnlineBaruPage] gagal query gudang online:", whErr);

  const warehouses = ((whRaw ?? []) as unknown as WhRow[]).map((w) => {
    const br = Array.isArray(w.branches) ? w.branches[0] : w.branches;
    return { id: w.id, name: w.name, branch_name: br?.name ?? "—" };
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/online" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Order Online Baru</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {whErr ? (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> Gagal memuat daftar gudang online. Coba muat ulang halaman;
          kalau masih gagal, hubungi admin.
        </div>
      ) : warehouses.length === 0 ? (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
          <i className="ti ti-alert-triangle" /> Belum ada gudang bertipe ONLINE yang aktif. Minta admin
          membuat cabang &amp; gudang online dulu sebelum mencatat order.
        </div>
      ) : (
        <OnlineForm
          warehouses={warehouses}
          items={(items ?? []) as { id: string; code: string; name: string; sell_price: number }[]}
          customers={(customers ?? []) as { id: string; name: string; phone: string | null }[]}
        />
      )}
    </>
  );
}
