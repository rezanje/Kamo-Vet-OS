import type { SupabaseClient } from "@supabase/supabase-js";
export type Row = Record<string, unknown>;
export function clientFixture(options: { role?: string; active?: boolean; modules?: Row[]; tables?: Record<string, Row[]>; errorTable?: string; deniedBranch?: string; anonymous?: boolean;
  serverCap?: number; missingCountTable?: string; beforeRead?: (table: string, occurrence: number, tables: Record<string, Row[]>) => void } = {}) {
  const records: { table: string; method: string; args: unknown[] }[] = [];
  const tables: Record<string, Row[]> = {
    profiles: [{ id: "u", role: options.role ?? "OWNER", is_active: options.active ?? true }], role_modules: options.modules ?? [],
    branches: [{ id: "b1", name: "Satu" }, { id: "b2", name: "Dua" }],
    warehouses: [{ id: "w1", branch_id: "b1", name: "VET lama", code: "V", type: "VET", is_active: false }],
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 3 }],
    stock_layers: [{ id: "l", warehouse_id: "w1", item_id: "i", qty_left: 3, unit_cost: 50 }],
    items: [{ id: "i", code: "SKU", name: "Obat lama", unit: "ml", is_active: false }],
    ...options.tables,
  };
  const nested = (row: Row, key: string): unknown => key.split(".").reduce<unknown>((value, part) => (value as Row | null)?.[part], row);
  const reads = new Map<string,number>();
  const client = {
    auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: "u" } }, error: null }) },
    from: (table: string) => {
      const occurrence = (reads.get(table) ?? 0) + 1;
      reads.set(table,occurrence);
      options.beforeRead?.(table,occurrence,tables);
      let data = [...(tables[table] ?? [])]; let single = false;
      let countRequested = false;
      let range: [number,number] | undefined;
      const ordering: string[] = [];
      const query: Record<string, unknown> = {};
      for (const method of ["select","eq","in","gt","gte","lte","is","not","order","range","maybeSingle"]) {
        query[method] = (...args: unknown[]) => {
          records.push({ table, method, args });
          const key = String(args[0]);
          if (method === "select") countRequested = (args[1] as { count?: string } | undefined)?.count === "exact";
          if (method === "eq" || method === "is") data = data.filter(row => nested(row,key) === args[1]);
          if (method === "in") data = data.filter(row => (args[1] as unknown[]).includes(nested(row,key)));
          if (method === "not") data = data.filter(row => nested(row,key) !== args[2]);
          if (method === "gt") data = data.filter(row => Number(nested(row,key)) > Number(args[1]));
          if (method === "gte") data = data.filter(row => String(nested(row,key)) >= String(args[1]));
          if (method === "lte") data = data.filter(row => String(nested(row,key)) <= String(args[1]));
          if (method === "order") ordering.push(key);
          if (method === "range") range = [Number(args[0]),Number(args[1])];
          if (method === "maybeSingle") single = true;
          return query;
        };
      }
      query.then = (resolve: (value: unknown) => unknown) => {
        data.sort((a,b) => {
          for (const key of ordering) {
            const x = nested(a,key), y = nested(b,key);
            const compared = x === y ? 0 : typeof x === "number" && typeof y === "number" ? x-y : String(x) < String(y) ? -1 : 1;
            if (compared) return compared;
          }
          return 0;
        });
        const count = countRequested && options.missingCountTable !== table ? data.length : null;
        const paged = range ? data.slice(range[0],range[1]+1) : data;
        const capped = options.serverCap ? paged.slice(0,options.serverCap) : paged;
        return Promise.resolve({ data: single ? capped[0] ?? null : capped, count,
          error: options.errorTable === table ? { message: "read failed" } : null }).then(resolve);
      };
      return query;
    },
    rpc: async (_name: string, args: { b: string }) => ({ data: args.b !== options.deniedBranch, error: null }),
  } as unknown as SupabaseClient;
  return { client, records };
}
