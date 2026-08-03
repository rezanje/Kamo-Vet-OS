"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { bacaBaris, nextNoDokumen, totalBaris } from "@/lib/penjualan-server";

const BASE = "/penjualan/penawaran";
const BOLEH = ["OWNER", "ADMIN", "FINANCE", "STAFF"];
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

export async function buatPenawaran(formData: FormData) {
  const supabase = await assertRole(BASE, "penawaran penjualan", BOLEH);

  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const berlaku = String(formData.get("berlaku_sampai") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const baris = bacaBaris(formData.get("items"));
  if (!customerId) gagal("Pilih pelanggan dulu");
  if (baris.length === 0) gagal("Isi minimal satu baris barang atau jasa");
  if (berlaku && berlaku < tanggal) gagal("Masa berlaku selesai sebelum tanggal penawaran");

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "SQ");

  const { data: doc, error } = await supabase.from("sales_quotations").insert({
    no_penawaran: no, customer_id: customerId, branch_id: branchId, tanggal,
    berlaku_sampai: berlaku, total: totalBaris(baris), catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !doc) gagal(error?.message ?? "Gagal menyimpan penawaran");

  const { error: itemErr } = await supabase.from("sales_quotation_items").insert(
    baris.map((b) => ({
      quotation_id: doc!.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, qty: b.qty, harga: b.harga,
    })),
  );
  if (itemErr) {
    // Kepala tanpa baris = penawaran kosong yang tetap memakan nomor dokumen.
    await supabase.from("sales_quotations").delete().eq("id", doc!.id);
    gagal(itemErr.message);
  }

  redirect(`${BASE}?success=${encodeURIComponent(`Penawaran ${no} dibuat.`)}`);
}

export async function ubahStatusPenawaran(formData: FormData) {
  const supabase = await assertRole(BASE, "penawaran penjualan", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) gagal("Penawaran tidak valid");
  if (!["draft", "dikirim", "diterima", "ditolak"].includes(status)) gagal("Status tidak dikenal");

  const { error } = await supabase.from("sales_quotations").update({ status }).eq("id", id);
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=${encodeURIComponent("Status penawaran diperbarui.")}`);
}

/** Salin penawaran jadi pesanan. Penawaran ikut ditandai diterima. */
export async function jadikanPesanan(formData: FormData) {
  const supabase = await assertRole(BASE, "pesanan penjualan", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Penawaran tidak valid");

  const { data: q } = await supabase
    .from("sales_quotations")
    .select("id, no_penawaran, customer_id, branch_id, total, catatan, sales_quotation_items(item_id, nama, satuan, qty, harga)")
    .eq("id", id).maybeSingle();
  if (!q) gagal("Penawaran tidak ditemukan");

  const { data: sudah } = await supabase
    .from("sales_orders").select("id, no_pesanan").eq("quotation_id", id).maybeSingle();
  if (sudah) gagal(`Penawaran ini sudah jadi pesanan ${sudah.no_pesanan}`);

  const baris = (q!.sales_quotation_items ?? []) as
    { item_id: string | null; nama: string; satuan: string | null; qty: number; harga: number }[];
  if (baris.length === 0) gagal("Penawaran ini tidak punya baris");

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "SO");

  const { data: so, error } = await supabase.from("sales_orders").insert({
    no_pesanan: no, quotation_id: id, customer_id: q!.customer_id, branch_id: q!.branch_id,
    total: q!.total, catatan: q!.catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !so) gagal(error?.message ?? "Gagal membuat pesanan");

  await supabase.from("sales_order_items").insert(
    baris.map((b) => ({
      order_id: so!.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, qty: b.qty, harga: b.harga,
    })),
  );
  await supabase.from("sales_quotations").update({ status: "diterima" }).eq("id", id);

  redirect(`/penjualan/pesanan/${so!.id}?success=${encodeURIComponent(`Pesanan ${no} dibuat dari ${q!.no_penawaran}.`)}`);
}
