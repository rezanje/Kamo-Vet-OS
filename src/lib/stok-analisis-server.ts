// Pembaca data untuk dashboard stok (HANYA BACA). Satu panggilan fungsi SQL `laporan_stok_analisis`
// (agregasi semua gudang digabung, atau satu gudang) + daftar kecil pendukung. Tanpa N+1.
import { bolehBukaPath, type AturanTersimpan } from "./akses";
import { readCompleteList } from "./checked-list";
import { loadClinicItemCategories, type ClinicItemCategory } from "./clinic-item-categories";
import { petaKategori, resolveKategori } from "./laporan-kategori-penjualan";
import { unitOptions, type ItemUnit } from "./satuan";
import { gabungSubmenu } from "./submenu-access";
import { loadSubmenuPolicy, rulesWithSubmenu } from "./submenu-policy";
import {
  analisisSemua, daftarHarusOrder, daftarSlow, hitungPortofolio, labelRiwayat, ringkasSlow, HALAMAN_ORDER, HALAMAN_SLOW, KONFIG_STOK, PERAN_STOK,
  type BarisAnalisis, type BarisOrder, type HasilStokMentah, type PemasokInfo, type Portofolio, type RingkasSlow, type SatuanBeli,
} from "./stok-analisis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const FUNGSI_STOK = "laporan_stok_analisis";

export class StokAnalisisError extends Error {}

export type GudangOpsi = { id: string; code: string; name: string };
export type PilihanStok = { gudang: GudangOpsi[]; kategori: ClinicItemCategory[]; kategoriOpsi: string[]; kategoriDari: (b: BarisAnalisis) => string };

function bacaHasil(data: unknown): HasilStokMentah {
  const d = data as Partial<HasilStokMentah> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.baris) || typeof d.hari_ini !== "string") {
    throw new StokAnalisisError("Data stok belum dapat dibaca lengkap. Coba muat ulang.");
  }
  return d as HasilStokMentah;
}

/** Hanya angka ringkas (kartu dashboard): tanpa kategori/gudang. */
export async function muatRingkasStok(client: AnyClient, gudang = "") {
  const { data, error } = await client.rpc(FUNGSI_STOK, { p_gudang: gudang || null, p_jendela_hari: KONFIG_STOK.jendelaHari });
  if (error) {
    throw new StokAnalisisError(error.code === "PGRST202" ? "Fungsi laporan stok belum terpasang di database." : "Data stok belum dapat dibaca. Coba muat ulang.");
  }
  return analisisSemua(bacaHasil(data));
}

/** Pilihan filter (ringan, boleh dibaca sebelum Tampilkan): gudang aktif dan kategori induk. */
export async function muatPilihanStok(client: AnyClient): Promise<PilihanStok> {
  const [gudang, kategori] = await Promise.all([
    readCompleteList<GudangOpsi>((from, to) => client.from("warehouses").select("id, code, name", { count: "exact" })
      .eq("is_active", true).order("code").order("id").range(from, to), "Gudang", { maxRows: null }),
    loadClinicItemCategories(client),
  ]);
  const peta = petaKategori(kategori);
  const kategoriDari = (b: BarisAnalisis) => resolveKategori(b.kategoriId, peta).kategori;
  const kategoriOpsi = [...new Set(kategori.filter((k) => !k.parent_id).map((k) => k.name.trim().toLocaleUpperCase("id-ID")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id"));
  return { gudang, kategori, kategoriOpsi, kategoriDari };
}

function potong<T>(isi: T[], ukuran: number): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < isi.length; i += ukuran) hasil.push(isi.slice(i, i + ukuran));
  return hasil;
}

/** Satuan beli + nama pemasok hanya untuk kandidat order (ratusan, bukan seluruh barang). */
export async function muatPendukungOrder(client: AnyClient, kandidat: BarisAnalisis[]) {
  const satuanBeli = new Map<string, SatuanBeli>();
  const pemasok = new Map<string, PemasokInfo>();
  const tidakValid: string[] = [];
  const itemIds = kandidat.map((b) => b.id);
  const supplierIds = [...new Set(kandidat.map((b) => b.supplierId).filter((x): x is string => !!x))];
  const [unitRows, pemasokRows] = await Promise.all([
    Promise.all(potong(itemIds, 200).map((batch) => readCompleteList<ItemUnit & { id: string; item_id: string }>((from, to) => client.from("item_units")
      .select("id,item_id,unit,factor,sell_price,buy_price", { count: "exact" }).in("item_id", batch).order("id").range(from, to), "Satuan barang", { maxRows: null }))),
    Promise.all(potong(supplierIds, 100).map((batch) => readCompleteList<{ id: string; nama: string }>((from, to) => client.from("suppliers")
      .select("id, nama", { count: "exact" }).in("id", batch).order("id").range(from, to), "Pemasok", { maxRows: null }))),
  ]);
  const unitMap = new Map<string, ItemUnit[]>();
  for (const row of unitRows.flat()) {
    const daftar = unitMap.get(row.item_id) ?? [];
    daftar.push({ unit: row.unit, factor: Number(row.factor), sell_price: Number(row.sell_price), buy_price: Number(row.buy_price) });
    unitMap.set(row.item_id, daftar);
  }
  for (const p of pemasokRows.flat()) pemasok.set(p.id, { nama: p.nama });
  for (const b of kandidat) {
    const opsi = unitOptions({ unit: b.satuan, sell_price: 0, buy_price: b.hargaBeliDasar }, unitMap.get(b.id) ?? []);
    const beli = opsi.find((u) => u.unit === (b.buyUnit || b.satuan));
    if (!beli) { tidakValid.push(b.nama); satuanBeli.set(b.id, null); continue; }
    satuanBeli.set(b.id, { unit: beli.unit, faktor: beli.factor, hargaBeli: Number(beli.buy_price) || b.hargaBeliDasar || 0 });
  }
  return { satuanBeli, pemasok, tidakValid };
}

/** Pemeriksaan akses sisi server (halaman & unduhan): peran aktif + Akses Grup (termasuk sub-menu). */
export async function periksaAksesStok(client: AnyClient, path: string): Promise<{ ok: boolean; role: string | null; aturan: AturanTersimpan }> {
  const gagal = { ok: false, role: null, aturan: [] as AturanTersimpan };
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return gagal;
    const { data: profile, error: profileError } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (profileError || !profile?.role || profile.is_active === false) return gagal;
    const { data: rules, error: rulesError } = await client.from("role_modules").select("role, module_id").eq("role", profile.role);
    if (rulesError || !Array.isArray(rules)) return gagal;
    // Gerbang otorisasi: bila kebijakan sub-menu tidak terbaca, gagal tertutup (kecuali OWNER, yang tidak pernah dibatasi).
    const kebijakan = await loadSubmenuPolicy(client);
    if (kebijakan.status === "error" && profile.role !== "OWNER") return gagal;
    const aturan = gabungSubmenu(rules as { role: string; module_id: string }[], kebijakan.rows) as AturanTersimpan;
    return { ok: bolehBukaPath(profile.role, path, aturan), role: profile.role, aturan };
  } catch { return gagal; }
}

