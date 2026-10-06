"use server";

// ponytail: server actions — buatPO, tambahSupplier, updatePOStatus (+ receiving logic).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { type BatchInput } from "@/lib/kadaluarsa-batch";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";

type ItemInput = {
  nama: string; qty: number; harga_beli: number; item_id?: string | null;
  satuan?: string | null; faktor?: number;
};

// ─── Buat PO ──────────────────────────────────────────────────────────────────

export async function buatPO(formData: FormData) {
  const supabase = await createClient();

  const supplier_id = String(formData.get("supplier_id") ?? "").trim() || null;
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "").trim() || null;
  const branch_id = String(formData.get("branch_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!to_warehouse_id || !branch_id || items.length === 0) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gudang, cabang, dan minimal 1 item wajib diisi."));
  }

  // Formatnya dibaca dari master penomoran; bawaannya PO-YYYYMMDD-NNNN,
  // dilanjutkan dari nomor tertinggi hari itu.
  const { nomor: no_po } = await nomorBerikutnya(supabase, "PO", tanggal, {
    table: "purchase_orders", column: "no_po",
  });

  // compute total
  const total = items.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.harga_beli) || 0), 0);

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({ no_po, supplier_id, to_warehouse_id, branch_id, tanggal, total, status: "Draft" })
    .select("id")
    .single();

  if (poErr || !po) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gagal membuat PO."));
  }

  const poId = (po as { id: string }).id;
  // Satuan beli (box/sak) diambil ulang dari master — faktor dari form tidak dipercaya,
  // karena faktor palsu bikin stok masuk lebih banyak dari barang yang benar-benar datang.
  const unitOpts = await loadUnitOptions(supabase, items.map((it) => it.item_id).filter((x): x is string => !!x));
  const rows = items.map((it) => {
    const opts = it.item_id ? unitOpts.get(it.item_id) : undefined;
    const u = opts ? pickUnit(opts, it.satuan) : null;
    return {
      po_id: poId,
      item_id: it.item_id || null,   // link master SKU → stok bertambah saat Diterima & bisa diretur
      nama: String(it.nama).slice(0, 160),
      qty: Number(it.qty) || 0,
      harga_beli: Number(it.harga_beli) || 0,
      satuan: u?.unit ?? null,
      faktor: u?.factor ?? 1,
    };
  });
  await supabase.from("purchase_order_items").insert(rows);

  revalidatePath("/pembelian");
  redirect("/pembelian?success=1");
}

// ─── Tambah Supplier ──────────────────────────────────────────────────────────

export async function tambahSupplier(formData: FormData) {
  const supabase = await createClient();
  const nama = String(formData.get("nama") ?? "").trim();
  const kontak = String(formData.get("kontak") ?? "").trim() || null;
  const telp = String(formData.get("telp") ?? "").trim() || null;
  const alamat = String(formData.get("alamat") ?? "").trim() || null;
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const npwp = String(formData.get("npwp") ?? "").trim() || null;
  const bankNama = String(formData.get("bank_nama") ?? "").trim() || null;
  const bankRekening = String(formData.get("bank_rekening") ?? "").trim() || null;
  const bankAtasNama = String(formData.get("bank_atas_nama") ?? "").trim() || null;

  const terminRaw = formData.get("termin_hari");
  const termin = terminRaw === null || String(terminRaw).trim() === "" ? 30 : Number(terminRaw);

  if (!nama) {
    redirect("/pembelian?error=" + encodeURIComponent("Nama supplier wajib diisi."));
  }
  if (!Number.isFinite(termin) || termin < 0) {
    redirect("/pembelian?error=" + encodeURIComponent("Termin pembayaran tidak valid."));
  }

  await supabase.from("suppliers").insert({
    nama, kontak, telp, alamat, category_id: categoryId,
    npwp, termin_hari: termin, bank_nama: bankNama,
    bank_rekening: bankRekening, bank_atas_nama: bankAtasNama,
  });

  revalidatePath("/pembelian");
  redirect("/pembelian?tab=supplier&success_sup=1");
}

// ─── Update PO Status (+ receiving logic) ─────────────────────────────────────

