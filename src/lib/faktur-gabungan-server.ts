// Penarikan data daftar Faktur Penjualan gabungan.
//
// ── Cara halamannya tetap ringan walau struknya ribuan ──────────────────────
// Rentang tanggal adalah JENDELA-nya (bawaan: bulan berjalan). Untuk jendela
// itu tiap sumber ditarik sekali dengan kolom kunci saja — nomor, tanggal,
// total, status, cabang, pelanggan — tanpa satu pun relasi. Ketiga hasilnya
// digabung sekali jalan (sudah urut dari database), lalu:
//   • jumlah dokumen dan total kaki daftar dihitung dari gabungan itu — persis
//     seluruh hasil saringan, bukan cuma halaman yang tampil;
//   • halaman yang diminta dipotong dari gabungan itu;
//   • nama pelanggan, nama cabang, dan keterangan baru diambil UNTUK 50 BARIS
//     yang tampil saja.
// Jadi beban per halaman tetap: satu tarikan kolom-kunci per sumber + satu
// tarikan rincian per sumber. Jendela dibatasi `BATAS_JENDELA` dokumen; kalau
// terlampaui, pengguna diminta mempersempit tanggal, bukan disuguhi daftar
// yang diam-diam terpotong.
//
// Kalau suatu hari jendela sebulan benar-benar melewati puluhan ribu dokumen,
// langkah berikutnya adalah satu VIEW `union all` di database supaya urut,
// hitung, dan potong halaman dikerjakan Postgres. Itu butuh migrasi, jadi
// sengaja belum dilakukan selama cara ini masih cukup.

import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedBranchIds, type AllowedBranches } from "./branch-access";
import { branchDisplayName } from "./branch-display";
import { ListLoadError, readCompleteList, TABLE_PAGE_SIZE } from "./checked-list";
import { amankanKueri } from "./cari-global";
import { batasTanggalWIB } from "./laporan-transaksi";
import { infoHalaman } from "./pagination";
import { sisaTagihan } from "./penjualan-dokumen";
import { loadSalesInvoicePayments } from "./sales-invoice-payments-server";
import { hariIniWIB, tanggalWIB } from "./tanggal";
import {
  gabungFaktur, ringkasFaktur, saringFaktur, SUMBER_FAKTUR, STATUS_FAKTUR,
  type BarisFaktur, type KunciFaktur, type RingkasanFaktur, type StatusFaktur, type SumberFaktur,
} from "./faktur-gabungan";

/** Dokumen per rentang tanggal yang masih sanggup diurutkan di aplikasi. */
export const BATAS_JENDELA = 20_000;
/** Unduhan menarik rincian SEMUA baris, jadi batasnya lebih ketat dari layar. */
export const BATAS_EKSPOR = 5_000;
/** Nama pelanggan yang dicocokkan satu pencarian. */
const BATAS_PELANGGAN = 2_000;
/** Banyak id per tarikan rincian — jaga panjang URL tetap aman di proxy. */
const UKURAN_BATCH = 100;

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export type ParamFaktur = {
  dari?: string; sampai?: string; cabang?: string; sumber?: string;
  status?: string; pelanggan?: string; cari?: string; batal?: string; hal?: string;
};

export type FilterFaktur = {
  dari: string;
  sampai: string;
  cabang: string;
  sumber: SumberFaktur | "";
  status: StatusFaktur | "";
  pelanggan: string;
  cari: string;
  /** Tampilkan juga dokumen yang dibatalkan — bawaannya disembunyikan. */
  batal: boolean;
};

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const tanggalAtau = (nilai: string | undefined, bawaan: string) =>
  nilai && TANGGAL.test(nilai) ? nilai : bawaan;

/** Bawaan = bulan berjalan sampai hari ini, sama seperti rekap Penjualan dan laporan omzet. */
export function bacaFilterFaktur(sp: ParamFaktur, hariIni = hariIniWIB()): FilterFaktur {
  const dari = tanggalAtau(sp.dari, `${hariIni.slice(0, 7)}-01`);
  const sampai = tanggalAtau(sp.sampai, hariIni);
  const sumber = SUMBER_FAKTUR.find((s) => s === sp.sumber) ?? "";
  const status = STATUS_FAKTUR.find((s) => s === sp.status) ?? "";
  return {
    dari: dari <= sampai ? dari : sampai,
    sampai: dari <= sampai ? sampai : dari,
    cabang: (sp.cabang ?? "").slice(0, 80),
    sumber,
    status,
    pelanggan: amankanKueri(sp.pelanggan ?? ""),
    cari: amankanKueri(sp.cari ?? ""),
    // Status "Dibatalkan" hanya masuk akal kalau dokumen batal ikut ditampilkan.
    batal: sp.batal === "1" || status === "batal",
  };
}

