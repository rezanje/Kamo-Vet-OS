"use server";

import { redirect } from "next/navigation";

// Keep old mounted forms harmless while the verified administrative reset replaces them.
export async function resetSimulasiBarangDanStok() {
  redirect(`/pos/stok?error=${encodeURIComponent("Reset belum dijalankan. Pengelola harus memverifikasi cadangan dan cakupan seluruh cabang terlebih dahulu.")}`);
}
