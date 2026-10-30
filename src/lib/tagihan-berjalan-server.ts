// Pembacaan layar "Tagihan rawat inap berjalan". Semua angka uang dihitung ulang oleh
// RPC saat disimpan; yang di sini hanya untuk ditampilkan.
import type { createClient } from "./supabase/server";
import { gagalBacaUang } from "./baca-uang";
import {
  barisBelumDitagih, ringkasTahap, saldoUangMuka, totalPiutang,
  type BarisInvoice, type BarisResep, type RingkasTahap, type TagihanTahap,
} from "./tagihan-berjalan";

type Db = Awaited<ReturnType<typeof createClient>>;
type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

export class TagihanBerjalanError extends Error {}
const gagal = () => new TagihanBerjalanError(
  "Data tagihan rawat inap belum dapat dibaca lengkap. Muat ulang sebelum memproses uang.",
);

export type KwitansiBagian = { urutan: number; metode: string; amount: number; kas_code: string };
export type Kwitansi = {
  id: string; no_kwitansi: string; tanggal: string; total: number; status: string;
  catatan: string | null; void_reason: string | null; created_at: string;
  kasir: string | null; bagian: KwitansiBagian[];
};
export type UangMuka = {
  id: string; no_uang_muka: string; tanggal: string; amount: number; applied: number; status: string;
};

export type RincianDitagih = BarisInvoice & {
  id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number;
};

export type TagihanBerjalan = {
  record: { id: string; visit_id: string; branch_id: string; admitted_at: string; discharged_at: string | null };
  visit: { id: string; status: string; poli: string | null; dokter: string | null; customer_id: string | null };
  pasien: string; pemilik: string; telepon: string | null;
  belumDitagih: BarisResep[];
  rincianDitagih: RincianDitagih[];
  tahap: RingkasTahap[];
  piutang: number;
  kwitansi: Kwitansi[];
  uangMuka: UangMuka[];
  saldoUangMuka: number;
  /**
   * false = tabel kwitansi/uang muka memang belum ada di lingkungan ini (migrasi
   * tagihan berjalan belum terpasang). Riwayat uang ditampilkan kosong DAN layar
   * harus mengunci aksi uang; bukan berarti "belum ada pembayaran".
   */
  riwayatUangTerpasang: boolean;
};

/** Semua baris yang dibutuhkan satu layar tagihan rawat inap, atau lempar bila tidak lengkap. */
export async function muatTagihanBerjalan(db: Db, recordId: string): Promise<TagihanBerjalan | null> {
  const { data: record, error: recordError } = await db
    .from("inpatient_records")
    .select("id, visit_id, branch_id, admitted_at, discharged_at")
    .eq("id", recordId).maybeSingle();
  if (recordError) throw gagal();
  if (!record) return null;

  const visitId = record.visit_id as string;
  const [visitRes, mrRes, invoiceRes, kwitansiRes, mukaRes] = await Promise.all([
    db.from("visits")
      .select("id, status, poli, dokter, customer_id, pets(name, species), customers(name, phone)")
      .eq("id", visitId).maybeSingle(),
    db.from("medical_records").select("id").eq("visit_id", visitId).order("created_at"),
    db.from("invoices")
      .select("id, invoice_no, created_at, subtotal, discount, tax, total, dp_amount, metode_bayar, paid_status, voided_at, correction_pending, reissued_from")
      .eq("visit_id", visitId).order("created_at"),
    db.from("clinic_payment_receipts")
      // created_by DAN voided_by sama-sama menunjuk profiles: embed tanpa `!nama_fk`
      // gagal total (PGRST201) dan riwayatnya diam-diam kosong.
      .select("id, no_kwitansi, tanggal, total, status, catatan, void_reason, created_at, profiles!clinic_payment_receipts_created_by_fkey(full_name), clinic_payment_receipt_parts(urutan, metode, amount, kas_code)")
      .eq("visit_id", visitId).order("created_at"),
    db.from("clinic_customer_advances")
      .select("id, no_uang_muka, tanggal, amount, applied, status")
      .eq("visit_id", visitId).order("created_at"),
  ]);
  if (visitRes.error || mrRes.error || invoiceRes.error) throw gagal();
  if (!visitRes.data) return null;

  const mrIds = ((mrRes.data ?? []) as { id: string }[]).map((r) => r.id);
  const invoices = (invoiceRes.data ?? []) as TagihanTahap[];
  const invoiceIds = invoices.map((i) => i.id);
  const [resepRes, lineRes, bayarRes] = await Promise.all([
    mrIds.length
      ? db.from("prescription_items")
          .select("id, nama_obat, qty, harga, jenis, kategori, item_id, satuan, compound_recipe_id")
          .in("medical_record_id", mrIds).order("created_at")
      : Promise.resolve({ data: [] as BarisResep[], error: null }),
    invoiceIds.length
      ? db.from("invoice_items").select("id, invoice_id, prescription_item_id, deskripsi, qty, harga, diskon_persen").in("invoice_id", invoiceIds).order("created_at").order("id")
      : Promise.resolve({ data: [] as BarisInvoice[], error: null }),
    invoiceIds.length
      ? db.from("invoice_payments").select("invoice_id, amount").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] as { invoice_id: string; amount: number }[], error: null }),
  ]);
  if (resepRes.error || lineRes.error || bayarRes.error) throw gagal();

  // Riwayat uang gagal-TERTUTUP. Error baca/izin/relasi tidak boleh tampil sebagai
  // "Belum ada pembayaran": staf bisa menagih ulang uang yang sebenarnya sudah masuk.
  // Yang tetap boleh kosong hanyalah tabel yang memang belum ada di lingkungan ini.
  if (gagalBacaUang(kwitansiRes.error) || gagalBacaUang(mukaRes.error)) throw gagal();
  const riwayatUangTerpasang = !kwitansiRes.error && !mukaRes.error;

  const resep = (resepRes.data ?? []) as BarisResep[];
  const tahap = ringkasTahap(invoices, (bayarRes.data ?? []) as { invoice_id: string; amount: number }[]);
  const uangMuka = (mukaRes.error ? [] : (mukaRes.data ?? [])) as UangMuka[];
  const visit = visitRes.data;
  const pet = one(visit.pets as Rel<{ name: string; species: string | null }>);
  const cust = one(visit.customers as Rel<{ name: string; phone: string | null }>);

  return {
    record: record as TagihanBerjalan["record"],
    visit: {
      id: visit.id as string, status: visit.status as string,
      poli: (visit.poli as string | null) ?? null, dokter: (visit.dokter as string | null) ?? null,
      customer_id: (visit.customer_id as string | null) ?? null,
    },
    pasien: pet ? `${pet.name}${pet.species ? ` · ${pet.species}` : ""}` : "—",
    pemilik: cust?.name ?? "—",
    telepon: cust?.phone ?? null,
    belumDitagih: barisBelumDitagih(resep, (lineRes.data ?? []) as BarisInvoice[], invoices),
    rincianDitagih: ((lineRes.data ?? []) as RincianDitagih[])
      .filter((l) => tahap.some((t) => t.id === l.invoice_id)),
    tahap,
    piutang: totalPiutang(tahap),
    riwayatUangTerpasang,
    // Kosong hanya bila migrasinya belum terpasang, supaya layar tetap terbuka dan staf
    // melihat tagihannya; layar sendiri yang mengunci aksi uangnya.
    kwitansi: (kwitansiRes.error ? [] : (kwitansiRes.data ?? [])).map((row: Record<string, unknown>): Kwitansi => ({
      id: row.id as string, no_kwitansi: row.no_kwitansi as string, tanggal: row.tanggal as string,
      total: Number(row.total) || 0, status: row.status as string,
      catatan: (row.catatan as string | null) ?? null,
      void_reason: (row.void_reason as string | null) ?? null,
      created_at: row.created_at as string,
      kasir: one(row.profiles as Rel<{ full_name: string | null }>)?.full_name ?? null,
      bagian: ((row.clinic_payment_receipt_parts ?? []) as KwitansiBagian[])
        .map((p) => ({ ...p, amount: Number(p.amount) || 0 }))
        .sort((a, b) => a.urutan - b.urutan),
    })),
    uangMuka,
    saldoUangMuka: saldoUangMuka(uangMuka),
  };
}

