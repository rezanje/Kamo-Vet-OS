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

export type DataKomisi = {
  baris: BarisJual[];
  /** Omzet yang tidak bisa dibagikan ke siapa pun (kasirnya belum terhubung ke data karyawan). */
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

  return { baris, omzetTanpaPenjual };
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
    .select("id, nama, tipe, basis, persen, nominal, employee_id, branch_id, category_id, item_id, min_omzet, berlaku_dari, berlaku_sampai")
    .eq("is_active", true)
    .order("nama");

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    nama: String(r.nama),
    tipe: r.tipe as "persen" | "nominal",
    basis: r.basis as "omzet" | "laba",
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
