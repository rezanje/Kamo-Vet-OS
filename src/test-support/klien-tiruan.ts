// Pembantu uji: klien Supabase tiruan dalam memori (select/eq/is/gte/lte/in/order/range + count exact) yang mencatat tiap statement.
type Baris = Record<string, unknown>;
export type CatatanStatement = { table: string; select: string; filters: string[]; range: [number, number] | null };

export type RpcTiruan = (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };

/** `rpcs` (opsional) menambahkan `client.rpc`; tanpa itu klien tidak punya rpc (jalur lama laporan dipakai). */
export function bikinKlienTiruan(tables: Record<string, Baris[]>, rpcs?: Record<string, RpcTiruan>) {
  const catatan: CatatanStatement[] = [];
  const catatanRpc: { nama: string; args: Record<string, unknown> }[] = [];
  const client = {
    ...(rpcs ? { rpc: async (nama: string, args: Record<string, unknown>) => {
      catatanRpc.push({ nama, args });
      const fn = rpcs[nama];
      return fn ? fn(args) : { data: null, error: { message: `Could not find the function public.${nama} in the schema cache`, code: "PGRST202" } };
    } } : {}),
    auth: { getUser: async () => ({ data: { user: { id: "pengguna" } }, error: null }) },
    from(table: string) {
      const filters: ((b: Baris) => boolean)[] = [];
      const teks: string[] = [];
      let select = ""; let urut = "id"; let range: [number, number] | null = null;
      const nilai = (baris: Baris, kolom: string) => baris[kolom];
      const q: Record<string, unknown> = {
        select: (kolom: string) => { select = kolom; return q; },
        eq: (kolom: string, v: unknown) => { teks.push(`${kolom}=${String(v)}`); filters.push(b => nilai(b, kolom) === v); return q; },
        is: (kolom: string, v: unknown) => { teks.push(`${kolom} is ${String(v)}`); filters.push(b => (nilai(b, kolom) ?? null) === v); return q; },
        gte: (kolom: string, v: string) => { teks.push(`${kolom}>=${v}`); filters.push(b => String(nilai(b, kolom)) >= v); return q; },
        lte: (kolom: string, v: string) => { teks.push(`${kolom}<=${v}`); filters.push(b => String(nilai(b, kolom)) <= v); return q; },
        in: (kolom: string, v: unknown[]) => { teks.push(`${kolom} in (${v.length})`); filters.push(b => v.includes(nilai(b, kolom))); return q; },
        order: (kolom: string) => { urut = kolom; return q; },
        range: (a: number, z: number) => { range = [a, z]; return run(); },
      };
      const run = async () => {
        catatan.push({ table, select, filters: teks, range });
        const cocok = (tables[table] ?? []).filter(b => filters.every(f => f(b)))
          .sort((a, b) => String(a[urut]) < String(b[urut]) ? -1 : String(a[urut]) > String(b[urut]) ? 1 : 0);
        const data = range ? cocok.slice(range[0], range[1] + 1) : cocok;
        return { data, count: cocok.length, error: null };
      };
      q.then = (resolve: (v: unknown) => unknown) => run().then(resolve);
      return q;
    },
  };
  return { client, catatan, catatanRpc };
}