/** Parameter URL yang mewakili filter — dipakai tautan halaman dan tombol unduh. */
export function paramFilter(f: FilterFaktur): Record<string, string> {
  return {
    dari: f.dari, sampai: f.sampai, cabang: f.cabang, sumber: f.sumber,
    status: f.status, pelanggan: f.pelanggan, cari: f.cari, batal: f.batal ? "1" : "",
  };
}

/**
 * Cabang yang boleh dibaca pengguna ini, setelah pilihan filternya dipakai.
 * null = semua cabang. Array kosong = tidak ada yang boleh dibaca.
 */
export function cabangEfektif(izin: AllowedBranches, pilihan: string): string[] | null {
  if (!pilihan) return izin;
  if (izin !== null && !izin.includes(pilihan)) return [];
  return [pilihan];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

async function idPelangganCocok(db: AnyClient, kueri: string): Promise<{ ids: Set<string>; terpotong: boolean }> {
  if (!kueri) return { ids: new Set(), terpotong: false };
  const { data, error } = await db.from("customers").select("id")
    .ilike("name", `%${kueri}%`).order("name").limit(BATAS_PELANGGAN);
  if (error) throw new ListLoadError("Pencarian nama pelanggan belum dapat dijalankan. Coba muat ulang.");
  const rows = (data ?? []) as { id: string }[];
  return { ids: new Set(rows.map((row) => String(row.id))), terpotong: rows.length >= BATAS_PELANGGAN };
}

type KunciStruk = { id: string; no_struk: string | null; created_at: string; total: number;
  branch_id: string | null; customer_id: string | null; buyer_name: string | null; voided_at: string | null };
type KunciKlinik = { id: string; invoice_no: string | null; created_at: string; total: number;
  paid_status: string; voided_at: string | null; visits: Rel<{ branch_id: string | null; customer_id: string | null }> };
type KunciGrosir = { id: string; no_faktur: string; tanggal: string | null; total: number;
  status: string; voided_on: string | null; branch_id: string | null; customer_id: string | null };

/** Faktur grosir yang sudah digantikan faktur koreksi — tidak boleh dihitung dua kali. */
async function idDigantikan(db: AnyClient): Promise<Set<string>> {
  const rows = await readCompleteList<{ id: string; replaces_invoice_id: string | null }>((from, to) =>
    db.from("sales_invoices").select("id,replaces_invoice_id", { count: "exact" })
      .not("replaces_invoice_id", "is", null).order("id").range(from, to),
    "Faktur grosir pengganti", { maxRows: null });
  return new Set(rows.map((row) => String(row.replaces_invoice_id)));
}

/** Kolom kunci seluruh jendela tanggal, per sumber, sudah urut tanggal terbaru dulu. */
async function kunciJendela(db: AnyClient, f: FilterFaktur, cabang: string[] | null): Promise<KunciFaktur[][]> {
  if (cabang !== null && cabang.length === 0) return [[], [], []];
  const { mulai, akhir } = batasTanggalWIB(f.dari, f.sampai);
  // "Belum lunas" adalah daftar tagihan yang masih harus ditagih: piutang lama (mis. saldo
  // awal per faktur dari Accurate) tidak boleh hilang hanya karena tanggalnya di luar
  // rentang bawaan bulan berjalan. Rentang tanggal diabaikan untuk status ini.
  const semuaTanggal = f.status === "belum";
  const pakai = (s: SumberFaktur) => (!f.sumber || f.sumber === s)
    // Struk kasir selalu lunas saat itu juga — tidak pernah muncul di "Belum lunas".
    && !(semuaTanggal && s === "petshop");
  const batas = { maxRows: BATAS_JENDELA };

  const petshop = !pakai("petshop") ? Promise.resolve([] as KunciStruk[]) : readCompleteList<KunciStruk>((from, to) => {
    let q = db.from("sales")
      .select("id,no_struk,created_at,total,branch_id,customer_id,buyer_name,voided_at", { count: "exact" })
      // Rencana bayar yang belum diselesaikan belum jadi penjualan — aturan sama
      // dengan laporan omzet, supaya angka kedua layar tidak pernah berbeda.
      .or("payment_plan.is.null,payments_finalized_at.not.is.null")
      .gte("created_at", mulai).lte("created_at", akhir);
    if (!f.batal) q = q.is("voided_at", null);
    if (cabang) q = q.in("branch_id", cabang);
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  }, "Struk penjualan petshop", batas);

  const klinik = !pakai("klinik") ? Promise.resolve([] as KunciKlinik[]) : readCompleteList<KunciKlinik>((from, to) => {
    let q = db.from("invoices")
      .select("id,invoice_no,created_at,total,paid_status,voided_at,visits!inner(branch_id,customer_id)", { count: "exact" });
    q = semuaTanggal ? q.neq("paid_status", "Lunas") : q.gte("created_at", mulai).lte("created_at", akhir);
    if (!f.batal) q = q.is("voided_at", null);
    if (cabang) q = q.in("visits.branch_id", cabang);
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  }, "Tagihan klinik", batas);

  const grosir = !pakai("grosir")
    ? Promise.resolve({ rows: [] as KunciGrosir[], diganti: new Set<string>() })
    : Promise.all([
      readCompleteList<KunciGrosir>((from, to) => {
        let q = db.from("sales_invoices")
          .select("id,no_faktur,tanggal,total,status,voided_on,branch_id,customer_id", { count: "exact" });
        q = semuaTanggal ? q.neq("status", "lunas") : q.gte("tanggal", f.dari).lte("tanggal", f.sampai);
        if (!f.batal) q = q.is("voided_on", null).neq("status", "batal");
        if (cabang) q = q.in("branch_id", cabang);
        return q.order("tanggal", { ascending: false }).order("id", { ascending: false }).range(from, to);
      }, "Faktur penjualan grosir", batas),
      idDigantikan(db),
    ]).then(([rows, diganti]) => ({ rows, diganti }));

  const [struk, tagihan, faktur] = await Promise.all([petshop, klinik, grosir]);

  return [
    struk.map((row): KunciFaktur => ({
      id: row.id, sumber: "petshop", nomor: row.no_struk ?? "",
      tanggal: tanggalWIB(row.created_at), total: Number(row.total) || 0,
      // Struk kasir selalu dibayar saat itu juga; yang tidak lunas tidak pernah
      // jadi struk. Jadi satu-satunya status lain adalah dibatalkan.
      status: row.voided_at ? "batal" : "lunas",
      branchId: row.branch_id, customerId: row.customer_id, namaBebas: row.buyer_name,
    })),
    tagihan.map((row): KunciFaktur => {
      const visit = one(row.visits);
      return {
        id: row.id, sumber: "klinik", nomor: row.invoice_no ?? "",
        tanggal: tanggalWIB(row.created_at), total: Number(row.total) || 0,
        status: row.voided_at ? "batal" : row.paid_status === "Lunas" ? "lunas" : "belum",
        branchId: visit?.branch_id ?? null, customerId: visit?.customer_id ?? null, namaBebas: null,
      };
    }),
    faktur.rows.filter((row) => !faktur.diganti.has(row.id)).map((row): KunciFaktur => ({
      id: row.id, sumber: "grosir", nomor: row.no_faktur,
      tanggal: row.tanggal ?? "", total: Number(row.total) || 0,
      status: row.voided_on || row.status === "batal" ? "batal" : row.status === "lunas" ? "lunas" : "belum",
      branchId: row.branch_id, customerId: row.customer_id, namaBebas: null,
    })),
  ];
}

type RincianStruk = { id: string; channel: string | null; external_ref: string | null;
  buyer_name: string | null; customers: Rel<{ name: string }>; branches: Rel<{ name: string }> };
type RincianKlinik = { id: string; visit_id: string;
  visits: Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string }>; branches: Rel<{ name: string }> }> };
