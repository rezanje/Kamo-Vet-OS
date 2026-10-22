export const ACTIVITY_PAGE_SIZE = 40;
export const ACTIVITY_PATH = '/perusahaan/log-aktifitas';

// Keep aligned with the explicit SQL registry; this is a navigation list, never
// an authorization rule. Database RLS evaluates every read independently.
export const ACTIVITY_ENTITIES: Record<string, string> = {
  items: 'Barang & Jasa', customers: 'Pelanggan', brands: 'Merek', units: 'Satuan',
  suppliers: 'Pemasok', supplier_categories: 'Kategori Pemasok', sales: 'Transaksi POS',
  sales_quotations: 'Penawaran Penjualan', sales_orders: 'Pesanan Penjualan',
  sales_deliveries: 'Pengiriman Penjualan', sales_invoices: 'Faktur Penjualan',
  purchase_orders: 'Pesanan Pembelian', goods_receipts: 'Penerimaan Pembelian',
  purchase_invoices: 'Faktur Pembelian', visits: 'Kunjungan Klinik', invoices: 'Invoice Klinik',
  cash_entries: 'Kas Masuk / Keluar', cash_transfers: 'Transfer Bank',
  bank_reconciliations: 'Rekonsiliasi Bank', expenses: 'Pengeluaran',
  journal_entries: 'Jurnal', fixed_assets: 'Aset Tetap', stock_transfers: 'Pemindahan Barang',
  stock_requests: 'Permintaan Barang', stock_receipts: 'Penerimaan Permintaan Barang', inventory_adjustments: 'Penyesuaian Persediaan',
  opname_orders: 'Perintah Stok Opname', opname_results: 'Hasil Stok Opname',
};
export const ACTIVITY_MODULES: Record<string, string> = {
  pos: 'Persediaan / POS', crm: 'CRM', pembelian: 'Pembelian', penjualan: 'Penjualan',
  klinik: 'Klinik', 'kas-bank': 'Kas & Bank', 'buku-besar': 'Buku Besar', 'aset-tetap': 'Aset Tetap',
};
export const ACTIVITY_ACTIONS: Record<string, string> = { create: 'Dibuat', update: 'Diubah', delete: 'Dihapus' };
export type ActivityParams = Partial<Record<'entity' | 'object' | 'module' | 'action' | 'q' | 'from' | 'to' | 'before' | 'after', string | string[]>>;
export type ActivityFilters = Record<keyof ActivityParams, string>;
const scalar = (v: string | string[] | undefined) => typeof v === 'string' ? v : '';
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : '';
const cursor = (s: string) => /^[1-9]\d{0,18}$/.test(s) && BigInt(s) <= BigInt('9223372036854775807') ? s : '';
const ownKey = (obj: Record<string, string>, key: string) => Object.hasOwn(obj, key) ? key : '';
export function activityFilters(params: ActivityParams): ActivityFilters {
  const entity = ownKey(ACTIVITY_ENTITIES, scalar(params.entity));
  const before = cursor(scalar(params.before));
  return {
    entity, object: entity ? scalar(params.object).slice(0, 120) : '',
    module: ownKey(ACTIVITY_MODULES, scalar(params.module)),
    action: ownKey(ACTIVITY_ACTIONS, scalar(params.action)),
    q: scalar(params.q).trim().slice(0, 120), from: date(scalar(params.from)), to: date(scalar(params.to)),
    before, after: before ? '' : cursor(scalar(params.after)),
  };
}
export function activityHref(filters: ActivityFilters, patch: Partial<ActivityFilters> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...patch })) if (value) query.set(key, value);
  return ACTIVITY_PATH + (query.size ? '?' + query.toString() : '');
}
export function activityObjectHref(entity: string, id: string): string {
  return activityHref(activityFilters({ entity, object: id }));
}
export type ActivityRow = {
  id: number | string; occurred_at: string; actor_id: string | null; actor_name: string; actor_kind: 'user' | 'system';
  module_id: string; entity: string; entity_id: string; object_label: string;
  row_entity: string; row_id: string; action: string; changed_fields: string[];
  before_state: Record<string, unknown>; after_state: Record<string, unknown>;
};


/** Only menus backed by registered sources get the shortcut. */
export function activityMenuHref(path: string): string | null {
  const routes: [string, string][] = [
    ['/pos/sku', 'items'], ['/pos/merek', 'brands'], ['/pos/satuan', 'units'],
    ['/crm/pelanggan', 'customers'], ['/pembelian/kategori-pemasok', 'supplier_categories'],
    ['/pembelian/faktur', 'purchase_invoices'], ['/pembelian/penerimaan', 'goods_receipts'],
    ['/penjualan/penawaran', 'sales_quotations'], ['/penjualan/pesanan', 'sales_orders'],
    ['/penjualan/pengiriman', 'sales_deliveries'], ['/penjualan/faktur', 'sales_invoices'],
    ['/penjualan/online', 'sales'], ['/pos/transaksi', 'sales'],
    ['/pos/permintaan', 'stock_requests'], ['/pos/pemindahan', 'stock_transfers'],
    ['/pos/penyesuaian', 'inventory_adjustments'], ['/pos/opname', 'opname_orders'],
    ['/kas-bank/transfer', 'cash_transfers'], ['/kas-bank/kas-masuk', 'cash_entries'], ['/kas-bank/kas-keluar', 'cash_entries'],
    ['/keuangan/rekonsiliasi', 'bank_reconciliations'], ['/keuangan/aset', 'fixed_assets'],
    ['/keuangan/jurnal', 'journal_entries'], ['/pos/expense', 'expenses'],
    ['/klinik/pengeluaran', 'expenses'], ['/buku-besar/beban', 'expenses'],
    ['/klinik/pembayaran', 'invoices'],
  ];
  const found = routes.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (found) return activityHref(activityFilters({ entity: found[1] }));
  if (path === '/pembelian') return activityHref(activityFilters({ module: 'pembelian' }));
  return null;
}
