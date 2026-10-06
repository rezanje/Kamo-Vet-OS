type Row = Record<string, unknown>;
type Failure = { code?: string; message: string };

/** Fictional Supabase query fixture: pages, counts, persisted log status and uniqueness. */
export function waDatabase(tables: Record<string, Row[]> = {}, failures: {
  read?: Record<string, Failure>;
  page?: { table: string; from: number; error: Failure };
  insert?: Failure;
  update?: Failure;
  hideUpdatedRow?: boolean;
  count?: Record<string, number | null>;
} = {}) {
  const logs: Row[] = [];
  const reads: { table: string; from: number; to?: number }[] = [];
  return {
    logs, reads,
    from(table: string) {
      let from = 0, to: number | undefined;
      let inserted: Row | undefined, update: Row | undefined;
      let id: unknown, counted = false, ordered = false;
      const result = () => {
        if (inserted) {
          if (failures.insert) return { data: null, error: failures.insert, count: null };
          if (logs.some((row) => row.idempotency_key === inserted!.idempotency_key)) {
            return { data: null, error: { code: "23505", message: "duplicate event" }, count: null };
          }
          const log = { ...inserted, id: `log-${logs.length + 1}`, status: "queued" };
          logs.push(log);
          return { data: [log], error: null, count: null };
        }
        if (update) {
          if (failures.update) return { data: null, error: failures.update, count: null };
          const log = logs.find((row) => row.id === id);
          if (log) Object.assign(log, update);
          return { data: log && !failures.hideUpdatedRow ? [log] : [], error: null, count: null };
        }
        reads.push({ table, from, to });
        const error = failures.read?.[table] ?? (failures.page?.table === table && failures.page.from === from ? failures.page.error : null);
        if (error) return { data: null, error, count: null };
        const source = table === "whatsapp_message_log" ? logs : tables[table] ?? [];
        const rows = ordered ? [...source].sort((a, b) => String(a.id).localeCompare(String(b.id))) : source;
        const count = counted ? (failures.count && table in failures.count ? failures.count[table] : rows.length) : null;
        // The ordinary unpaged response follows Supabase's default row cap.
        return { data: rows.slice(from, to === undefined ? 1000 : to + 1), error: null, count };
      };
      const query = {
        select: (_fields?: string, options?: { count?: string }) => { counted = options?.count === "exact"; return query; },
        eq: (field: string, value: unknown) => { if (field === "id") id = value; return query; },
        order: () => { ordered = true; return query; },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        insert: (value: Row) => { inserted = value; return query; },
        update: (value: Row) => { update = value; return query; },
        maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  };
}
