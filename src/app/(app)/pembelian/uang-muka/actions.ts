"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import {revalidatePath} from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { formatDokumen } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import Decimal from "decimal.js";

const BASE = "/pembelian/uang-muka";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

export async function bayarUangMuka(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka pembelian", BOLEH);

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const poId = String(formData.get("po_id") ?? "").trim() || null;
  let jumlah = 0;
  try {
    const amount = new Decimal(String(formData.get("jumlah") ?? ""));
    if (amount.isFinite() && amount.gt(0) && amount.lte(9999999999999) && amount.decimalPlaces() <= 2) jumlah = amount.toNumber();
  } catch { /* Invalid input is rejected below, before the atomic RPC. */ }
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const requestKey = String(formData.get("draft_key") ?? "").trim();
  if (!supplierId) gagal("Pilih pemasok penerima uang muka");
  if (!requestKey || requestKey.length > 120) gagal("Kunci uang muka belum tersedia. Muat ulang formulir sebelum menyimpan.");
  if (jumlah <= 0) gagal("Nominal uang muka harus lebih dari 0 dan maksimal 2 angka desimal");
  const format = await formatDokumen(supabase,"UM",hariIniWIB());
  const {data,error} = await supabase.rpc("pay_purchase_advance_atomic", {
    p_request_key:requestKey,p_no_prefix:format.prefix,p_no_digits:format.digit,
    p_supplier_id:supplierId,p_po_id:poId,p_tanggal:tanggal,p_jumlah:jumlah,p_metode:metode,p_account_id:accountId,p_catatan:catatan,
  });
  if (error) gagal(error.message);
  if (!data?.advance_id || !data?.journal_id || !data?.no_um) gagal("Uang muka belum terkonfirmasi lengkap. Periksa hasil transaksi sebelum menyimpan ulang.");
  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${data.no_um} tercatat.`)}${transactionDraftAck(formData)}`);
}

export async function periksaUangMuka(formData:FormData) {
  const supabase = await assertRole(BASE,"uang muka pembelian",BOLEH);
  const key = String(formData.get("draft_key") ?? "").trim();
  if (!key || key.length > 120) gagal("Kunci uang muka tidak valid");
  const {data,error} = await supabase.rpc("get_purchase_advance_result",{p_request_key:key});
  if (error || !data?.advance_id || !data?.journal_id) gagal(error?.message ?? "Belum ada uang muka tersimpan untuk draf ini. Periksa daftar sebelum mencoba kembali.");
  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${data.no_um} sudah tersimpan; tidak diposting ulang.`)}${transactionDraftAck(formData)}`);
}

// Batal hanya boleh selama belum terpakai — kalau sudah dipotong ke pembayaran,
// membatalkannya akan meninggalkan hutang yang terlanjur berkurang tanpa dasar.
export async function batalkanUangMuka(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka pembelian", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Uang muka tidak valid");

  const {data,error} = await supabase.rpc("cancel_purchase_advance_atomic",{p_advance_id:id});
  if (error) gagal(error.message);
  if (!data?.advance_id || !data?.journal_id) gagal("Pembatalan uang muka belum terkonfirmasi lengkap. Periksa daftar sebelum mencoba kembali.");
  revalidatePath(BASE);
  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${data.no_um} dibatalkan.`)}${transactionDraftAck(formData)}`);
}
