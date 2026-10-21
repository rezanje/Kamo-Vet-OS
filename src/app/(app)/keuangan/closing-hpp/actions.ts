"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { INVENTORY_CLOSING_PATH } from "@/lib/inventory-closing";
import { validReportDate } from "@/lib/hpp-reports";
import { hariIniWIB } from "@/lib/tanggal";

const fail = (message: string): never => redirect(`${INVENTORY_CLOSING_PATH}?error=${encodeURIComponent(message)}`);
function success(message: string): never {
  for (const path of [INVENTORY_CLOSING_PATH, "/laporan/nilai-persediaan", "/pos/sku", "/keuangan/tutup-buku"]) revalidatePath(path);
  redirect(`${INVENTORY_CLOSING_PATH}?success=${encodeURIComponent(message)}`);
}

export async function activateAverage() {
  const client = await createClient();
  const { data, error } = await client.rpc("activate_moving_average");
  if (error) fail(error.message);
  if (!data || typeof data !== "object") fail("Hasil aktivasi belum terkonfirmasi. Muat ulang status sebelum mencoba lagi.");
  success("Metode rata-rata bergerak aktif. HPP transaksi sebelumnya tetap tersimpan.");
}

export async function closeInventoryMonth(formData: FormData) {
  const month = String(formData.get("month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month) || !validReportDate(`${month}-01`) || month >= hariIniWIB().slice(0, 7)) fail("Pilih bulan yang sudah selesai.");
  const client = await createClient();
  const { data, error } = await client.rpc("close_inventory_month", { p_month: `${month}-01` });
  if (error) fail(error.message);
  if (!data || typeof data !== "object") fail("Hasil closing belum terkonfirmasi. Muat ulang riwayat sebelum mencoba lagi.");
  success(`Closing HPP ${month} tersimpan dan periode terkunci.`);
}
