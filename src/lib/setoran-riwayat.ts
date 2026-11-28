// Riwayat Setoran (tampilan awal, HANYA LIHAT) — rumus murni per HARI untuk kas toko satu cabang. Dites di __tests__/setoran-riwayat.test.ts.
//
// Tidak mengubah apa pun: tidak menyentuh setoran_hitung, Rekap Setoran, jurnal, atau data. Angkanya dibaca dari
//  (a) shift kasir yang sudah ditutup (closing_balance − opening_balance, dikelompokkan per tanggal WIB penutupan), dan
//  (b) baris Buku Besar akun kas toko cabang itu (jurnal pengeluaran, jurnal Transfer Kas & Bank, dan sisanya).
// Kesepakatan tanda: "Selisih setor" positif = KELEBIHAN setor (yang ditransfer lebih besar daripada yang harus disetor);
// negatif = KEKURANGAN setor. Transfer KELUAR dari kas toko = kredit akun kas (positif); transfer MASUK / pembalikan = debit (mengurangi).
import { tanggalWIB } from "@/lib/tanggal";

export const SUMBER_PENGELUARAN = ["expense", "expense-reversal", "expense-correction"] as const;
export const SUMBER_TRANSFER = ["transfer", "transfer-reversal"] as const;

export type BarisKas = { tanggal: string; source: string; debit: number; credit: number };
export type ShiftTutup = { closed_at: string; opening_balance: number; closing_balance: number };

export type BarisHari = {
  tanggal: string;
  tutupShift: number;       // Σ (closing − opening) shift yang ditutup hari itu
  pengeluaran: number;      // kredit − debit jurnal pengeluaran di akun kas toko
  harusDisetor: number;     // tutupShift − pengeluaran
  sudahDitransfer: number;  // kredit − debit jurnal Transfer Kas & Bank di akun kas toko
  selisihHarian: number;    // sudahDitransfer − harusDisetor (positif = kelebihan setor)
  kumulatif: number;        // Σ selisihHarian sejak tanggal "Dari" (positif = kelebihan setor)
  saldoBukuAkhir: number;   // saldo akun kas toko di Buku Besar pada akhir hari itu
};

export type KodePenjelasan = "awal" | "penjualan" | "pembelian" | "manual" | "shift" | "penerimaan" | "lain";
export type BarisPenjelasan = { kode: KodePenjelasan; label: string; jumlah: number; keterangan: string };

export type RingkasanRiwayat = {
  totalTutupShift: number; totalPengeluaran: number; totalHarusDisetor: number; totalDitransfer: number;
  kumulatif: number;          // totalDitransfer − totalHarusDisetor (positif = kelebihan setor)
  saldoAwal: number;          // saldo Buku Besar sebelum tanggal "Dari"
  saldoAkhir: number;         // saldo Buku Besar pada tanggal "Sampai"
  kasSeharusnya: number;      // totalHarusDisetor − totalDitransfer: uang yang menurut hitungan setoran masih di toko (sejak "Dari")
  selisihBuku: number;        // saldoAkhir − kasSeharusnya
  penjelasan: BarisPenjelasan[]; // jumlahnya SELALU = selisihBuku
};

