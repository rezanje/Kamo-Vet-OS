import { readListPage } from "@/lib/checked-list";
import { ListLoadFailure } from "@/components/ListPagination";
import { createClient } from "@/lib/supabase/server";
import { filterCariPelanggan } from "@/lib/pelanggan-cari";
import { PelangganClient, type CustomerRow } from "./PelangganClient";

const KOLOM_PELANGGAN =
  "id, name, phone, email, dob, address, tier, kategori, category_id, points, total_spending, catatan, pekerjaan, sumber_info, created_at, " +
  "review_status_id, review_catatan, review_updated_at, " +
  "customer_categories(nama, diskon_persen), customer_review_statuses(nama, warna, nada), " +
  "pets(id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status, created_at)";
const TIER = ["Bronze", "Silver", "Gold", "Platinum"] as const;

export default async function PelangganPage({ searchParams }: {
  searchParams: Promise<{ cari?: string; hal?: string; success?: string; error?: string }>;
}) {
  // `cari` datang dari kotak cari halaman ini atau pencarian global di topbar.
  const { cari, hal, success, error: pesanError } = await searchParams;
  const supabase = await createClient();
  const filter = cari ? filterCariPelanggan(cari) : null;

  // Dulu SEMUA pelanggan (10.000+, beserta anabulnya) dimuat lalu disaring di browser —
  // halaman ini & kasir jadi lambat (1 Nov 2026). Sekarang: ringkasan dihitung database,
  // daftar dimuat per halaman (50 baris), pencarian dijalankan di server.
  const hitung = (tier?: string) => {
    let q = supabase.from("customers").select("id", { count: "exact", head: true });
    if (tier) q = q.eq("tier", tier);
    return q.then(({ count, error }) => { if (error || typeof count !== "number") throw new Error("count"); return count; });
  };
  const hitungMember = async () => {
    const { data, error } = await supabase.from("customer_categories").select("id").eq("nama", "Member");
    if (error) throw new Error("count");
    const ids = (data ?? []).map((row) => row.id as string);
    if (!ids.length) return 0;
    const { count, error: countError } = await supabase.from("customers").select("id", { count: "exact", head: true }).in("category_id", ids);
    if (countError || typeof count !== "number") throw new Error("count");
    return count;
  };

  let customers: CustomerRow[];
  let total: number;
  let pageInfo: { page: number; from: number; totalPages: number };
  let stats: { total: number; member: number; tierCounts: Record<string, number> };
  try {
    const [daftar, semua, member, ...perTier] = await Promise.all([
      readListPage<CustomerRow>(async (from, to) => {
        let q = supabase.from("customers").select(KOLOM_PELANGGAN, { count: "exact" });
        if (filter) q = q.or(filter);
        const result = await q.order("total_spending", { ascending: false }).order("id").range(from, to);
        return { ...result, data: result.data as unknown as CustomerRow[] | null };
      }, "Pelanggan", hal),
      hitung(), hitungMember(), ...TIER.map((tier) => hitung(tier)),
    ]);
    customers = daftar.rows;
    total = daftar.count;
    pageInfo = daftar.pageInfo;
    stats = { total: semua, member, tierCounts: Object.fromEntries(TIER.map((tier, i) => [tier, perTier[i]])) };
  } catch (error) { return <ListLoadFailure error={error} label="Pelanggan" />; }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isAdmin = !!me && ["OWNER", "ADMIN"].includes(me.role);

  // Kartu anabul hasil pembersihan duplikat (status 'Digabung', migrasi 0076)
  // riwayatnya sudah dipindah ke kartu induk — jangan ditampilkan lagi supaya
  // daftar anabul tidak kelihatan dobel. Disaring di sini, bukan di query,
  // karena filter pada tabel bersarang akan ikut membuang pelanggan tanpa anabul.
  const enriched = customers.map((c) => ({
    ...c,
    pets: (c.pets ?? []).filter((p) => p.status === "Aktif"),
    purchases: [], ledger: [], stat: null,
  }));

  // Golongan aktif untuk dropdown; diskonnya ditampilkan biar admin sadar dampaknya.
  const [{ data: katData }, { data: ulasanData }] = await Promise.all([
    supabase.from("customer_categories").select("id, nama, diskon_persen").eq("is_active", true).order("nama"),
    supabase.from("customer_review_statuses").select("id, nama, warna, nada").eq("is_active", true).order("nama"),
  ]);
  const categories = (katData ?? []).map((k) => ({ ...k, diskon_persen: Number(k.diskon_persen) }));
  const statusUlasan = (ulasanData ?? []) as { id: string; nama: string; warna: string; nada: string }[];

  return (
    <>
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {pesanError && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {pesanError}
        </div>
      )}
      <PelangganClient
        cariAwal={cari ?? ""} customers={enriched} isAdmin={isAdmin}
        categories={categories} statusUlasan={statusUlasan}
        total={total} stats={stats} halaman={pageInfo}
      />
    </>
  );
}
