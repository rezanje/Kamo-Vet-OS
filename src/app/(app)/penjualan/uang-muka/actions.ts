"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { cekPeriode } from "@/lib/jurnal-guard";
import { jurnalUangMukaJual } from "@/lib/penjualan-dokumen";
import { nextNoDokumen } from "@/lib/penjualan-server";
import { hariIniWIB } from "@/lib/tanggal";

const BASE = "/penjualan/uang-muka";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

export async function terimaUangMukaJual(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka penjualan", BOLEH);

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const orderId = String(formData.get("order_id") ?? "").trim() || null;
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!customerId) gagal("Pilih pelanggan yang menyetor uang muka");
  if (jumlah <= 0) gagal("Nominal uang muka harus lebih dari 0");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Pesanan yang dipilih harus milik pelanggan yang sama — kalau tidak, uang mukanya
  // nyangkut di pesanan orang lain dan tidak akan pernah bisa dipotongkan.
  let branchId: string | null = null;
  if (orderId) {
    const { data: so } = await supabase
      .from("sales_orders").select("id, customer_id, branch_id").eq("id", orderId).maybeSingle();
    if (!so) gagal("Pesanan tidak ditemukan");
    if (so!.customer_id && so!.customer_id !== customerId) gagal("Pesanan itu milik pelanggan lain");
    branchId = (so!.branch_id as string | null) ?? null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "UJ");

  const { error } = await supabase.from("sales_advances").insert({
    no_um: no, customer_id: customerId, order_id: orderId, tanggal, jumlah,
    metode, account_id: accountId, catatan, created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  const kasCode = await kodeAkunBayar(supabase, metode, branchId, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Uang muka penjualan ${no}`,
    source: "sales-advance",
    sourceRef: no,
    branchId,
    lines: jurnalUangMukaJual(kasCode, jumlah),
  });

  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${no} tercatat.`)}`);
}

export async function batalkanUangMukaJual(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka penjualan", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Uang muka tidak valid");

  const { data: um } = await supabase
    .from("sales_advances").select("id, no_um, jumlah, terpakai, status, metode, account_id, order_id").eq("id", id).maybeSingle();
  if (!um) gagal("Uang muka tidak ditemukan");
  if (um!.status === "batal") gagal("Uang muka ini sudah dibatalkan");
  if (Number(um!.terpakai) > 0) gagal("Uang muka sudah dipakai melunasi faktur — tidak bisa dibatalkan");

  const tanggal = hariIniWIB();
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  let branchId: string | null = null;
  if (um!.order_id) {
    const { data: so } = await supabase.from("sales_orders").select("branch_id").eq("id", um!.order_id).maybeSingle();
    branchId = (so?.branch_id as string | null) ?? null;
  }

  // Jurnal pembalikan: uangnya dikembalikan, kewajiban hilang.
  const kasCode = await kodeAkunBayar(supabase, um!.metode, branchId, um!.account_id);
  const lines = jurnalUangMukaJual(kasCode, Number(um!.jumlah)).map((l) => ({
    code: l.code, debit: l.credit, credit: l.debit,
  }));
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pengembalian uang muka penjualan ${um!.no_um}`,
    source: "sales-advance-void",
    sourceRef: um!.no_um,
    branchId,
    lines,
  });

  await supabase.from("sales_advances").update({ status: "batal" }).eq("id", id);
  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${um!.no_um} dibatalkan.`)}`);
}
