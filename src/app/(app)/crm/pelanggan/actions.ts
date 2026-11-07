"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCompletedSale } from "@/lib/sale-payment-reporting";

export type DetailPelanggan = {
  purchases: { tgl: string; produk: string; qty: number; total: number; cabang: string; anabul: string }[];
  ledger: { tgl: string; desc: string; delta: number; saldo: number }[];
  stat: { petshopCount: number; petshopTotal: number; klinikCount: number; klinikTotal: number; onlineCount: number; onlineTotal: number } | null;
  /** Transaksi selesai per cabang (petshop, online, klinik) — membantu melacak kartu umum yang dipakai lintas cabang. */
  perCabang?: { cabang: string; count: number; total: number }[];
};

export async function detailPelanggan(customerId: string): Promise<DetailPelanggan> {
  const kosong: DetailPelanggan = { purchases: [], ledger: [], stat: null };
  if (!customerId) return kosong;
  const supabase = await createClient();
  const [{ data: sales }, { data: ledger }, { data: userData }] = await Promise.all([
    supabase.from("sales").select("created_at, payment_plan, payments_finalized_at, voided_at, pets(name), branches(code), sale_items(nama, qty, harga)").eq("customer_id", customerId).order("created_at", { ascending: false }),
    supabase.from("point_ledger").select("created_at, description, delta, saldo").eq("customer_id", customerId).order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);
  const purchases: DetailPelanggan["purchases"] = [];
  for (const sale of (sales ?? []).filter(isCompletedSale) as Record<string, unknown>[]) {
    const branchRel = sale.branches as { code: string } | { code: string }[] | null;
    const petRel = sale.pets as { name: string } | { name: string }[] | null;
    const branch = Array.isArray(branchRel) ? branchRel[0] : branchRel;
    const pet = Array.isArray(petRel) ? petRel[0] : petRel;
    for (const item of (sale.sale_items as { nama: string; qty: number; harga: number }[]) ?? []) {
      purchases.push({ tgl: sale.created_at as string, produk: item.nama, qty: item.qty, total: item.qty * item.harga, cabang: branch?.code ?? "—", anabul: pet?.name ?? "—" });
    }
  }
  const pointHistory = (ledger ?? []).map((item) => ({ tgl: item.created_at as string, desc: (item.description as string | null) ?? "—", delta: Number(item.delta), saldo: Number(item.saldo) }));
  const { data: me } = await supabase.from("profiles").select("role").eq("id", userData.user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) return { purchases, ledger: pointHistory, stat: null };
  const [{ data: salesAgg }, { data: invAgg }] = await Promise.all([
    supabase.from("sales").select("total, channel, payment_plan, payments_finalized_at, voided_at, branches(name)").eq("customer_id", customerId),
    supabase.from("invoices").select("total, visits!inner(customer_id, branches(name))").eq("paid_status", "Lunas").is("voided_at", null).eq("visits.customer_id", customerId),
  ]);
  type Rel<T> = T | T[] | null | undefined;
  const namaCabang = (rel: Rel<{ name: string }>) => (Array.isArray(rel) ? rel[0] : rel)?.name ?? "Tanpa cabang";
  const cabang = new Map<string, { cabang: string; count: number; total: number }>();
  const tambahCabang = (nama: string, total: number) => {
    const row = cabang.get(nama) ?? { cabang: nama, count: 0, total: 0 };
    row.count++; row.total += total;
    cabang.set(nama, row);
  };
  const stat = { petshopCount: 0, petshopTotal: 0, klinikCount: 0, klinikTotal: 0, onlineCount: 0, onlineTotal: 0 };
  for (const sale of (salesAgg ?? []).filter(isCompletedSale) as { total: number; channel: string | null; branches?: Rel<{ name: string }> }[]) {
    const total = Number(sale.total || 0);
    if (sale.channel) { stat.onlineCount++; stat.onlineTotal += total; }
    else { stat.petshopCount++; stat.petshopTotal += total; }
    tambahCabang(namaCabang(sale.branches), total);
  }
  for (const invoice of (invAgg ?? []) as { total: number; visits?: Rel<{ branches?: Rel<{ name: string }> }> }[]) {
    const total = Number(invoice.total || 0);
    stat.klinikCount++; stat.klinikTotal += total;
    const visit = Array.isArray(invoice.visits) ? invoice.visits[0] : invoice.visits;
    tambahCabang(namaCabang(visit?.branches), total);
  }
  const perCabang = [...cabang.values()].sort((a, b) => b.count - a.count || a.cabang.localeCompare(b.cabang));
  return { purchases, ledger: pointHistory, stat, perCabang };
}

// Golongan pelanggan hanya boleh diubah OWNER/ADMIN (pola crm/promo).
export async function updateKategoriPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah golongan")}`);
  }

  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  if (!id) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}`);

  // Id golongan dari form diverifikasi ada & aktif — jangan percaya kiriman klien.
  if (categoryId) {
    const { data: kat } = await supabase
      .from("customer_categories").select("id").eq("id", categoryId).eq("is_active", true).maybeSingle();
    if (!kat) redirect(`/crm/pelanggan?error=${encodeURIComponent("Golongan tidak valid")}`);
  }

  await supabase.from("customers").update({ category_id: categoryId }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}

// Status ulasan: label yang dipasang manajemen ke pelanggan (mis. "Bintang 1
// Google"). Sama seperti golongan — hanya OWNER/ADMIN yang boleh mengubah,
// tapi semua peran boleh melihatnya.
export async function updateUlasanPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah status ulasan")}`);
  }

  const id = String(formData.get("id") ?? "");
  const statusId = String(formData.get("review_status_id") ?? "").trim() || null;
  const catatan = String(formData.get("review_catatan") ?? "").trim().slice(0, 500) || null;
  if (!id) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}`);

  // Id status dari form diverifikasi ada & aktif — jangan percaya kiriman klien.
  if (statusId) {
    const { data: st } = await supabase
      .from("customer_review_statuses").select("id").eq("id", statusId).eq("is_active", true).maybeSingle();
    if (!st) redirect(`/crm/pelanggan?error=${encodeURIComponent("Status ulasan tidak valid")}`);
  }

  await supabase.from("customers").update({
    review_status_id: statusId,
    review_catatan: statusId ? catatan : null,
    // Kosongkan waktunya kalau statusnya dicabut — biar tidak ada tanggal menggantung.
    review_updated_at: statusId ? new Date().toISOString() : null,
  }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}

// Sembunyikan / tampilkan lagi kartu pelanggan di pemilih pelanggan transaksi baru
// (kasir, POS, faktur, uang muka). Riwayat, poin, dan laporan tidak diubah.
// Database ikut menjaga: hanya OWNER/ADMIN yang boleh, pelaku & waktu diisi server.
export async function aturSembunyiPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa menyembunyikan pelanggan")}`);
  }

  const id = String(formData.get("id") ?? "");
  const sembunyikan = String(formData.get("aksi") ?? "") === "sembunyikan";
  const alasan = String(formData.get("hidden_reason") ?? "").trim().slice(0, 300) || null;
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 100);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}`);

  const { data, error } = await supabase.from("customers").update(sembunyikan
    ? { hidden_at: new Date().toISOString(), hidden_by: user!.id, hidden_reason: alasan }
    : { hidden_at: null, hidden_by: null, hidden_reason: null },
  ).eq("id", id).select("id");
  const kembali = nama ? `&cari=${encodeURIComponent(nama)}` : "";
  if (error) {
    const belumSiap = error.code === "42703" || error.code === "PGRST204" || /hidden_/.test(error.message ?? "");
    redirect(`/crm/pelanggan?error=${encodeURIComponent(belumSiap
      ? "Fitur sembunyikan pelanggan belum aktif di database. Hubungi tim pengembang."
      : "Gagal menyimpan. Coba lagi.")}${kembali}`);
  }
  if (!data?.length) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak ditemukan")}${kembali}`);
  revalidatePath("/crm/pelanggan");
  redirect(`/crm/pelanggan?success=${encodeURIComponent(sembunyikan
    ? "Pelanggan disembunyikan — tidak muncul lagi saat kasir mencari pelanggan."
    : "Pelanggan ditampilkan lagi di pencarian kasir.")}${kembali}`);
}

