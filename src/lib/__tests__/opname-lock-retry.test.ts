import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ stock: -5, saved: null as null | Record<string, unknown>, failure: '', status: 'Terbuka', writes: 0 }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(url); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from(table: string) {
    let payload: Record<string, unknown> | undefined, ignoreDuplicates = false;
    const q = {
      select: () => q, eq: () => q, maybeSingle: () => q,
      upsert(value: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) { payload = value; ignoreDuplicates = !!options?.ignoreDuplicates; return q; },
      then(resolve: (r: unknown) => unknown) {
        if (payload && s.failure !== table) { s.writes++; if (!s.saved || !ignoreDuplicates) s.saved = payload; }
        return Promise.resolve({ error: s.failure === table ? { message: 'Synthetic failure' } : null, data: table === 'opname_orders' ? { id: 'order', status: s.status, warehouse_id: 'wh' } : table === 'profiles' ? { role: 'OWNER' } : table === 'role_modules' ? [] : table === 'stock' ? { qty: s.stock } : table === 'opname_counts' ? s.saved : [] }).then(resolve);
      },
    };
    return q;
  },
}) }));
import { kunciBaris } from '@/app/(app)/pos/opname/actions';
beforeEach(() => { s.stock = -5; s.saved = null; s.failure = ''; s.status = 'Terbuka'; s.writes = 0; });
it('keeps the original negative baseline and physical count when a lost-response lock is retried after a sale', async () => {
  await kunciBaris('order', 'item', 1);
  s.stock = -6;
  const response = await kunciBaris('order', 'item', 2);
  expect(s.saved?.qty_sistem).toBe(-5); expect(s.saved?.qty_fisik).toBe(1);
  expect(response).toMatchObject({ ok: true, qtyFisik: 1 });
  // The preserved delta +6 applied to live stock -6 gives 0, preserving the sale.
  expect(s.stock + Number(s.saved?.qty_fisik) - Number(s.saved?.qty_sistem)).toBe(0);
});
it('uses the current baseline on first lock instead of freezing it at order creation', async () => {
  s.stock = -5; await kunciBaris('order', 'item', 1);
  expect(s.saved?.qty_sistem).toBe(-5); expect(Number(s.saved?.qty_fisik) - Number(s.saved?.qty_sistem)).toBe(6);
});
it('does not fabricate a zero snapshot when the stock read fails', async () => {
  s.failure = 'stock'; expect((await kunciBaris('order', 'item', 1)).ok).toBe(false); expect(s.writes).toBe(0);
});
it.each([NaN, Infinity, -1])('rejects invalid count %s instead of coercing it to zero', async qty => {
  expect((await kunciBaris('order', 'item', qty)).ok).toBe(false); expect(s.writes).toBe(0);
});
it('does not claim confirmed lock when saving fails', async () => {
  s.failure = 'opname_counts'; expect((await kunciBaris('order', 'item', 1)).ok).toBe(false); expect(s.saved).toBeNull();
});
it('rejects a completed order before writing counts', async () => {
  s.status = 'Selesai'; expect((await kunciBaris('order', 'item', 1)).ok).toBe(false); expect(s.writes).toBe(0);
});
