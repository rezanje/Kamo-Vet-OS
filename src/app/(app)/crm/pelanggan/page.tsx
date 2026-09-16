import { createClient } from "@/lib/supabase/server";
import { PelangganClient, type CustomerRow } from "./PelangganClient";

export default async function PelangganPage({ searchParams }: {
  searchParams: Promise<{ cari?: string; success?: string; error?: string }>;
}) {
  // `cari` datang dari pencarian global di topbar — layar terbuka langsung
  // menyorot pelanggannya, bukan daftar penuh yang harus ditelusuri lagi.
  const { cari, success, error: pesanError } = await searchParams;
  const supabase = await createClient();
  const { data: custData } = await supabase
    .from("customers")
    .select(
      "id, name, phone, email, dob, address, tier, kategori, category_id, points, total_spending, catatan, pekerjaan, sumber_info, created_at, " +
        "review_status_id, review_catatan, review_updated_at, " +
        "customer_categories(nama, diskon_persen), customer_review_statuses(nama, warna, nada), " +
        "pets(id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status, created_at)"
    )
    .order("total_spending", { ascending: false });

  const customers = (custData ?? []) as unknown as CustomerRow[];
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
      />
    </>
  );
}
