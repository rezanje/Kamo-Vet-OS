"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";

type ItemInput = { nama: string; qty_diminta: number };

export async function buatPermintaanKlinik(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  const from_branch_id = shift?.branch_id ?? String(formData.get("from_branch_id") ?? "");
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const priority = String(formData.get("priority") ?? "normal");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const back = "/klinik/permintaan/baru";

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!from_branch_id || !to_warehouse_id || items.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Gudang tujuan & minimal 1 item wajib diisi")}`);
  }

  // Formatnya dibaca dari master penomoran; bawaannya PRM-YYYYMMDD-NNNN,
  // dilanjutkan dari nomor tertinggi hari itu.
  const { nomor: no_request } = await nomorBerikutnya(supabase, "PRM", hariIniWIB(), {
    table: "stock_requests", column: "no_request",
  });

  const { data: req, error } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id, to_warehouse_id, priority, catatan, requested_by: user.id })
    .select("id").single();
  if (error || !req) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal simpan permintaan")}`);

  await supabase.from("stock_request_items").insert(
    items.map((it) => ({ request_id: (req as { id: string }).id, nama: String(it.nama).slice(0, 160), qty_diminta: Number(it.qty_diminta) || 0 })),
  );

  redirect("/klinik/permintaan?success=1");
}
