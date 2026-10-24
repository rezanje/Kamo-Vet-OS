export type RecurringSourceOccurrence = {
  schedule_id: string;
  period: string;
  journal_id: string;
  receipt: unknown;
};

export type RecurringSourceWindowPeriod = {
  period: string;
  state: "pending" | "executed" | "review";
  journal_id?: string;
};

const MAX_MONTH_INDEX = 9999 * 12 - 1;
const WINDOW_SIZE = 24;

export function recurringSourcePeriodIndex(period: string): number | null {
  if (!/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  return (year - 1) * 12 + Number(monthText) - 1;
}

function periodFromIndex(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > MAX_MONTH_INDEX) return null;
  return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

function currentWibParts(now: Date): { period: string; day: number } {
  if (!Number.isFinite(now.getTime())) throw new Error("Tanggal sekarang tidak valid.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { period: `${get("year").padStart(4, "0")}-${get("month")}`, day: Number(get("day")) };
}

export function currentRecurringSourcePeriod(now = new Date()): string {
  return currentWibParts(now).period;
}

export function firstRecurringSourcePeriod(sourceDate: string, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
  const sourcePeriod = recurringSourcePeriodIndex(sourceDate.slice(0, 7));
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const sourceDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!match || sourcePeriod === null || !day || day > sourceDay) throw new Error("Tanggal sumber tidak valid.");
  const current = currentWibParts(now).period;
  const currentIndex = recurringSourcePeriodIndex(current);
  if (currentIndex === null) throw new Error("Bulan WIB tidak valid.");
  const first = Math.max(sourcePeriod + 1, currentIndex);
  const result = periodFromIndex(first);
  if (!result) throw new Error("Bulan pertama berada di luar rentang kalender.");
  return result;
}

export function recurringSourceBounds(
  firstPeriod: string,
  count: number | null,
  endPeriod: string | null,
): { count: number; last_period: string } {
  const first = recurringSourcePeriodIndex(firstPeriod);
  const end = endPeriod === null ? null : recurringSourcePeriodIndex(endPeriod);
  if (first === null || (endPeriod !== null && end === null)) throw new Error("Bulan periode tidak valid.");
  if (count === null && end === null) throw new Error("Pilih jumlah bulan atau bulan terakhir.");
  if (count !== null && (!Number.isSafeInteger(count) || count < 1)) throw new Error("Jumlah bulan harus bilangan bulat positif.");
  if (count !== null && first + count - 1 > MAX_MONTH_INDEX) throw new Error("Jadwal melewati rentang kalender.");
  if (end !== null && end < first) throw new Error("Bulan terakhir harus sama atau setelah bulan pertama.");
  const derivedCount = count ?? (end as number) - first + 1;
  const lastIndex = first + derivedCount - 1;
  if (end !== null && lastIndex !== end) throw new Error("Jumlah bulan dan bulan terakhir tidak cocok.");
  const last = periodFromIndex(lastIndex);
  if (!last) throw new Error("Jadwal melewati rentang kalender.");
  return { count: derivedCount, last_period: last };
}

export function recurringSourceDue(period: string, day: number, now = new Date()): boolean {
  const requestedIndex = recurringSourcePeriodIndex(period);
  const current = currentWibParts(now);
  const currentIndex = recurringSourcePeriodIndex(current.period);
  if (requestedIndex === null || currentIndex === null || !Number.isInteger(day) || day < 1 || day > 28) return false;
  return requestedIndex < currentIndex || (requestedIndex === currentIndex && day <= current.day);
}

export function recurringSourceProgress(
  config: { first_period: string; count: number },
  lastPosted: string | null,
): number | null {
  const first = recurringSourcePeriodIndex(config.first_period);
  if (first === null || !Number.isSafeInteger(config.count) || config.count < 1
    || first + config.count - 1 > MAX_MONTH_INDEX) return null;
  if (!lastPosted) return 0;
  const last = recurringSourcePeriodIndex(lastPosted);
  if (last === null) return null;
  const count = last - first + 1;
  return count < 1 || count > config.count ? null : count;
}

export function recurringSourceWindow(
  config: { first_period: string; count: number },
  occurrences: RecurringSourceOccurrence[],
  page = 0,
): RecurringSourceWindowPeriod[] {
  const first = recurringSourcePeriodIndex(config.first_period);
  if (first === null || !Number.isSafeInteger(config.count) || config.count < 1
    || first + config.count - 1 > MAX_MONTH_INDEX || !Number.isInteger(page) || page < 0) return [];
  const start = first + page * WINDOW_SIZE;
  if (!Number.isSafeInteger(start) || start > first + config.count - 1) return [];
  const byPeriod = new Map<string, RecurringSourceOccurrence[]>();
  for (const occurrence of occurrences) {
    const rows = byPeriod.get(occurrence.period) ?? [];
    rows.push(occurrence);
    byPeriod.set(occurrence.period, rows);
  }
  const end = Math.min(start + WINDOW_SIZE, first + config.count);
  const periods: RecurringSourceWindowPeriod[] = [];
  for (let index = start; index < end; index++) {
    const period = periodFromIndex(index);
    if (!period) break;
    const rows = byPeriod.get(period) ?? [];
    if (rows.length === 0) { periods.push({ period, state: "pending" }); continue; }
    const [row] = rows;
    const receipt = row.receipt && typeof row.receipt === "object" ? row.receipt as Record<string, unknown> : {};
    if (rows.length === 1 && row.schedule_id && row.journal_id && receipt.period === period
      && receipt.entry_id === row.journal_id && receipt.schedule_id === row.schedule_id
      && typeof receipt.no_jurnal === "string" && !!receipt.no_jurnal.trim() && receipt.posted === true) {
      periods.push({ period, state: "executed", journal_id: row.journal_id });
    } else periods.push({ period, state: "review" });
  }
  return periods;
}
