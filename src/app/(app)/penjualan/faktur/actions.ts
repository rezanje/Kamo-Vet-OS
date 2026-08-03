"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { cekPeriode } from "@/lib/jurnal-guard";
import { jurnalPenerimaan, sisaTagihan } from "@/lib/penjualan-dokumen";
import { nextNoDokumen } from "@/lib/penjualan-server";

const BASE = "/penjualan/faktur";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

/** Penerimaan Penjualan: pelunasan faktur, boleh memotong uang muka pelanggan. */
export async function terimaPembayaranJual(formData: FormData) {
  const supabase = await assertRole(BASE, "penerimaan penjualan", BOLEH);

  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const advanceId = String(formData.get("advance_id") ?? "").trim() || null;

  if (!invoiceId || jumlah <= 0) gagal("Nominal penerimaan tidak valid");

  const { data: inv } = await supabase
    .from("sales_invoices").select("id, no_faktur, total, status, customer_id, branch_id").eq("id", invoiceId).maybeSingle();
  if (!inv) gagal("Faktur tidak ditemukan");
  if (inv!.status === "batal") gagal("Faktur ini sudah dibatalkan");

  const { data: pays } = await supabase.from("sales_receipts").select("jumlah").eq("invoice_id", invoiceId);
  const sisa = sisaTagihan(Number(inv!.total), (pays ?? []) as { jumlah: number }[]);
  if (sisa <= 0) gagal("Faktur ini sudah lunas");
  if (jumlah > sisa) gagal(`Nominal melebihi sisa tagihan (maks Rp ${Math.round(sisa).toLocaleString("id-ID")})`);

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Uang muka dipotong lebih dulu — uangnya sudah masuk waktu DP, mencatatnya lagi
  // sebagai kas masuk berarti uang yang sama masuk dua kali.
  let dariUangMuka = 0;
  type Advance = { id: string; jumlah: number; terpakai: number; customer_id: string | null; status: string };
  let advance: Advance | null = null;

  if (advanceId) {
    const { data: um } = await supabase
      .from("sales_advances").select("id, jumlah, terpakai, customer_id, status").eq("id", advanceId).maybeSingle();
    if (!um) gagal("Uang muka tidak ditemukan");
    if (um!.status !== "aktif") gagal("Uang muka itu sudah dibatalkan");
    if (um!.customer_id && inv!.customer_id && um!.customer_id !== inv!.customer_id) {
      gagal("Uang muka itu milik pelanggan lain");
    }
    advance = um as Advance;
    dariUangMuka = Math.min(Number(um!.jumlah) - Number(um!.terpakai), jumlah);
    if (dariUangMuka <= 0) gagal("Uang muka itu sudah habis terpakai");
  }

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "RC");

  const { error } = await supabase.from("sales_receipts").insert({
    no_terima: no, invoice_id: invoiceId, tanggal, jumlah, dari_uang_muka: dariUangMuka,
    advance_id: advance?.id ?? null, metode, account_id: accountId, catatan, created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  if (advance) {
    await supabase.from("sales_advances")
      .update({ terpakai: Number(advance.terpakai) + dariUangMuka }).eq("id", advance.id);
  }

  const kasCode = await kodeAkunBayar(supabase, metode, inv!.branch_id, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: dariUangMuka > 0
      ? `Penerimaan ${no} atas faktur ${inv!.no_faktur} (pakai uang muka)`
      : `Penerimaan ${no} atas faktur ${inv!.no_faktur}`,
    source: "sales-receipt",
    sourceRef: no,
    branchId: inv!.branch_id,
    lines: jurnalPenerimaan(kasCode, jumlah, dariUangMuka),
  });

  if (jumlah >= sisa) {
    await supabase.from("sales_invoices").update({ status: "lunas" }).eq("id", invoiceId);
  }

  redirect(`${BASE}?success=${encodeURIComponent(`Penerimaan ${no} tercatat.`)}`);
}
