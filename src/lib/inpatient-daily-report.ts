// Daftar rawat inap — hanya baca: pasien lunas-belum-pulang dan kepatuhan laporan harian.
// Tidak menulis apa pun, tidak memulangkan, tidak ada pengingat/gerbang.
import type { createClient } from "./supabase/server";
import { BILLING_LUNAS_LABEL } from "./inpatient-billing-status";

type Db = Awaited<ReturnType<typeof createClient>>;

const WIB_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const ID_CHUNK = 100;

export type DailyLogRow = { inpatient_record_id: string; log_date: string | null; created_at: string };
export type LaporanHarian = { state: "belum" | "ada"; count: number; lastDate: string | null; daysSince: number | null };

// Server jalan di UTC, klinik di WIB: geser +7 jam sebelum memotong tanggal.
export function wibDate(iso: string): string {
  return new Date(new Date(iso).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => { const [y, m, day] = d.split("-").map(Number); return Date.UTC(y, m - 1, day); };
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

// Sinyal yang sama dengan kolom Tagihan di daftar: label "Lunas" dari
// readInpatientBillingStatuses (semua tagihan aktif lunas, tidak ada koreksi, tidak ada baris
// obat/biaya belum ditagih — aturan yang sama dengan close_settled_visit, migrasi 20261106530000).
// Belum pulang = discharged_at kosong (sama dengan !r.discharged_at di halaman).
export function isLunasBelumPulang(
  rec: { discharged_at?: string | null },
  billing: { label: string } | undefined,
): boolean {
  return !rec.discharged_at && billing?.label === BILLING_LUNAS_LABEL;
}

// Tanggal laporan = log_date (tanggal yang ditulis di laporan); bila kosong, tanggal WIB dari created_at.
function logDay(l: DailyLogRow): string {
  return l.log_date ? l.log_date.slice(0, 10) : wibDate(l.created_at);
}

export function laporanHarian(logs: readonly DailyLogRow[], todayWib: string): LaporanHarian {
  let count = 0;
  let lastDate: string | null = null;
  for (const l of logs) {
    const d = logDay(l);
    if (d > todayWib) continue; // tanggal masa depan bukan laporan hari ini maupun "terakhir"
    if (d === todayWib) count++;
    if (lastDate === null || d > lastDate) lastDate = d;
  }
  return {
    state: count > 0 ? "ada" : "belum",
    count,
    lastDate,
    daysSince: lastDate === null ? null : daysBetween(lastDate, todayWib),
  };
}

export function canSeeLaporanTertinggal(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function groupLogsByRecord(rows: readonly DailyLogRow[]): Map<string, DailyLogRow[]> {
  const out = new Map<string, DailyLogRow[]>();
  for (const r of rows) {
    const list = out.get(r.inpatient_record_id);
    if (list) list.push(r); else out.set(r.inpatient_record_id, [r]);
  }
  return out;
}

export type LaporanTertinggal = { id: string; label: string; lastDate: string | null; daysSince: number | null };

// Pasien aktif tanpa laporan hari ini. Belum pernah lapor di depan, lalu yang paling lama tertinggal.
export function laporanTertinggal(
  active: readonly { id: string; label: string }[],
  logsByRecord: ReadonlyMap<string, readonly DailyLogRow[]>,
  todayWib: string,
): LaporanTertinggal[] {
  return active
    .map((a) => ({ a, s: laporanHarian(logsByRecord.get(a.id) ?? [], todayWib) }))
    .filter(({ s }) => s.state === "belum")
    .map(({ a, s }) => ({ id: a.id, label: a.label, lastDate: s.lastDate, daysSince: s.daysSince }))
    .sort((x, y) => (y.daysSince ?? Infinity) - (x.daysSince ?? Infinity));
}

// Satu bacaan bertumpuk untuk semua pasien aktif (bukan satu per pasien). Gagal/terpotong = null:
// "tidak terbaca" tidak boleh tampil sebagai "belum ada laporan".
export async function readDailyLogsBatched(db: Db, recordIds: readonly string[]): Promise<Map<string, DailyLogRow[]> | null> {
  const rows: DailyLogRow[] = [];
  const ids = [...new Set(recordIds)];
  try {
    for (let chunk = 0; chunk < ids.length; chunk += ID_CHUNK) {
      const scope = ids.slice(chunk, chunk + ID_CHUNK);
      for (let start = 0; ; start += PAGE_SIZE) {
        const { data, error } = await db.from("inpatient_daily_logs")
          .select("inpatient_record_id, log_date, created_at")
          .in("inpatient_record_id", scope)
          .order("id")
          .range(start, start + PAGE_SIZE - 1);
        if (error || !data) return null;
        rows.push(...(data as unknown as DailyLogRow[]));
        if (data.length < PAGE_SIZE) break;
      }
    }
  } catch {
    return null;
  }
  return groupLogsByRecord(rows);
}
