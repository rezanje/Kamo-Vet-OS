"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { loadUnitOptions, pickUnit } from "@/lib/satuan";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { parseLampiran } from "@/lib/dokumen";
import { cekPeriode } from "@/lib/jurnal-guard";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { validateDirectPurchaseLines, type DirectPurchaseLine } from "@/lib/direct-purchase-lines";
import { buildMixedDirectPurchaseLines } from "@/lib/faktur-beli";

const BARU = "/pembelian/faktur/langsung";
const LIST = "/pembelian/faktur";
type ClientLine = { kind: "stock" | "fixed_asset"; item_id?: string; qty?: number; price?: number; unit?: string; expiry_date?: string; name?: string; category_id?: string; useful_life_months?: number; residual_value?: number; location?: string };

export async function buatFakturLangsung(formData: FormData) {
  const supabase = await createClient();
  const gagal: (msg: string) => never = (msg) => redirect(`${BARU}?error=${encodeURIComponent(msg)}`);
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const warehouseId = String(formData.get("warehouse_id") ?? "").trim() || null;
  let branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const jatuhTempo = String(formData.get("jatuh_tempo") ?? "").trim() || tanggal;
  const funding = String(formData.get("funding") ?? "accounts_payable");
  if (!supplierId) gagal("Pilih pemasok dulu.");
  if (!(["accounts_payable", "cash", "bank"] as string[]).includes(funding)) gagal("Sumber pembayaran tidak valid.");
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  let input: ClientLine[] = [];
  try { input = JSON.parse(String(formData.get("items") ?? "[]")) as ClientLine[]; } catch { gagal("Rincian faktur tidak valid."); }
  const ids = [...new Set(input.filter((l) => l.kind === "stock" && l.item_id).map((l) => String(l.item_id)))];
  const [{ data: itemRows }, unitMap] = await Promise.all([
    ids.length ? supabase.from("items").select("id, name, item_type").in("id", ids) : Promise.resolve({ data: [] }),
    loadUnitOptions(supabase, ids),
  ]);
  const itemMap = new Map(((itemRows ?? []) as { id: string; name: string; item_type: string }[]).map((r) => [r.id, r]));
  const lines: DirectPurchaseLine[] = [];
  for (const line of input) {
    if (line.kind === "stock" && line.item_id && Number(line.qty) > 0) {
      const master = itemMap.get(line.item_id);
      if (!master || master.item_type !== "Persediaan") continue;
      const unit = pickUnit(unitMap.get(line.item_id) ?? [], line.unit);
      lines.push({ kind: "stock", itemId: line.item_id, name: master.name, qty: Number(line.qty), price: Number(line.price) || 0, unit: unit.unit, factor: unit.factor, expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(line.expiry_date ?? "") ? line.expiry_date! : null });
      continue;
    }
    if (line.kind === "fixed_asset") lines.push({ kind: "fixed_asset", name: String(line.name ?? "").trim(), categoryId: String(line.category_id ?? ""), usefulLifeMonths: Number(line.useful_life_months), residualValue: Number(line.residual_value) || 0, price: Number(line.price) || 0, location: String(line.location ?? "").trim() || null });
  }
  try { validateDirectPurchaseLines(lines, warehouseId); } catch (e) { gagal(e instanceof Error ? e.message : "Rincian faktur tidak valid"); }

  if (warehouseId) {
    const { data: warehouse } = await supabase.from("warehouses").select("branch_id").eq("id", warehouseId).eq("is_active", true).maybeSingle();
    if (!warehouse) gagal("Gudang tidak valid.");
    if (branchId && branchId !== warehouse.branch_id) gagal("Gudang dan cabang harus sama.");
    branchId = String(warehouse.branch_id);
  }
  if (!branchId) gagal("Cabang/lokasi faktur wajib dipilih.");
  const stockGross = lines.filter((l) => l.kind === "stock").reduce((sum, l) => sum + l.qty * l.price, 0);
  const assetGross = lines.filter((l) => l.kind === "fixed_asset").reduce((sum, l) => sum + l.price, 0);
  const total = stockGross + assetGross;
  const { ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const creditCode = funding === "accounts_payable" ? "2101" : await kodeAkunBayar(supabase, funding === "cash" ? "Tunai" : "Transfer", branchId, String(formData.get("account_id") ?? "").trim() || null);
  const journal = buildMixedDirectPurchaseLines(stockGross, assetGross, ppn, creditCode);
  if (!journal.length || Math.round(journal.reduce((s, l) => s + l.debit, 0)) !== Math.round(total)) gagal("Jurnal faktur tidak seimbang.");

  const noFaktur = await nextNoFakturLangsung(supabase);
  const rpcLines = lines.map((line) => line.kind === "stock" ? { kind: line.kind, item_id: line.itemId, name: line.name, qty: line.qty, price: line.price, unit: line.unit, factor: line.factor, expiry_date: line.expiryDate } : { kind: line.kind, name: line.name, category_id: line.categoryId, useful_life_months: line.usefulLifeMonths, residual_value: line.residualValue, price: line.price, location: line.location });
  const { data: invoiceId, error } = await supabase.rpc("create_direct_purchase_invoice", {
    p_no_faktur: noFaktur, p_no_faktur_pemasok: String(formData.get("no_faktur_pemasok") ?? ""), p_supplier_id: supplierId,
    p_branch_id: branchId, p_warehouse_id: warehouseId, p_tanggal: tanggal, p_jatuh_tempo: jatuhTempo,
    p_keterangan: String(formData.get("keterangan") ?? ""), p_surat_jalan: String(formData.get("surat_jalan") ?? ""),
    p_lines: rpcLines, p_ppn: ppn, p_credit_code: creditCode, p_payment_method: funding === "cash" ? "Tunai" : "Transfer",
  });
  if (error || !invoiceId) gagal(`Faktur, aset, stok, dan jurnal dibatalkan: ${error?.message ?? "gagal"}`);
  const { data: { user } } = await supabase.auth.getUser();
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (lampiran.length) await supabase.from("document_attachments").insert(lampiran.map((l) => ({ ...l, modul: "pembelian", ref_id: invoiceId, uploaded_by: user?.id ?? null })));
  revalidatePath(LIST); revalidatePath("/keuangan/hutang"); revalidatePath("/keuangan/aset");
  redirect(`${LIST}?success=${encodeURIComponent(`Faktur ${noFaktur} tersimpan lengkap.`)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextNoFakturLangsung(supabase: any) {
  const { nomor } = await nomorBerikutnya(supabase, "FB", hariIniWIB(), { table: "purchase_invoices", column: "no_faktur" });
  return nomor;
}
