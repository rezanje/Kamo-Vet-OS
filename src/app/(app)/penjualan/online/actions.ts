"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { hitungKomisi, isMarketplace } from "@/lib/online";

const BACK = "/penjualan/online";

// Duplikat kecil dari src/app/me/actions.ts (house style — bukan modul bersama baru).
// Server Vercel jalan di UTC tapi bisnisnya WIB (UTC+7); "hari ini" harus dihitung WIB
// supaya operator jam 00:00–07:00 WIB tidak ditolak "tanggal masa depan" (I2).
function todayJakarta(): string {
  // WIB (UTC+7) date string YYYY-MM-DD.
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}


// Order online: TANPA shift kasir (shift_id null) — settlement bukan tunai fisik.
// Marketplace → Dr 1202 Piutang Marketplace; WA → Dr 1102 Bank (lunas seketika).
export async function buatPenjualanOnline(formData: FormData) {
  const db = await createClient();
  const key = String(formData.get("request_key") ?? "");
  const fail = (msg: string) => redirect(`${BACK}/baru?error=${encodeURIComponent(msg)}`);
  if (!key) fail("Identitas simpan belum tersedia. Muat ulang formulir.");
  let items: unknown;
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { fail("Data barang tidak valid."); }
  const header = Object.fromEntries(["channel", "warehouse_id", "buyer_name", "external_ref", "customer_id"].map(k => [k, String(formData.get(k) ?? "")]));
  header.tanggal = String(formData.get("tanggal") ?? "") || todayJakarta();
  const { data, error } = await db.rpc("post_online_order", {p_request_key:key,p_header:header,p_items:items});
  if (error || !data) fail(error?.message ?? "Respons simpan belum terkonfirmasi. Periksa hasil transaksi terakhir sebelum menyimpan ulang.");
  revalidatePath(BACK);
  redirect(`${BACK}/baru?success=${encodeURIComponent(`Order ${data.document_no} tersimpan.`)}&request_scope=online&request_done=${encodeURIComponent(key)}`);
}

// Pencairan marketplace: input dana yang benar-benar masuk bank; selisihnya = komisi platform.
// ponytail: 1 order = 1 pencairan. Kalau volume naik dan platform mencairkan
// banyak order sekaligus, naikkan ke pencairan batch (tabel disbursements).
export async function tandaiCair(formData: FormData) {
  const supabase = await createClient();
  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const saleId = String(formData.get("sale_id") ?? "");
  const nominal = Number(formData.get("nominal")) || 0;
  if (!saleId) fail("Order tidak dikenali.");
  if (nominal <= 0) fail("Nominal pencairan harus lebih dari nol.");

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, total, channel, marketplace_status, branch_id")
    .eq("id", saleId).maybeSingle();
  if (!sale) fail("Order tidak ditemukan.");
  if (!sale!.channel || !isMarketplace(sale!.channel)) fail("Order ini bukan order marketplace.");
  if (sale!.marketplace_status !== "piutang") fail("Order ini sudah dicairkan.");

  const total = Number(sale!.total);
  // Nominal jauh di atas total = kemungkinan besar salah ketik; jangan diam-diam diclamp (I1).
  if (nominal > total) fail("Nominal pencairan tidak boleh melebihi total order.");
  const komisi = hitungKomisi(total, nominal);
  const now = new Date();
  const tanggal = todayJakarta();

  // Periode terkunci (tutup buku) — sama seperti buatPenjualanOnline (I1). Kalau tidak
  // dicek di sini, UPDATE sales di bawah tetap sukses (marketplace_status='cair' tercatat)
  // tapi jurnal pencairan gagal diam-diam (trigger DB raise, postJournal menelan error),
  // dan tidak bisa diretry karena predikat marketplace_status='piutang' sudah tidak match.
  const { data: lock, error: lockErr } = await supabase
    .from("accounting_locks").select("closed_until").eq("id", true).maybeSingle();
  if (lockErr) {
    console.error("[tandaiCair] gagal baca status tutup buku:", lockErr);
    fail("Gagal memeriksa status tutup buku, coba lagi.");
  }
  if (lock?.closed_until && tanggal <= lock.closed_until) {
    fail(`Periode akuntansi s/d ${lock.closed_until} sudah ditutup — tidak bisa posting tanggal ini.`);
  }

  // Guard double-submit (C3): predikat marketplace_status ada di UPDATE itu sendiri,
  // bukan cuma di baca sebelumnya. Kalau 0 baris ke-update, order sudah dicairkan duluan
  // oleh submit lain — jangan lanjut posting jurnal kedua kalinya.
  const { data: updated, error: updErr } = await supabase
    .from("sales")
    .update({ marketplace_status: "cair", komisi, disbursed_at: now.toISOString() })
    .eq("id", saleId)
    .eq("marketplace_status", "piutang")
    .select("id");
  if (updErr) {
    console.error("[tandaiCair] gagal update sales:", updErr);
    fail("Gagal mencatat pencairan.");
  }
  if (!updated || updated.length === 0) fail("Order ini sudah dicairkan.");

  // Dr Bank (dana masuk) + Dr Beban Komisi (potongan platform) / Cr Piutang Marketplace (nilai order).
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pencairan ${sale!.channel} ${sale!.no_struk}`,
    source: "sale-online-cair", sourceRef: sale!.no_struk, branchId: sale!.branch_id,
    lines: [
      { code: await kodeAkunBayar(supabase, "Transfer", sale!.branch_id), debit: Math.min(nominal, total), credit: 0 },
      ...(komisi > 0 ? [{ code: "5305", debit: komisi, credit: 0 }] : []),
      { code: "1202", debit: 0, credit: total },
    ],
  });

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Pencairan ${sale!.no_struk} tercatat.`)}`);
}

export async function recoverUnitPosting(form: FormData) {
  const db = await createClient();
  const scope = String(form.get("request_scope") ?? "");
  const key = String(form.get("request_key") ?? "");
  const kasir = String(form.get("dari") ?? "") === "kasir";
  const { data, error } = await db.rpc("get_unit_posting_result", {p_scope:scope,p_request_key:key});
  const back = kasir ? "/kasir/retur" : scope.startsWith("purchase-return") ? "/pembelian/retur/baru" : scope.startsWith("sales-return:") ? "/penjualan/retur/baru" : "/penjualan/online/baru";
  const query = "struk=" + encodeURIComponent(String(form.get("source_ref") ?? ""));
  if(error || !data) redirect(`${back}?${query}&error=${encodeURIComponent(error?.message ?? "Transaksi belum ditemukan.")}`);
  redirect(`${back}?${query}&success=${encodeURIComponent(`Transaksi ${data.document_no} tersimpan.`)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}`);
}
