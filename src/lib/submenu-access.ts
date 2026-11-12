// Hak buka SUB-MENU per peran (di dalam satu modul). Murni, dites di __tests__/submenu-access.test.ts.
//
// Aturan emas:
//  1. Peran tanpa kebijakan sub-menu = perilaku lama persis (modul diizinkan => semua halamannya boleh).
//     Kebijakan itu opt-in per peran per modul; `undefined` selalu berarti "semua sub-menu".
//  2. Penegakan di jalur URL (prefix), bukan cuma menyembunyikan tautan: satu id sub-menu memiliki satu
//     atau lebih prefix rute; halaman rincian/aksi di bawah prefix itu ikut sub-menunya (prefix terpanjang menang).
//  3. Rute di dalam modul yang tidak dimiliki sub-menu mana pun GAGAL TERTUTUP bila modulnya dibatasi.
//  4. Ini otorisasi navigasi/halaman saja. Uang, RLS, dan kebijakan aksi di database tidak disentuh.
import { TILES } from "./nav";

export type SubmenuEntry = {
  id: string; // "<modul>.<slug>" — stabil, disimpan di database; jangan diganti nama
  module: string;
  routes: string[]; // prefix rute yang dimiliki (batas segmen); halaman di bawahnya mewarisi
  label?: string; // wajib bila tidak ada tile yang mengarah ke sana
};

const e = (module: string, slug: string, routes: string[], label?: string): SubmenuEntry => ({ id: `${module}.${slug}`, module, routes, label });

