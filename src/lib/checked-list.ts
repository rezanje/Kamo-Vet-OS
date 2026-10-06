import { infoHalaman } from "./pagination";

type Identified = { id: string };
type Result<T> = { data: T[] | null; count?: number | null; error: unknown };
type Fetch<T> = (from: number, to: number) => PromiseLike<Result<T>>;
const SOURCE_PAGE_SIZE = 500;
const SOURCE_CAP = 10_000;
export const TABLE_PAGE_SIZE = 50;
export class ListLoadError extends Error {}

async function fetchResult<T>(fetch: Fetch<T>, from: number, to: number, label: string) {
  try { return await fetch(from, to); }
  catch { throw new ListLoadError(`${label} belum dapat dimuat lengkap. Coba muat ulang.`); }
}

function checked<T extends Identified>(result: Result<T>, label: string, from: number, size: number, knownCount?: number) {
  if (result.error || !Array.isArray(result.data)) throw new ListLoadError(`${label} belum dapat dimuat lengkap. Coba muat ulang.`);
  const count = result.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new ListLoadError(`${label}: jumlah data tidak dapat diverifikasi. Coba muat ulang.`);
  if (knownCount !== undefined && count !== knownCount) throw new ListLoadError(`${label}: data berubah saat dimuat. Coba muat ulang.`);
  const expected = Math.min(size, Math.max(0, count - from));
  if (result.data.length !== expected) throw new ListLoadError(`${label} belum dimuat lengkap. Coba muat ulang.`);
  const ids = new Set<string>();
  for (const row of result.data) {
    if (!row.id || ids.has(row.id)) throw new ListLoadError(`${label}: ID data kosong atau duplikat. Coba muat ulang.`);
    ids.add(row.id);
  }
  return { rows: result.data, count };
}

/** Stable caller ordering must end in a unique id; never return partial totals. */
export async function readCompleteList<T extends Identified>(fetch: Fetch<T>, label: string): Promise<T[]> {
  let count: number | undefined;
  const rows: T[] = [];
  const ids = new Set<string>();
  for (let from = 0; count === undefined || from < count; from += SOURCE_PAGE_SIZE) {
    const page = checked(await fetchResult(fetch, from, from + SOURCE_PAGE_SIZE - 1, label), label, from, SOURCE_PAGE_SIZE, count);
    count = page.count;
    if (count > SOURCE_CAP) throw new ListLoadError(`${label} melebihi batas 10.000 baris dan belum dapat ditampilkan lengkap.`);
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new ListLoadError(`${label}: ID data duplikat saat dimuat. Coba muat ulang.`);
      ids.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** First page establishes count; requested page is then verified against it. */
export async function readListPage<T extends Identified>(fetch: Fetch<T>, label: string, rawPage: unknown) {
  const first = checked(await fetchResult(fetch, 0, TABLE_PAGE_SIZE - 1, label), label, 0, TABLE_PAGE_SIZE);
  const pageInfo = infoHalaman(rawPage, first.count, TABLE_PAGE_SIZE);
  const page = pageInfo.page === 1 ? first : checked(await fetchResult(fetch, pageInfo.from, pageInfo.to, label), label, pageInfo.from, TABLE_PAGE_SIZE, first.count);
  return { rows: page.rows, count: first.count, pageInfo };
}
