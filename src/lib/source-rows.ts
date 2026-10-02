// Complete stable source reads for financial calculations. A failure is never zero.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
const PAGE = 500,
  MAX = 200000;
export async function sourceRows<T>(
  db: Client,
  table: string,
  columns: string,
  filter: (q: Client) => Client = (q) => q,
): Promise<T[]> {
  const out: T[] = [];
  let expected: number | null = null;
  const seen = new Set<string>();
  for (let offset = 0; offset <= MAX; offset += PAGE) {
    const { data, error, count } = await filter(
      db.from(table).select(columns, { count: "exact" }),
    )
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX
    )
      throw new Error(`Data gaji/komisi gagal dibaca lengkap: ${table}`);
    if (expected !== null && expected !== count)
      throw new Error(`Data gaji/komisi berubah saat dibaca: ${table}`);
    expected = count;
    for (const row of data) {
      const id = String(row.id ?? "");
      if (!id || seen.has(id))
        throw new Error(`Data gaji/komisi tidak lengkap/berulang: ${table}`);
      seen.add(id);
      out.push(row as T);
    }
    if (out.length === expected) return out;
    if (data.length !== PAGE || out.length > count)
      throw new Error(`Data gaji/komisi terpotong: ${table}`);
  }
  throw new Error(`Data gaji/komisi melebihi batas: ${table}`);
}
export async function sourceByIds<T>(
  db: Client,
  table: string,
  columns: string,
  key: string,
  ids: string[],
): Promise<T[]> {
  const sorted = [...new Set(ids)].sort(),
    out: T[] = [];
  for (let i = 0; i < sorted.length; i += 100) {
    out.push(
      ...(await sourceRows<T>(db, table, columns, (q) =>
        q.in(key, sorted.slice(i, i + 100)),
      )),
    );
    if (out.length > MAX)
      throw new Error(`Data gaji/komisi melebihi batas: ${table}`);
  }
  return out;
}
