// Perakitan baris tagihan klinik dari resep dokter — dipakai layar pembayaran
// (untuk memperlihatkan perkiraan sebelum ditagih) DAN aksi bayar rombongan
// (untuk membuat invoicenya).
//
// Sengaja satu tempat: kalau perkiraan di layar dan perhitungan saat menyimpan
// dihitung dua kali dengan kode berbeda, kasir bisa menyebut angka ke pemilik
// yang ternyata tidak sama dengan yang tercetak di struk.

import { bolehBayar } from "./tindakan";
import { tambahPpn, type PajakSettings } from "./pajak";
import { hitungPromoKeranjang, loadPromoAktif } from "./promo-hitung";
import { diskonGolonganKeranjang, loadAturanDiskon, loadInfoBarang } from "./harga-golongan";
import { pesanVoucherDitolak, potonganVoucher, normalizeKode, voucherBerlaku, type VoucherRow } from "./voucher";
import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisTagihan = {
  deskripsi: string; qty: number; harga: number; jenis: string; item_id: string | null;
};

/**
 * Baris tagihan satu kunjungan, diambil dari resep & tindakan yang diinput dokter.
 * Kalau dokter tidak menginput apa pun, tetap ada satu baris jasa konsultasi
 * supaya kunjungan tidak lolos tanpa tagihan sama sekali.
 */
export async function barisTagihanVisit(
  supabase: AnyClient,
  visitId: string,
  poli: string,
): Promise<BarisTagihan[]> {
  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: resep } = mr
    ? await supabase.from("prescription_items")
        .select("nama_obat, qty, harga, jenis, item_id").eq("medical_record_id", mr.id).order("created_at")
    : { data: [] as { nama_obat: string; qty: number; harga: number; jenis: string; item_id: string | null }[] };

  const rows = ((resep ?? []) as { nama_obat: string; qty: number; harga: number; jenis: string; item_id: string | null }[])
    .map((r) => ({
      deskripsi: String(r.nama_obat ?? "").trim(),
      qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
      harga: Number(r.harga) || 0,
      jenis: r.jenis === "jasa" ? "jasa" : "obat",
      // item_id jasa ikut dibawa: promo boleh mengenai tindakan, dan tanpa ini
      // promo tidak punya pegangan tindakan mana yang sedang didiskon. Stok tetap
      // aman karena pemotongan stok menyaring lewat kolom `jenis`.
      item_id: r.item_id ?? null,
    })).filter((l) => l.deskripsi);

  return rows.length ? rows : [{ deskripsi: `Jasa Konsultasi ${poli}`, qty: 1, harga: 0, jenis: "jasa", item_id: null }];
}

export type Perkiraan = {
  /** Total termasuk PPN — angka yang akan tercetak di invoice nanti. */
  total: number;
  /** false = tertahan persetujuan tindakan; nanti dilewati saat bayar sekaligus. */
  bisaDibayar: boolean;
};

/**
 * Perkiraan tagihan kunjungan yang invoicenya BELUM dibuat. Kasir perlu menyebut
 * angka ke pemilik sebelum memilih metode bayar — tanpa ini panel rombongan
 * menampilkan Rp 0 untuk semua hewan yang belum ditagih.
 *
 * Memakai gerbang persetujuan yang sama dengan aksi bayarnya, jadi hewan yang
 * nanti dilewati tidak ikut menaikkan angka yang disebutkan ke pemilik.
 */
export async function perkiraanTagihan(
  supabase: AnyClient,
  visitIds: string[],
  pajak: PajakSettings,
): Promise<Map<string, Perkiraan>> {
  const hasil = new Map<string, Perkiraan>();
  if (visitIds.length === 0) return hasil;

  const { data: visits } = await supabase
    .from("visits").select("id, poli").in("id", visitIds);
  const poliPerVisit = new Map(
    ((visits ?? []) as { id: string; poli: string | null }[]).map((v) => [v.id, v.poli ?? "Poli Umum"]),
  );

  await Promise.all(visitIds.map(async (visitId) => {
    const [rows, gate] = await Promise.all([
      barisTagihanVisit(supabase, visitId, poliPerVisit.get(visitId) ?? "Poli Umum"),
      gerbangConsent(supabase, visitId),
    ]);
    const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
    const { total } = tambahPpn(subtotal, pajak);
    hasil.set(visitId, { total, bisaDibayar: gate });
  }));

  return hasil;
}

