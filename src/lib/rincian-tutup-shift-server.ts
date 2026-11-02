// Pemuat data kartu Rincian Tutup Shift — dipakai layar kasir sesudah tutup shift
// dan layar riwayat tutup shift backoffice, supaya keduanya menampilkan angka yang sama.

import { batasPeriode, tanggalBaris } from "./komisi-data";
import { completeReportQuery } from "./report-query";
import { isCompletedSale } from "./sale-payment-reporting";
import { cashExpenseTotal } from "./shift-calc";
import {
  rincianPembayaran, ringkasTarget, targetBulananCabang,
  type BarisTarget, type RincianPembayaran, type RingkasanTarget,
} from "./rincian-tutup-shift";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

export type RincianTutupShiftData = {
  id: string;
  jenis: "petshop" | "klinik";
  status: string;
  branchId: string;
  cabang: string;
  kasir: string | null;
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  /** Tanggal WIB saat shift ditutup (atau dibuka, kalau belum ditutup). */
  tanggal: string;
  modalAwal: number;
  kasSeharusnya: number;
  kasFisik: number;
  selisih: number;
  pembayaran: RincianPembayaran;
  pengeluaranTunai: number;
  pengeluaranTunaiRincian: { keterangan: string; jumlah: number }[];
  /** Pengeluaran dibayar dari rekening — dicatat di shift, tapi tidak mengurangi laci. */
  pengeluaranNonTunai: number;
  /** Hanya shift petshop yang sudah ditutup. `error` = data penjualan bulan ini gagal dibaca. */
  target: RingkasanTarget | { error: string } | null;
};

export const PESAN_TARGET_TIDAK_TERBACA =
  "Ringkasan omset bulan ini belum dapat dibaca. Muat ulang halaman ini sebentar lagi.";

/**
 * Omset toko cabang ini sejak awal bulan sampai jam shift ditutup, plus bagian yang
 * jatuh di tanggal tutup shift. Dibatasi jam tutup supaya laporan yang dibuka ulang
 * dari riwayat sama dengan yang difoto kasir waktu itu.
 */
async function omsetCabang(
  supabase: AnyClient, branchId: string, tanggal: string, sampaiIso: string,
): Promise<{ bulan: number; hari: number }> {
  const periode = tanggal.slice(0, 7);
  const { dari } = batasPeriode(periode);
  const { data } = await completeReportQuery<{
    id: string; total: number | string; created_at: string;
    payment_plan: unknown; payments_finalized_at: string | null; voided_at: string | null;
  }>(supabase.from("sales")
    .select("id, total, created_at, payment_plan, payments_finalized_at, voided_at", { count: "exact" })
    .eq("branch_id", branchId)
    .gte("created_at", dari)
    .lte("created_at", sampaiIso));
  let bulan = 0, hari = 0;
  for (const s of data.filter(isCompletedSale)) {
    const nilai = Number(s.total) || 0;
    bulan += nilai;
    if (tanggalBaris(s.created_at) === tanggal) hari += nilai;
  }
  return { bulan, hari };
}

export async function muatRincianTutupShift(supabase: AnyClient, shiftId: string): Promise<RincianTutupShiftData | null> {
  const { data: shift } = await supabase
    .from("cashier_shifts")
    .select("id, shift_type, status, branch_id, opened_by, opening_balance, closing_balance, expected_cash, selisih, closing_breakdown, opened_at, closed_at, branches(name), profiles(full_name)")
    .eq("id", shiftId)
    .maybeSingle();
  if (!shift) return null;

  const { data: expenses } = await supabase
    .from("expenses").select("kategori, deskripsi, jumlah, metode_bayar").eq("shift_id", shiftId);
  const semuaPengeluaran = (expenses ?? []) as { kategori: string; deskripsi: string | null; jumlah: number; metode_bayar: string }[];
  const tunaiRows = semuaPengeluaran.filter((e) => e.metode_bayar === "Tunai");
  const pengeluaranTunai = cashExpenseTotal(semuaPengeluaran);
  const pengeluaranNonTunai = semuaPengeluaran
    .filter((e) => e.metode_bayar !== "Tunai")
    .reduce((a, e) => a + (Number(e.jumlah) || 0), 0);

  const jenis = shift.shift_type === "klinik" ? "klinik" : "petshop";
  const tanggal = tanggalBaris(shift.closed_at ?? shift.opened_at);

  let target: RincianTutupShiftData["target"] = null;
  if (jenis === "petshop" && shift.status === "closed" && shift.closed_at) {
    const periode = tanggal.slice(0, 7);
    try {
      const [omset, { data: targetRows, error: targetError }] = await Promise.all([
        omsetCabang(supabase, shift.branch_id, tanggal, shift.closed_at),
        supabase.from("sales_targets")
          .select("periode, target, basis, branch_id, employee_id, category_id")
          .eq("periode", periode).eq("branch_id", shift.branch_id),
      ]);
      if (targetError) throw new Error(targetError.message);
      target = ringkasTarget({
        periode,
        omsetBulan: omset.bulan,
        penjualanHari: omset.hari,
        target: targetBulananCabang((targetRows ?? []) as BarisTarget[], shift.branch_id, periode),
      });
    } catch {
      // Angka target yang salah lebih menyesatkan daripada kosong — tampilkan pesan saja.
      target = { error: PESAN_TARGET_TIDAK_TERBACA };
    }
  }

  return {
    id: shift.id,
    jenis,
    status: shift.status,
    branchId: shift.branch_id,
    cabang: one(shift.branches as Rel<{ name: string }>)?.name ?? "—",
    kasir: one(shift.profiles as Rel<{ full_name: string | null }>)?.full_name ?? null,
    openedBy: shift.opened_by ?? null,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at ?? null,
    tanggal,
    modalAwal: Number(shift.opening_balance) || 0,
    kasSeharusnya: Number(shift.expected_cash) || 0,
    kasFisik: Number(shift.closing_balance) || 0,
    selisih: Number(shift.selisih) || 0,
    pembayaran: rincianPembayaran(shift.closing_breakdown as Record<string, number> | null),
    pengeluaranTunai,
    pengeluaranTunaiRincian: tunaiRows.map((e) => ({ keterangan: e.deskripsi?.trim() || e.kategori, jumlah: Number(e.jumlah) || 0 })),
    pengeluaranNonTunai,
    target,
  };
}