export type KartuStokData = {
  label: string; riwayatBaru: boolean; riwayatHari: number;
  portofolio: Portofolio;
  slow: (RingkasSlow & { top: BarisAnalisis[] }) | null;
  order: { jumlah: number; nilai: number; top: BarisOrder[] } | null;
};
export type KartuStok = { galat: string } | ({ galat?: undefined } & KartuStokData) | null;

/**
 * Dua kartu dashboard. null = tidak ditampilkan (peran bukan OWNER/ADMIN/FINANCE atau tidak diberi akses halamannya).
 * Galat apa pun menjadi kartu "belum dapat dihitung", tidak pernah menjatuhkan dashboard.
 */
export async function muatKartuStok(client: AnyClient, role: string | null | undefined): Promise<KartuStok> {
  if (!role || !(PERAN_STOK as readonly string[]).includes(role)) return null;
  try {
    const { data, error } = await client.from("role_modules").select("role, module_id").eq("role", role);
    if (error || !Array.isArray(data)) throw new StokAnalisisError("Hak akses belum dapat dibaca.");
    const aturan = await rulesWithSubmenu(client, data as { role: string; module_id: string }[]) as AturanTersimpan;
    const bolehSlow = bolehBukaPath(role, HALAMAN_SLOW, aturan);
    const bolehOrder = bolehBukaPath(role, HALAMAN_ORDER, aturan);
    if (!bolehSlow && !bolehOrder) return null;
    const { ctx, baris } = await muatRingkasStok(client);
    let slow: KartuStokData["slow"] = null;
    if (bolehSlow) { const daftar = daftarSlow(baris); slow = { ...ringkasSlow(daftar), top: daftar.slice(0, 5) }; }
    let order: KartuStokData["order"] = null;
    if (bolehOrder) {
      const kandidat = baris.filter((b) => b.aktif && b.alasanOrder.length > 0 && (b.minStock > 0 || b.terjualHari > 0));
      const pend = await muatPendukungOrder(client, kandidat);
      const rows = daftarHarusOrder(kandidat, pend.satuanBeli, pend.pemasok, ctx);
      const urut = rows.sort((a, b) => (a.coverHari ?? Infinity) - (b.coverHari ?? Infinity) || a.nama.localeCompare(b.nama, "id"));
      order = { jumlah: rows.length, nilai: rows.reduce((a, r) => a + r.nilai, 0), top: urut.slice(0, 5) };
    }
    return { label: labelRiwayat(ctx), riwayatBaru: ctx.riwayatBaru, riwayatHari: ctx.riwayatHari, portofolio: hitungPortofolio(baris), slow, order };
  } catch (e) {
    return { galat: e instanceof StokAnalisisError ? e.message : "Data stok belum dapat dihitung. Muat ulang sebentar lagi." };
  }
}
