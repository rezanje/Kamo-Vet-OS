"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";

type ItemInput = { nama: string; qty_diminta: number };

// Buat permintaan barang dari dunia kasir — cabang asal otomatis dari shift terbuka.
export async function buatPermintaanKasir(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  // hanya baris dengan nama terisi yang dipakai.
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!to_warehouse_id || items.length === 0) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gudang tujuan dan minimal 1 item wajib diisi."));
  }

  // no_request = PRM-YYYYMMDD-NNNN (urutan hari ini +1, padded 4). Today 2026-07-01.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ymd = `${y}${m}${d}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfDay.toISOString());
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const no_request = `PRM-${ymd}-${seq}`;

  const { data: req, error: reqErr } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id: shift.branch_id, to_warehouse_id, catatan })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  const rows = items.map((it) => ({
    request_id: (req as { id: string }).id,
    nama: String(it.nama).slice(0, 160),
    qty_diminta: Number(it.qty_diminta) || 0,
  }));
  await supabase.from("stock_request_items").insert(rows);

  revalidatePath("/kasir/persediaan");
  redirect("/kasir/persediaan?tab=permintaan&success=1");
}

type TerimaRow = { id: string; item_id: string | null; qty_diterima: number; kondisi: string };

// Penerimaan barang (§2.4): catat qty diterima + kondisi per item, tandai request Selesai,
// lalu tambahkan qty ke gudang cabang penerima.
export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) redirect("/kasir/persediaan?tab=penerimaan");

  let rows: TerimaRow[] = [];
  try {
    rows = JSON.parse(String(formData.get("items") ?? "[]")) as TerimaRow[];
  } catch {
    rows = [];
  }

  for (const row of rows) {
    await supabase
      .from("stock_request_items")
      .update({ qty_diterima: Number(row.qty_diterima) || 0, kondisi: row.kondisi || null })
      .eq("id", row.id);
  }

  await supabase.from("stock_requests").update({ status: "Selesai" }).eq("id", requestId);

  // ponytail: transfer internal antar gudang sendiri (DC → cabang) tidak dijurnal ulang —
  // nilainya sudah tercatat sbg Persediaan saat stok masuk di gudang asal; di sini cuma
  // pindah lokasi qty ke gudang cabang penerima.
  const { data: wh } = await supabase
    .from("warehouses")
    .select("id")
    .eq("branch_id", shift.branch_id)
    .eq("is_active", true)
    .order("code")
    .limit(1)
    .maybeSingle();

  if (wh) {
    for (const row of rows) {
      if (!row.item_id) continue;
      const qty = Number(row.qty_diterima) || 0;
      if (qty <= 0) continue;

      const { data: existing } = await supabase
        .from("stock")
        .select("qty")
        .eq("warehouse_id", wh.id)
        .eq("item_id", row.item_id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("stock")
          .update({ qty: Number(existing.qty) + qty, updated_at: new Date().toISOString() })
          .eq("warehouse_id", wh.id)
          .eq("item_id", row.item_id);
      } else {
        await supabase.from("stock").insert({ warehouse_id: wh.id, item_id: row.item_id, qty });
      }
    }
  }

  revalidatePath("/kasir/persediaan");
  redirect("/kasir/persediaan?tab=penerimaan&success=terima");
}
