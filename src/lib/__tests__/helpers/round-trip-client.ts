import { appendFileSync } from "node:fs";

// Klinik-A (loading): a fake Supabase client that counts SEQUENTIAL ROUND TRIPS.
//
// Every query/RPC/auth.getUser that starts while the code is still running
// synchronously or in microtasks joins the current "wave". A wave is answered only
// after the microtask queue is empty (setImmediate), so a read that the code issues
// only AFTER awaiting another read lands in the next wave. The highest wave number is
// therefore the number of database round trips the server has to wait for one after
// another (the waterfall depth), independent of machine speed.
//
// This is evidence about request ORDER on a mocked client, not a production timing.

export type Call = {
  kind: "from" | "rpc" | "auth";
  name: string;
  ops: [string, unknown[]][];
  single: boolean;
  wave: number;
};
export type Reply = { data?: unknown; error?: unknown; count?: number | null };
export type Responder = (call: Call) => Reply | undefined;

const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([name, values]) => name === op && args.every((arg, i) => values[i] === arg));
export const filterOf = (call: Call, op: string, column: string) =>
  call.ops.find(([name, values]) => name === op && values[0] === column)?.[1][1];
export { has as hasOp };

/** Answer a `.range(from, to)` page of a fixture list with an exact count (readCompleteList contract). */
export function paged(call: Call, rows: { id: string }[]): Reply {
  const range = call.ops.find(([op]) => op === "range")?.[1] as [number, number] | undefined;
  return { data: range ? rows.slice(range[0], range[1] + 1) : rows, count: rows.length };
}

/** Fictional clinic catalogue sized like production (±3.600 active SKUs). */
export function fictionalCatalogue(size = 3600, prefix = "item") {
  return Array.from({ length: size }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(5, "0")}`, code: `K${i}`, upc: null, name: `Barang fiksi ${i}`, unit: "pcs",
    sell_price: 1000 + i, is_compound_material: false, item_type: i % 5 === 0 ? "Jasa" : "Persediaan",
    tindakan_kategori: null, category_id: null,
  }));
}

export function roundTripClient(respond: Responder, options: { userId?: string } = {}) {
  const calls: Call[] = [];
  let pending: { call: Call; settle: (reply: Reply) => void }[] = [];
  let wave = 0;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (!pending.length) return;
    wave++;
    const batch = pending;
    pending = [];
    for (const { call, settle } of batch) {
      call.wave = wave;
      const reply = respond(call) ?? {};
      const rows = Array.isArray(reply.data) ? reply.data : null;
      const fallback = call.single ? null : [];
      const data = "data" in reply ? reply.data : fallback;
      settle({
        data: call.single && Array.isArray(data) ? data[0] ?? null : data,
        error: reply.error ?? null,
        count: reply.count !== undefined ? reply.count : rows ? rows.length : Array.isArray(data) ? data.length : 0,
      });
    }
  };
  const enqueue = (call: Call) => new Promise<Reply>((settle) => {
    calls.push(call);
    pending.push({ call, settle });
    if (!scheduled) { scheduled = true; setImmediate(flush); }
  });

  const builder = (kind: Call["kind"], name: string, firstArgs: unknown[] = []) => {
    const call: Call = { kind, name, ops: kind === "rpc" ? [["rpc", firstArgs]] : [], single: false, wave: 0 };
    let started: Promise<Reply> | null = null;
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (ok: (value: Reply) => unknown, fail?: (reason: unknown) => unknown) => {
            started ??= enqueue(call);
            return started.then(ok, fail);
          };
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => { call.single = true; call.ops.push([String(prop), []]); return proxy; };
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return proxy; };
      },
    });
    return proxy;
  };

  const client = {
    from: (table: string) => builder("from", table),
    rpc: (fn: string, args?: unknown) => builder("rpc", fn, [args]),
    auth: {
      getUser: () => enqueue({ kind: "auth", name: "auth.getUser", ops: [], single: true, wave: 0 })
        .then(() => ({ data: { user: options.userId === undefined ? { id: "user-a" } : options.userId ? { id: options.userId } : null }, error: null })),
      // Local JWT verification with cached keys: not a database round trip.
      getClaims: async () => ({ data: { claims: { sub: options.userId ?? "user-a" } }, error: null }),
    },
  };

  return {
    client,
    calls,
    /** Number of sequential round-trip stages observed so far. */
    depth: () => calls.reduce((max, call) => Math.max(max, call.wave), 0),
    /** Per-wave list of reads, for the evidence report. */
    waves: () => {
      const out: string[][] = [];
      for (const call of calls) (out[call.wave - 1] ??= []).push(call.kind === "rpc" ? `rpc:${call.name}` : call.name);
      return out;
    },
    reset: () => { calls.length = 0; wave = 0; },
  };
}

/** Evidence only: when KLINIK_A_REPORT names a file, append this route's waterfall to it. */
export function reportWaterfall(label: string, rt: ReturnType<typeof roundTripClient>) {
  const file = process.env.KLINIK_A_REPORT;
  if (!file) return;
  const lines = rt.waves().map((wave, i) => {
    const counts = new Map<string, number>();
    for (const name of wave) counts.set(name, (counts.get(name) ?? 0) + 1);
    return `  wave ${i + 1}: ${[...counts].map(([name, n]) => n > 1 ? `${name}×${n}` : name).join(", ")}`;
  });
  appendFileSync(file, `[klinik-a] ${label} depth=${rt.depth()} reads=${rt.calls.length}\n${lines.join("\n")}\n`);
}
