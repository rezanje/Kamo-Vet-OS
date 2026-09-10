"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RESET_SIMULASI_TOTAL_PHRASE } from "@/lib/simulasi-reset";

const BACK = "/pos/stok";

export async function resetSimulasiBarangDanStok(formData: FormData) {
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  const understoodImpact = String(formData.get("understood_impact") ?? "") === "1";
  const gagal = (message: string): never => redirect(`${BACK}?error=${encodeURIComponent(message)}`);

  if (!understoodImpact || confirmation !== RESET_SIMULASI_TOTAL_PHRASE) {
    gagal(`Centang persetujuan lalu ketik ${RESET_SIMULASI_TOTAL_PHRASE} dengan tepat.`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER") gagal("Reset simulasi total hanya bisa dijalankan Owner.");

  // Fungsi database menjalankan seluruh penghapusan dalam satu transaksi dan
  // mengulang cek Owner + frasa agar request langsung pun tetap aman.
  // Tipe Supabase dibuat sebelum fungsi migrasi ada, jadi RPC sengaja dipanggil
  // lewat bentuk minimal ini; validasi sesungguhnya tetap di database.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("reset_simulasi_barang_dan_stok", {
    p_confirmation: confirmation,
  });
  if (error) gagal("Reset belum dijalankan. Data lama tetap utuh; coba lagi dari halaman Stok.");

  revalidatePath("/pos/stok");
  revalidatePath("/pos/sku");
  revalidatePath("/pos/sku/impor");
  revalidatePath("/pos/kartu-stok");
  revalidatePath("/pembelian");
  revalidatePath("/penjualan");
  redirect(`${BACK}?success=${encodeURIComponent("Reset simulasi selesai. Barang, stok, dan transaksi simulasi terkait sudah kosong.")}`);
}
