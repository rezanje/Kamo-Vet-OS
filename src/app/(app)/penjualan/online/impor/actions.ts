"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { loadWarehouseStock } from "@/lib/warehouse-stock";
import { bacaGudangImpor } from "@/lib/online-gudang-server";
import { loadItemUnits, unitOptions } from "@/lib/satuan";
import { bacaShopeeXlsx, type ShopeeOrder } from "@/lib/shopee-import";
import type { CatalogItem, ExistingOrders } from "@/lib/shopee-import-match";

// Impor pesanan Shopee → jalur SAMA dengan input manual: RPC post_online_order (stok keluar FIFO dari gudang
// online, jurnal Dr piutang marketplace, HPP). Satu pesanan = satu RPC = satu transaksi atomik; pesanan yang
// gagal tidak menghentikan pesanan lain dan tidak pernah tersimpan sebagian.
const BACK = "/penjualan/online";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PESANAN = /^[A-Za-z0-9._-]{4,40}$/;
const MAKS_PESANAN_PER_PERMINTAAN = 50;
const CHUNK = 100;

export type PratinjauImpor = {
  error?: string;
  orders: ShopeeOrder[];
  catalog: CatalogItem[];
  existing: ExistingOrders;
};
/** satuan[i] = satuan untuk items[i] ("" / tidak ada = satuan dasar). Faktor isi ditentukan database, bukan klien. */
export type PilihanImpor = { orderNo: string; items: string[]; satuan?: string[]; sertakan?: boolean };
export type HasilImporOrder = { orderNo: string; status: "ok" | "duplikat" | "dilewati" | "error"; message: string; documentNo?: string };
export type HasilSimpanImpor = { ok: boolean; error?: string; results: HasilImporOrder[] };

type Sesi = { db: Awaited<ReturnType<typeof createClient>>; role: string; userId: string };

async function bukaSesi(): Promise<Sesi | { error: string }> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Sesi berakhir. Masuk kembali sebelum mengimpor pesanan." };
  const { data: profile } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active) return { error: "Akun tidak aktif atau tidak punya akses untuk mengimpor pesanan." };
  return { db, role: String(profile.role ?? ""), userId: user.id };
}

/** E4 (meeting 12 Nov 2026): cabang dari form → gudang utama cabang (sama persis dengan halaman). */
async function gudangDariCabang(sesi: Sesi, formData: FormData): Promise<{ warehouseId: string } | { error: string }> {
  const branchId = String(formData.get("branch_id") ?? "");
  const { data, error } = await bacaGudangImpor(sesi.db, sesi.userId, branchId);
  if (error) return { error: "Daftar gudang gagal dimuat. Muat ulang halaman lalu coba lagi." };
  if (!data.terpilih) return { error: data.cabang.length ? "Pilih cabang tujuan dulu." : "Akun ini belum terhubung ke cabang yang punya gudang toko." };
  if (!data.terkunci && branchId !== data.terpilih.id) return { error: "Cabang tidak valid. Muat ulang halaman." };
  return { warehouseId: data.terpilih.gudang.id };
}

async function bacaFile(formData: FormData): Promise<{ orders: ShopeeOrder[] } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih file Excel (.xlsx) hasil ekspor pesanan Shopee." };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "Format file harus .xlsx (ekspor pesanan Shopee)." };
  const hasil = await bacaShopeeXlsx(new Uint8Array(await file.arrayBuffer()));
  if (hasil.error) return { error: hasil.error };
  if (hasil.orders.length === 0) return { error: "Tidak ada pesanan di file." };
  return { orders: hasil.orders };
}

