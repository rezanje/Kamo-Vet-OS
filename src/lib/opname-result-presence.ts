import type { SupabaseClient } from '@supabase/supabase-js';
import { ListLoadError } from './checked-list';

/** Missing/failed reads must never reopen a potentially partially posted order. */
export async function opnameHasResult(db: Pick<SupabaseClient, 'from'>, orderId: string): Promise<boolean> {
  const { count, error } = await db.from('opname_results').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
  if (error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new ListLoadError('Hasil opname belum dapat diperiksa. Muat ulang sebelum melanjutkan hitungan atau posting.');
  return count > 0;
}
