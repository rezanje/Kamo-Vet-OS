import "server-only";
import { getAccountLedger, getAccountOpening } from "@/lib/ledger";
import { completeReportQuery } from "@/lib/report-query";
import { geserHari } from "@/lib/tanggal";
import { hitungRiwayat, type BarisKas, type CabangRiwayat, type ShiftTutup } from "@/lib/setoran-riwayat";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type AkunKasToko = { id: string; nama: string; coa_code: string };
export type HasilRiwayat = { akun: AkunKasToko | null; hitung: ReturnType<typeof hitungRiwayat> | null };

/** Cabang aktif yang boleh dilihat akun ini (RLS branches + pilihan cabang operasional sesi). Saringan jenis toko dilakukan di pilihCabangRiwayat. */
export async function muatCabangRiwayat(supabase: Supabase): Promise<CabangRiwayat[]> {
  const { data } = await supabase.from("branches").select("id, name, type").eq("is_active", true).order("name");
  return ((data ?? []) as CabangRiwayat[]).map((c) => ({ id: String(c.id), name: String(c.name), type: String(c.type) }));
}

/**
 * Baca-saja. Buku Besar akun kas toko cabang lewat fungsi baca yang sama dengan halaman Buku Besar (ledger_account_lines:
 * hak baca = RLS, jurnal setoran hanya terlihat penyetuju), ditambah shift kasir yang sudah ditutup. Tidak ada tulis ke basis data.
 */
export async function muatRiwayat(supabase: Supabase, p: { branchId: string; dari: string; sampai: string }): Promise<HasilRiwayat> {
  const { data: akunRows, error } = await supabase.from("cash_accounts").select("id, nama, coa_code").eq("branch_id", p.branchId).eq("jenis", "Kas").eq("is_active", true).order("created_at");
  if (error) throw new Error("Rekening kas toko belum dapat dibaca.");
  const akun = ((akunRows ?? []) as AkunKasToko[])[0] ?? null;
  if (!akun || !akun.coa_code) return { akun: null, hitung: null };

  const filter = { from: p.dari, to: p.sampai, branchId: p.branchId };
  const [lines, saldoAwal, shiftRes] = await Promise.all([
    getAccountLedger(supabase as never, akun.coa_code, filter),
    getAccountOpening(supabase as never, akun.coa_code, filter),
    completeReportQuery<{ id: string; closed_at: string; opening_balance: number | string; closing_balance: number | string }>(
      supabase.from("cashier_shifts").select("id, closed_at, opening_balance, closing_balance", { count: "exact" })
        .eq("branch_id", p.branchId).eq("status", "closed").not("closing_balance", "is", null).not("closed_at", "is", null)
        // Batas hari WIB (UTC+7): shift ditutup 00:00–06:59 WIB jatuh di hari WIB itu, bukan hari UTC sebelumnya.
        .gte("closed_at", `${p.dari}T00:00:00+07:00`).lt("closed_at", `${geserHari(p.sampai, 1)}T00:00:00+07:00`) as never,
    ),
  ]);
  const baris: BarisKas[] = lines.map((l) => ({ tanggal: l.tanggal, source: l.source, debit: l.debit, credit: l.credit }));
  const shifts: ShiftTutup[] = shiftRes.data.map((s) => ({ closed_at: s.closed_at, opening_balance: Number(s.opening_balance), closing_balance: Number(s.closing_balance) }));
  return { akun, hitung: hitungRiwayat({ dari: p.dari, sampai: p.sampai, shifts, baris, saldoAwal }) };
}
