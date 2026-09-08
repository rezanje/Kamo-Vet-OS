"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type DetailPelanggan = {
  purchases: { tgl: string; produk: string; qty: number; total: number; cabang: string; anabul: string }[];
  ledger: { tgl: string; desc: string; delta: number; saldo: number }[];
  stat: { petshopCount: number; petshopTotal: number; klinikCount: number; klinikTotal: number; onlineCount: number; onlineTotal: number } | null;
};

export async function detailPelanggan(customerId: string): Promise<DetailPelanggan> {
  const kosong: DetailPelanggan = { purchases: [], ledger: [], stat: null };
  if (!customerId) return kosong;
  const supabase = await createClient();
  const [{ data: sales }, { data: ledger }, { data: userData }] = await Promise.all([
    supabase.from("sales").select("created_at, pets(name), branches(code), sale_items(nama, qty, harga)").eq("customer_id", customerId).order("created_at", { ascending: false }),
    supabase.from("point_ledger").select("created_at, description, delta, saldo").eq("customer_id", customerId).order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);
  const purchases: DetailPelanggan["purchases"] = [];
  for (const sale of (sales ?? []) as Record<string, unknown>[]) {
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
    supabase.from("sales").select("total, channel").eq("customer_id", customerId),
    supabase.from("invoices").select("total, visits!inner(customer_id)").eq("paid_status", "Lunas").is("voided_at", null).eq("visits.customer_id", customerId),
  ]);
  const stat = { petshopCount: 0, petshopTotal: 0, klinikCount: 0, klinikTotal: 0, onlineCount: 0, onlineTotal: 0 };
  for (const sale of (salesAgg ?? []) as { total: number; channel: string | null }[]) {
    if (sale.channel) { stat.onlineCount++; stat.onlineTotal += Number(sale.total || 0); }
    else { stat.petshopCount++; stat.petshopTotal += Number(sale.total || 0); }
  }
  for (const invoice of (invAgg ?? []) as { total: number }[]) { stat.klinikCount++; stat.klinikTotal += Number(invoice.total || 0); }
  return { purchases, ledger: pointHistory, stat };
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