// ─────────────────────────── Promo & voucher klinik ───────────────────────────
// Mesinnya sama dengan kasir petshop (lib/promo-hitung, lib/voucher,
// lib/harga-golongan) — klinik tidak punya aturan promo sendiri. Yang beda cuma
// pemakaiannya di rombongan: satu voucher untuk satu kedatangan, potongannya
// dibagi proporsional ke nota tiap hewan (kesepakatan 2026-08-12).

export type BarisPotongan = { item_id: string | null; qty: number; harga: number };

export type Potongan = {
  promo: number;
  voucher: number;
  golongan: number;
  /** promo + voucher + golongan, belum termasuk diskon manual kasir. */
  total: number;
  /** Alasan voucher ditolak; null kalau tidak ada kode / kodenya sah. */
  tolakVoucher: string | null;
};

const KOSONG: Potongan = { promo: 0, voucher: 0, golongan: 0, total: 0, tolakVoucher: null };

/**
 * Potongan otomatis untuk satu tagihan klinik. SELALU dihitung ulang di server
 * saat menyimpan — angka dari layar tidak boleh menentukan uang, layar kasir yang
 * sudah lama terbuka bisa memegang promo yang sudah dicabut.
 *
 * Promo boleh mengenai jasa/tindakan, bukan cuma obat (kesepakatan dengan Aldi).
 * Karena itu baris jasa wajib membawa item_id-nya; tanpa itu promo tidak punya
 * pegangan untuk mengenali tindakan apa yang sedang didiskon.
 */
export async function hitungPotonganKlinik(
  supabase: AnyClient,
  opts: {
    branchId: string | null;
    customerId: string | null;
    rows: BarisPotongan[];
    voucherCode?: string | null;
  },
): Promise<Potongan> {
  const rows = opts.rows.filter((l) => Number(l.qty) > 0);
  const subtotal = rows.reduce((a, l) => a + Number(l.qty) * Number(l.harga), 0);
  if (subtotal <= 0) return KOSONG;

  const kode = normalizeKode(opts.voucherCode) || null;

  // Promo otomatis: dari master, per baris, pakai mesin yang sama dengan petshop.
  const promoAktif = opts.branchId ? await loadPromoAktif(supabase, opts.branchId) : [];
  const potonganPromo = hitungPromoKeranjang(promoAktif, rows.map((l) => ({
    item_id: l.item_id ?? "", qty: Number(l.qty), harga: Number(l.harga),
  })));
  const promo = potonganPromo.reduce((a, p) => a + Number(p.potongan), 0);

  const afterPromo = Math.max(0, subtotal - promo);

  // Diskon golongan pelanggan — persennya dari master, BUKAN dari form.
  let golongan = 0;
  if (opts.customerId) {
    const { data: cust } = await supabase
      .from("customers").select("category_id, customer_categories(diskon_persen, is_active)")
      .eq("id", opts.customerId).maybeSingle();
    const rel = cust?.customer_categories as
      | { diskon_persen: number; is_active: boolean }
      | { diskon_persen: number; is_active: boolean }[] | null | undefined;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    if (kat?.is_active) {
      const [aturan, infoBarang] = await Promise.all([
        loadAturanDiskon(supabase, cust?.category_id),
        loadInfoBarang(supabase, rows.map((l) => l.item_id).filter((x): x is string => !!x)),
      ]);
      golongan = diskonGolonganKeranjang(
        rows.map((l) => ({ item_id: l.item_id ?? "", qty: Number(l.qty), harga: Number(l.harga) })),
        aturan, Number(kat.diskon_persen), infoBarang,
      );
    }
  }

  // Voucher dihitung dari nilai setelah promo, sama urutannya dengan §6 di POS.
  let voucher = 0;
  let tolakVoucher: string | null = null;
  if (kode) {
    const { data: v } = await supabase
      .from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo")
      .eq("code", kode).maybeSingle();
    tolakVoucher = pesanVoucherDitolak((v ?? null) as VoucherRow | null, hariIniWIB(), {
      dasar: afterPromo,
      adaPromoOtomatis: potonganPromo.length > 0,
    });
    if (!tolakVoucher) voucher = potonganVoucher(afterPromo, v as VoucherRow);
  }

  // Total potongan tidak boleh melebihi tagihan — kalau lewat, DPP jadi minus dan
  // jurnal pendapatannya ikut salah.
  const total = Math.min(subtotal, promo + golongan + voucher);
  return { promo, voucher, golongan, total, tolakVoucher };
}