async function cariSudahAda(db: Sesi["db"], orderNos: string[]): Promise<ExistingOrders> {
  const hasil: ExistingOrders = {};
  const refs = [...new Set(orderNos)];
  for (let i = 0; i < refs.length; i += CHUNK) {
    const rows = await readCompleteList<{ id: string; external_ref: string; no_struk: string | null; voided_at: string | null }>((from, to) => db.from("sales")
      .select("id,external_ref,no_struk,voided_at", { count: "exact" }).eq("channel", "Shopee").in("external_ref", refs.slice(i, i + CHUNK)).order("id").range(from, to),
    "Order Shopee yang sudah ada", { maxRows: null });
    for (const r of rows) {
      // Order aktif didahulukan dari yang sudah dibatalkan.
      const lama = hasil[r.external_ref];
      if (!lama || (lama.voided && !r.voided_at)) hasil[r.external_ref] = { noStruk: r.no_struk, voided: !!r.voided_at };
    }
  }
  return hasil;
}

export async function pratinjauImporShopee(formData: FormData): Promise<PratinjauImpor> {
  const kosong = (error: string): PratinjauImpor => ({ error, orders: [], catalog: [], existing: {} });
  try {
    const sesi = await bukaSesi();
    if ("error" in sesi) return kosong(sesi.error);
    const { db } = sesi;
    // E4: gudang dihitung ulang di server dari cabang (tidak percaya kiriman klien).
    const gudang = await gudangDariCabang(sesi, formData);
    if ("error" in gudang) return kosong(gudang.error);
    const warehouseId = gudang.warehouseId;
    const baca = await bacaFile(formData);
    if ("error" in baca) return kosong(baca.error);

    const [items, stock, existing, extraUnits] = await Promise.all([
      readCompleteList<{ id: string; code: string; name: string; unit: string | null; sell_price: number | string; item_type: string | null }>((from, to) => db.from("items")
        .select("id,code,name,unit,sell_price,item_type", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to), "Daftar barang", { maxRows: null }),
      loadWarehouseStock(db, [warehouseId]),
      cariSudahAda(db, baca.orders.map(o => o.orderNo)),
      loadItemUnits(db),
    ]);
    const qty = new Map(stock.map(s => [s.item_id, Number(s.qty) || 0]));
    const catalog: CatalogItem[] = items
      .filter(i => !i.item_type || i.item_type === "Persediaan")
      .map(i => {
        const sell = Number(i.sell_price) || 0;
        // Harga beli tidak ikut dikirim ke browser.
        const units = unitOptions({ unit: i.unit, sell_price: sell }, extraUnits.get(i.id) ?? []).map(u => ({ unit: u.unit, factor: u.factor, sell_price: u.sell_price }));
        return { id: i.id, code: i.code ?? "", name: i.name, sell_price: sell, stock: qty.get(i.id) ?? 0, units };
      });
    return { orders: baca.orders, catalog, existing };
  } catch (e) {
    return kosong(e instanceof Error && e.message ? e.message : "Pratinjau gagal dimuat. Coba lagi.");
  }
}

function pesanError(raw: string): string {
  if (/rincian berbeda/i.test(raw)) return "Order ini pernah dikirim dengan rincian berbeda. Periksa daftar Penjualan Online; bila sudah tercatat, tidak perlu diimpor lagi.";
  if (/satuan tidak terdaftar/i.test(raw)) return "Satuan yang dipilih sudah tidak ada di master barang. Muat ulang pratinjau lalu pilih satuannya lagi.";
  return raw || "Gagal menyimpan order.";
}

