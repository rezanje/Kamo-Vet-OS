import { formatTanggalID } from "@/lib/tanggal-mundur";

/**
 * Jejak tanggal mundur pengeluaran (tabel expense_backdates, tak dapat diubah) untuk daftar dan laporan.
 * Pembacaan tunduk pada RLS: pelaku hanya melihat miliknya; Owner/Admin/Finance melihat cabangnya.
 * Galat baca TIDAK PERNAH menjatuhkan halaman: hasilnya kosong (lencana tidak tampil), bukan galat.
 */
export type JejakMundur = { expense_id: string; effective_date: string; reason: string; recorded_at: string };

// Tipe minimal klien Supabase; sengaja longgar supaya server client dan test double sama-sama cocok.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Klien = { from: (table: string) => any };

const KOLOM = "expense_id, effective_date, reason, recorded_at";
const POTONG = 100;

const sah = (row: unknown): row is JejakMundur => {
  const r = row as Partial<JejakMundur> | null;
  return !!r && typeof r.expense_id === "string" && typeof r.effective_date === "string" && typeof r.reason === "string" && typeof r.recorded_at === "string";
};

/** Jejak untuk sejumlah pengeluaran yang tampil di satu daftar pendek (per 100 id). */
export async function muatJejakMundurByIds(supabase: Klien, ids: string[]): Promise<Map<string, JejakMundur>> {
  const peta = new Map<string, JejakMundur>();
  const unik = [...new Set(ids.filter(Boolean))];
  try {
    for (let i = 0; i < unik.length; i += POTONG) {
      const { data, error } = await supabase.from("expense_backdates").select(KOLOM).in("expense_id", unik.slice(i, i + POTONG));
      if (error || !Array.isArray(data)) continue;
      for (const row of data) if (sah(row)) peta.set(row.expense_id, row);
    }
  } catch { /* lencana saja yang hilang */ }
  return peta;
}

/** Jejak untuk daftar panjang (setahun): semua jejak dengan tanggal efektif sejak `dari`, tanpa daftar id yang panjang. */
export async function muatJejakMundurSejak(supabase: Klien, dari: string): Promise<Map<string, JejakMundur>> {
  const peta = new Map<string, JejakMundur>();
  try {
    for (let awal = 0; awal < 10_000; awal += 1000) {
      const { data, error } = await supabase.from("expense_backdates").select(KOLOM).gte("effective_date", dari)
        .order("recorded_at", { ascending: false }).order("expense_id").range(awal, awal + 999);
      if (error || !Array.isArray(data)) break;
      for (const row of data) if (sah(row)) peta.set(row.expense_id, row);
      if (data.length < 1000) break;
    }
  } catch { /* lencana saja yang hilang */ }
  return peta;
}

const fmtWaktu = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

/** Teks tooltip lencana "Mundur". */
export function keteranganJejak(j: Pick<JejakMundur, "effective_date" | "reason" | "recorded_at">): string {
  return `Dicatat mundur ke ${formatTanggalID(j.effective_date)}, diinput ${fmtWaktu(j.recorded_at)} WIB. Alasan: ${j.reason}`;
}

/** Hari WIB (YYYY-MM-DD) dari waktu nyata input. */
export function tanggalInputWIB(recordedAt: string): string {
  return new Date(new Date(recordedAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function selisihHari(tanggalEfektif: string, recordedAt: string): number {
  const a = Date.parse(`${tanggalEfektif}T00:00:00Z`), b = Date.parse(`${tanggalInputWIB(recordedAt)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Pengeluaran yang diinput di bulan berbeda dari tanggal efektifnya: laporan bulan itu bisa berubah setelah dilaporkan. */
export function lintasBulan(tanggalEfektif: string, recordedAt: string): boolean {
  return tanggalEfektif.slice(0, 7) !== tanggalInputWIB(recordedAt).slice(0, 7);
}

type Nilai = Record<string, unknown> | null | undefined;
const rp = (n: unknown) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

/** Ringkasan apa yang berubah pada satu koreksi (Ubah): tanggal, kategori, metode, jumlah; kosong bila tidak ada selisih terbaca. */
export function ringkasPerubahan(before: Nilai, after: Nilai): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  const t0 = String(before.tanggal ?? ""), t1 = String(after.tanggal ?? "");
  if (t0 && t1 && t0 !== t1) out.push(`Tanggal ${formatTanggalID(t0)} → ${formatTanggalID(t1)}`);
  if (before.kategori !== after.kategori && before.kategori && after.kategori) out.push(`Kategori ${String(before.kategori)} → ${String(after.kategori)}`);
  if (before.metode_bayar !== after.metode_bayar && before.metode_bayar && after.metode_bayar) out.push(`Metode ${String(before.metode_bayar)} → ${String(after.metode_bayar)}`);
  if (Number(before.jumlah) !== Number(after.jumlah)) out.push(`Jumlah ${rp(before.jumlah)} → ${rp(after.jumlah)}`);
  return out;
}

export type BarisLaporanMundur = { effective_date: string; recorded_at: string; jumlah: number; dibatalkan: boolean };

/** Ringkasan laporan: jumlah pengeluaran mundur, total (tanpa yang dibatalkan), dan yang lintas bulan (laporan bulan lama berubah). */
export function ringkasLaporanMundur(rows: BarisLaporanMundur[]) {
  const aktif = rows.filter((r) => !r.dibatalkan);
  const lintas = aktif.filter((r) => lintasBulan(r.effective_date, r.recorded_at));
  const jumlah = (xs: BarisLaporanMundur[]) => xs.reduce((a, r) => a + (Number(r.jumlah) || 0), 0);
  return { baris: rows.length, aktif: aktif.length, dibatalkan: rows.length - aktif.length, total: jumlah(aktif), lintasBulan: lintas.length, totalLintasBulan: jumlah(lintas) };
}