type RincianGrosir = { id: string; catatan: string | null; jatuh_tempo: string | null; kategori: string | null;
  opening_batch_id: string | null; customers: Rel<{ name: string }>; branches: Rel<{ name: string }>;
  sales_orders: Rel<{ no_pesanan: string }> };

async function perBatch<T extends { id: string }>(ids: string[], ambil: (batch: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>, label: string) {
  const peta = new Map<string, T>();
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += UKURAN_BATCH) batches.push(ids.slice(start, start + UKURAN_BATCH));
  for (const hasil of await Promise.all(batches.map(ambil))) {
    if (hasil.error || !Array.isArray(hasil.data)) throw new ListLoadError(`${label} belum dapat dimuat lengkap. Coba muat ulang.`);
    for (const row of hasil.data) peta.set(String(row.id), row);
  }
  return peta;
}

/** Nama pelanggan, cabang, dan keterangan — hanya untuk baris yang benar-benar ditampilkan. */
export async function muatRincianFaktur(db: AnyClient, kunci: readonly KunciFaktur[]): Promise<BarisFaktur[]> {
  const idPer = (sumber: SumberFaktur) => kunci.filter((row) => row.sumber === sumber).map((row) => row.id);
  const [struk, klinik, grosir] = await Promise.all([
    perBatch<RincianStruk>(idPer("petshop"), (batch) => db.from("sales")
      .select("id,channel,external_ref,buyer_name,customers(name),branches(name)").in("id", batch), "Rincian struk petshop"),
    perBatch<RincianKlinik>(idPer("klinik"), (batch) => db.from("invoices")
      .select("id,visit_id,visits(pets(name),customers(name),branches(name))").in("id", batch), "Rincian tagihan klinik"),
    perBatch<RincianGrosir>(idPer("grosir"), (batch) => db.from("sales_invoices")
      .select("id,catatan,jatuh_tempo,kategori,opening_batch_id,customers(name),branches(name),sales_orders(no_pesanan)").in("id", batch), "Rincian faktur grosir"),
  ]);

  return kunci.map((row): BarisFaktur => {
    if (row.sumber === "petshop") {
      const rinci = struk.get(row.id);
      const keterangan = [rinci?.channel ? `Online · ${rinci.channel}` : "Kasir petshop", rinci?.external_ref]
        .filter(Boolean).join(" · ");
      return { ...row, visitId: null, rincianHpp: !!row.nomor,
        cabang: one(rinci?.branches ?? null)?.name ?? "—",
        pelanggan: one(rinci?.customers ?? null)?.name ?? rinci?.buyer_name ?? "Pelanggan umum",
        keterangan };
    }
    if (row.sumber === "klinik") {
      const rinci = klinik.get(row.id);
      const visit = one(rinci?.visits ?? null);
      const hewan = one(visit?.pets ?? null)?.name;
      return { ...row, visitId: rinci?.visit_id ?? null, rincianHpp: !!row.nomor,
        cabang: one(visit?.branches ?? null)?.name ?? "—",
        pelanggan: one(visit?.customers ?? null)?.name ?? "—",
        keterangan: hewan ? `Kunjungan klinik · ${hewan}` : "Kunjungan klinik" };
    }
    const rinci = grosir.get(row.id);
    const pesanan = one(rinci?.sales_orders ?? null)?.no_pesanan;
    const keterangan = rinci?.opening_batch_id ? `Saldo awal${rinci.catatan ? ` · ${rinci.catatan}` : ""}`
      : rinci?.kategori === "selisih_stok" ? "Selisih stok opname"
        : rinci?.catatan || (pesanan ? `Pesanan ${pesanan}` : "Faktur grosir");
    return { ...row, visitId: null,
      rincianHpp: !!row.nomor && !rinci?.opening_batch_id && rinci?.kategori !== "selisih_stok",
      cabang: one(rinci?.branches ?? null)?.name ?? "—",
      pelanggan: one(rinci?.customers ?? null)?.name ?? "—",
      keterangan };
  });
}