export type BekalPotongan = {
  promos: import("./promo-hitung").PromoHitung[];
  vouchers: VoucherRow[];
  aturanDiskon: import("./harga-golongan").AturanDiskon[];
  infoBarang: Record<string, import("./harga-golongan").BarangDiskon>;
  golonganPersen: number;
  hariIni: string;
};

/**
 * Bahan perhitungan potongan untuk LAYAR kasir klinik: promo aktif, voucher yang
 * masih berlaku, dan aturan diskon golongan pelanggannya. Layar memakainya untuk
 * memperlihatkan angka sebelum tombol bayar ditekan — servernya tetap menghitung
 * ulang saat menyimpan, ini murni tampilan.
 *
 * Voucher yang sudah lewat/belum mulai tidak dikirim ke layar: kalau dikirim,
 * kasir melihat potongan yang nanti ditolak server.
 */
export async function bekalPotonganKlinik(
  supabase: AnyClient,
  branchId: string | null,
  customerId: string | null,
  itemIds: string[],
): Promise<BekalPotongan> {
  const hariIni = hariIniWIB();
  const [promos, { data: vouchers }, cust] = await Promise.all([
    branchId ? loadPromoAktif(supabase, branchId) : Promise.resolve([]),
    supabase.from("vouchers")
      .select("code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo")
      .eq("is_active", true),
    customerId
      ? supabase.from("customers")
          .select("category_id, customer_categories(diskon_persen, is_active)")
          .eq("id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rel = cust?.data?.customer_categories as
    | { diskon_persen: number; is_active: boolean }
    | { diskon_persen: number; is_active: boolean }[] | null | undefined;
  const kat = Array.isArray(rel) ? rel[0] : rel;

  const [aturanDiskon, infoMap] = kat?.is_active
    ? await Promise.all([
        loadAturanDiskon(supabase, cust?.data?.category_id),
        loadInfoBarang(supabase, itemIds),
      ])
    : [[], new Map()];

  return {
    promos,
    vouchers: ((vouchers ?? []) as VoucherRow[]).filter((v) => voucherBerlaku(v, hariIni)),
    aturanDiskon,
    // Map tidak bisa dikirim ke komponen klien — layar merakit ulang Map-nya.
    infoBarang: Object.fromEntries(infoMap),
    golonganPersen: kat?.is_active ? Number(kat.diskon_persen) : 0,
    hariIni,
  };
}

/**
 * Bagi satu potongan ke beberapa nota sesuai porsi tagihannya. Dipakai voucher
 * rombongan: pemilik memakai kode sekali, tapi tiap hewan tetap punya notanya
 * sendiri — kalau potongan ditumpuk ke satu hewan, insentif dokter yang menangani
 * hewan itu ambles padahal bukan porsi dia.
 *
 * Sisa pembulatan ditempel ke nota terbesar supaya jumlah potongan per nota
 * persis sama dengan nilai vouchernya (tidak kurang/lebih 1 rupiah).
 */
export function bagiPotongan(dasar: number[], potongan: number): number[] {
  const jumlah = dasar.reduce((a, b) => a + Math.max(0, b), 0);
  const nilai = Math.max(0, Math.min(potongan, jumlah));
  if (jumlah <= 0 || nilai <= 0) return dasar.map(() => 0);

  const bagian = dasar.map((d) => Math.floor((Math.max(0, d) * nilai) / jumlah));
  const sisa = nilai - bagian.reduce((a, b) => a + b, 0);
  if (sisa > 0) {
    let terbesar = 0;
    for (let i = 1; i < dasar.length; i++) if (dasar[i] > dasar[terbesar]) terbesar = i;
    bagian[terbesar] += sisa;
  }
  return bagian;
}

async function gerbangConsent(supabase: AnyClient, visitId: string): Promise<boolean> {
  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const [{ data: jasaRows }, { data: inpat }, { data: consents }] = await Promise.all([
    mr
      ? supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mr.id)
      : Promise.resolve({ data: [] as { jenis: string; kategori: string | null }[] }),
    supabase.from("inpatient_records").select("id").eq("visit_id", visitId).limit(1).maybeSingle(),
    supabase.from("consents").select("status").eq("visit_id", visitId),
  ]);
  return bolehBayar(
    (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
    !!inpat,
    (consents ?? []) as { status: string }[],
  );
}
