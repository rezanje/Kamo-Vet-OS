import { readReportRows } from "./hpp-reports-server";

type Result<T> = { data: T[] | null; error: { message: string } | null; count: number | null };
type Query<T> = { order(column: string): { range(from: number, to: number): PromiseLike<Result<T>> } };

/** Queries must select id and count: exact. Reuse the complete HPP reader with exact counts and stable identities. */
export async function completeReportQuery<T>(query: Query<T>): Promise<{ data: T[]; error: null }> {
  const ordered = query.order("id");
  return { data: await readReportRows<T>((from, to) => ordered.range(from, to)), error: null };
}
