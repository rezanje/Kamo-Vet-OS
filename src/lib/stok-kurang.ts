/**
 * Satu bentuk data "stok tidak cukup" untuk SELURUH proses yang mengeluarkan stok.
 *
 * Sebelum modul ini, tiap layar punya kalimatnya sendiri: pemindahan memakai spanduk
 * merah di bawah formulir, klinik memakai dialog berisi satu baris teks, kasir memakai
 * kotak oranye, dan penolakan database cuma dilempar apa adanya ke bilah merah halaman.
 * Akibatnya petugas harus menebak barang mana yang kurang dan berapa kurangnya.
 *
 * Sekarang semuanya bermuara ke satu bentuk baris (`BarisKurangStok`) yang dipakai
 * popup `StokKurangPopup`. Ada dua jalan masuk ke bentuk itu:
 *
 *   1. PEMERIKSAAN DI LAYAR / DI SERVER — hitungannya sendiri menghasilkan baris
 *      (lihat `kekuranganStok`, `kurangStokPemindahan`, `kurangStokPermintaan`).
 *   2. PENOLAKAN DATABASE — yang sampai ke layar cuma kalimat. `uraiKekuranganStok`
 *      mengurai kalimat itu kembali menjadi baris.
 *
 * Supaya jalan (2) tidak pernah salah baca jalan (1), kalimat yang dikirim server
 * action dibentuk oleh `formatKekuranganStok`, dan angkanya memakai format yang sama
 * persis dengan fungsi `stock_qty_text` di database (tanpa pemisah ribuan, titik
 * sebagai koma desimal, maksimal 6 angka di belakang koma). Pelokalan angka ke gaya
 * Indonesia dikerjakan belakangan saat ditampilkan, bukan di dalam kalimatnya.
 */

export type BarisKurangStok = {
  /** Penanda baris di layar; dipakai popup untuk memindahkan fokus ke isian yang salah. */
  kunci?: string | null;
  item_id?: string | null;
  nama: string;
  /** Nama gudang bila diketahui. Penolakan database sering hanya menyebut perannya. */
  gudang?: string | null;
  /** Dalam satuan `satuan`. null = jumlahnya tidak disebut oleh penolaknya. */
  butuh: number | null;
  tersedia: number | null;
  satuan?: string | null;
};

export type KekuranganStok = {
  baris: BarisKurangStok[];
  /** Saran tindakan khas prosesnya, mis. "kirim sebagian" untuk permintaan barang. */
  petunjuk: string | null;
};

const bilangan = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Angka apa adanya untuk dimasukkan ke dalam kalimat — kembaran `stock_qty_text`
 * di database. Tanpa pemisah ribuan supaya tidak pernah rancu dengan koma desimal
 * saat kalimatnya diurai kembali.
 */
export function angkaStok(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const tetap = Math.abs(v) >= 1e15 ? String(Math.round(v)) : v.toFixed(6);
  return tetap.includes(".") ? tetap.replace(/0+$/, "").replace(/\.$/, "") : tetap;
}

/** Angka untuk DILIHAT orang (gaya Indonesia). Tidak pernah masuk ke kalimat yang diurai. */
export function angkaTampil(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(Number(v).toFixed(6)).toLocaleString("id-ID", { maximumFractionDigits: 6 });
}

/** Berapa yang kurang; null bila salah satu angkanya tidak diketahui. */
export function kekurangan(baris: BarisKurangStok): number | null {
  if (baris.butuh == null || baris.tersedia == null) return null;
  return Math.max(0, baris.butuh - baris.tersedia);
}

/**
 * Daftar barang kurang menjadi satu kalimat: "Nama butuh 500 pcs, tersedia 250 pcs".
 * Inilah bentuk yang dikirim lewat `?error=` dan yang dibaca `uraiKekuranganStok`.
 */
export function formatKekuranganStok(baris: BarisKurangStok[]): string {
  return baris
    .map((b) => {
      const satuan = (b.satuan ?? "").trim();
      const akhiran = satuan ? ` ${satuan}` : "";
      const butuh = b.butuh == null ? "?" : angkaStok(b.butuh);
      const tersedia = b.tersedia == null ? "?" : angkaStok(b.tersedia);
      return `${b.nama} butuh ${butuh}${akhiran}, tersedia ${tersedia}${akhiran}`;
    })
    .join("; ");
}

// ── Pengurai pesan ──────────────────────────────────────────────────────────────

