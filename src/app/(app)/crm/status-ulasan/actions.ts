"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/crm/status-ulasan";
const NADA = ["positif", "netral", "negatif"];

export async function simpanStatusUlasan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "status ulasan");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);
  const warna = String(formData.get("warna") ?? "").trim();
  const nada = String(formData.get("nada") ?? "netral");

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama status wajib diisi")}`);
  // Warna dipakai apa adanya sebagai gaya badge — pastikan benar-benar kode heksa.
  if (!/^#[0-9a-fA-F]{6}$/.test(warna)) {
    redirect(`${BACK}?error=${encodeURIComponent("Warna tidak valid")}`);
  }
  if (!NADA.includes(nada)) redirect(`${BACK}?error=${encodeURIComponent("Nada tidak valid")}`);

  const patch = { nama, warna: warna.toLowerCase(), nada };
  const { error } = id
    ? await supabase.from("customer_review_statuses").update(patch).eq("id", id)
    : await supabase.from("customer_review_statuses").insert(patch);

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pelanggan yang sudah diberi status ini masih menunjuk ke sini.
export async function toggleStatusUlasan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "status ulasan");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Status tidak valid")}`);

  const { error } = await supabase.from("customer_review_statuses").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