export async function updatePOStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const newStatus = String(formData.get("status") ?? "");

  // ponytail: fetch PO + current status before changing anything.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, total, to_warehouse_id, branch_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!po) {
    revalidatePath("/pembelian");
    return;
  }

  const currentStatus = (po as { status: string }).status;

  // Penerimaan barang punya halamannya sendiri (qty datang bisa ≠ qty PO).
  if (newStatus === "Diterima") {
    if (currentStatus === "Diterima") {
      revalidatePath("/pembelian");
      return;
    }
    redirect(`/pembelian/${id}/terima`);
  }

  await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", id);

  revalidatePath("/pembelian");
}

// ─── Terima Barang (qty diterima boleh ≠ qty PO) ──────────────────────────────

type TerimaInput = {
  id: string; qty_terima: number; qty_rusak?: number; catatan?: string; exp_date?: string;
  /** Jumlah per tanggal kadaluarsa — satu kiriman bisa beberapa masa simpan. */
  batches?: BatchInput[];
};

export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const fail = (msg: string): never => redirect(`/pembelian/${id}/terima?error=${encodeURIComponent(msg)}`);
  let input: TerimaInput[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (Array.isArray(parsed)) input = parsed as TerimaInput[];
  } catch { /* Invalid JSON is rejected below. */ }
  if (!id || !requestKey || input.length === 0 || input.some((row) => !row || !row.id
    || !Number.isFinite(Number(row.qty_terima)) || Number(row.qty_terima) < 0
    || !Number.isFinite(Number(row.qty_rusak ?? 0)) || Number(row.qty_rusak ?? 0) < 0)
    || new Set(input.map((row) => row.id)).size !== input.length) {
    fail("Rincian atau kunci penerimaan tidak valid. Periksa formulir lalu coba lagi.");
  }
  const { prefix, digit } = await nomorBerikutnya(supabase, "TB", tanggal, {
    table: "goods_receipts", column: "no_terima",
  });
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_po_id: id, p_request_key: requestKey,
    p_no_terima_prefix: prefix, p_no_terima_digits: digit,
    p_tanggal: tanggal,
    p_surat_jalan: String(formData.get("surat_jalan") ?? "").trim() || null,
    p_catatan: String(formData.get("catatan") ?? "").trim() || null,
    p_rows: input,
  });
  if (error || !data?.receipt_id) fail(error?.message ?? "Penerimaan belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  revalidatePath("/pembelian");
  revalidatePath("/pembelian/penerimaan");
  revalidatePath("/keuangan/hutang");
  const pesan = `Barang ${data.no_po ?? id} diterima ${data.complete ? "lengkap" : "sebagian"} — dokumen ${data.no_terima}.`;
  redirect(`/pembelian?success_terima=${encodeURIComponent(pesan)}&request_done=${encodeURIComponent(requestKey)}&request_scope=${encodeURIComponent(`receipt:${id}`)}`);
}

// Check a prior committed submission without replaying refreshed form quantities.
export async function recoverPurchaseSubmission(formData: FormData) {
  const scope = String(formData.get("request_scope") ?? "");
  const requestKey = String(formData.get("request_key") ?? "").trim();
  const kind = scope.startsWith("receipt:") ? "receipt" : scope;
  const back = kind === "receipt" ? `/pembelian/${scope.slice(8)}/terima`
    : kind === "invoice" ? "/pembelian/faktur/baru" : "/keuangan/aset";
  if (!["receipt", "invoice", "asset"].includes(kind) || !requestKey) {
    redirect(`${back}?error=${encodeURIComponent("Kunci transaksi tidak valid.")}`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_purchase_operation_result", {
    p_kind: kind, p_request_key: requestKey,
  });
  if (error || !data) {
    redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Belum ada transaksi tersimpan untuk formulir ini. Periksa rincian sebelum menyimpan.")}`);
  }
  const confirmed = `request_done=${encodeURIComponent(requestKey)}&request_scope=${encodeURIComponent(scope)}`;
  revalidatePath("/pembelian");
  revalidatePath("/pembelian/faktur");
  revalidatePath("/keuangan/aset");
  if (kind === "receipt") redirect(`/pembelian?success_terima=${encodeURIComponent(`Penerimaan ${data.no_terima} sudah tersimpan.`)}&${confirmed}`);
  if (kind === "invoice") redirect(`/pembelian/faktur?success=${encodeURIComponent(`Faktur ${data.no_faktur} sudah tersimpan.`)}&${confirmed}`);
  redirect(`/keuangan/aset?success=pembelian&${confirmed}`);
}