/** Saran tindakan, dikenali dari ekor kalimat yang sudah dipakai tiap proses. */
const PETUNJUK: { pola: RegExp; teks: string }[] = [
  {
    pola: /\.?\s*Turunkan jumlah yang disetujui\.?$/i,
    teks: "Setujui sebanyak stok yang ada saja. Sisanya diminta lagi setelah stok masuk.",
  },
  {
    pola: /\.?\s*Kurangi jumlah kirim atau tunggu stok masuk\.?$/i,
    teks: "Boleh kirim sebagian: isi jumlah kirim sebanyak stok yang ada, sisanya menyusul setelah stok masuk.",
  },
  {
    pola: /\.?\s*Kurangi kuantitasnya\.?$/i,
    teks: "Kurangi jumlahnya, atau pilih gudang asal lain yang stoknya cukup.",
  },
  {
    pola: /\.?\s*Kurangi jumlah atau ganti obat sebelum melanjutkan\.?$/i,
    teks: "Kurangi jumlahnya atau ganti dengan obat lain yang stoknya ada.",
  },
  {
    pola: /\.?\s*Barang sudah terpakai\/terjual; rekonsiliasi dependensi dahulu\.?$/i,
    teks: "Barangnya sudah terpakai atau terjual. Periksa dokumen yang memakainya sebelum mengoreksi.",
  },
];

// Menerima "500", "1234.5" (gaya database) dan "1.234,5" (gaya Indonesia).
// Koma hanya diakui bila diikuti angka, supaya koma pemisah kalimat tidak ikut terbaca.
const ANGKA = "[0-9][0-9.]*(?:,[0-9]+)?";
// "Nama butuh 500 pcs, tersedia 250 pcs" dan varian klinik "Nama: butuh 6 pcs, stok 5 pcs".
const BARIS_BUTUH = new RegExp(`^(.+?)\\s*:?\\s+butuh\\s+(${ANGKA})(?:\\s+(.+?))?,\\s*(?:tersedia|stok)\\s+(${ANGKA})(?:\\s+(.+?))?\\.?$`, "i");
// Varian `stock_transfer_fifo_exact`: "Nama perlu 500, tersedia 250" (selalu satuan dasar).
const BARIS_PERLU = new RegExp(`^(.+?)\\s+perlu\\s+(${ANGKA})(?:\\s+(.+?))?,\\s*tersedia\\s+(${ANGKA})(?:\\s+(.+?))?\\.?$`, "i");

/**
 * Angka di dalam pesan. Semua penghasil pesan kita menulis format polos
 * ("1234.5"), tetapi pesan lama bisa saja bergaya Indonesia ("1.234,5") —
 * keduanya diterima. Hanya titik tunggal yang rancu, dan itu dibaca sebagai
 * koma desimal karena begitulah database dan `angkaStok` menulisnya.
 */