export type RingkasBelumDitagih = {
  /** false = salah satu sumbernya gagal dibaca; angkanya TIDAK boleh dipercaya. */
  terbaca: boolean;
  baris: number;
  nilai: number;
};

/**
 * Biaya yang sudah tercatat di rekam medis tetapi belum masuk tagihan aktif mana pun.
 *
 * Dipakai layar rawat inap untuk memperlihatkan sisa biaya SEBELUM pasien dipulangkan.
 * Kepulangan tetap tidak diblokir oleh angka ini — pasien boleh pulang walau masih ada
 * tagihan; yang dicegah hanyalah biaya terlewat tanpa ada yang melihatnya.
 */
export async function ringkasBelumDitagih(db: Db, visitId: string): Promise<RingkasBelumDitagih> {
  const [mrRes, invoiceRes] = await Promise.all([
    db.from("medical_records").select("id").eq("visit_id", visitId),
    db.from("invoices").select("id, voided_at").eq("visit_id", visitId),
  ]);
  if (mrRes.error || invoiceRes.error) return { terbaca: false, baris: 0, nilai: 0 };
  const mrIds = ((mrRes.data ?? []) as { id: string }[]).map((r) => r.id);
  const invoices = (invoiceRes.data ?? []) as { id: string; voided_at: string | null }[];
  const invoiceIds = invoices.map((i) => i.id);
  const [resepRes, lineRes] = await Promise.all([
    mrIds.length
      ? db.from("prescription_items")
          .select("id, nama_obat, qty, harga, jenis, kategori, item_id, satuan, compound_recipe_id")
          .in("medical_record_id", mrIds)
      : Promise.resolve({ data: [] as BarisResep[], error: null }),
    invoiceIds.length
      ? db.from("invoice_items").select("invoice_id, prescription_item_id").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] as BarisInvoice[], error: null }),
  ]);
  if (resepRes.error || lineRes.error) return { terbaca: false, baris: 0, nilai: 0 };
  const sisa = barisBelumDitagih(
    (resepRes.data ?? []) as BarisResep[],
    (lineRes.data ?? []) as BarisInvoice[],
    invoices.map((i) => ({ id: i.id, voided_at: i.voided_at })),
  );
  return {
    terbaca: true,
    baris: sisa.length,
    nilai: sisa.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0),
  };
}
