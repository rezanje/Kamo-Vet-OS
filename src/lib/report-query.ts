import { readReportRows } from "./hpp-reports-server";
import { BATAS_BACA_LAPORAN } from "./konkuren-batas";

type Result<T> = { data: T[] | null; error: { message: string; code?: string } | null; count: number | null };
type Query<T> = { order(column: string): { range(from: number, to: number): PromiseLike<Result<T>> } };

/** Queries must select id and count: exact. Reuse the complete HPP reader with exact counts and stable identities. */
export async function completeReportQuery<T>(query: Query<T>): Promise<{ data: T[]; error: null }> {
  const ordered = query.order("id");
  return { data: await readReportRows<T>(async (from, to) => {
    const result = await ordered.range(from, to);
    // Same message the reader would throw, but the PostgREST code survives, so callers
    // can still tell a missing table/column (42P01, 42703, PGRST204) from a real failure.
    if (result.error) throw Object.assign(new Error(`Data laporan gagal dibaca: ${result.error.message}`), { code: result.error.code });
    return result;
  }), error: null };
}

/**
 * Seperti completeReportQuery, tetapi `buat` membuat query BARU untuk tiap halaman: halaman setelah yang pertama
 * dibaca bersamaan (paling banyak BATAS_BACA_LAPORAN). Pembangun query PostgREST berubah saat `.range()` dipanggil,
 * jadi satu pembangun tidak boleh dipakai bersamaan; hitungan pasti, panjang halaman, dan identitas baris diperiksa sama.
 */
export async function completeReportQueryParalel<T>(buat: () => { order(column: string): { range(from: number, to: number): PromiseLike<Result<T>> } }): Promise<{ data: T[]; error: null }> {
  return { data: await readReportRows<T>(async (from, to) => {
    const result = await buat().order("id").range(from, to);
    if (result.error) throw Object.assign(new Error(`Data laporan gagal dibaca: ${result.error.message}`), { code: result.error.code });
    return result;
  }, undefined, { paralel: BATAS_BACA_LAPORAN }), error: null };
}