export async function simpanImporShopee(formData: FormData): Promise<HasilSimpanImpor> {
  const gagal = (error: string): HasilSimpanImpor => ({ ok: false, error, results: [] });
  try {
    const sesi = await bukaSesi();
    if ("error" in sesi) return gagal(sesi.error);
    const { db, role } = sesi;
    const gudang = await gudangDariCabang(sesi, formData);
    if ("error" in gudang) return gagal(gudang.error);
    const warehouseId = gudang.warehouseId;
    let pilihan: PilihanImpor[];
    try { pilihan = JSON.parse(String(formData.get("selection") ?? "[]")); } catch { return gagal("Pilihan pesanan tidak valid."); }
    if (!Array.isArray(pilihan) || pilihan.length === 0) return gagal("Pilih minimal satu pesanan untuk disimpan.");
    if (pilihan.length > MAKS_PESANAN_PER_PERMINTAAN) return gagal(`Maksimal ${MAKS_PESANAN_PER_PERMINTAAN} pesanan per permintaan.`);
    const baca = await bacaFile(formData);
    if ("error" in baca) return gagal(baca.error);

    // Sumber kebenaran harga/qty/status = FILE (dibaca ulang di sini), bukan kiriman klien.
    const peta = new Map(baca.orders.map(o => [o.orderNo, o]));
    const sudahAda = await cariSudahAda(db, pilihan.map(p => String(p?.orderNo ?? "")).filter(Boolean));
    const diproses = new Set<string>();
    const results: HasilImporOrder[] = [];

    for (const p of pilihan) {
      const orderNo = String(p?.orderNo ?? "");
      const hasil = (status: HasilImporOrder["status"], message: string, documentNo?: string) => { results.push({ orderNo, status, message, documentNo }); };
      if (!NO_PESANAN.test(orderNo)) { hasil("error", "No. Pesanan tidak valid."); continue; }
      if (diproses.has(orderNo)) { hasil("duplikat", "Pesanan ini sudah diproses dalam permintaan yang sama."); continue; }
      diproses.add(orderNo);
      const order = peta.get(orderNo);
      if (!order) { hasil("error", "Pesanan tidak ada di file yang diunggah."); continue; }
      const dup = sudahAda[orderNo];
      if (dup) { hasil("duplikat", `Sudah diimpor sebagai ${dup.noStruk ?? "order lain"}${dup.voided ? " (order itu sudah dibatalkan)" : ""} — dilewati.`, dup.noStruk ?? undefined); continue; }
      if (!order.dataValid) { hasil("dilewati", order.skipReason ?? "Data pesanan tidak valid — dilewati."); continue; }
      if (!order.importable && !(p.sertakan === true && role === "OWNER")) {
        hasil("dilewati", `${order.skipReason ?? "Dilewati"}${p.sertakan === true ? " (hanya Owner yang boleh menyertakan)" : ""}`);
        continue;
      }
      const ids = Array.isArray(p.items) ? p.items.map(x => String(x ?? "")) : [];
      if (order.lines.length === 0 || ids.length !== order.lines.length || ids.some(id => !UUID.test(id))) {
        hasil("error", "Ada barang yang belum dipetakan ke master — pesanan tidak disimpan sebagian.");
        continue;
      }
      // Satuan hanya nama; database (unit_posting_factor) yang menentukan isinya dan menolak satuan yang tidak terdaftar.
      const satuan = Array.isArray(p.satuan) ? p.satuan.map(x => (typeof x === "string" ? x.trim() : "")) : [];
      if (satuan.length > ids.length || satuan.some(u => u.length > 40)) { hasil("error", "Satuan barang tidak valid — muat ulang pratinjau."); continue; }
      const key = `shopee-import:${orderNo}:${warehouseId}`;
      try {
        const { data, error } = await db.rpc("post_online_order", {
          p_request_key: key,
          p_header: { channel: "Shopee", warehouse_id: warehouseId, buyer_name: order.buyer, external_ref: orderNo, customer_id: "", tanggal: order.tanggal ?? "" },
          p_items: order.lines.map((l, i) => ({ item_id: ids[i], qty: l.qty, harga: l.harga, satuan: satuan[i] ?? "" })),
        });
        if (error || !data) { hasil("error", pesanError(error?.message ?? "Respons simpan belum terkonfirmasi. Muat ulang pratinjau: order yang sudah tersimpan akan tampil 'sudah diimpor'.")); continue; }
        hasil("ok", `Tersimpan sebagai ${data.document_no}.`, data.document_no);
      } catch {
        hasil("error", "Hasil simpan belum dapat dipastikan (koneksi terputus). Muat ulang pratinjau: bila order sudah tercatat akan tampil 'sudah diimpor'.");
      }
    }
    if (results.some(r => r.status === "ok")) revalidatePath(BACK);
    return { ok: results.every(r => r.status === "ok" || r.status === "duplikat"), results };
  } catch (e) {
    return gagal(e instanceof Error && e.message ? e.message : "Penyimpanan gagal. Muat ulang pratinjau lalu cek hasilnya.");
  }
}
