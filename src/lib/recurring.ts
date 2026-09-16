// Jurnal Berulang — catch-up bulanan (pola penyusutan): posting semua bulan tertinggal.
// Idempotent via last_posted (YYYY-MM). Dipanggil lazy dari halaman Jurnal Umum.

import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type RJLine = { code: string; debit: number; credit: number };
type RJ = {
  id: string; nama: string; deskripsi: string | null; day_of_month: number;
  branch_id: string | null; lines: RJLine[]; is_active: boolean; last_posted: string | null;
};

export type RecurringFrequency = "daily" | "monthly";

function addOccurrence(startDate: string, frequency: RecurringFrequency, offset: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  if (frequency === "daily") {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return date.toISOString().slice(0, 10);
  }
  const targetMonth = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function dueRecurringOccurrences(
  startDate: string,
  frequency: RecurringFrequency,
  runCount: number,
  repeatCount: number,
  today: string,
  limit = 31,
): string[] {
  const due: string[] = [];
  for (let offset = runCount; offset < repeatCount && due.length < limit; offset++) {
    const date = addOccurrence(startDate, frequency, offset);
    if (date > today) break;
    due.push(date);
  }
  return due;
}

const MAX_CATCHUP = 12; // ponytail: batas mundur 12 bulan

// Daftar periode YYYY-MM dari (last_posted, bulan-berjalan]. PURE — dites.
//
// dayOfMonth = tanggal jatuhnya jurnal. Bulan BERJALAN hanya ikut kalau tanggal itu
// sudah lewat; kalau tidak, jurnal sewa tanggal 25 akan diposting bertanggal 25 padahal
// hari ini baru tanggal 10 — beban masa depan masuk ke laporan bulan ini.
export function periodeTertinggal(lastPosted: string | null, now: Date, dayOfMonth = 1): string[] {
  const bulanIni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const batas = now.getDate() >= dayOfMonth ? bulanIni : bulanSebelum(bulanIni);

  const out: string[] = [];
  const cursor = lastPosted
    ? new Date(Number(lastPosted.slice(0, 4)), Number(lastPosted.slice(5, 7)), 1) // bulan setelah last_posted
    : new Date(now.getFullYear(), now.getMonth(), 1);                             // belum pernah: bulan ini saja
  while (out.length < MAX_CATCHUP) {
    const p = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    if (p > batas) break;
    out.push(p);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function bulanSebelum(periode: string): string {
  const y = Number(periode.slice(0, 4));
  const m = Number(periode.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function postRecurringCatchUp(supabase: AnyClient): Promise<{ nama: string; periode: string }[]> {
  const { data } = await supabase.from("recurring_journals").select("*").eq("status", "active");
  const posted: { nama: string; periode: string }[] = [];
  const today = hariIniWIB();

  for (const rj of (data ?? []) as (RJ & { frequency: RecurringFrequency; start_date: string; run_count: number; repeat_count: number })[]) {
    for (const tanggal of dueRecurringOccurrences(rj.start_date, rj.frequency, rj.run_count, rj.repeat_count, today)) {
      const { error } = await supabase.rpc("run_recurring_occurrence", { p_schedule_id: rj.id, p_run_date: tanggal });
      if (error) break;
      posted.push({ nama: rj.nama, periode: tanggal });
    }
  }
  return posted;
}