export const SUBMENU_ENTRIES: readonly SubmenuEntry[] = [
  // ── Klinik ──
  e("klinik", "registrasi", ["/klinik/registrasi"]),
  e("klinik", "antrian", ["/klinik/antrian"]),
  e("klinik", "rekam-medis", ["/klinik/rekam-medis"]),
  e("klinik", "impor-rekam-medis", ["/klinik/rekam-medis/impor"]),
  e("klinik", "rawat-inap", ["/klinik/rawat-inap"]),
  e("klinik", "racik", ["/klinik/racik"]),
  e("klinik", "aturan-demo", ["/klinik/aturan-demo"]),
  e("klinik", "persetujuan", ["/klinik/persetujuan", "/klinik/consent"]),
  e("klinik", "follow-up", ["/klinik/follow-up"]),
  e("klinik", "bahan-baku", ["/klinik/bahan-baku"]),
  e("klinik", "katalog-racikan", ["/klinik/katalog-racikan"]),
  e("klinik", "jadwal-dokter", ["/klinik/jadwal-dokter"]),
  e("klinik", "maintenance", ["/klinik/maintenance"]),
  e("klinik", "booking", ["/klinik/booking"]),
  e("klinik", "penerimaan", ["/klinik/penerimaan"]),
  e("klinik", "pembayaran", ["/klinik/pembayaran"], "Pembayaran kasir klinik"),
  e("klinik", "shift", ["/klinik/shift"], "Shift kasir klinik"),
  e("klinik", "pengeluaran", ["/klinik/pengeluaran"], "Pengeluaran klinik"),
  e("klinik", "permintaan", ["/klinik/permintaan"], "Permintaan barang klinik"),
  // ── CRM ──
  e("crm", "promo", ["/crm/promo", "/crm/voucher"]),
  e("crm", "pelanggan", ["/crm/pelanggan", "/crm/anabul"]),
  e("crm", "kategori-pelanggan", ["/crm/kategori-pelanggan"]),
  e("crm", "status-ulasan", ["/crm/status-ulasan"]),
  e("crm", "kampanye", ["/crm/kampanye"], "Kampanye"),
  // ── HRIS ──
  e("hris", "karyawan", ["/hris/karyawan"]),
  e("hris", "absensi", ["/hris/absensi"]),
  e("hris", "jadwal", ["/hris/jadwal"]),
  e("hris", "penggajian", ["/hris/penggajian"]),
  e("hris", "cuti", ["/hris/cuti"]),
  e("hris", "pengajuan", ["/hris/pengajuan"]),
  e("hris", "kpi", ["/hris/kpi"]),
  e("hris", "komponen-gaji", ["/hris/komponen-gaji"]),
  e("hris", "shift", ["/hris/shift"]),
  // ── Pengaturan ──
  e("pengaturan", "akses-grup", ["/pengaturan/akses-grup"]),
  e("pengaturan", "pengguna", ["/pengaturan/pengguna"]),
  e("pengaturan", "penomoran", ["/pengaturan/penomoran"]),
  e("pengaturan", "penyetuju", ["/pengaturan/penyetuju"]),
  e("pengaturan", "cabang", ["/pengaturan/cabang"]),
  e("pengaturan", "tier", ["/pengaturan/tier"]),
  e("pengaturan", "gaji", ["/pengaturan/gaji"]),
  e("pengaturan", "operasional-klinik", ["/pengaturan/operasional-klinik"]),
  e("pengaturan", "alert-operasional", ["/pengaturan/alert-operasional"]),
  e("pengaturan", "wa-engine", ["/pengaturan/wa-engine"]),
  e("pengaturan", "impor", ["/pengaturan/impor"], "Impor data"),
  // ── Perusahaan ──
  e("perusahaan", "cabang", ["/perusahaan/cabang"]),
  e("perusahaan", "gudang", ["/perusahaan/gudang"]),
  e("perusahaan", "log-aktifitas", ["/perusahaan/log-aktifitas"]),
  // ── Buku Besar ──
  e("buku-besar", "coa", ["/keuangan/coa"]),
  e("buku-besar", "jurnal", ["/keuangan/jurnal"]),
  e("buku-besar", "jurnal-berulang", ["/keuangan/jurnal-berulang"]),
  e("buku-besar", "histori-akun", ["/keuangan/buku-besar"]),
  e("buku-besar", "tutup-buku", ["/keuangan/tutup-buku"]),
  e("buku-besar", "closing-hpp", ["/keuangan/closing-hpp"], "Closing HPP"),
  e("buku-besar", "saldo-awal", ["/keuangan/saldo-awal"]),
  e("buku-besar", "saldo-awal-faktur", ["/keuangan/saldo-awal-faktur"]),
  e("buku-besar", "sinkron", ["/keuangan/sinkron"]),
  e("buku-besar", "monitor-anggaran", ["/buku-besar/monitor-anggaran"]),
  e("buku-besar", "transfer-anggaran", ["/buku-besar/transfer-anggaran"]),
  e("buku-besar", "anggaran", ["/buku-besar/anggaran"]),
  e("buku-besar", "log", ["/buku-besar/log"]),
  e("buku-besar", "beban", ["/buku-besar/beban"], "Pencatatan beban"),
  // ── Kas & Bank ──
  e("kas-bank", "hutang", ["/keuangan/hutang"]),
  e("kas-bank", "hutang-pembantu", ["/keuangan/hutang/pembantu"]),
  e("kas-bank", "piutang", ["/keuangan/piutang"]),
  e("kas-bank", "piutang-pembantu", ["/keuangan/piutang/pembantu"]),
  e("kas-bank", "kas-keluar", ["/kas-bank/kas-keluar"]),
  e("kas-bank", "kas-masuk", ["/kas-bank/kas-masuk"]),
  e("kas-bank", "transfer", ["/kas-bank/transfer"]),
  e("kas-bank", "rekonsiliasi", ["/keuangan/rekonsiliasi"]),
  e("kas-bank", "rekening", ["/kas-bank/rekening"]),
  e("kas-bank", "peta", ["/kas-bank/peta"]),
  e("kas-bank", "refund", ["/kas-bank/refund"], "Antrean pengembalian dana"),
  // ── Penjualan ── (halaman utama /penjualan = rekap penjualan + rincian transaksi per id)
  e("penjualan", "rekap", ["/penjualan"], "Rekap penjualan (halaman utama)"),
  e("penjualan", "penawaran", ["/penjualan/penawaran"]),
  e("penjualan", "pesanan", ["/penjualan/pesanan"]),
  e("penjualan", "pengiriman", ["/penjualan/pengiriman"]),
  e("penjualan", "uang-muka", ["/penjualan/uang-muka"]),
  e("penjualan", "faktur", ["/penjualan/faktur"], "Faktur penjualan dan penerimaan"),
  e("penjualan", "retur", ["/penjualan/retur"]),
  e("penjualan", "retur-grosir", ["/penjualan/retur-grosir"]),
  e("penjualan", "komisi", ["/penjualan/komisi"]),
  e("penjualan", "target", ["/penjualan/target"]),
  e("penjualan", "online", ["/penjualan/online"]),
  // ── Pembelian ── (halaman utama /pembelian = pesanan pembelian + tab pemasok)
  e("pembelian", "pesanan", ["/pembelian"], "Pesanan pembelian dan pemasok"),
  e("pembelian", "penerimaan", ["/pembelian/penerimaan"]),
  e("pembelian", "uang-muka", ["/pembelian/uang-muka"]),
  e("pembelian", "faktur", ["/pembelian/faktur"]),
  e("pembelian", "faktur-langsung", ["/pembelian/faktur/langsung"]),
  e("pembelian", "retur", ["/pembelian/retur"]),
  e("pembelian", "kategori-pemasok", ["/pembelian/kategori-pemasok"]),
  e("pembelian", "perintah-bayar", ["/pembelian/perintah-bayar"]),
  e("pembelian", "koreksi", ["/pembelian/koreksi"]),
  // ── Persediaan (id modul `pos`) ── Shift Kasir dan Quest diatur grup Operasional, bukan di sini.
  e("pos", "permintaan", ["/pos/permintaan"]),
  e("pos", "pemindahan", ["/pos/pemindahan"]),
  e("pos", "penyesuaian", ["/pos/penyesuaian"]),
  e("pos", "produksi", ["/pos/produksi"], "Produksi own brand (pekerjaan dan penyelesaian pesanan)"),
  e("pos", "opname", ["/pos/opname"], "Stok opname (perintah dan hasil)"),
  e("pos", "sku", ["/pos/sku"]),
  e("pos", "sku-varian", ["/pos/sku/varian"]),
  e("pos", "sku-impor", ["/pos/sku/impor"]),
  e("pos", "harga", ["/pos/harga"]),
  e("pos", "satuan", ["/pos/satuan"]),
  e("pos", "kategori", ["/pos/kategori"]),
  e("pos", "merek", ["/pos/merek"]),
  e("pos", "stok-minimum", ["/pos/stok-minimum"]),
  e("pos", "stok", ["/pos/stok"]),
  e("pos", "kartu-stok", ["/pos/kartu-stok"]),
  e("pos", "expired", ["/pos/expired"]),
  e("pos", "transaksi", ["/pos/transaksi", "/pos/struk"]),
  e("pos", "expense", ["/pos/expense"]),
  // ── Aset Tetap ──
  e("aset-tetap", "aset", ["/keuangan/aset"], "Aset tetap (termasuk perubahan, disposisi, pindah)"),
  e("aset-tetap", "kategori-aset", ["/keuangan/kategori-aset"]),
  e("aset-tetap", "kategori-aset-pajak", ["/keuangan/kategori-aset-pajak"]),
  // ── Pajak ── (/pajak/faktur tidak dimiliki modul mana pun sejak dulu; tidak dipetakan)
  e("pajak", "mode-pkp", ["/pengaturan/pajak"]),
  e("pajak", "rekap-ppn", ["/keuangan/ppn"]),
  // ── Daftar Laporan ──
  e("laporan", "operasional-penjualan", ["/laporan/operasional-penjualan"]),
  e("laporan", "pelanggan-teratas", ["/laporan/pelanggan-teratas"]),
  e("laporan", "jadwal-anabul", ["/laporan/jadwal-anabul"]),
  e("laporan", "absensi", ["/laporan/absensi"]),
  e("laporan", "gaji", ["/laporan/gaji"]),
  e("laporan", "penjualan-rinci", ["/laporan/penjualan-rinci"]),
  e("laporan", "penjualan-barang", ["/laporan/penjualan-barang"]),
  e("laporan", "penjualan-kasir", ["/laporan/penjualan-kasir"]),
  e("laporan", "transaksi-cabang", ["/laporan/transaksi-cabang"]),
  e("laporan", "pelanggan-harian", ["/laporan/pelanggan-harian"]),
  e("laporan", "akuisisi", ["/laporan/akuisisi"]),
  e("laporan", "pembelian", ["/laporan/pembelian"]),
  e("laporan", "penjual", ["/laporan/penjual"]),
  e("laporan", "anamnesa", ["/laporan/anamnesa"]),
  e("laporan", "retensi", ["/laporan/retensi"]),
  e("laporan", "promo", ["/laporan/promo"]),
  e("laporan", "rekap-klinik", ["/laporan/rekap-klinik"]),
  // A4: baris katalognya ditambah migrasi 20261115300000_a4_submenu_laporan_visit.sql.
  e("laporan", "visit", ["/laporan/visit"]),
  e("laporan", "member", ["/laporan/member"]),
  e("laporan", "kpi", ["/laporan/kpi"]),
  e("laporan", "hasil-opname", ["/laporan/hasil-opname"], "Hasil opname (laporan)"),
  e("laporan", "margin-racikan", ["/laporan/margin-racikan"], "Margin racikan"),
  e("laporan", "nilai-persediaan", ["/laporan/nilai-persediaan"], "Nilai persediaan"),
  e("laporan", "laba-rugi", ["/keuangan/laba-rugi"]),
  e("laporan", "neraca", ["/keuangan/neraca"]),
  e("laporan", "neraca-saldo", ["/keuangan/neraca-saldo"]),
  e("laporan", "arus-kas", ["/keuangan/arus-kas"]),
  e("laporan", "arus-kas-rincian", ["/keuangan/arus-kas/rincian"]),
];

