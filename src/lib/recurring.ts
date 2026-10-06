// Jurnal Berulang — catch-up bulanan (pola penyusutan): posting semua bulan tertinggal.
// Header, baris, dan last_posted disimpan atomik oleh RPC per bulan.

import { tanggalWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type RJ = {
  id: string; nama: string; day_of_month: number; last_posted: string | null;
};

/** Empty preserves legacy unlimited schedules; PostgreSQL int bounds apply. */
export function parseRecurringOccurrences(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const count = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(count) || count < 1 || count > 2147483647) {
    throw new Error("Jumlah pengulangan harus bilangan bulat positif (minimal 1).");
  }
  return count;
}

const MAX_CATCHUP = 12; // ponytail: batas mundur 12 bulan

// Daftar periode YYYY-MM dari (last_posted, bulan-berjalan]. PURE — dites.
//
// dayOfMonth = tanggal jatuhnya jurnal. Bulan BERJALAN hanya ikut kalau tanggal itu
// sudah lewat; kalau tidak, jurnal sewa tanggal 25 akan diposting bertanggal 25 padahal
// hari ini baru tanggal 10 — beban masa depan masuk ke laporan bulan ini.
export function periodeTertinggal(lastPosted: string | null, now: Date, dayOfMonth = 1): string[] {
  const today = tanggalWIB(now.toISOString());
  const bulanIni = today.slice(0, 7);
  const batas = Number(today.slice(8)) >= dayOfMonth ? bulanIni : bulanSebelum(bulanIni);

  const out: string[] = [];
  const cursor = lastPosted
    ? new Date(Date.UTC(Number(lastPosted.slice(0, 4)), Number(lastPosted.slice(5, 7)), 1))
    : new Date(`${bulanIni}-01T00:00:00Z`);
  while (out.length < MAX_CATCHUP) {
    const p = cursor.toISOString().slice(0, 7);
    if (p > batas) break;
    out.push(p);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** Resolve full identities and only unambiguous legacy UUID prefixes. */
export function idRecurringDariRef(ref: string, ids: string[]): string | null {
  const full = /^([0-9a-f-]{36}):\d{4}-(0[1-9]|1[0-2])$/.exec(ref);
  if (full) return ids.includes(full[1]) ? full[1] : null;
  const legacy = /^([0-9a-f]{8})-\d{4}-(0[1-9]|1[0-2])$/.exec(ref);
  if (!legacy) return null;
  const matches = ids.filter((id) => id.startsWith(legacy[1]));
  return matches.length === 1 ? matches[0] : null;
}

export type JurnalRecurringHistory = {
  no_jurnal: string | null; tanggal: string; source_ref: string | null; branch_id?: string | null;
  journal_lines: { debit: number; credit: number }[];
};

// Match PostgreSQL numeric sums without rounding away sub-cent imbalances.
function balancedDecimalLines(lines: JurnalRecurringHistory["journal_lines"]): boolean {
  const parts = lines.flatMap((line) => [line.debit, line.credit]).map((value) => {
    const [mantissa, exponent = "0"] = String(Number(value)).toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    return { coefficient: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
  });
  const scale = parts.reduce((max, part) => Math.max(max, part.scale), 0);
  return parts.reduce((sum, part, index) => sum + (index % 2 ? BigInt(-1) : BigInt(1))
    * part.coefficient * BigInt(10) ** BigInt(scale - part.scale), BigInt(0)) === BigInt(0);
}

/** Only complete journals contribute to the displayed successful run count. */
export function riwayatJurnalRecurring(
  journals: JurnalRecurringHistory[], ids: string[],
  schedules: { id: string; day_of_month: number; branch_id: string | null }[] = [],
) {
  const scheduleById = new Map(schedules.map((row) => [row.id, row]));
  const perluDitinjau = new Set<string>();
  const riwayat = new Map<string, { no_jurnal: string; tanggal: string; periode: string; nilai: number }[]>();
  let bermasalah = 0;
  for (const journal of journals) {
    const ref = journal.source_ref ?? "";
    const id = idRecurringDariRef(ref, ids);
    const schedule = id ? scheduleById.get(id) : undefined;
    const periode = ref.slice(-7);
    const dateMatches = journal.tanggal.slice(0, 7) === periode
      && (!schedule || (Number(journal.tanggal.slice(8, 10)) === schedule.day_of_month
        && (journal.branch_id ?? null) === schedule.branch_id));
    const markReview = () => {
      if (id) perluDitinjau.add(id);
      else if (/^[0-9a-f]{8}-/.test(ref)) {
        ids.filter((candidate) => candidate.startsWith(ref.slice(0, 8)))
          .forEach((candidate) => perluDitinjau.add(candidate));
      }
    };
    const lines = journal.journal_lines ?? [];
    const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
    if (!id || !dateMatches || !journal.no_jurnal?.trim() || lines.length < 2 || !Number.isFinite(debit)
      || !Number.isFinite(credit) || debit <= 0 || !balancedDecimalLines(lines)
      || lines.some((line) => Number(line.debit) < 0 || Number(line.credit) < 0
        || (Number(line.debit) > 0 && Number(line.credit) > 0))) {
      bermasalah++;
      markReview();
      continue;
    }
    const history = riwayat.get(id) ?? [];
    if (history.some((row) => row.periode === ref.slice(-7))) {
      bermasalah++;
      markReview();
      continue;
    }
    history.push({ no_jurnal: journal.no_jurnal, tanggal: journal.tanggal, periode: ref.slice(-7), nilai: debit });
    riwayat.set(id, history);
  }
  return { riwayat, bermasalah, perluDitinjau };
}

function bulanSebelum(periode: string): string {
  const y = Number(periode.slice(0, 4));
  const m = Number(periode.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function postRecurringCatchUp(supabase: AnyClient): Promise<{ nama: string; periode: string }[]> {
  const { data, error } = await supabase.from("recurring_journals")
    .select("id, nama, day_of_month, last_posted").eq("is_active", true);
  if (error) throw new Error(`Jurnal berulang tidak dapat diperiksa: ${error.message}`);
  const posted: { nama: string; periode: string }[] = [];
  const now = new Date();

  for (const rj of (data ?? []) as RJ[]) {
    const periods = periodeTertinggal(rj.last_posted, now, rj.day_of_month);
    // When nothing is due, verify the last marker too: a historical empty header
    // must surface for review instead of being labelled a successful posting.
    if (periods.length === 0 && rj.last_posted) periods.push(rj.last_posted);
    for (const periode of periods) {
      const { data: result, error: postingError } = await supabase.rpc("post_recurring_journal_period", {
        p_recurring_id: rj.id, p_periode: periode,
      });
      // Definitions remain globally readable in the existing RLS policy, but
      // branch-scoped users must only post journals for their accessible branches.
      if (postingError?.code === "42501" && postingError.message?.startsWith("RECURRING_SCOPE:")) break;
      if (postingError?.code === "RCL01" && postingError.message?.startsWith("RECURRING_LIMIT:")) break;
      const journal = Array.isArray(result) ? result[0] : result;
      if (postingError || !journal?.entry_id) {
        throw new Error(`Jurnal berulang "${rj.nama}" (${periode}) gagal: ${postingError?.message ?? "hasil posting tidak diterima"}`);
      }
      if (journal.posted) posted.push({ nama: rj.nama, periode });
    }
  }
  return posted;
}