/**
 * Sisa tagihan faktur grosir yang tampil — dipakai form Penerimaan di daftar.
 * Hanya grosir yang punya penerimaan bertahap; struk dan tagihan klinik
 * diselesaikan di dokumennya sendiri.
 */
export async function muatSisaGrosir(db: AnyClient, ids: readonly string[]): Promise<Map<string, number>> {
  const daftar = [...new Set(ids)];
  if (daftar.length === 0) return new Map();
  type Ringkas = { id: string; total: number; carried_paid: number; returned_ar?: number | null; status: string };
  const [faktur, bayar] = await Promise.all([
    perBatch<Ringkas>(daftar, (batch) => db.from("sales_invoices")
      .select("id,total,carried_paid,returned_ar,status").in("id", batch), "Sisa tagihan faktur grosir"),
    loadSalesInvoicePayments(db as never, daftar, []),
  ]);
  const peta = new Map<string, number>();
  for (const id of daftar) {
    const row = faktur.get(id);
    if (!row) continue;
    peta.set(id, row.status === "batal" ? 0
      : sisaTagihan(Number(row.total) - Number(row.carried_paid ?? 0) - Number(row.returned_ar ?? 0), bayar.receipts.get(id) ?? []));
  }
  return peta;
}

export type CabangPilihan = { id: string; name: string };

