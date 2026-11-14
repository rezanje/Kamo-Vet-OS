// Dashboard stok: "Item slow moving / stok berlebih" dan "Item harus order".
// Perhitungannya dipisah dari halaman supaya bisa dites. HANYA BACA: tidak mengubah uang atau stok.
//
// Dasar (permintaan Pak Andri, 13 Nov 2026): nilai dari RATA-RATA SEMUA GUDANG DIGABUNG, berdasarkan riwayat
// penjualan. Contoh Pak Andri: penjualan sebulan Rp2 jt, nilai stok Rp10 jt => cukup untuk 5 bulan => BERLEBIH.
//
// Semua angka batas ada di KONFIG_STOK di bawah (satu tempat, mudah diubah). Sumber pemakaian = stock_moves
// dalam satuan DASAR (fungsi SQL `laporan_stok_analisis`), jadi konversi satuan sudah beres di sumbernya.
import { hitungUsulan, kelompokPemasok, type BarangReorder, type Usulan } from "./reorder";

export const KONFIG_STOK = {
  /** Jendela rata-rata: 90 hari terakhir, atau sejak ada penjualan bila riwayat lebih pendek. */
  jendelaHari: 90,
  /** Pembagi minimum (hari) bila riwayat lebih pendek dari ini. */
  jendelaMinHari: 14,
  hariPerBulan: 30,
  /** Tidak laku = tidak ada barang keluar selama sekian hari. */
  tidakLakuHari: 60,
  /** Mati = tidak laku selama sekian hari. */
  matiHari: 120,
  /** Berlebih = stok cukup untuk lebih dari sekian bulan penjualan. */
  berlebihBulan: 3,
  /** Riwayat di bawah ini (hari) dianggap BARU: angka bersifat sementara. */
  riwayatCukupHari: 60,
  /** Harus order bila stok cukup kurang dari sekian hari (lead time pemasok). */
  leadTimeHari: 14,
  /** Saran order mengisi stok sampai cukup sekian hari penjualan. */
  targetCoverHari: 30,
} as const;
export const HALAMAN_SLOW = "/laporan/stok-slow-moving";
export const HALAMAN_ORDER = "/laporan/stok-harus-order";
/** Peran yang melihat kartu di dashboard (halamannya tetap ikut Akses Grup). */
export const PERAN_STOK = ["OWNER", "ADMIN", "FINANCE"] as const;
export type KonfigStok = { [K in keyof typeof KONFIG_STOK]: number };

/** Satu baris per barang dari fungsi SQL (angka bisa datang sebagai teks/angka). */
export type BarisStokMentah = {
  id: string; kode: string; nama: string; satuan: string;
  kategori_id: string | null; aktif: boolean;
  min_stock: number | string; supplier_id: string | null;
  buy_unit: string | null; min_buy: number | string; buy_price: number | string;
  stok: number | string; nilai: number | string; stok_sejak: string | null;
  keluar: number | string; modal_keluar: number | string; terakhir: string | null;
  /** Biaya per satuan dasar pada masuk barang terakhir (0 = belum ada). */
  biaya_terakhir?: number | string;
};
export type MetaStok = { hari_ini: string; jendela_hari: number; riwayat_mulai: string | null; riwayat_hari: number };
export type HasilStokMentah = MetaStok & { gudang_id: string | null; baris: BarisStokMentah[] };

export type StatusStok = "mati" | "tidak_laku" | "belum_laku" | "berlebih" | "aman";
export type AlasanOrder = "min" | "cepat_habis";

export const LABEL_STATUS: Record<StatusStok, string> = {
  mati: "Mati", tidak_laku: "Tidak laku", belum_laku: "Belum laku", berlebih: "Berlebih", aman: "Aman",
};
export const LABEL_ALASAN: Record<AlasanOrder, string> = { min: "Di bawah minimum", cepat_habis: "Segera habis" };

export type KonteksStok = {
  hariIni: string;
  /** Lama riwayat penjualan yang ada (hari). 0 = belum ada penjualan sama sekali. */
  riwayatHari: number;
  /** Pembagi rata-rata (hari): riwayat dibatasi ke [jendelaMinHari, jendelaHari]. */
  hariDipakai: number;
  /** Riwayat < riwayatCukupHari: semua angka sementara. */
  riwayatBaru: boolean;
};

