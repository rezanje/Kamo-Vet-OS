import { readReportRows } from "./hpp-reports-server";

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
