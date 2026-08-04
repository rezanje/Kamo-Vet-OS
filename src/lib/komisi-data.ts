// Pengumpul data komisi: menarik penjualan + retur satu periode lalu menyusunnya
// jadi baris siap hitung untuk `hitungKomisi`.
//
// Dipisah dari layar supaya layar komisi, layar target, dan penggajian memakai
// sumber angka yang sama persis.

import { lineSubtotal } from "./pos-calc";
import { hitungKomisi, type AturanKomisi, type BarisJual, type HasilKomisi } from "./komisi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const awalPeriode = (periode: string) => `${periode}-01`;

export const akhirPeriode = (periode: string): string => {
  const [thn, bln] = periode.split("-").map(Number);
  return `${periode}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;
};

type SaleItemRow = {
  item_id: string | null;
  qty: number;
  harga: number;
  item_discount_type: "nominal" | "percent" | null;
  item_discount_value: number | null;
  hpp: number | null;
};

type SaleRow = {
  id: string;
  created_at: string;
  branch_id: string | null;
  cashier_id: string | null;
  total: number;
  sale_items: SaleItemRow[] | null;
};

type ReturRow = {
  sale_id: string;
  tanggal: string;
  sales_return_items: { item_id: string | null; qty: number; harga: number }[] | null;
};

type InvoiceRow = {
  id: string;
  paid_at: string;
  total: number;
  visits: { branch_id: string | null; doctor_id: string | null } | { branch_id: string | null; doctor_id: string | null }[] | null;
  invoice_items: { item_id: string | null; qty: number; harga: number; hpp: number | null }[] | null;
};

type FakturJualRow = {
  id: string;
  tanggal: string;
  dpp: number;
  branch_id: string | null;
  created_by: string | null;
  sales_invoice_items: { order_item_id: string | null; item_id: string | null; qty: number; harga: number }[] | null;
};

export type DataKomisi = {
  baris: BarisJual[];
  /** Omzet yang tidak bisa dibagikan ke siapa pun (kasir/dokternya belum terhubung ke data karyawan). */
  omzetTanpaPenjual: number;
};

/** Rantai kategori sebuah barang: kategorinya sendiri + induknya (kategori 2 tingkat, migrasi 0066). */
function rantaiKategori(catId: string | null, indukPer: Map<string, string | null>): string[] {
  const out: string[] = [];
  let cur = catId;
  // Batas kedalaman menjaga dari data kategori yang tanpa sengaja melingkar.
  for (let i = 0; cur && i < 5; i++) {
    out.push(cur);
    cur = indukPer.get(cur) ?? null;
  }
  return out;
}

export async function kumpulkanBarisKomisi(supabase: AnyClient, periode: string): Promise<DataKomisi> {
  const awal = awalPeriode(periode);
  const akhir = akhirPeriode(periode);

  const [{ data: salesData }, { data: empData }, { data: itemData }, { data: katData }] = await Promise.all([
    supabase.from("sales")
      .select("id, created_at, branch_id, cashier_id, total, sale_items(item_id, qty, harga, item_discount_type, item_discount_value, hpp)")
      .gte("created_at", `${awal}T00:00:00`).lte("created_at", `${akhir}T23:59:59`),
    supabase.from("employees").select("id, profile_id").not("profile_id", "is", null),
    supabase.from("items").select("id, category_id"),
    supabase.from("item_categories").select("id, parent_id"),
  ]);

  const sales = (salesData ?? []) as SaleRow[];
  const empPerProfile = new Map(
    ((empData ?? []) as { id: string; profile_id: string }[]).map((e) => [e.profile_id, e.id]),
  );
  const katPerItem = new Map(
    ((itemData ?? []) as { id: string; category_id: string | null }[]).map((i) => [i.id, i.category_id]),
  );
  const indukPerKat = new Map(
    ((katData ?? []) as { id: string; parent_id: string | null }[]).map((k) => [k.id, k.parent_id]),
  );

  const baris: BarisJual[] = [];
  let omzetTanpaPenjual = 0;

  // Untuk baris retur: modal & pemilik struk asli.
  const infoStruk = new Map<string, { employeeId: string | null; branchId: string | null; hppPerUnit: Map<string, number> }>();

  for (const s of sales) {
    const employeeId = s.cashier_id ? empPerProfile.get(s.cashier_id) ?? null : null;
    const items = s.sale_items ?? [];

    const subtotalPer = items.map((it) => lineSubtotal({
      qty: Number(it.qty),
      harga: Number(it.harga),
      item_discount_type: it.item_discount_type,
      item_discount_value: Number(it.item_discount_value ?? 0),
    }));
    const jumlahBaris = subtotalPer.reduce((a, v) => a + v, 0);

    // Potongan tingkat struk (voucher, poin, diskon golongan, diskon manual kasir) tidak
    // tersimpan per baris. Selisih antara jumlah baris dan total struk dibagi rata secara
    // proporsional supaya komisi tidak dihitung dari harga sebelum potongan.
    const potonganStruk = Math.max(0, jumlahBaris - Number(s.total));

    const hppPerUnit = new Map<string, number>();
    for (const [idx, it] of items.entries()) {
      const qty = Number(it.qty);
      if (it.item_id && it.hpp !== null && qty > 0) hppPerUnit.set(it.item_id, Number(it.hpp) / qty);

      const kotor = subtotalPer[idx];
      const omzet = jumlahBaris > 0 ? kotor - (potonganStruk * kotor) / jumlahBaris : kotor;
      if (!employeeId) omzetTanpaPenjual += omzet;

      // Baris tanpa penjual tetap dibawa: realisasi target per cabang/kategori
      // tidak boleh kehilangan omzet cuma karena kasirnya belum terhubung ke
      // data karyawan. `hitungKomisi` yang menyaringnya.
      baris.push({
        tanggal: s.created_at.slice(0, 10),
        sumber: "kasir",
        employeeId,
        branchId: s.branch_id,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty,
        omzet,
        laba: it.hpp === null ? null : omzet - Number(it.hpp),
      });
    }

    infoStruk.set(s.id, { employeeId, branchId: s.branch_id, hppPerUnit });
  }

  // ── Retur: mengurangi komisi orang yang menjualnya, di bulan returnya terjadi ──
  const { data: returData } = await supabase
    .from("sales_returns")
    .select("sale_id, tanggal, sales_return_items(item_id, qty, harga)")
    .gte("tanggal", awal).lte("tanggal", akhir);

  for (const r of (returData ?? []) as ReturRow[]) {
    const asal = infoStruk.get(r.sale_id);
    // Struk asalnya di luar periode ini — ambil pemiliknya langsung dari struk itu.
    const info = asal ?? (await infoStrukLuarPeriode(supabase, r.sale_id, empPerProfile));
    if (!info) continue;
    if (!info.employeeId) {
      omzetTanpaPenjual -= (r.sales_return_items ?? []).reduce((a, i) => a + Number(i.qty) * Number(i.harga), 0);
    }

    for (const it of r.sales_return_items ?? []) {
      const qty = Number(it.qty);
      const nilai = qty * Number(it.harga);
      const hppUnit = it.item_id ? info.hppPerUnit.get(it.item_id) : undefined;
      baris.push({
        tanggal: r.tanggal,
        sumber: "kasir",
        employeeId: info.employeeId,
        branchId: info.branchId,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty: -qty,
        omzet: -nilai,
        laba: hppUnit === undefined ? null : -(nilai - hppUnit * qty),
      });
    }
  }

  // ── Klinik: tagihan kunjungan yang sudah lunas, jadi haknya dokter ────────────
  // Dipatok pada tanggal bayar, bukan tanggal periksa: yang dikomisikan adalah uang
  // yang benar-benar masuk. Tagihan DP/belum lunas menyusul di bulan pelunasannya.
  const { data: invData } = await supabase
    .from("invoices")
    .select("id, paid_at, total, visits(branch_id, doctor_id), invoice_items(item_id, qty, harga, hpp)")
    .eq("paid_status", "Lunas")
    .gte("paid_at", `${awal}T00:00:00`).lte("paid_at", `${akhir}T23:59:59`);

  for (const inv of (invData ?? []) as InvoiceRow[]) {
    const v = Array.isArray(inv.visits) ? inv.visits[0] ?? null : inv.visits;
    const employeeId = v?.doctor_id ?? null;
    const items = inv.invoice_items ?? [];

    // Baris tagihan klinik tidak punya diskon per baris; potongannya cuma di kepala
    // tagihan, jadi dibagi proporsional seperti struk kasir.
    const kotorPer = items.map((it) => Number(it.qty) * Number(it.harga));
    const jumlahBaris = kotorPer.reduce((a, x) => a + x, 0);
    const potongan = Math.max(0, jumlahBaris - Number(inv.total));

    for (const [idx, it] of items.entries()) {
      const omzet = jumlahBaris > 0 ? kotorPer[idx] - (potongan * kotorPer[idx]) / jumlahBaris : kotorPer[idx];
      if (!employeeId) omzetTanpaPenjual += omzet;

      baris.push({
        tanggal: inv.paid_at.slice(0, 10),
        sumber: "klinik",
        employeeId,
        branchId: v?.branch_id ?? null,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty: Number(it.qty),
        omzet,
        // Jasa tidak punya modal barang — labanya utuh, bukan tidak diketahui.
        laba: it.item_id === null ? omzet : it.hpp === null ? null : omzet - Number(it.hpp),
      });
    }
  }

  // ── Reseller: faktur penjualan dari rantai dokumen (migrasi 0098) ─────────────
  // Dipatok pada tanggal faktur, bukan tanggal pelunasan seperti klinik: di sini
  // pendapatan diakui saat faktur terbit (Dr 1201 / Cr 4101), jadi omzet komisi,
  // realisasi target, dan omzet dashboard menunjuk angka yang sama. Faktur batal
  // tidak ikut. Yang dianggap penjualnya = pembuat faktur.
  const { data: fjData } = await supabase
    .from("sales_invoices")
    .select("id, tanggal, dpp, branch_id, created_by, sales_invoice_items(order_item_id, item_id, qty, harga)")
    .neq("status", "batal")
    .gte("tanggal", awal).lte("tanggal", akhir);

  const fakturs = (fjData ?? []) as FakturJualRow[];
  const hppPerOrderItem = await hppPengiriman(
    supabase,
    fakturs.flatMap((f) => (f.sales_invoice_items ?? []).map((it) => it.order_item_id).filter((x): x is string => !!x)),
  );

  for (const f of fakturs) {
    const employeeId = f.created_by ? empPerProfile.get(f.created_by) ?? null : null;
    const items = f.sales_invoice_items ?? [];

    // Baris faktur tidak punya diskon sendiri; potongan kepala faktur (kalau ada)
    // dibagi proporsional. Dasarnya DPP, bukan total — PPN bukan omzet penjual.
    const kotorPer = items.map((it) => Number(it.qty) * Number(it.harga));
    const jumlahBaris = kotorPer.reduce((a, x) => a + x, 0);
    const potongan = Math.max(0, jumlahBaris - Number(f.dpp));

    for (const [idx, it] of items.entries()) {
      const qty = Number(it.qty);
      const omzet = jumlahBaris > 0 ? kotorPer[idx] - (potongan * kotorPer[idx]) / jumlahBaris : kotorPer[idx];
      if (!employeeId) omzetTanpaPenjual += omzet;

      const hppUnit = it.order_item_id ? hppPerOrderItem.get(it.order_item_id) : undefined;
      baris.push({
        tanggal: f.tanggal,
        sumber: "reseller",
        employeeId,
        branchId: f.branch_id,
        itemId: it.item_id,
        kategoriIds: rantaiKategori(it.item_id ? katPerItem.get(it.item_id) ?? null : null, indukPerKat),
        qty,
        omzet,
        // Jasa (tanpa master barang) tidak punya modal — labanya utuh.
        laba: it.item_id === null ? omzet : hppUnit === undefined ? null : omzet - hppUnit * qty,
      });
    }
  }

  return { baris, omzetTanpaPenjual };
}

/**
 * Modal per unit tiap baris pesanan, diambil dari pengiriman yang sudah terjadi.
 * Faktur penjualan tidak menyimpan HPP — barangnya keluar di dokumen pengiriman,
 * dan di situlah modal FIFO-nya dicatat.
 */
async function hppPengiriman(supabase: AnyClient, orderItemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(orderItemIds)];
  if (ids.length === 0) return out;

  const { data } = await supabase
    .from("sales_delivery_items")
    .select("order_item_id, qty, hpp")
    .in("order_item_id", ids);

  const akum = new Map<string, { qty: number; hpp: number }>();
  for (const d of (data ?? []) as { order_item_id: string | null; qty: number; hpp: number | null }[]) {
    if (!d.order_item_id || d.hpp === null) continue;
    const a = akum.get(d.order_item_id) ?? { qty: 0, hpp: 0 };
    a.qty += Number(d.qty);
    a.hpp += Number(d.hpp);
    akum.set(d.order_item_id, a);
  }
  for (const [id, a] of akum) if (a.qty > 0) out.set(id, a.hpp / a.qty);
  return out;
}

async function infoStrukLuarPeriode(
  supabase: AnyClient,
  saleId: string,
  empPerProfile: Map<string, string>,
): Promise<{ employeeId: string | null; branchId: string | null; hppPerUnit: Map<string, number> } | null> {
  const { data } = await supabase
    .from("sales").select("branch_id, cashier_id, sale_items(item_id, qty, hpp)").eq("id", saleId).maybeSingle();
  if (!data) return null;
  const hppPerUnit = new Map<string, number>();
  for (const it of (data.sale_items ?? []) as { item_id: string | null; qty: number; hpp: number | null }[]) {
    if (it.item_id && it.hpp !== null && Number(it.qty) > 0) hppPerUnit.set(it.item_id, Number(it.hpp) / Number(it.qty));
  }
  return {
    employeeId: data.cashier_id ? empPerProfile.get(data.cashier_id) ?? null : null,
    branchId: data.branch_id,
    hppPerUnit,
  };
}

export async function muatAturanKomisi(supabase: AnyClient): Promise<AturanKomisi[]> {
  const { data } = await supabase
    .from("commission_rules")
    .select("id, nama, tipe, basis, sumber, persen, nominal, employee_id, branch_id, category_id, item_id, min_omzet, berlaku_dari, berlaku_sampai")
    .eq("is_active", true)
    .order("nama");

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    nama: String(r.nama),
    tipe: r.tipe as "persen" | "nominal",
    basis: r.basis as "omzet" | "laba",
    sumber: r.sumber as "semua" | "kasir" | "klinik",
    persen: Number(r.persen),
    nominal: Number(r.nominal),
    employeeId: (r.employee_id as string | null) ?? null,
    branchId: (r.branch_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    itemId: (r.item_id as string | null) ?? null,
    minOmzet: Number(r.min_omzet),
    dari: (r.berlaku_dari as string | null) ?? null,
    sampai: (r.berlaku_sampai as string | null) ?? null,
  }));
}

/** Komisi seluruh karyawan untuk satu periode — dipakai layar komisi & penggajian. */
export async function komisiPeriode(
  supabase: AnyClient,
  periode: string,
): Promise<{ hasil: HasilKomisi[]; baris: BarisJual[]; omzetTanpaPenjual: number }> {
  const [{ baris, omzetTanpaPenjual }, aturan] = await Promise.all([
    kumpulkanBarisKomisi(supabase, periode),
    muatAturanKomisi(supabase),
  ]);
  return { hasil: hitungKomisi(baris, aturan), baris, omzetTanpaPenjual };
}
