"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { kendalaBatalKirim } from "@/lib/pemindahan";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function post(formData: FormData, receive: boolean) {
  const supabase = await createClient();
  const source = String(formData.get("source_transfer_id") ?? "");
  const back = receive ? `/pos/pemindahan/${source}` : "/pos/pemindahan/baru";
  let items: unknown;
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { items = []; }
  const { data, error } = await supabase.rpc("post_stock_transfer_atomic", {
    p_key: String(formData.get("request_key") ?? ""), p_source: receive ? source : null,
    p_from: receive ? null : String(formData.get("from_warehouse_id") ?? ""),
    p_to: receive ? null : String(formData.get("to_warehouse_id") ?? ""),
    p_date: String(formData.get("tanggal") ?? "") || hariIniWIB(),
    p_notes: String(formData.get("keterangan") ?? "").trim() || null, p_items: items,
  });
  if (error || !data) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Gagal menyimpan pemindahan.")}`);
  revalidatePath("/pos/pemindahan");
  redirect(`/pos/pemindahan/${receive ? source : data}?success=${encodeURIComponent("Pemindahan tersimpan.")}${transactionDraftAck(formData)}`);
}
export async function buatKirim(formData: FormData) { return post(formData, false); }
export async function terimaBarang(formData: FormData) { return post(formData, true); }

/**
 * Batalkan pengiriman (dokumen Kirim Barang yang belum diterima sama sekali).
 *
 * Semua pagar nyata ada di RPC `cancel_stock_transfer` (satu transaksi, dokumen
 * dikunci, izin diperiksa ulang). Pemeriksaan di sini cuma supaya pesannya
 * ramah sebelum bolak-balik ke database.
 */
export async function batalkanPengiriman(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("transfer_id") ?? "");
  const back = `/pos/pemindahan/${encodeURIComponent(id)}`;
  const alasan = String(formData.get("alasan") ?? "").trim();
  const kunci = String(formData.get("draft_key") ?? "");
  if (alasan.length < 3) redirect(`${back}?error=${encodeURIComponent("Alasan pembatalan wajib diisi (minimal 3 karakter).")}`);
  // Kunci kiriman ini yang bikin klik ganda tidak membalik stok dua kali. Tanpa bentuk yang
  // benar, database cuma balas error cast mentah -- ditahan di sini dengan pesan yang berguna.
  if (!UUID.test(kunci)) redirect(`${back}?error=${encodeURIComponent("Identitas pembatalan tidak lengkap. Muat ulang halaman lalu coba lagi.")}`);

  const { data: doc } = await supabase
    .from("stock_transfers").select("proses, status").eq("id", id).maybeSingle();
  if (!doc) redirect(`/pos/pemindahan?error=${encodeURIComponent("Dokumen pemindahan tidak ditemukan.")}`);
  // Dokumen yang sudah dibatalkan tetap diteruskan ke RPC: kiriman ulang dengan kunci
  // yang sama (tab kedua, koneksi putus) harus menjawab "sudah dibatalkan", bukan error.
  const kendala = doc!.status === "Dibatalkan" ? null : kendalaBatalKirim(doc as { proses: string; status: string | null });
  if (kendala) redirect(`${back}?error=${encodeURIComponent(kendala)}`);

  const { data, error } = await supabase.rpc("cancel_stock_transfer", {
    p_transfer_id: id,
    p_request_key: kunci,
    p_reason: alasan,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data || data.transfer_id !== id) throw new Error("Pembatalan belum terkonfirmasi. Muat ulang halaman sebelum mengulang.");
  for (const path of [back, "/pos/pemindahan", "/pos/stok", "/pos"]) revalidatePath(path);
  const pesan = data.already_cancelled
    ? "Pengiriman ini sudah dibatalkan sebelumnya. Tidak ada perubahan baru."
    : "Pengiriman dibatalkan. Barang sudah kembali ke gudang asal dengan harga pokok aslinya; dokumennya tetap tersimpan.";
  redirect(`${back}?success=${encodeURIComponent(pesan)}${transactionDraftAck(formData)}`);
}
