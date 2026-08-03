"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { cekPeriode } from "@/lib/jurnal-guard";
import { formatNoUangMuka, jurnalUangMuka } from "@/lib/uang-muka";

const BASE = "/pembelian/uang-muka";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextNoUangMuka(supabase: any): Promise<string> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from("purchase_advances").select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoUangMuka(now, (count ?? 0) + 1);
}

export async function bayarUangMuka(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka pembelian", BOLEH);

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const poId = String(formData.get("po_id") ?? "").trim() || null;
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!supplierId) gagal("Pilih pemasok penerima uang muka");
  if (jumlah <= 0) gagal("Nominal uang muka harus lebih dari 0");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // PO yang dipilih harus milik pemasok yang sama — kalau tidak, uang mukanya
  // nyangkut di pesanan orang lain dan tidak akan pernah bisa dipotongkan.
  let branchId: string | null = null;
  if (poId) {
    const { data: po } = await supabase
      .from("purchase_orders").select("id, supplier_id, branch_id").eq("id", poId).maybeSingle();
    if (!po) gagal("PO tidak ditemukan");
    if (po!.supplier_id && po!.supplier_id !== supplierId) gagal("PO itu milik pemasok lain");
    branchId = (po!.branch_id as string | null) ?? null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const noUm = await nextNoUangMuka(supabase);

  const { error } = await supabase.from("purchase_advances").insert({
    no_um: noUm, supplier_id: supplierId, po_id: poId, tanggal, jumlah,
    metode, account_id: accountId, catatan, created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  const kasCode = await kodeAkunBayar(supabase, metode, branchId, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Uang muka pembelian ${noUm}`,
    source: "purchase-advance",
    sourceRef: noUm,
    branchId,
    lines: jurnalUangMuka(kasCode, jumlah),
  });

  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${noUm} tercatat.`)}`);
}

// Batal hanya boleh selama belum terpakai — kalau sudah dipotong ke pembayaran,
// membatalkannya akan meninggalkan hutang yang terlanjur berkurang tanpa dasar.
export async function batalkanUangMuka(formData: FormData) {
  const supabase = await assertRole(BASE, "uang muka pembelian", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Uang muka tidak valid");

  const { data: um } = await supabase
    .from("purchase_advances")
    .select("id, no_um, tanggal, jumlah, terpakai, status, metode, account_id, po_id")
    .eq("id", id).maybeSingle();
  if (!um) gagal("Uang muka tidak ditemukan");
  if (um!.status === "batal") gagal("Uang muka ini sudah dibatalkan");
  if (Number(um!.terpakai) > 0) gagal("Uang muka sudah dipakai untuk pembayaran — tidak bisa dibatalkan");

  const tanggal = new Date().toISOString().slice(0, 10);
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  let branchId: string | null = null;
  if (um!.po_id) {
    const { data: po } = await supabase.from("purchase_orders").select("branch_id").eq("id", um!.po_id).maybeSingle();
    branchId = (po?.branch_id as string | null) ?? null;
  }

  // Jurnal pembalikan: uangnya kembali ke rekening, hak tagih hilang.
  const kasCode = await kodeAkunBayar(supabase, um!.metode, branchId, um!.account_id);
  const lines = jurnalUangMuka(kasCode, Number(um!.jumlah)).map((l) => ({
    code: l.code, debit: l.credit, credit: l.debit,
  }));
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pembatalan uang muka ${um!.no_um}`,
    source: "purchase-advance-void",
    sourceRef: um!.no_um,
    branchId,
    lines,
  });

  await supabase.from("purchase_advances").update({ status: "batal" }).eq("id", id);
  redirect(`${BASE}?success=${encodeURIComponent(`Uang muka ${um!.no_um} dibatalkan.`)}`);
}