// Ubah data pelanggan (nama pemilik, email, alamat, pekerjaan) — permintaan klinik 6 Nov 2026:
// nama yang salah ketik saat registrasi selama ini tidak bisa dibetulkan. No. HP sengaja
// tidak ikut diubah di sini karena jadi kunci pengenal pelanggan di kasir & registrasi.
// Hanya OWNER/ADMIN; perubahan otomatis tercatat di riwayat aktivitas pelanggan.
export async function ubahDataPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const id = String(formData.get("id") ?? "");
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 30);
  const kembali = phone ? `&cari=${encodeURIComponent(phone)}` : "";
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah data pelanggan")}${kembali}`);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}${kembali}`);

  const nama = String(formData.get("nama") ?? "").replace(/\s+/g, " ").trim();
  if (!nama) redirect(`/crm/pelanggan?error=${encodeURIComponent("Nama pelanggan wajib diisi")}${kembali}`);
  if (nama.length > 100) redirect(`/crm/pelanggan?error=${encodeURIComponent("Nama pelanggan maksimal 100 huruf")}${kembali}`);
  const email = String(formData.get("email") ?? "").trim().slice(0, 120) || null;
  const alamat = String(formData.get("alamat") ?? "").trim().slice(0, 500) || null;
  const pekerjaan = String(formData.get("pekerjaan") ?? "").trim().slice(0, 80) || null;

  const { data, error } = await supabase.from("customers")
    .update({ name: nama, email, address: alamat, pekerjaan })
    .eq("id", id).select("id");
  if (error) redirect(`/crm/pelanggan?error=${encodeURIComponent("Gagal menyimpan data pelanggan. Coba lagi.")}${kembali}`);
  if (!data?.length) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak ditemukan")}${kembali}`);
  revalidatePath("/crm/pelanggan");
  redirect(`/crm/pelanggan?success=${encodeURIComponent("Data pelanggan tersimpan.")}${kembali}`);
}
