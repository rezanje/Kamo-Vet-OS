"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { receiptSummary } from "@/lib/stock-recon";
import { transferStock } from "@/lib/inventory";

type ItemInput = { item_id?: string; nama: string; qty_diminta: number; catatan?: string };

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
    .insert({ no_request, from_branch_id: shift.branch_id, to_warehouse_id, catatan, priority, requested_by: user.id })
    .select("id")
    .single();

  if (reqErr || !req) {
    redirect("/kasir/persediaan/baru?error=" + encodeURIComponent("Gagal menyimpan permintaan."));
  }

  const rows = items.map((it) => ({
    request_id: (req as { id: string }).id,
    item_id: it.item_id || null, // tautan ke master barang (buat penerimaan/potong stok)
    nama: String(it.nama).slice(0, 160),
    qty_diminta: Number(it.qty_diminta) || 0,
    catatan: (it.catatan ?? "").trim() || null, // §5: catatan per item ("stok menipis", dst)
  }));
  await supabase.from("stock_request_items").insert(rows);

  revalidatePath("/kasir/persediaan");
  redirect("/kasir/persediaan?tab=permintaan&success=1");
}

type TerimaRow = { id: string; item_id: string | null; nama?: string; qty_diminta?: number; qty_diterima: number; kondisi: string; notes?: string };

// Penerimaan barang (Addendum §5): buat dokumen penerimaan (TRM) dgn rekonsiliasi
// dipesan vs diterima, tandai request Selesai, stok bertambah sesuai QTY DITERIMA.
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

  // Gudang asal (DC pengirim) & gudang tujuan (retail cabang shift) wajib ketemu.
  // Dulu blok stok diam-diam dilewati kalau gudang tujuan tidak ada → dokumen bilang
  // "berhasil" tapi stok tidak pernah bertambah.
  const { data: req } = await supabase
    .from("stock_requests").select("to_warehouse_id").eq("id", requestId).maybeSingle();
  if (!req?.to_warehouse_id) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent("Permintaan tidak ditemukan atau gudang pengirimnya kosong.")}`);
  }

  const { data: wh } = await supabase
    .from("warehouses").select("id")
    .eq("branch_id", shift.branch_id).eq("is_active", true)
    .order("code").limit(1).maybeSingle();
  if (!wh) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent("Cabang ini belum punya gudang aktif — stok tidak bisa masuk. Hubungi admin.")}`);
  }

  // Pindah stok DULU (DC berkurang → cabang bertambah). Kalau gagal, dokumen
  // penerimaan tidak jadi dibuat — lebih baik gagal terang daripada "berhasil" palsu.
  // Hanya barang kondisi "baik" yang jadi stok jual; rusak/kurang tetap tercatat penuh
  // di dokumen TRM sebagai basis klaim ke DC.
  // ponytail: gagal di tengah loop bisa menyisakan sebagian item terpindah — upgrade
  // ke RPC Postgres satu transaksi kalau ini pernah kejadian di produksi.
  let stokErr: string | null = null;
  try {
    for (const row of rows) {
      if (!row.item_id) continue;
      if ((row.kondisi || "baik").toLowerCase() !== "baik") continue;
      const qty = Number(row.qty_diterima) || 0;
      if (qty <= 0) continue;
      await transferStock(supabase, {
        fromWarehouseId: req!.to_warehouse_id as string,
        toWarehouseId: wh!.id as string,
        itemId: row.item_id,
        qty,
        source: "terima-permintaan",
        ref: requestId,
      });
    }
  } catch (e) {
    stokErr = e instanceof Error ? e.message : "gagal memperbarui stok";
  }
  if (stokErr) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent(`Penerimaan dibatalkan — stok gagal diperbarui (${stokErr})`)}`);
  }

  // dokumen penerimaan TRM-YYMMDD-NNN (§5).
  const now = new Date();
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const { count } = await supabase
    .from("stock_receipts").select("id", { count: "exact", head: true })
    .like("receipt_number", `TRM-${ymd}-%`);
  const receiptNumber = `TRM-${ymd}-${String((count ?? 0) + 1).padStart(3, "0")}`;

  const { data: receipt, error: recErr } = await supabase
    .from("stock_receipts")
    .insert({ receipt_number: receiptNumber, stock_request_id: requestId, received_by: user.id })
    .select("id").single();
  if (recErr || !receipt) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent(recErr?.message ?? "Gagal buat dokumen penerimaan")}`);
  }

  await supabase.from("stock_receipt_items").insert(
    rows.map((r) => ({
      stock_receipt_id: receipt!.id,
      item_id: r.item_id,
      nama: String(r.nama ?? "").slice(0, 160) || "—",
      qty_ordered: Number(r.qty_diminta) || 0,
      qty_received: Number(r.qty_diterima) || 0,
      condition: (r.kondisi || "baik").toLowerCase(),
      notes: (r.notes ?? "").trim() || null,
    })),
  );

  // legacy view di list lama tetap terisi.
  for (const row of rows) {
    await supabase
      .from("stock_request_items")
      .update({ qty_diterima: Number(row.qty_diterima) || 0, kondisi: row.kondisi || null })
      .eq("id", row.id);
  }

  await supabase.from("stock_requests").update({ status: "Selesai" }).eq("id", requestId);

  const summary = receiptSummary(rows.map((r) => ({ qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0 })));

  // ponytail: transfer internal antar gudang sendiri (DC → cabang) tidak dijurnal ulang —
  // nilainya sudah tercatat sbg Persediaan saat stok masuk di gudang asal; di sini cuma
  // pindah lokasi qty (sudah dikerjakan di atas sebelum dokumen dibuat).

  revalidatePath("/kasir/persediaan");
  redirect(`/kasir/persediaan?tab=penerimaan&success=terima&trm=${receiptNumber}&selisih=${summary.selisih}`);
}
