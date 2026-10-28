"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { allowedBranchIds, canUseBranch } from "@/lib/branch-access";
import { bacaBaris, nextNoDokumen, totalBaris } from "@/lib/penjualan-server";
import { validasiSatuanJual } from "@/lib/penjualan-satuan";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { hariIniWIB } from "@/lib/tanggal";

const FORM = "/penjualan/faktur/baru";
const BOLEH = ["OWNER", "ADMIN", "FINANCE", "STAFF"];

/**
 * Faktur Penjualan langsung dari halaman faktur, tanpa mengetik pesanan dulu.
 *
 * Jalurnya tetap rantai resmi Accurate: pesanan → pengiriman → faktur, hanya saja ketiganya
 * dibuat sekaligus. Dengan begitu stok, HPP (di pengiriman), piutang dan pendapatan (di faktur)
 * tetap diposting mesin yang sama dengan faktur dari halaman pesanan — tidak ada jalur
 * pembukuan kedua yang harus dirawat.
 */
export async function buatFakturLangsung(formData: FormData) {
  const supabase = await assertRole(FORM, "faktur penjualan", BOLEH);
  const gagal = (msg: string): never => redirect(`${FORM}?error=${encodeURIComponent(msg)}`);

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const jatuhTempo = String(formData.get("jatuh_tempo") ?? "").trim() || tanggal;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const requestKey = String(formData.get("request_key") ?? "").trim();

  if (!requestKey || requestKey.length > 100) gagal("Formulir tidak valid. Muat ulang halaman lalu coba lagi.");
  if (!customerId) gagal("Pilih pelanggan dulu.");
  if (!branchId) gagal("Pilih cabang dulu.");
  if (!warehouseId) gagal("Pilih gudang pengirim dulu.");
  if (jatuhTempo < tanggal) gagal("Jatuh tempo tidak boleh mendahului tanggal faktur.");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) gagal("Sesi login sudah berakhir. Masuk lagi lalu ulangi.");

  // Cabang dibatasi penempatan pengguna; database memeriksa ulang lewat user_can_access_branch.
  const allowed = await allowedBranchIds(supabase, user!.id);
  if (!canUseBranch(allowed, branchId)) gagal("Kamu tidak punya akses ke cabang itu.");
  const { data: izin, error: izinError } = await supabase.rpc("user_can_access_branch", { b: branchId });
  if (izinError || izin !== true) gagal("Kamu tidak punya akses ke cabang itu.");

  const { data: gudang, error: gudangError } = await supabase.from("warehouses")
    .select("id, branch_id, is_active").eq("id", warehouseId).maybeSingle();
  if (gudangError || !gudang) gagal("Gudang tidak ditemukan atau tidak dapat diakses.");
  if (!gudang!.is_active || gudang!.branch_id !== branchId) gagal("Gudang itu tidak aktif atau bukan milik cabang yang dipilih.");

  const parsed = bacaBaris(formData.get("items"));
  const { rows: baris, error: satuanError } = await validasiSatuanJual(supabase, parsed);
  if (satuanError) gagal(satuanError);
  if (baris.length === 0) gagal("Isi minimal satu baris barang atau jasa.");

  const noPesanan = await nextNoDokumen(supabase, "SO");
  const { data: order, error: orderError } = await supabase.from("sales_orders").insert({
    no_pesanan: noPesanan, customer_id: customerId, branch_id: branchId, warehouse_id: warehouseId,
    tanggal, rencana_kirim: tanggal, total: totalBaris(baris), catatan, created_by: user!.id,
  }).select("id").single();
  if (orderError || !order) gagal(orderError?.message ?? "Pesanan dasar faktur gagal disimpan.");

  const pesanan = `/penjualan/pesanan/${order!.id}`;
  const { data: items, error: itemError } = await supabase.from("sales_order_items").insert(
    baris.map((b) => ({
      order_id: order!.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, faktor: b.faktor ?? 1, qty: b.qty, harga: b.harga,
    })),
  ).select("id, qty");
  if (itemError || !items?.length) {
    await supabase.from("sales_orders").delete().eq("id", order!.id);
    gagal(itemError?.message ?? "Rincian barang gagal disimpan.");
  }

  const rincian = items!.map((row) => ({ order_item_id: String(row.id), qty: Number(row.qty) }))
    .sort((a, b) => a.order_item_id.localeCompare(b.order_item_id));

  // Pengiriman: stok keluar dan HPP diakui. Gagal di sini menyisakan pesanan yang bisa
  // dilanjutkan manual, bukan faktur setengah jadi.
  const kirim = await supabase.rpc("sales_create_delivery", {
    p_order_id: order!.id, p_request_key: `${requestKey}:kirim`,
    p_header: { tanggal, warehouse_id: warehouseId, catatan }, p_items: rincian,
  });
  if (kirim.error || !kirim.data?.document_id) {
    redirect(`${pesanan}?error=${encodeURIComponent(`${kirim.error?.message ?? "Pengiriman belum tersimpan."} Pesanan ${noPesanan} sudah dibuat — lanjutkan pengiriman dan fakturnya dari halaman ini.`)}`);
  }

  const faktur = await supabase.rpc("sales_create_invoice", {
    p_order_id: order!.id, p_request_key: `${requestKey}:faktur`,
    p_header: { tanggal, jatuh_tempo: jatuhTempo, catatan }, p_items: rincian,
  });
  if (faktur.error || !faktur.data?.document_id) {
    redirect(`${pesanan}?error=${encodeURIComponent(`${faktur.error?.message ?? "Faktur belum tersimpan."} Barang sudah tercatat keluar lewat pengiriman ${kirim.data!.document_no} — terbitkan fakturnya dari halaman ini.`)}`);
  }

  for (const path of ["/penjualan/faktur", "/penjualan/pesanan", "/penjualan/pengiriman",
    "/keuangan/piutang", "/keuangan/piutang/pembantu", "/laporan/penjual", "/"]) revalidatePath(path);
  redirect(`/penjualan/faktur/${faktur.data.document_id}?success=${encodeURIComponent(`Faktur ${faktur.data.document_no} terbit dari pesanan ${noPesanan}.`)}${transactionDraftAck(formData)}`);
}
