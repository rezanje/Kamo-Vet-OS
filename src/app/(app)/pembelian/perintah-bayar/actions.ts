"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { cekPeriode } from "@/lib/jurnal-guard";
import { formatNoPerintahBayar, sisaFakturBayar } from "@/lib/perintah-bayar";

const BASE = "/pembelian/perintah-bayar";
// Membuat perintah bayar = mengajukan, bukan mengeluarkan uang — FINANCE ikut boleh.
const BOLEH_AJUKAN = ["OWNER", "ADMIN", "FINANCE"];
// Menyetujui pengeluaran uang tetap hak pemilik/admin.
const BOLEH_SETUJU = ["OWNER", "ADMIN"];

const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function nextNoPP(supabase: Db): Promise<string> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { count } = await supabase
    .from("payment_orders").select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  return formatNoPerintahBayar(now, (count ?? 0) + 1);
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
    await supabase.from("payment_orders").delete().eq("id", order!.id);
    gagal(itemErr.message);
  }

  redirect(`${BASE}?success=${encodeURIComponent(`Perintah bayar ${noPp} dibuat, menunggu persetujuan.`)}`);
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
  await supabase.from("payment_orders").update({
    status: "disetujui", approved_by: user?.id ?? null, approved_at: new Date().toISOString(),
  }).eq("id", id);

  redirect(`${BASE}?success=${encodeURIComponent(`${order!.no_pp} disetujui — siap dibayar.`)}`);
}

export async function batalkanPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "perintah pembayaran", BOLEH_SETUJU);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Perintah bayar tidak valid");

  const { data: order } = await supabase
    .from("payment_orders").select("id, no_pp, status").eq("id", id).maybeSingle();
  if (!order) gagal("Perintah bayar tidak ditemukan");
  if (order!.status === "dibayar") gagal("Perintah bayar yang sudah dibayar tidak bisa dibatalkan");

  await supabase.from("payment_orders").update({ status: "batal" }).eq("id", id);
  redirect(`${BASE}?success=${encodeURIComponent(`${order!.no_pp} dibatalkan.`)}`);
}

/** Eksekusi: uang benar-benar keluar. Satu jurnal per perintah bayar. */
export async function bayarPerintahBayar(formData: FormData) {
  const supabase = await assertRole(BASE, "pembayaran hutang", BOLEH_SETUJU);

  const id = String(formData.get("id") ?? "").trim();
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!id) gagal("Perintah bayar tidak valid");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: order } = await supabase
    .from("payment_orders")
    .select("id, no_pp, status, payment_order_items(id, invoice_id, jumlah)")
    .eq("id", id).maybeSingle();
  if (!order) gagal("Perintah bayar tidak ditemukan");
  if (order!.status !== "disetujui") gagal("Perintah bayar ini belum disetujui");

  const baris = (order!.payment_order_items ?? []) as { invoice_id: string; jumlah: number }[];
  if (baris.length === 0) gagal("Perintah bayar ini tidak punya baris faktur");

  // Sisa dicek ulang saat eksekusi: fakturnya bisa saja sudah dibayar lewat layar
  // hutang di antara persetujuan dan pembayaran.
  const [{ data: inv }, { data: bayar }] = await Promise.all([
    supabase.from("purchase_invoices").select("id, total, purchase_orders(branch_id)").in("id", baris.map((b) => b.invoice_id)),
    supabase.from("purchase_invoice_payments").select("invoice_id, amount").in("invoice_id", baris.map((b) => b.invoice_id)),
  ]);
  const sisa = sisaFakturBayar(
    (inv ?? []) as { id: string; total: number }[],
    (bayar ?? []) as { invoice_id: string; amount: number }[],
    [],
  );
  for (const b of baris) {
    if (b.jumlah > (sisa.get(b.invoice_id) ?? 0)) {
      gagal("Ada faktur yang keburu dibayar dari layar lain — batalkan perintah bayar ini lalu buat ulang");
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { error: payErr } = await supabase.from("purchase_invoice_payments").insert(
    baris.map((b) => ({
      invoice_id: b.invoice_id, tanggal, amount: b.jumlah, metode,
      catatan: `Perintah bayar ${order!.no_pp}`, created_by: user?.id ?? null,
      payment_order_id: id,
    })),
  );
  if (payErr) gagal(payErr.message);

  type InvRow = { id: string; purchase_orders: { branch_id: string | null } | { branch_id: string | null }[] | null };
  const pertama = ((inv ?? []) as InvRow[])[0];
  const rel = Array.isArray(pertama?.purchase_orders) ? pertama.purchase_orders[0] : pertama?.purchase_orders;
  const branchId = rel?.branch_id ?? null;

  const total = baris.reduce((a, b) => a + Number(b.jumlah), 0);
  const kasCode = await kodeAkunBayar(supabase, metode, branchId, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Pembayaran hutang lewat ${order!.no_pp}`,
    source: "purchase-pay",
    sourceRef: order!.no_pp,
    branchId,
    lines: [
      { code: "2101", debit: total, credit: 0 },
      { code: kasCode, debit: 0, credit: total },
    ],
  });

  await supabase.from("payment_orders")
    .update({ status: "dibayar", paid_at: new Date().toISOString() }).eq("id", id);

  redirect(`${BASE}?success=${encodeURIComponent(`${order!.no_pp} dibayar.`)}`);
}
