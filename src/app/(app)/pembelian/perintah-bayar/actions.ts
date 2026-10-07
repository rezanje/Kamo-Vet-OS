"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { sisaFakturBayar } from "@/lib/perintah-bayar";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";

const BASE = "/pembelian/perintah-bayar";
// Membuat perintah bayar = mengajukan, bukan mengeluarkan uang — FINANCE ikut boleh.
const BOLEH_AJUKAN = ["OWNER", "ADMIN", "FINANCE"];
// Menyetujui pengeluaran uang tetap hak pemilik/admin.
const BOLEH_SETUJU = ["OWNER", "ADMIN"];

const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function nextNoPP(supabase: Db): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, "PP", hariIniWIB(), {
    table: "payment_orders", column: "no_pp",
  });
  return nomor;
}

/** Sisa hutang tiap faktur, sudah dikurangi pembayaran & perintah bayar yang masih menunggu. */
async function sisaPerFaktur(supabase: Db, invoiceIds: string[]): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const [{ data: inv }, { data: bayar }, { data: antre }] = await Promise.all([
    supabase.from("purchase_invoices").select("id, total").in("id", invoiceIds),
    supabase.from("purchase_invoice_payments").select("invoice_id, amount").in("invoice_id", invoiceIds),
    supabase.from("payment_order_items")
      .select("invoice_id, jumlah, payment_orders!inner(status)")
      .in("invoice_id", invoiceIds)
      .in("payment_orders.status", ["draft", "disetujui"]),
  ]);

  return sisaFakturBayar(
    (inv ?? []) as { id: string; total: number }[],
    (bayar ?? []) as { invoice_id: string; amount: number }[],
    (antre ?? []) as { invoice_id: string; jumlah: number }[],
  );
}

export async function buatPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "perintah pembayaran", BOLEH_AJUKAN);

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const rencana = String(formData.get("rencana_bayar") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  if (!supplierId) gagal("Pilih pemasok dulu");

  // Baris terpilih datang sebagai pasangan pilih_<invoiceId> + jumlah_<invoiceId>.
  const dipilih: { invoice_id: string; jumlah: number }[] = [];
  for (const [key, val] of formData.entries()) {
    if (!key.startsWith("pilih_") || String(val) !== "on") continue;
    const invoiceId = key.slice("pilih_".length);
    const jumlah = Number(formData.get(`jumlah_${invoiceId}`)) || 0;
    if (jumlah > 0) dipilih.push({ invoice_id: invoiceId, jumlah });
  }
  if (dipilih.length === 0) gagal("Centang minimal satu faktur dengan nominal lebih dari 0");

  const sisa = await sisaPerFaktur(supabase, dipilih.map((d) => d.invoice_id));
  for (const d of dipilih) {
    const maks = sisa.get(d.invoice_id) ?? 0;
    if (d.jumlah > maks) {
      gagal(`Nominal salah satu faktur melebihi sisa hutangnya (maks Rp ${Math.round(maks).toLocaleString("id-ID")})`);
    }
  }

  const total = dipilih.reduce((a, d) => a + d.jumlah, 0);
  const { data: { user } } = await supabase.auth.getUser();
  const noPp = await nextNoPP(supabase);

  const { data: order, error } = await supabase.from("payment_orders").insert({
    no_pp: noPp, supplier_id: supplierId, rencana_bayar: rencana, total,
    catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !order) gagal(error?.message ?? "Gagal membuat perintah bayar");

  const { error: itemErr } = await supabase.from("payment_order_items")
    .insert(dipilih.map((d) => ({ order_id: order!.id, invoice_id: d.invoice_id, jumlah: d.jumlah })));
  if (itemErr) {
    // Kepala tanpa baris = perintah bayar kosong yang tetap mengunci sisa hutang.
    const { error: draftWriteError1 } = await supabase.from("payment_orders").delete().eq("id", order!.id);
    if (draftWriteError1) throw new Error("Perubahan transaksi belum terkonfirmasi lengkap. Periksa daftar transaksi sebelum menyimpan ulang.");
    gagal(itemErr.message);
  }

  redirect(`${BASE}?success=${encodeURIComponent(`Perintah bayar ${noPp} dibuat, menunggu persetujuan.`)}${transactionDraftAck(formData)}`);
}

export async function setujuiPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "persetujuan perintah bayar", BOLEH_SETUJU);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Perintah bayar tidak valid");

  const { data: order } = await supabase
    .from("payment_orders").select("id, no_pp, status").eq("id", id).maybeSingle();
  if (!order) gagal("Perintah bayar tidak ditemukan");
  if (order!.status !== "draft") gagal("Hanya perintah bayar berstatus draft yang bisa disetujui");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: draftWriteError2 } = await supabase.from("payment_orders").update({
    status: "disetujui", approved_by: user?.id ?? null, approved_at: new Date().toISOString(),
  }).eq("id", id).select("id").single();
  if (draftWriteError2) throw new Error("Perubahan transaksi belum terkonfirmasi lengkap. Periksa daftar transaksi sebelum menyimpan ulang.");

  redirect(`${BASE}?success=${encodeURIComponent(`${order!.no_pp} disetujui — siap dibayar.`)}${transactionDraftAck(formData)}`);
}

export async function batalkanPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "perintah pembayaran", BOLEH_SETUJU);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Perintah bayar tidak valid");

  const { data: order } = await supabase
    .from("payment_orders").select("id, no_pp, status").eq("id", id).maybeSingle();
  if (!order) gagal("Perintah bayar tidak ditemukan");
  if (order!.status === "dibayar") gagal("Perintah bayar yang sudah dibayar tidak bisa dibatalkan");

  const { error: draftWriteError3 } = await supabase.from("payment_orders").update({ status: "batal" }).eq("id", id).select("id").single();
  if (draftWriteError3) throw new Error("Perubahan transaksi belum terkonfirmasi lengkap. Periksa daftar transaksi sebelum menyimpan ulang.");
  redirect(`${BASE}?success=${encodeURIComponent(`${order!.no_pp} dibatalkan.`)}${transactionDraftAck(formData)}`);
}

/** Eksekusi: invoice/PO debt is locked with the payment rows and aggregate journal. */
export async function bayarPerintahBayar(formData: FormData) {
 const supabase=await assertRole(BASE,"pembayaran hutang",BOLEH_SETUJU);
 const id=String(formData.get("id")??"").trim();
 const key=String(formData.get("draft_key")??"");
 const metode=String(formData.get("metode")??"Transfer");
 const accountId=String(formData.get("account_id")??"").trim()||null;
 const tanggal=String(formData.get("tanggal")??"").trim()||hariIniWIB();
 if(!id||!key)gagal("Identitas perintah bayar tidak valid. Muat ulang formulir.");
 const {data:result,error}=await supabase.rpc("pay_purchase_payment_order_atomic",{p_request_key:key,p_order_id:id,p_tanggal:tanggal,p_metode:metode,p_account_id:accountId});
 if(error)gagal(error.message);
 if(!result?.order_id||!result?.journal_id||!result?.no_pp)throw new Error("Pembayaran belum terkonfirmasi lengkap. Periksa perintah bayar sebelum menyimpan ulang.");
 redirect(`${BASE}?success=${encodeURIComponent(`${result.no_pp} dibayar.`)}${transactionDraftAck(formData)}`);
}