/** Halaman depan modul (kotak-kotak menu): terbuka selama modulnya punya minimal satu sub-menu yang diizinkan. */
export const SUBMENU_HOME: Record<string, string> = {
  klinik: "/klinik", crm: "/crm", hris: "/hris", pengaturan: "/pengaturan", perusahaan: "/perusahaan",
  "buku-besar": "/buku-besar", "kas-bank": "/kas-bank", pos: "/pos", laporan: "/laporan",
};

const cocok = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
const bersih = (path: string) => { const p = path.split(/[?#]/)[0]; return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p; };

const ENTRY_BY_ID = new Map(SUBMENU_ENTRIES.map(x => [x.id, x]));
export const submenuById = (id: string): SubmenuEntry | undefined => ENTRY_BY_ID.get(id);

function longest(entries: readonly SubmenuEntry[], path: string): SubmenuEntry | null {
  let best: SubmenuEntry | null = null; let bestLen = -1;
  for (const entry of entries) for (const r of entry.routes) {
    if (cocok(path, r) && r.length > bestLen) { best = entry; bestLen = r.length; }
  }
  return best;
}

/** Sub-menu yang memiliki path ini (seluruh modul), atau null. Dipakai untuk memetakan tile. */
export function submenuOfPath(path: string): SubmenuEntry | null { return longest(SUBMENU_ENTRIES, bersih(path)); }

export function selectableSubmenus(moduleId: string): SubmenuEntry[] { return SUBMENU_ENTRIES.filter(x => x.module === moduleId); }

export type SubmenuResolution = { kind: "submenu"; id: string } | { kind: "home" } | { kind: "unmapped" };

/** Path di dalam satu modul → sub-menu pemiliknya (hanya sub-menu modul itu). Tidak dikenal = unmapped (gagal tertutup). */
export function resolveSubmenu(moduleId: string, path: string): SubmenuResolution {
  const p = bersih(path);
  const hit = longest(selectableSubmenus(moduleId), p);
  if (hit) return { kind: "submenu", id: hit.id };
  if (SUBMENU_HOME[moduleId] === p) return { kind: "home" };
  return { kind: "unmapped" };
}

export function moduleHasAllowedSubmenu(moduleId: string, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true;
  return selectableSubmenus(moduleId).some(x => allowed.includes(x.id));
}

/** `allowed === undefined` = tidak ada kebijakan = perilaku lama (semua boleh). */
export function submenuIzinkan(moduleId: string, path: string, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true;
  const r = resolveSubmenu(moduleId, path);
  if (r.kind === "submenu") return allowed.includes(r.id);
  if (r.kind === "home") return moduleHasAllowedSubmenu(moduleId, allowed);
  return false;
}

/** Tujuan klik modul di sidebar untuk modul yang dibatasi: halaman depan bila terbuka, selain itu sub-menu pertama yang diizinkan. */
export function submenuLanding(moduleId: string, allowed: readonly string[] | undefined): string | null {
  if (allowed === undefined || !moduleHasAllowedSubmenu(moduleId, allowed)) return null;
  const root = `/${moduleId}`;
  if (submenuIzinkan(moduleId, root, allowed)) return root;
  if (SUBMENU_HOME[moduleId]) return SUBMENU_HOME[moduleId];
  const first = selectableSubmenus(moduleId).find(x => allowed.includes(x.id));
  return first ? first.routes[0] : null;
}

export function submenuSummary(moduleId: string, allowed: readonly string[] | undefined): { allowed: number; total: number; restricted: boolean } {
  const all = selectableSubmenus(moduleId);
  if (allowed === undefined) return { allowed: all.length, total: all.length, restricted: false };
  return { allowed: all.filter(x => allowed.includes(x.id)).length, total: all.length, restricted: true };
}

// Label tile yang mengarah ke tiap sub-menu (dari nav.ts; tidak ditulis ulang supaya tidak melenceng).
const TILE_LABELS = new Map<string, string[]>();
for (const [moduleId, tiles] of Object.entries(TILES)) {
  for (const tile of tiles) {
    if (!tile.href) continue;
    const path = tile.href.split(/[?#]/)[0];
    const entry = submenuOfPath(path); // kasir/quest/shift/`/me` tidak dipetakan => null
    if (!entry) continue;
    const list = TILE_LABELS.get(entry.id) ?? [];
    // tile milik modul pemilik didahulukan
    if (!list.includes(tile.label)) {
      if (moduleId === entry.module) list.unshift(tile.label);
      else list.push(tile.label);
    }
    TILE_LABELS.set(entry.id, list);
  }
}

export const submenuTileLabels = (id: string): string[] => TILE_LABELS.get(id) ?? [];
export const submenuLabel = (id: string): string => ENTRY_BY_ID.get(id)?.label ?? TILE_LABELS.get(id)?.[0] ?? id;

export type SubmenuPolicyRow = { role: string; module_id: string; allowed: string[] };

/** Jawaban `get_my_submenu_policy()`. null = bentuknya tidak dikenal (pemanggil harus gagal tertutup). */
export function parseSubmenuPolicyRows(value: unknown): SubmenuPolicyRow[] | null {
  if (!Array.isArray(value)) return null;
  for (const r of value) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    const x = r as Record<string, unknown>;
    if (typeof x.role !== "string" || typeof x.module_id !== "string" || !Array.isArray(x.allowed) || !x.allowed.every(i => typeof i === "string")) return null;
  }
  return value as SubmenuPolicyRow[];
}

/**
 * Tempelkan kebijakan ke baris `role_modules` yang sama (peran+modul). Seluruh pemakai `AturanTersimpan`
 * (middleware, sidebar, pintasan, pencarian) otomatis ikut. Tanpa kebijakan => daftar yang sama persis.
 */
export function gabungSubmenu<T extends { role: string; module_id: string }>(rules: T[], policy: SubmenuPolicyRow[] | null | undefined): (T & { submenus?: string[] })[] {
  if (!policy || policy.length === 0) return rules;
  return rules.map(r => {
    const hit = policy.find(p => p.role === r.role && p.module_id === r.module_id);
    return hit ? { ...r, submenus: [...hit.allowed] } : r;
  });
}

/**
 * Halaman yang tidak dimiliki awalan modul mana pun. Peran yang bawaannya SEMUA modul (ADMIN, DOCTOR) hanya memegangnya
 * selama SEMUA modul tercentang dan masing-masing masih punya sub-menu terbuka (aturan `bolehBukaPath`, jangkauan penuh).
 * Satu modul saja yang tak dicentang atau dikosongkan membuat semuanya tertutup. Tes membuktikan daftar ini sama
 * dengan perilaku `bolehBukaPath`.
 */
export const OWNERLESS_FULL_REACH_PAGES = ["/dokumen", "/keuangan", "/pajak/faktur", "/aset-tetap", "/keuangan/laba-ditahan"] as const;