const nilai = (n: unknown): number => { const x = typeof n === "string" ? Number(n) : (n as number); return Number.isFinite(x) ? x : 0; };
/** Pembulatan ke sen supaya jumlah desimal float tidak menumpuk (nilai rupiah di basis data numeric). */
const sen = (n: number): number => Math.round(n * 100) / 100;
const masuk = (t: string, dari: string, sampai: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= dari && t <= sampai;
const adaDi = (daftar: readonly string[], s: string): boolean => daftar.includes(s);

/** Tanggal (WIB) penutupan shift; kosong bila waktunya tidak terbaca. */
export function tanggalTutupShift(closedAt: string): string { return tanggalWIB(closedAt); }

type KelompokLain = Exclude<KodePenjelasan, "awal">;
function kelompok(source: string): KelompokLain | "pengeluaran" | "transfer" {
  if (adaDi(SUMBER_PENGELUARAN, source)) return "pengeluaran";
  if (adaDi(SUMBER_TRANSFER, source)) return "transfer";
  if (source === "sale") return "penjualan";
  if (source === "purchase-pay") return "pembelian";
  if (source === "manual" || source === "manual-reversal" || source === "manual-correction") return "manual";
  if (source === "shift" || source === "shift-reversal") return "shift";
  if (source === "sale-receipt-cancel" || source === "sale-receipt-repost") return "penerimaan";
  return "lain";
}

export function hitungRiwayat(input: { dari: string; sampai: string; shifts: ShiftTutup[]; baris: BarisKas[]; saldoAwal: number }): { hari: BarisHari[]; ringkasan: RingkasanRiwayat } {
  const { dari, sampai } = input;
  const peta = new Map<string, { shift: number; peng: number; tf: number; buku: number }>();
  const ambil = (t: string) => { let x = peta.get(t); if (!x) { x = { shift: 0, peng: 0, tf: 0, buku: 0 }; peta.set(t, x); } return x; };
  const lain = { penjualan: 0, pembelian: 0, manual: 0, shift: 0, penerimaan: 0, lain: 0 };

  for (const s of input.shifts) {
    const t = tanggalTutupShift(s.closed_at);
    if (!t || !masuk(t, dari, sampai)) continue;
    ambil(t).shift += nilai(s.closing_balance) - nilai(s.opening_balance);
  }
  for (const b of input.baris) {
    if (!masuk(b.tanggal, dari, sampai)) continue;
    const d = nilai(b.debit), k = nilai(b.credit);
    const x = ambil(b.tanggal);
    x.buku += d - k;
    const g = kelompok(b.source);
    if (g === "pengeluaran") x.peng += k - d;
    else if (g === "transfer") x.tf += k - d;
    else lain[g] += d - k;
  }

  const tanggal = [...peta.keys()].sort();
  let kumulatif = 0, saldo = nilai(input.saldoAwal);
  let tShift = 0, tPeng = 0, tTf = 0;
  const hari: BarisHari[] = tanggal.map((t) => {
    const x = peta.get(t)!;
    const harus = x.shift - x.peng;
    const selisih = x.tf - harus;
    kumulatif += selisih; saldo += x.buku; tShift += x.shift; tPeng += x.peng; tTf += x.tf;
    return { tanggal: t, tutupShift: sen(x.shift), pengeluaran: sen(x.peng), harusDisetor: sen(harus), sudahDitransfer: sen(x.tf), selisihHarian: sen(selisih), kumulatif: sen(kumulatif), saldoBukuAkhir: sen(saldo) };
  });

  const totalHarus = tShift - tPeng;
  const kasSeharusnya = totalHarus - tTf;
  const saldoAkhir = saldo;
  const selisihBuku = saldoAkhir - kasSeharusnya;
  // Uraian selisih: saldo awal + (penjualan tunai di Buku Besar − kas tutup shift) + gerakan non-setoran. Jumlahnya = selisihBuku
  // karena saldoAkhir = saldoAwal + penjualan − pengeluaran − transfer + lainnya, dan kasSeharusnya = tutupShift − pengeluaran − transfer.
  const penjelasan: BarisPenjelasan[] = [
    { kode: "awal", label: "Saldo kas toko sebelum tanggal Dari", jumlah: sen(nilai(input.saldoAwal)), keterangan: "Uang yang sudah ada di Buku Besar sebelum rentang ini (termasuk saldo awal cabang)." },
    { kode: "penjualan", label: "Penjualan tunai di Buku Besar dikurangi kas tutup shift", jumlah: sen(lain.penjualan - tShift), keterangan: "Selisih antara jurnal penjualan tunai dan hitungan kas laci saat tutup shift (di luar setoran)." },
    { kode: "pembelian", label: "Pembayaran pembelian dari kas toko", jumlah: sen(lain.pembelian), keterangan: "Bukan bagian setoran, tetapi mengurangi saldo kas toko." },
    { kode: "manual", label: "Jurnal manual (mis. salah closing) dan pembaliknya", jumlah: sen(lain.manual), keterangan: "Dicatat lewat Jurnal Manual; bukan bagian setoran." },
    { kode: "shift", label: "Jurnal shift dan pembalik shift (selisih tutup shift)", jumlah: sen(lain.shift), keterangan: "Jurnal selisih kurang/lebih saat tutup shift dan pembaliknya." },
    { kode: "penerimaan", label: "Batal / terbit ulang penerimaan penjualan", jumlah: sen(lain.penerimaan), keterangan: "Koreksi pembayaran penjualan yang sudah tercatat." },
    { kode: "lain", label: "Lain-lain", jumlah: sen(lain.lain), keterangan: "Sumber jurnal lain di akun kas toko (mis. saldo awal cabang, jurnal setoran)." },
  ];

  return {
    hari,
    ringkasan: {
      totalTutupShift: sen(tShift), totalPengeluaran: sen(tPeng), totalHarusDisetor: sen(totalHarus), totalDitransfer: sen(tTf),
      kumulatif: sen(tTf - totalHarus), saldoAwal: sen(nilai(input.saldoAwal)), saldoAkhir: sen(saldoAkhir),
      kasSeharusnya: sen(kasSeharusnya), selisihBuku: sen(selisihBuku), penjelasan,
    },
  };
}

/** Kata untuk tanda selisih setor: positif = kelebihan, negatif = kekurangan. */
export function labelSelisihSetor(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v > 0 ? "Kelebihan setor" : v < 0 ? "Kekurangan setor" : "Pas";
}

export type CabangRiwayat = { id: string; name: string; type: string };
/** Cabang pilihan: hanya toko (PETSHOP) yang boleh dibuka pengguna. Bawaan: cabang aktif sesi bila ada di daftar, kalau tidak yang pertama. */
export function pilihCabangRiwayat(semua: CabangRiwayat[], diminta: string | null | undefined, cabangAktif: string | null | undefined): { daftar: CabangRiwayat[]; terpilih: CabangRiwayat | null } {
  const daftar = semua.filter((c) => c.type === "PETSHOP");
  const cari = (id: string | null | undefined) => (id ? daftar.find((c) => c.id === id) ?? null : null);
  return { daftar, terpilih: cari(diminta) ?? cari(cabangAktif) ?? daftar[0] ?? null };
}

/** Saringan dari alamat; nilai tidak sah dibuang ke bawaan (1 November tahun berjalan s/d hari ini). Rentang dibatasi 366 hari. */
export function bacaSaringanRiwayat(sp: Record<string, string | undefined>, hariIni: string): { dari: string; sampai: string; cabang: string | null; dipotong: boolean } {
  const TGL = /^\d{4}-\d{2}-\d{2}$/;
  const sah = (v: string | undefined) => !!v && TGL.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  let dari = sah(sp.dari) ? sp.dari! : `${hariIni.slice(0, 4)}-11-01`;
  let sampai = sah(sp.sampai) ? sp.sampai! : hariIni;
  if (sampai > hariIni) sampai = hariIni;
  if (dari > sampai) dari = sampai;
  let dipotong = false;
  const batas = new Date(`${sampai}T00:00:00Z`); batas.setUTCDate(batas.getUTCDate() - 365);
  const batasStr = batas.toISOString().slice(0, 10);
  if (dari < batasStr) { dari = batasStr; dipotong = true; }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return { dari, sampai, cabang: sp.cabang && UUID.test(sp.cabang) ? sp.cabang : null, dipotong };
}