function bacaAngka(teks: string | undefined): number | null {
  const t = (teks ?? "").trim();
  if (!/^[0-9][0-9.,]*$/.test(t)) return null;
  if (t.includes(",")) return bilangan(t.replace(/\./g, "").replace(",", "."));
  if ((t.match(/\./g) ?? []).length > 1) return bilangan(t.replace(/\./g, ""));
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

function bersih(teks: string | undefined): string | null {
  const t = (teks ?? "").trim().replace(/[.,;]+$/, "").trim();
  return t || null;
}

function uraiSatuBaris(segmen: string): BarisKurangStok | null {
  for (const pola of [BARIS_BUTUH, BARIS_PERLU]) {
    const m = pola.exec(segmen.trim());
    if (!m) continue;
    const butuh = bacaAngka(m[2]);
    const tersedia = bacaAngka(m[4]);
    if (butuh == null || tersedia == null) continue;
    const nama = bersih(m[1]);
    if (!nama) continue;
    return { nama, butuh, tersedia, satuan: bersih(m[3]) ?? bersih(m[5]) ?? null };
  }
  return null;
}

/** Daftar barang dipisah titik koma; segmen yang tidak dikenali diabaikan. */
function uraiDaftar(sisa: string): BarisKurangStok[] {
  return sisa.split(";").map(uraiSatuBaris).filter((b): b is BarisKurangStok => b !== null);
}

type Selubung = {
  pola: RegExp;
  gudang?: string;
  /** Membentuk baris saat pesannya tidak memuat daftar barang. */
  baris?: (m: RegExpExecArray) => BarisKurangStok[];
  /** Sisa kalimat yang masih harus diurai sebagai daftar barang. */
  daftar?: (m: RegExpExecArray) => string;
};

const TANPA_RINCIAN = (nama: string): BarisKurangStok[] => [{ nama, butuh: null, tersedia: null }];

/**
 * Semua bentuk penolakan "stok tidak cukup" yang benar-benar dipakai hari ini —
 * dari server action maupun dari pengecualian RPC di database. Urutannya penting:
 * yang paling spesifik lebih dulu.
 *
 * Pesan soal LAPISAN biaya ("Lapisan stok ... tidak cukup", "Lapisan FIFO ...")
 * sengaja TIDAK ada di sini: stoknya ada, yang kurang catatan harga pokoknya,
 * jadi "Ubah jumlah" bukan jalan keluarnya.
 */
const SELUBUNG: Selubung[] = [
  // Permintaan barang — persetujuan dan pengiriman (server action dan RPC database).
  { pola: /^Stok gudang pengirim tidak cukup[.:]\s*(.+)$/i, gudang: "Gudang pengirim", daftar: (m) => m[1] },
  // Pemindahan barang — pemeriksaan di layar dan `stock_transfer_fifo_exact`.
  { pola: /^Stok gudang asal tidak cukup[.:]\s*(.+)$/i, gudang: "Gudang asal", daftar: (m) => m[1] },
  { pola: /^Stok gudang asal tidak cukup\.?$/i, gudang: "Gudang asal", baris: () => TANPA_RINCIAN("Barang yang dipindahkan") },
  // Pengiriman penjualan grosir — `sales_post_order` menyebut barang dan jumlah perlunya.
  {
    pola: new RegExp(`^Stok (.+?) tidak cukup untuk (${ANGKA}) satuan dasar\\.?$`, "i"),
    baris: (m) => [{ nama: bersih(m[1]) ?? "Barang", butuh: bacaAngka(m[2]), tersedia: null, satuan: "satuan dasar" }],
  },
  // Produksi merek sendiri — bahannya kurang; database tidak menyebut bahan yang mana.
  { pola: /^Stok bahan tidak cukup(?: atau jumlah tidak valid)?\.?$/i, baris: () => TANPA_RINCIAN("Bahan produksi") },
  // Koreksi faktur pembelian yang menurunkan qty penerimaan.
  { pola: /^Stok gudang tidak cukup untuk mengurangi qty faktur\.?$/i, baris: () => TANPA_RINCIAN("Barang faktur") },
  // Koreksi stok / opname.
  { pola: /^Stok tidak cukup untuk koreksi\b.*$/i, baris: () => TANPA_RINCIAN("Barang yang dikoreksi") },
  // Penyesuaian persediaan & pengeluaran stok lain lewat `issue_stock_document_recorded`.
  { pola: /^Stok tidak cukup\.\s*Seluruh pengeluaran ini dibatalkan\.?$/i, baris: () => TANPA_RINCIAN("Barang yang dikeluarkan") },
  // Klinik: `STOCK_SHORT: <nama>` sudah diterjemahkan jadi "Stok tidak cukup: <nama>".
  { pola: /^Stok tidak cukup:\s*(.+)$/i, baris: (m) => TANPA_RINCIAN(bersih(m[1]) ?? "Barang") },
  // Kasir/POS, penjualan daring, retur pembelian — penolakan polos tanpa rincian.
  { pola: /^Stok tidak cukup\.?$/i, baris: () => TANPA_RINCIAN("Barang yang dijual") },
];

/**
 * Mengurai pesan penolakan menjadi baris kekurangan stok.
 * Mengembalikan null bila pesannya bukan soal kekurangan stok — pemanggil lalu
 * membiarkan pesan itu tampil apa adanya di bilah merah halaman.
 */
export function uraiKekuranganStok(pesan: string | null | undefined): KekuranganStok | null {
  const awal = String(pesan ?? "").replace(/\s+/g, " ").trim();
  if (!awal) return null;

  let teks = awal;
  let petunjuk: string | null = null;
  for (const p of PETUNJUK) {
    if (p.pola.test(teks)) {
      petunjuk = p.teks;
      teks = teks.replace(p.pola, "").trim();
      break;
    }
  }

  for (const s of SELUBUNG) {
    const m = s.pola.exec(teks);
    if (!m) continue;
    const dariDaftar = s.daftar ? uraiDaftar(s.daftar(m)) : [];
    const baris = dariDaftar.length
      ? dariDaftar
      : s.baris
        ? s.baris(m)
        : TANPA_RINCIAN(bersih(s.daftar?.(m)) ?? "Barang");
    return { baris: baris.map((b) => ({ gudang: s.gudang ?? null, ...b })), petunjuk };
  }

  // Tanpa selubung: daftar polos dari pemeriksaan di layar klinik
  // ("Obat A: butuh 6 pcs, stok 5 pcs; Obat B: butuh 2 ml, stok 0 ml").
  const daftar = uraiDaftar(teks);
  return daftar.length ? { baris: daftar, petunjuk } : null;
}

/**
 * Apakah pesan ini akan ditampilkan oleh popup stok? Dipakai layar yang sudah
 * punya dialog umum (`Popup`) supaya dua dialog tidak terbuka bersamaan.
 */
export function adalahKekuranganStok(pesan: string | null | undefined): boolean {
  return uraiKekuranganStok(pesan) !== null;
}
