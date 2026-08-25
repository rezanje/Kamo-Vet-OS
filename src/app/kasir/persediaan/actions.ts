"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { loadMasterPermintaan, parseBarisInput, siapkanBaris } from "@/lib/permintaan";
import { prosesTerimaPermintaan, type BarisTerima } from "@/lib/terima-permintaan";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";

// Buat permintaan barang dari dunia kasir — cabang asal otomatis dari shift terbuka.
export async function buatPermintaanKasir(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const priority = String(formData.get("priority") ?? "normal") === "tinggi" ? "tinggi" : "normal";

  if (!to_warehouse_id) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gudang tujuan wajib diisi."));
  }

  // Satuan & jenis barang ditentukan ulang dari master — kiriman klien tidak dipercaya.
  const input = parseBarisInput(formData.get("items"));
  const master = await loadMasterPermintaan(supabase, input.map((b) => String(b.item_id ?? "")));
  const { rows: baris, error: barisErr } = siapkanBaris(input, master);
  if (barisErr) redirect("/kasir/persediaan/baru?error=" + encodeURIComponent(barisErr));

  // no_request = PRM-YYYYMMDD-NNNN (urutan hari ini +1, padded 4). Today 2026-07-01.
  // Formatnya dibaca dari master penomoran; bawaannya PRM-YYYYMMDD-NNNN,
  // dilanjutkan dari nomor tertinggi hari itu.
  const { nomor: no_request } = await nomorBerikutnya(supabase, "PRM", hariIniWIB(), {
    table: "stock_requests", column: "no_request",
  });

  const { data: req, error: reqErr } = await supabase
    .from("stock_requests")
    .insert({ no_request, from_branch_id: shift.branch_id, to_warehouse_id, catatan, priority, requested_by: user.id })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  // §5: catatan per item ("stok menipis", dst) ikut tersimpan dari siapkanBaris.
  await supabase.from("stock_request_items").insert(
    baris.map((b) => ({ ...b, request_id: (req as { id: string }).id })),
  );

  revalidatePath("/kasir/persediaan");
  redirect("/kasir/persediaan?tab=permintaan&success=1");
}

// Penerimaan barang (Addendum §5): buat dokumen penerimaan (TRM) dgn rekonsiliasi
// dipesan vs diterima, tandai request Selesai, stok berpindah sesuai QTY DITERIMA.
// Seluruh aturannya ada di lib/terima-permintaan — dipakai bareng layar klinik.
export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) redirect("/kasir/persediaan?tab=penerimaan");

  let rows: BarisTerima[] = [];
  try {
    rows = JSON.parse(String(formData.get("items") ?? "[]")) as BarisTerima[];
  } catch {
    rows = [];
  }

  const hasil = await prosesTerimaPermintaan(supabase, {
    requestId, branchId: shift.branch_id, receivedBy: user.id, rows,
  });
  if (!hasil.ok) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent(hasil.error)}`);
  }

  revalidatePath("/kasir/persediaan");
  redirect(`/kasir/persediaan?tab=penerimaan&success=terima&trm=${hasil.receiptNumber}&selisih=${hasil.selisih}`);
}
