/**
 * U07: start a read now, consume it later. The read is awaited at the exact point the
 * old sequential code awaited it, so every validation, redirect and error message keeps
 * its order, and a thrown/rejected read still rethrows there. A read abandoned by an
 * earlier redirect/notFound is ignored instead of surfacing as an unhandled rejection.
 * This does NOT inspect Supabase `{ error }` results: callers must check those
 * themselves before relying on the data.
 */
export function mulai<T>(read: PromiseLike<T>): Promise<T> {
  const p = Promise.resolve(read);
  p.catch(() => undefined);
  return p;
}

/** U07: lightweight per-phase timing so production latency can be measured from logs. */
export function catatWaktu(label: string, ref: string) {
  const start = Date.now();
  let last = start;
  const fase: string[] = [];
  return {
    tandai(nama: string) { const now = Date.now(); fase.push(`${nama}=${now - last}ms`); last = now; },
    selesai() { console.info(`[u07:${label}] ${ref} ${fase.join(" ")} total=${Date.now() - start}ms`); },
  };
}