export type BarisAnalisis = {
  id: string; kode: string; nama: string; satuan: string;
  kategoriId: string | null; aktif: boolean;
  minStock: number; supplierId: string | null; buyUnit: string | null; minBuy: number; hargaBeliDasar: number; biayaTerakhir: number;
  stok: number; nilaiStok: number;
  /** Rata-rata terjual per bulan (satuan dasar) dan per hari. */
  terjualBulan: number; terjualHari: number;
  /** Modal (HPP) barang yang terjual per bulan. */
  modalBulan: number;
  /** Stok cukup untuk berapa bulan/hari; null = tidak ada penjualan (tak terhingga). */
  coverBulan: number | null; coverHari: number | null;
  terakhirLaku: string | null; hariTanpaJual: number | null;
  status: StatusStok;
  /** Modal tertahan: seluruh nilai stok bila tidak laku/mati, atau hanya bagian di atas batas berlebih. */
  modalTertahan: number;
  /** Status bergantung pada riwayat yang masih baru. */
  sementara: boolean;
  alasanOrder: AlasanOrder[];
};

const angka = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function selisihHari(dari: string, sampai: string): number {
  const a = Date.parse(`${dari.slice(0, 10)}T00:00:00Z`), b = Date.parse(`${sampai.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function bangunKonteks(meta: Pick<MetaStok, "hari_ini" | "riwayat_hari">, konfig: KonfigStok = KONFIG_STOK): KonteksStok {
  const riwayatHari = Math.max(0, Math.floor(angka(meta.riwayat_hari)));
  const hariDipakai = Math.min(konfig.jendelaHari, Math.max(konfig.jendelaMinHari, riwayatHari));
  return { hariIni: meta.hari_ini, riwayatHari, hariDipakai, riwayatBaru: riwayatHari < konfig.riwayatCukupHari };
}

/** "riwayat baru 13 hari" selama < 60 hari; selebihnya "riwayat 75 hari". */
export function labelRiwayat(ctx: KonteksStok, konfig: KonfigStok = KONFIG_STOK): string {
  const hari = Math.min(ctx.riwayatHari, konfig.jendelaHari);
  return ctx.riwayatBaru ? `riwayat baru ${hari} hari` : `riwayat ${hari} hari`;
}

/** Analisis satu barang. Murni; tidak membaca apa pun selain argumen. */
export function analisisBarang(b: BarisStokMentah, ctx: KonteksStok, konfig: KonfigStok = KONFIG_STOK): BarisAnalisis {
  const stok = angka(b.stok);
  const nilaiStok = Math.max(0, angka(b.nilai));
  // Struk batal/retur sudah mengurangi `keluar` (pembalik ikut dijumlah); tidak boleh jadi negatif.
  const keluar = Math.max(0, angka(b.keluar));
  const modalKeluar = Math.max(0, angka(b.modal_keluar));
  const terjualHari = keluar / ctx.hariDipakai;
  const terjualBulan = terjualHari * konfig.hariPerBulan;
  const modalBulan = (modalKeluar / ctx.hariDipakai) * konfig.hariPerBulan;
  const coverHari = terjualHari > 0 ? Math.max(0, stok) / terjualHari : null;
  const coverBulan = coverHari === null ? null : coverHari / konfig.hariPerBulan;
  const terakhirLaku = b.terakhir ? String(b.terakhir).slice(0, 10) : null;
  const hariTanpaJual = terakhirLaku ? Math.max(0, selisihHari(terakhirLaku, ctx.hariIni)) : null;

  let status: StatusStok = "aman";
  let sementara = false;
  let modalTertahan = 0;
  if (stok > 0 && nilaiStok > 0) {
    // Belum pernah keluar dalam riwayat: yang diketahui hanya "paling tidak selama riwayat ini".
    const umurStok = b.stok_sejak ? Math.max(0, selisihHari(String(b.stok_sejak).slice(0, 10), ctx.hariIni)) : ctx.riwayatHari;
    const tanpaJual = hariTanpaJual ?? Math.min(ctx.riwayatHari, umurStok);
    if (tanpaJual >= konfig.matiHari) { status = "mati"; modalTertahan = nilaiStok; }
    else if (tanpaJual >= konfig.tidakLakuHari) { status = "tidak_laku"; modalTertahan = nilaiStok; }
    else if (terakhirLaku === null && ctx.riwayatHari < konfig.tidakLakuHari) {
      // Riwayat terlalu pendek untuk menyebut "tidak laku": tandai sementara, jangan dianggap pasti.
      status = "belum_laku"; sementara = true; modalTertahan = nilaiStok;
    } else if (coverBulan !== null && coverBulan > konfig.berlebihBulan) {
      status = "berlebih";
      sementara = ctx.riwayatBaru;
      // Bagian di atas kebutuhan `berlebihBulan` bulan.
      modalTertahan = nilaiStok * (1 - konfig.berlebihBulan / coverBulan);
    }
  }

  const minStock = Math.max(0, angka(b.min_stock));
  const alasanOrder: AlasanOrder[] = [];
  if (b.aktif && minStock > 0 && stok <= minStock) alasanOrder.push("min");
  if (b.aktif && coverHari !== null && coverHari < konfig.leadTimeHari) alasanOrder.push("cepat_habis");

  return {
    id: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan, kategoriId: b.kategori_id, aktif: b.aktif,
    minStock, supplierId: b.supplier_id, buyUnit: b.buy_unit, minBuy: angka(b.min_buy), hargaBeliDasar: angka(b.buy_price), biayaTerakhir: angka(b.biaya_terakhir),
    stok, nilaiStok, terjualBulan, terjualHari, modalBulan, coverBulan, coverHari,
    terakhirLaku, hariTanpaJual, status, modalTertahan, sementara, alasanOrder,
  };
}

export function analisisSemua(hasil: Pick<HasilStokMentah, "baris" | "hari_ini" | "riwayat_hari">, konfig: KonfigStok = KONFIG_STOK) {
  const ctx = bangunKonteks(hasil, konfig);
  return { ctx, baris: hasil.baris.map((b) => analisisBarang(b, ctx, konfig)) };
}

export type Saringan = { q?: string; kategori?: string; kategoriDari?: (b: BarisAnalisis) => string };

/** Cari (kode/nama) + kategori induk. */
export function saring(baris: BarisAnalisis[], s: Saringan): BarisAnalisis[] {
  const q = (s.q ?? "").trim().toLocaleLowerCase("id-ID");
  const kat = (s.kategori ?? "").trim().toLocaleUpperCase("id-ID");
  return baris.filter((b) =>
    (!q || b.kode.toLocaleLowerCase("id-ID").includes(q) || b.nama.toLocaleLowerCase("id-ID").includes(q)) &&
    (!kat || (s.kategoriDari ? s.kategoriDari(b) : "").toLocaleUpperCase("id-ID") === kat));
}

// ───────────── Slow moving / stok berlebih ─────────────

export type RingkasSlow = {
  jumlah: number; modalTertahan: number; nilaiStok: number;
  perStatus: Record<Exclude<StatusStok, "aman">, { jumlah: number; modalTertahan: number }>;
};

/** Barang yang masuk daftar: stok > 0 dan bukan "aman". Urut Modal tertahan terbesar. */
export function daftarSlow(baris: BarisAnalisis[]): BarisAnalisis[] {
  return baris.filter((b) => b.status !== "aman")
    .sort((a, b) => b.modalTertahan - a.modalTertahan || b.nilaiStok - a.nilaiStok || a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));
}

export function ringkasSlow(slow: BarisAnalisis[]): RingkasSlow {
  const kosong = () => ({ jumlah: 0, modalTertahan: 0 });
  const r: RingkasSlow = { jumlah: 0, modalTertahan: 0, nilaiStok: 0, perStatus: { mati: kosong(), tidak_laku: kosong(), belum_laku: kosong(), berlebih: kosong() } };
  for (const b of slow) {
    if (b.status === "aman") continue;
    r.jumlah += 1; r.modalTertahan += b.modalTertahan; r.nilaiStok += b.nilaiStok;
    r.perStatus[b.status].jumlah += 1; r.perStatus[b.status].modalTertahan += b.modalTertahan;
  }
  return r;
}

export type Portofolio = {
  nilaiStok: number; modalBulan: number;
  /** Nilai stok / modal terjual per bulan. null = belum ada penjualan. */
  coverBulan: number | null; berlebih: boolean;
};

/** Contoh Pak Andri: modal terjual Rp2 jt/bulan, nilai stok Rp10 jt => 5 bulan => berlebih. */
export function hitungPortofolio(baris: BarisAnalisis[], konfig: KonfigStok = KONFIG_STOK): Portofolio {
  const nilaiStok = baris.reduce((a, b) => a + (b.stok > 0 ? b.nilaiStok : 0), 0);
  const modalBulan = baris.reduce((a, b) => a + b.modalBulan, 0);
  const coverBulan = modalBulan > 0 ? nilaiStok / modalBulan : null;
  return { nilaiStok, modalBulan, coverBulan, berlebih: coverBulan !== null && coverBulan > konfig.berlebihBulan };
}

// ───────────── Harus order ─────────────

/** Satuan beli per barang (dari item_units). Tanpa isi = satuan dasar, faktor 1. */
export type SatuanBeli = { unit: string; faktor: number; hargaBeli: number } | null;
export type PemasokInfo = { nama: string };

export type BarisOrder = Usulan & {
  alasan: AlasanOrder[];
  coverHari: number | null; terjualBulan: number;
  /** Stok sasaran (satuan dasar) yang dipakai menghitung saran. */
  targetStok: number;
  sementara: boolean;
};

/**
 * Item aktif Persediaan yang harus dipesan: di bawah/menyentuh minimum (aturan lama) ATAU stok cukup kurang dari
 * lead time. Barang tanpa penjualan DAN tanpa minimum tidak pernah ikut. Saran = isi sampai `targetCoverHari`
 * hari penjualan (atau minimum, mana yang lebih besar), dibulatkan ke atas ke satuan beli lewat `hitungUsulan`.
 */
export function daftarHarusOrder(
  baris: BarisAnalisis[], satuanBeli: ReadonlyMap<string, SatuanBeli>, pemasok: ReadonlyMap<string, PemasokInfo>,
  ctx: KonteksStok, konfig: KonfigStok = KONFIG_STOK,
): BarisOrder[] {
  const hasil: BarisOrder[] = [];
  for (const b of baris) {
    if (!b.aktif || b.alasanOrder.length === 0) continue;
    if (b.minStock <= 0 && b.terjualHari <= 0) continue;
    const beli = satuanBeli.get(b.id) ?? null;
    const faktorBeli = beli && beli.faktor > 0 ? beli.faktor : 1;
    // Harga beli di master sering 0: pakai biaya masuk terakhir x isi satuan beli sebagai perkiraan.
    const hargaBeli = (beli ? beli.hargaBeli : b.hargaBeliDasar) || b.biayaTerakhir * faktorBeli;
    const input: BarangReorder = {
      itemId: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan,
      stok: b.stok,
      minStock: Math.max(b.minStock, Math.ceil(b.terjualHari * konfig.targetCoverHari)),
      minBuy: b.minBuy,
      buyUnit: beli?.unit ?? b.satuan,
      faktorBeli, hargaBeli,
      supplierId: b.supplierId,
      supplierNama: (b.supplierId ? pemasok.get(b.supplierId)?.nama : null) ?? "Belum ada pemasok",
    };
    let u = hitungUsulan(input);
    // Menyentuh minimum persis: kekurangan 0, tetapi barang tetap harus dipesan setidaknya satu satuan beli.
    if (u.qtyPesan <= 0) u = { ...u, qtyPesan: 1, nilai: Number(input.hargaBeli) || 0 };
    hasil.push({
      ...u, alasan: b.alasanOrder, coverHari: b.coverHari, terjualBulan: b.terjualBulan, targetStok: input.minStock,
      sementara: !b.alasanOrder.includes("min") && ctx.riwayatBaru,
    });
  }
  return hasil;
}

/** Per pemasok (satu PO per pemasok); di dalam grup yang paling mendesak (stok cukup paling sedikit) di atas. */
export function kelompokOrder(rows: BarisOrder[]) {
  const urut = [...rows].sort((a, b) => (a.coverHari ?? Infinity) - (b.coverHari ?? Infinity) || a.nama.localeCompare(b.nama, "id") || a.itemId.localeCompare(b.itemId));
  return kelompokPemasok(urut) as { supplierId: string | null; supplierNama: string; rows: BarisOrder[]; nilai: number }[];
}

// ───────────── Tampilan ─────────────

export const rupiah = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
export function rupiahRingkas(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + " M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",") + " jt";
  return rupiah(n);
}
/** "5,0 bulan"; null (tanpa penjualan) = "—"; di atas 24 bulan = "> 24". */
export function tampilBulan(n: number | null): string {
  if (n === null) return "—";
  if (n > 24) return "> 24";
  return n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function tampilQty(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

/** "2026-11-13" -> "13/11/2026"; kosong = "belum ada". */
export const tanggalId = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "belum ada");
