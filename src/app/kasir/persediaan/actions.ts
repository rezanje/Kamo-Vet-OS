"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { parseBarisInput } from "@/lib/permintaan";
import { prosesTerimaPermintaan, type BarisTerima } from "@/lib/terima-permintaan";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

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
  const requestKey = String(formData.get("request_key") ?? "");
  const scope = `cashier-stock-request:${shift.branch_id}`;
  const fail = (message: string): never => redirect("/kasir/persediaan/baru?error=" + encodeURIComponent(message));

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    fail("Identitas permintaan belum siap. Muat ulang halaman dan periksa draf sebelum mengirim.");
  }
  if (!to_warehouse_id) fail("Gudang tujuan wajib diisi.");

  const baris = parseBarisInput(formData.get("items"))
    .filter((row) => row?.item_id && Number(row.qty_diminta) > 0)
    .map((row) => ({ item_id: String(row.item_id), qty_diminta: Number(row.qty_diminta), satuan: row.satuan ?? "", catatan: row.catatan ?? "" }));
  if (!baris.length) fail("Minimal 1 barang dengan jumlah lebih dari 0.");

  // The database checks live branch/shift access and resolves item snapshots.
  // Header, lines and global numbering commit together; an identical retry
  // returns the original request, including after a lost response.
  const { data: requestId, error } = await supabase.rpc("create_cashier_stock_request_atomic", {
    p_key: requestKey, p_branch_id: shift.branch_id, p_to_warehouse_id: to_warehouse_id,
    p_priority: priority, p_notes: catatan, p_items: baris,
  });
  if (error || !requestId) fail(error?.message ?? "Hasil simpan permintaan belum terkonfirmasi. Draf tetap tersedia; periksa daftar permintaan sebelum mengirim ulang.");

  revalidatePath("/kasir/persediaan");
  redirect(`/kasir/persediaan?tab=permintaan&success=1&draft_done=${encodeURIComponent(requestKey)}&draft_scope=${encodeURIComponent(scope)}`);
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
  const requestKey = String(formData.get("request_key") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    redirect(`/kasir/persediaan?tab=penerimaan&error=${encodeURIComponent("Identitas penerimaan belum siap. Muat ulang halaman dan periksa draf sebelum mengirim.")}`);
  }
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
  redirect(`/kasir/persediaan?tab=penerimaan&success=terima&trm=${hasil.receiptNumber}&selisih=${hasil.selisih}${transactionDraftAck(formData)}`);
}
