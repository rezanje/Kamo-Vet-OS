"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { bacaBaris, nextNoDokumen, totalBaris } from "@/lib/penjualan-server";
import { validasiSatuanJual } from "@/lib/penjualan-satuan";
import { hariIniWIB } from "@/lib/tanggal";

const LIST = "/penjualan/pesanan";
const BOLEH = ["OWNER", "ADMIN", "FINANCE", "STAFF"];
const detail = (id: string) => `${LIST}/${id}`;

export async function buatPesanan(formData: FormData) {
  const supabase = await assertRole(LIST, "pesanan penjualan", BOLEH);
  const gagal = (msg: string): never => redirect(`${LIST}?error=${encodeURIComponent(msg)}`);

  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const rencana = String(formData.get("rencana_kirim") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  const parsed = bacaBaris(formData.get("items"));
  const { rows: baris, error: satuanError } = await validasiSatuanJual(supabase, parsed);
  if (satuanError) gagal(satuanError);
  if (!customerId) gagal("Pilih pelanggan dulu");
  if (baris.length === 0) gagal("Isi minimal satu baris barang atau jasa");

  const { data: { user } } = await supabase.auth.getUser();
  const no = await nextNoDokumen(supabase, "SO");

  const { data: so, error } = await supabase.from("sales_orders").insert({
    no_pesanan: no, customer_id: customerId, branch_id: branchId, warehouse_id: warehouseId,
    tanggal, rencana_kirim: rencana, total: totalBaris(baris), catatan, created_by: user?.id ?? null,
  }).select("id").single();
  if (error || !so) gagal(error?.message ?? "Gagal menyimpan pesanan");

  const { error: itemErr } = await supabase.from("sales_order_items").insert(
    baris.map((b) => ({
      order_id: so!.id, item_id: b.item_id, nama: b.nama,
      satuan: b.satuan, faktor: b.faktor ?? 1, qty: b.qty, harga: b.harga,
    })),
  );
  if (itemErr) {
    await supabase.from("sales_orders").delete().eq("id", so!.id);
    gagal(itemErr.message);
  }

  redirect(`${detail(so!.id)}?success=${encodeURIComponent(`Pesanan ${no} dibuat.`)}`);
}

export async function batalPesanan(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const supabase = await assertRole(detail(id), "pesanan penjualan", BOLEH);
  const { error } = await supabase.rpc("sales_cancel_order", { p_order_id: id });
  if (error) redirect(`${detail(id)}?error=${encodeURIComponent(error.message)}`);
  redirect(`${detail(id)}?success=${encodeURIComponent("Pesanan dibatalkan.")}`);
}

/** Pass exact quantities to SQL; never clamp using stale application remainders. */
function postingInput(formData: FormData) {
  const requestKey = String(formData.get("request_key") ?? "").trim();
  if (!requestKey || requestKey.length > 120) throw new Error("Formulir tidak valid. Muat ulang lalu coba lagi.");
  const items: { order_item_id: string; qty: number }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const id = key.slice(4);
    const qty = Number(raw);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || !Number.isFinite(qty) || qty < 0 || qty > 1_000_000_000) throw new Error("Qty tidak valid.");
    if (qty > 0) items.push({ order_item_id: id, qty });
  }
  if (!items.length) throw new Error("Pilih minimal satu baris untuk diproses.");
  return { requestKey, items: items.sort((a, b) => a.order_item_id.localeCompare(b.order_item_id)) };
}

async function postOrder(formData: FormData, kind: "delivery" | "invoice") {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${detail(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(detail(id), kind === "delivery" ? "pengiriman pesanan" : "faktur penjualan", BOLEH);
  let input: ReturnType<typeof postingInput>;
  try { input = postingInput(formData); }
  catch (error) { return gagal(error instanceof Error ? error.message : "Rincian tidak valid"); }
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const header = kind === "delivery" ? {
    tanggal,
    warehouse_id: String(formData.get("warehouse_id") ?? "").trim() || null,
    ekspedisi: String(formData.get("ekspedisi") ?? "").trim() || null,
    no_resi: String(formData.get("no_resi") ?? "").trim() || null,
    catatan: String(formData.get("catatan") ?? "").trim() || null,
  } : {
    tanggal,
    jatuh_tempo: String(formData.get("jatuh_tempo") ?? "").trim() || tanggal,
    catatan: String(formData.get("catatan") ?? "").trim() || null,
  };
  const { data, error } = await supabase.rpc(kind === "delivery" ? "sales_create_delivery" : "sales_create_invoice", {
    p_order_id: id, p_request_key: input.requestKey, p_header: header, p_items: input.items,
  });
  if (error || !data?.document_id) gagal(error?.message ?? "Dokumen belum berhasil disimpan. Coba lagi.");
  const pesan = kind === "delivery" ? `Pengiriman ${data.document_no} tercatat.` : `Faktur ${data.document_no} dibuat.`;
  redirect(`${detail(id)}?success=${encodeURIComponent(pesan)}`);
}

/** Inventory and HPP are committed with the delivery document and journal. */
export async function buatPengiriman(formData: FormData) { return postOrder(formData, "delivery"); }

/** Receivable/revenue and shipped-line HPP allocation commit together. */
export async function buatFakturJual(formData: FormData) { return postOrder(formData, "invoice"); }
