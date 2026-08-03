// Pengumpul data anggaran: menarik anggaran, pergeseran, dan realisasi satu periode.
// Dipisah supaya layar Anggaran, Monitor, dan Transfer memakai angka yang sama persis.

import { anggaranEfektif, realisasiAkun, ringkasSerapan, type RingkasanPos } from "./anggaran";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const akhirBulanAnggaran = (periode: string): string => {
  const [thn, bln] = periode.split("-").map(Number);
  return `${periode}-${String(new Date(thn, bln, 0).getDate()).padStart(2, "0")}`;
};

export type DataAnggaran = {
  ringkasan: RingkasanPos[];
  namaAkun: Map<string, string>;
  totalAnggaran: number;
  totalRealisasi: number;
};

/**
 * Serapan anggaran satu periode.
 *
 * `branchId` null berarti melihat seluruh perusahaan: anggaran pusat + anggaran
 * semua cabang dijumlahkan, dan realisasinya pun tidak disaring cabang. Kalau
 * disaring, jurnal yang tidak punya cabang (penggajian, penyusutan) akan hilang
 * dari monitor padahal uangnya nyata keluar.
 */
export async function serapanPeriode(
  supabase: AnyClient,
  periode: string,
  branchId: string | null,
): Promise<DataAnggaran> {
  const awal = `${periode}-01`;
  const akhir = akhirBulanAnggaran(periode);

  let qBudget = supabase.from("budgets").select("coa_code, jumlah, branch_id").eq("periode", periode);
  let qTransfer = supabase.from("budget_transfers").select("dari_coa, ke_coa, jumlah, branch_id").eq("periode", periode);
  if (branchId) {
    qBudget = qBudget.eq("branch_id", branchId);
    qTransfer = qTransfer.eq("branch_id", branchId);
  }

  const [{ data: budgetData }, { data: transferData }, { data: akunData }] = await Promise.all([
    qBudget,
    qTransfer,
    supabase.from("coa_accounts").select("code, name, type"),
  ]);

  const akun = (akunData ?? []) as { code: string; name: string; type: string }[];
  const namaAkun = new Map(akun.map((a) => [a.code, a.name]));

  const efektif = anggaranEfektif(
    ((budgetData ?? []) as { coa_code: string; jumlah: number }[]).map((b) => ({ coaCode: b.coa_code, jumlah: Number(b.jumlah) })),
    ((transferData ?? []) as { dari_coa: string; ke_coa: string; jumlah: number }[])
      .map((t) => ({ dariCoa: t.dari_coa, keCoa: t.ke_coa, jumlah: Number(t.jumlah) })),
  );

  // Realisasi: baris jurnal akun BEBAN pada periode itu.
  let qLines = supabase
    .from("journal_lines")
    .select("debit, credit, coa_accounts!inner(code, type), journal_entries!inner(tanggal, branch_id)")
    .eq("coa_accounts.type", "BEBAN")
    .gte("journal_entries.tanggal", awal)
    .lte("journal_entries.tanggal", akhir);
  if (branchId) qLines = qLines.eq("journal_entries.branch_id", branchId);

  const { data: lineData } = await qLines;

  type Row = { debit: number; credit: number; coa_accounts: { code: string } | { code: string }[] | null };
  const perAkun = new Map<string, { debit: number; credit: number }[]>();
  for (const row of (lineData ?? []) as Row[]) {
    const a = Array.isArray(row.coa_accounts) ? row.coa_accounts[0] : row.coa_accounts;
    if (!a?.code) continue;
    const arr = perAkun.get(a.code) ?? [];
    arr.push({ debit: Number(row.debit), credit: Number(row.credit) });
    perAkun.set(a.code, arr);
  }

  const realisasi = new Map<string, number>();
  for (const [code, baris] of perAkun) realisasi.set(code, realisasiAkun(baris));

  const ringkasan = ringkasSerapan(efektif, realisasi);
  return {
    ringkasan,
    namaAkun,
    totalAnggaran: ringkasan.reduce((a, r) => a + r.anggaran, 0),
    totalRealisasi: ringkasan.reduce((a, r) => a + r.realisasi, 0),
  };
}

/** Daftar akun beban — pilihan di layar anggaran & transfer. */
export async function akunBeban(supabase: AnyClient): Promise<{ code: string; name: string }[]> {
  const { data } = await supabase
    .from("coa_accounts").select("code, name").eq("type", "BEBAN").order("code");
  return (data ?? []) as { code: string; name: string }[];
}
