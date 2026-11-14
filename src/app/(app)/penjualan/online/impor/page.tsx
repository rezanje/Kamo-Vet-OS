import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { cookies } from "next/headers";
import { ShopeeImportWorkspace } from "./ShopeeImportWorkspace";
import { bacaGudangImpor } from "@/lib/online-gudang-server";
import { branchCookie, parseBranchContext } from "@/lib/operational-context";

// Akses halaman = modul Penjualan (middleware); hak posting = RPC post_online_order (peran + cabang),
// sama seperti form order online manual.
export default async function ImporShopeePage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  // E4: bawaan cabang = cabang petshop aktif akun (bila sah); akun satu cabang langsung terkunci.
  const cabangAktif = parseBranchContext((await cookies()).get(branchCookie("petshop"))?.value, user?.id ?? "")?.branchId ?? null;
  const [{ data: gudang, error: whErr }, { data: me }] = await Promise.all([
    bacaGudangImpor(db, user?.id ?? "", cabangAktif),
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
  ]);
  if (whErr) console.error("[ImporShopeePage] gagal query gudang online:", whErr);
  const isOwner = !!me?.is_active && me.role === "OWNER";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan/online" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Impor pesanan Shopee</span>
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="IMPOR PESANAN SHOPEE" desc="Unggah ekspor pesanan, periksa pratinjau, lalu simpan sekaligus. Gudang otomatis mengikuti cabang." />
        {whErr ? (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
            <i className="ti ti-alert-circle" /> Gagal memuat daftar gudang. Muat ulang halaman; bila masih gagal, hubungi admin.
          </div>
        ) : gudang.cabang.length === 0 ? (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
            <i className="ti ti-alert-triangle" /> Akun ini belum terhubung ke cabang yang punya gudang toko. Minta admin mengatur cabang akun ini.
          </div>
        ) : (
          <ShopeeImportWorkspace cabang={gudang.cabang} terkunci={gudang.terkunci} defaultBranchId={gudang.terpilih?.id ?? ""} isOwner={isOwner} />
        )}
      </div>
    </>
  );
}