async function cabangPilihan(db: AnyClient, izin: AllowedBranches): Promise<CabangPilihan[]> {
  const { data } = await db.from("branches").select("id,code,name,type").eq("is_active", true).order("name");
  const katalog = (data ?? []) as { id: string; code: string | null; name: string; type: string | null }[];
  return katalog
    .filter((branch) => izin === null || izin.includes(String(branch.id)))
    .map((branch) => ({ id: String(branch.id), name: branchDisplayName(branch, katalog) }));
}

export type HasilFakturGabungan = {
  rows: BarisFaktur[];
  /** Seluruh hasil saringan, untuk kaki daftar — bukan cuma halaman ini. */
  ringkasan: RingkasanFaktur;
  pageInfo: ReturnType<typeof infoHalaman>;
  cabangOptions: CabangPilihan[];
  /** Pencarian nama pelanggan menyentuh batas; hasilnya bisa belum semua. */
  pelangganTerpotong: boolean;
};

async function saringanNama(db: AnyClient, f: FilterFaktur) {
  const [cari, pelanggan] = await Promise.all([idPelangganCocok(db, f.cari), idPelangganCocok(db, f.pelanggan)]);
  return {
    saringan: { status: f.status, cari: f.cari, idCari: cari.ids, pelanggan: f.pelanggan, idPelanggan: pelanggan.ids },
    terpotong: cari.terpotong || pelanggan.terpotong,
  };
}

/** Seluruh dokumen sesuai filter, urut, tanpa rincian — dasar daftar dan unduhan. */
export async function kunciFakturGabungan(db: AnyClient, userId: string | null, f: FilterFaktur) {
  const izin = userId ? await allowedBranchIds(db, userId) : [];
  const cabang = cabangEfektif(izin, f.cabang);
  const [sumber, nama] = await Promise.all([kunciJendela(db, f, cabang), saringanNama(db, f)]);
  return { izin, kunci: saringFaktur(gabungFaktur(sumber), nama.saringan), pelangganTerpotong: nama.terpotong };
}

export async function bacaFakturGabungan(
  db: AnyClient, userId: string | null, f: FilterFaktur, rawPage: unknown,
): Promise<HasilFakturGabungan> {
  const { izin, kunci, pelangganTerpotong } = await kunciFakturGabungan(db, userId, f);
  const pageInfo = infoHalaman(rawPage, kunci.length, TABLE_PAGE_SIZE);
  const [rows, cabangOptions] = await Promise.all([
    muatRincianFaktur(db, kunci.slice(pageInfo.from, pageInfo.to + 1)),
    cabangPilihan(db, izin),
  ]);
  return { rows, ringkasan: ringkasFaktur(kunci), pageInfo, cabangOptions, pelangganTerpotong };
}

/** Seluruh baris sesuai filter, lengkap dengan nama — dipakai unduhan Excel/CSV. */
export async function bacaSemuaFakturGabungan(db: AnyClient, userId: string | null, f: FilterFaktur) {
  const { kunci } = await kunciFakturGabungan(db, userId, f);
  if (kunci.length > BATAS_EKSPOR) {
    throw new ListLoadError(`Unduhan dibatasi ${BATAS_EKSPOR.toLocaleString("id-ID")} dokumen; persempit rentang tanggal atau filternya.`);
  }
  return { rows: await muatRincianFaktur(db, kunci), ringkasan: ringkasFaktur(kunci) };
}
