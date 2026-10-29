export const ACTIVITY_PAGE_SIZE = 40;
export const ACTIVITY_PATH = '/perusahaan/log-aktifitas';

// Keep aligned with the explicit SQL registry; this is a navigation list, never
// an authorization rule. Database RLS evaluates every read independently.
export const ACTIVITY_ENTITIES: Record<string, string> = {
  items: "Barang & Jasa",
  customers: "Pelanggan",
  brands: "Merek",
  units: "Satuan",
  suppliers: "Pemasok",
  supplier_categories: "Kategori Pemasok",
  sales: "Transaksi POS",
  sales_quotations: "Penawaran Penjualan",
  sales_orders: "Pesanan Penjualan",
  sales_deliveries: "Pengiriman Penjualan",
  sales_invoices: "Faktur Penjualan",
  purchase_orders: "Pesanan Pembelian",
  goods_receipts: "Penerimaan Pembelian",
  purchase_invoices: "Faktur Pembelian",
  visits: "Kunjungan Klinik",
  invoices: "Invoice Klinik",
  cash_entries: "Kas Masuk / Keluar",
  cash_transfers: "Transfer Bank",
  bank_reconciliations: "Rekonsiliasi Bank",
  expenses: "Pengeluaran",
  journal_entries: "Jurnal",
  fixed_assets: "Aset Tetap",
  stock_transfers: "Pemindahan Barang",
  stock_requests: "Permintaan Barang",
  stock_receipts: "Penerimaan Permintaan Barang",
  inventory_adjustments: "Penyesuaian Persediaan",
  opname_orders: "Perintah Stok Opname",
  opname_results: "Hasil Stok Opname",
  sale_items: "Rincian Transaksi POS",
  sales_quotation_items: "Rincian Penawaran Penjualan",
  sales_order_items: "Rincian Pesanan Penjualan",
  sales_delivery_items: "Rincian Pengiriman Penjualan",
  sales_invoice_items: "Rincian Faktur Penjualan",
  purchase_order_items: "Rincian Pesanan Pembelian",
  goods_receipt_items: "Rincian Penerimaan Pembelian",
  purchase_invoice_items: "Rincian Faktur Pembelian",
  purchase_invoice_payments: "Pembayaran Faktur Pembelian",
  invoice_items: "Rincian Invoice Klinik",
  stock_request_items: "Rincian Permintaan Barang",
  stock_receipt_items: "Rincian Penerimaan Permintaan Barang",
  stock_transfer_items: "Rincian Pemindahan Barang",
  inventory_adjustment_items: "Rincian Penyesuaian Persediaan",
  opname_result_items: "Rincian Hasil Stok Opname",
  sales_receipts: "Penerimaan Penjualan",
  sales_advances: "Uang Muka Penjualan",
  sales_returns: "Retur Penjualan",
  sales_return_items: "Rincian Retur Penjualan",
  wholesale_returns: "Retur Faktur Penjualan",
  wholesale_return_items: "Rincian Retur Faktur Penjualan",
  purchase_advances: "Uang Muka Pembelian",
  payment_orders: "Perintah Pembayaran",
  payment_order_items: "Rincian Perintah Pembayaran",
  purchase_returns: "Retur Pembelian",
  purchase_return_items: "Rincian Retur Pembelian",
  invoice_payments: "Pembayaran Invoice Klinik",
  journal_lines: "Rincian Jurnal",
  asset_depreciations: "Penyusutan Aset",
  asset_changes: "Perubahan Nilai Aset",
  asset_disposals: "Pelepasan Aset",
  asset_transfers: "Pemindahan Aset",
  po_payments: "Pembayaran Pesanan Pembelian",
  sale_payments: "Pembayaran POS",
  sale_payment_refunds: "Pengembalian Pembayaran POS",
  sales_refund_requests: "Permintaan pengembalian dana penjualan",
  purchase_correction_requests: "Permintaan Koreksi Pembelian",
  sales_refund_payouts: "Bukti pengembalian dana penjualan",
  sales_invoice_delivery_allocations: "Alokasi Pengiriman Faktur Penjualan",
  purchase_invoice_layer_proofs: "Bukti Lapisan Faktur Pembelian",
  clinic_compound_sales: "Penjualan Racikan Klinik",
  item_categories: "Kategori Barang",
  item_units: "Satuan per Barang",
  item_price_tiers: "Harga Bertingkat Barang",
  item_branch_prices: "Harga Barang per Cabang",
  item_group_components: "Komponen Grup Barang",
  item_variant_families: "Keluarga Varian Barang",
  item_variant_members: "Anggota Varian Barang",
  stock: "Saldo Stok",
  stock_moves: "Mutasi Stok",
  stock_layers: "Lapisan Stok",
  opname_order_items: "Barang Perintah Stok Opname",
  opname_counts: "Hitungan Stok Opname",
  production_recipes: "Resep Produksi",
  production_recipe_items: "Bahan Resep Produksi",
  production_orders: "Perintah Produksi",
  production_order_items: "Bahan Perintah Produksi",
  cashier_shifts: "Shift Kasir",
  sale_drafts: "Draf Transaksi POS",
  quest_settings: "Pengaturan Quest",
  staff_quest_definitions: "Quest Staf",
  staff_quest_progress: "Perkembangan Quest Staf",
  staff_points: "Saldo Poin Staf",
  staff_streaks: "Rangkaian Aktivitas Staf",
  staff_points_ledger: "Mutasi Poin Staf",
  staff_reward_catalog: "Katalog Hadiah Staf",
  staff_reward_redemptions: "Penukaran Hadiah Staf",
  point_ledger: "Mutasi Poin Pelanggan",
  sale_staff_effects: "Bukti Poin Staf dari Penjualan",
  sale_item_group_components: "Komponen Grup Terjual",
  inventory_costing_settings: "Pengaturan Harga Pokok Persediaan",
  inventory_cost_events: "Perubahan Nilai Persediaan",
  inventory_month_closes: "Penutupan Bulanan Persediaan",
  inventory_month_values: "Nilai Persediaan Bulanan",
  stock_document_issue_proofs: "Bukti Pengeluaran Stok",
  employees: "Karyawan",
  employee_branch_assignments: "Penugasan Cabang Karyawan",
  employee_import_details: "Rincian Impor Karyawan",
  attendance: "Absensi",
  employee_schedules: "Jadwal Karyawan",
  leave_requests: "Pengajuan Cuti",
  overtime_requests: "Pengajuan Lembur",
  payrolls: "Penggajian",
  employee_salary_components: "Komponen Gaji Karyawan",
  reimbursements: "Penggantian Biaya Karyawan",
  cash_advances: "Kasbon Karyawan",
  cash_advance_installments: "Angsuran Kasbon",
  kpi_records: "Penilaian KPI",
  work_shifts: "Master Shift Karyawan",
  salary_components: "Komponen Gaji",
  payroll_settings: "Pengaturan Gaji",
  branches: "Cabang",
  warehouses: "Gudang",
  profiles: "Pengguna",
  user_branches: "Akses Cabang Pengguna",
  role_modules: "Akses Modul per Peran",
  role_capabilities: "Kapabilitas Peran",
  company_settings: "Pengaturan Perusahaan",
  approval_rules: "Aturan Persetujuan",
  approval_requests: "Pengajuan Persetujuan",
  document_numbering: "Penomoran Dokumen",
  wa_engine_settings: "Pengaturan WA Engine",
  tier_settings: "Pengaturan Loyalitas",
  operational_alert_settings: "Pengaturan Alert Operasional",
  commission_rules: "Aturan Komisi Penjual",
  sales_targets: "Target Penjualan",
  notifications: "Notifikasi",
  coa_accounts: "Akun Perkiraan",
  cash_accounts: "Rekening Kas dan Bank",
  payment_account_map: "Peta Rekening Pembayaran",
  budgets: "Anggaran",
  budget_transfers: "Transfer Anggaran",
  recurring_journals: "Jurnal Berulang",
  accounting_locks: "Penguncian Periode Akuntansi",
  month_end_runs: "Proses Akhir Bulan",
  asset_categories: "Kategori Aset",
  tax_asset_categories: "Kategori Aset Pajak",
  customer_categories: "Kategori Pelanggan",
  customer_review_statuses: "Status Ulasan Pelanggan",
  promos: "Promo",
  vouchers: "Voucher",
  category_discounts: "Pengecualian Diskon Kategori",
  pets: "Anabul",
  pet_ownership_transfers: "Pemindahan Pemilik Anabul",
  promo_items: "Barang Promo",
  medical_records: "Rekam Medis",
  prescription_items: "Rincian Resep Obat",
  inpatient_records: "Rawat Inap",
  inpatient_daily_logs: "Catatan Harian Rawat Inap",
  inpatient_medications: "Obat Rawat Inap",
  inpatient_med_doses: "Pemberian Obat Rawat Inap",
  compounding_recipes: "Racikan Obat",
  compounding_ingredients: "Bahan Racikan Obat",
  compound_formulas: "Formula Racikan Resmi",
  compound_formula_versions: "Versi Formula Racikan",
  compound_issues: "Pengeluaran Bahan Racikan",
  compound_official_usage: "Pemakaian Racikan Resmi",
  clinic_demo_policies: "Aturan Klinik DEMO",
  clinic_demo_invoice_snapshots: "Bukti Invoice Klinik DEMO",
  clinic_demo_incentive_allocations: "Alokasi Insentif Klinik DEMO",
  bookings: "Booking Klinik",
  branch_capacity_periods: "Kapasitas Layanan Cabang",
  consents: "Persetujuan Tindakan",
  consent_templates: "Template Persetujuan Tindakan",
  consent_rules: "Aturan Persetujuan Tindakan",
  follow_ups: "Tindak Lanjut Klinik",
  medical_equipment: "Alat Medis",
  medical_equipment_maintenance: "Pemeliharaan Alat Medis",
  visit_referrals: "Rujukan Kunjungan",
  visit_operational_events: "Aktivitas Operasional Kunjungan",
  whatsapp_message_log: "Riwayat Pengiriman WhatsApp",
  import_runs: "Proses Impor",
  import_run_rows: "Rincian Proses Impor",
  initial_stock_scope_mappings: "Pemetaan Stok Awal",
  document_attachments: "Lampiran Dokumen",
  accurate_inventory_accounting: "Pembukuan Persediaan Awal",
  clinic_history_reads: "Riwayat Akses Rekam Medis",
  clinic_refund_requests: "Permintaan Refund Klinik",
  clinic_refunds: "Refund Klinik",
  campaign_codes: "Kode Kampanye",
  payslip_templates: "Template Slip Gaji",
  payslip_template_components: "Komponen Template Slip Gaji",
  employee_payslip_templates: "Template Slip Gaji Karyawan",
  employee_base_salaries: "Gaji Pokok Karyawan",
  service_commission_policies: "Kebijakan Komisi Jasa",
  branch_grooming_rules: "Aturan Grooming Cabang",
  opening_invoice_batches: "Saldo Awal Faktur",
  opening_invoice_lines: "Rincian Saldo Awal Faktur",
  recurring_journal_sources: "Sumber Jurnal Berulang",
  clinic_refund_items: "Rincian Refund Klinik",
  clinic_record_addenda: "Addendum Rekam Medis",
  inpatient_rx_evidence: "Bukti Obat Rawat Inap",
  inpatient_rx_evidence_settings: "Pengaturan Bukti Obat Rawat Inap",
  purchase_invoice_receipts: "Tautan Faktur dan Penerimaan Pembelian",
  quest_new_customer_claims: "Klaim Quest Pelanggan Baru",
};
export const ACTIVITY_MODULES: Record<string, string> = {
  pos: 'Persediaan / POS', crm: 'CRM', pembelian: 'Pembelian', penjualan: 'Penjualan',
  klinik: 'Klinik', 'kas-bank': 'Kas & Bank', 'buku-besar': 'Buku Besar', 'aset-tetap': 'Aset Tetap',
  hris: 'HRIS', pengaturan: 'Pengaturan', perusahaan: 'Perusahaan', pajak: 'Pajak',
};
export const ACTIVITY_ACTIONS: Record<string, string> = { create: 'Dibuat', update: 'Diubah', delete: 'Dihapus' };
export type ActivityParams = Partial<Record<'entity' | 'object' | 'module' | 'action' | 'q' | 'from' | 'to' | 'before' | 'after', string | string[]>>;
export type ActivityFilters = Record<keyof ActivityParams, string>;
const scalar = (v: string | string[] | undefined) => typeof v === 'string' ? v : '';
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : '';
const cursor = (s: string) => /^[1-9]\d{0,18}$/.test(s) && BigInt(s) <= BigInt('9223372036854775807') ? s : '';
const objectIdentity = (s: string) => s.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(s) ? s : '';
const ownKey = (obj: Record<string, string>, key: string) => Object.hasOwn(obj, key) ? key : '';
export function activityFilters(params: ActivityParams): ActivityFilters {
  const entity = ownKey(ACTIVITY_ENTITIES, scalar(params.entity));
  const before = cursor(scalar(params.before));
  return {
    entity, object: entity ? objectIdentity(scalar(params.object)) : '',
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


/** Navigation only: current page access and audit RLS remain authoritative. */
const MENU_ENTITIES: Record<string, string> = {
  '/pos/sku/impor': 'import_runs', '/pos/sku/varian': 'item_variant_families',
  '/pos/sku': 'items', '/pos/merek': 'brands', '/pos/satuan': 'units',
  '/pos/kategori': 'item_categories', '/pos/harga': 'item_branch_prices',
  '/pos/stok-minimum': 'stock', '/pos/stok': 'stock', '/pos/expired': 'stock_layers',
  '/pos/kartu-stok': 'stock_moves', '/pos/produksi': 'production_orders',
  '/pos/quest': 'staff_quest_definitions', '/pos/shift': 'cashier_shifts',
  '/pos/transaksi': 'sales', '/pos/struk': 'sales',
  '/pos/permintaan': 'stock_requests', '/pos/pemindahan': 'stock_transfers',
  '/pos/penyesuaian': 'inventory_adjustments', '/pos/opname': 'opname_orders', '/pos/expense': 'expenses',
  '/crm/pelanggan': 'customers', '/crm/kategori-pelanggan': 'customer_categories',
  '/crm/status-ulasan': 'customer_review_statuses', '/crm/promo': 'promos',
  '/crm/voucher': 'vouchers', '/crm/kampanye': 'campaign_codes', '/crm/anabul/transfer': 'pet_ownership_transfers', '/crm/anabul': 'pets',
  '/pembelian/kategori-pemasok': 'supplier_categories', '/pembelian/faktur': 'purchase_invoices',
  '/pembelian/penerimaan': 'goods_receipts', '/pembelian/uang-muka': 'purchase_advances',
  '/pembelian/perintah-bayar': 'payment_orders', '/pembelian/retur': 'purchase_returns', '/pembelian/koreksi': 'purchase_correction_requests',
  '/penjualan/penawaran': 'sales_quotations', '/penjualan/pesanan': 'sales_orders',
  '/penjualan/pengiriman': 'sales_deliveries', '/penjualan/faktur': 'sales_invoices',
  '/penjualan/uang-muka': 'sales_advances', '/penjualan/retur-grosir': 'wholesale_returns', '/penjualan/retur': 'sales_returns',
  '/penjualan/online': 'sales', '/penjualan/komisi': 'commission_rules', '/penjualan/target': 'sales_targets',
  '/kas-bank/transfer': 'cash_transfers', '/kas-bank/kas-masuk': 'cash_entries',
  '/kas-bank/kas-keluar': 'cash_entries', '/kas-bank/rekening': 'cash_accounts', '/kas-bank/peta': 'payment_account_map',
  '/keuangan/hutang': 'purchase_invoice_payments', '/keuangan/rekonsiliasi': 'bank_reconciliations',
  '/keuangan/aset': 'fixed_assets', '/keuangan/kategori-aset-pajak': 'tax_asset_categories',
  '/keuangan/kategori-aset': 'asset_categories', '/keuangan/jurnal-berulang': 'recurring_journals',
  '/keuangan/jurnal': 'journal_entries', '/keuangan/coa': 'coa_accounts',
  '/keuangan/tutup-buku': 'month_end_runs', '/keuangan/closing-hpp': 'inventory_month_closes',
  '/keuangan/persediaan-awal': 'accurate_inventory_accounting', '/keuangan/saldo-awal-faktur': 'opening_invoice_batches',
  '/buku-besar/beban': 'expenses', '/buku-besar/anggaran': 'budgets',
  '/buku-besar/monitor-anggaran': 'budgets', '/buku-besar/transfer-anggaran': 'budget_transfers',
  '/hris/karyawan/impor': 'employee_import_details', '/hris/karyawan': 'employees',
  '/hris/absensi': 'attendance', '/hris/jadwal': 'employee_schedules', '/hris/cuti': 'leave_requests',
  '/hris/kpi': 'kpi_records',
  '/hris/shift': 'work_shifts', '/hris/penggajian': 'payrolls', '/hris/komponen-gaji': 'salary_components',
  '/perusahaan/cabang': 'branches', '/perusahaan/gudang': 'warehouses',
  '/pengaturan/pengguna': 'profiles', '/pengaturan/akses-grup': 'role_modules',
  '/pengaturan/penomoran': 'document_numbering', '/pengaturan/penyetuju': 'approval_rules',
  '/pengaturan/cabang': 'branches', '/pengaturan/tier': 'tier_settings',
  '/pengaturan/gaji': 'payroll_settings', '/pengaturan/wa-engine': 'wa_engine_settings',
  '/pengaturan/alert-operasional': 'operational_alert_settings', '/pengaturan/impor': 'import_runs',
  '/pengaturan/operasional-klinik': 'branch_capacity_periods',
  '/klinik/registrasi': 'visits', '/klinik/antrian': 'visits', '/klinik/rekam-medis/impor': 'import_runs', '/klinik/rekam-medis': 'medical_records',
  '/klinik/rawat-inap': 'inpatient_records', '/klinik/racik': 'compounding_recipes',
  '/klinik/katalog-racikan': 'compound_formulas', '/klinik/bahan-baku': 'compound_issues',
  '/klinik/aturan-demo': 'clinic_demo_policies', '/klinik/persetujuan': 'consents', '/klinik/consent': 'consents',
  '/klinik/follow-up': 'follow_ups', '/klinik/booking': 'bookings', '/klinik/jadwal-dokter': 'employee_schedules',
  '/klinik/maintenance': 'medical_equipment_maintenance', '/klinik/permintaan': 'stock_requests',
  '/klinik/penerimaan': 'stock_receipts', '/klinik/shift': 'cashier_shifts',
  '/klinik/pembayaran': 'invoices', '/klinik/pengeluaran': 'expenses',
};
export function activityMenuHref(path: string): string | null {
  if (path === '/hris/pengajuan') return activityHref(activityFilters({ module: 'hris' }));
  const found = Object.entries(MENU_ENTITIES).sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (found) return activityHref(activityFilters({ entity: found[1] }));
  // Receivables combine clinic and reseller payments; keep both in the viewer.
  if (path === '/keuangan/piutang') return ACTIVITY_PATH;
  if (Object.hasOwn(ACTIVITY_MODULES, path.slice(1))) return activityHref(activityFilters({ module: path.slice(1) }));
  return null;
}

const OBJECT_ROUTES: [RegExp, string, number?][] = [
  [/^\/klinik\/rawat-inap\/([^/]+)\/catatan\/([^/]+)$/, 'inpatient_daily_logs', 2],
  [/^\/klinik\/rawat-inap\/([^/]+)(?:\/catatan)?$/, 'inpatient_records'],
  [/^\/klinik\/penerimaan\/terima\/([^/]+)$/, 'stock_requests'],
  [/^\/pembelian\/penerimaan\/([^/]+)$/, 'goods_receipts'],
  [/^\/pembelian\/retur\/([^/]+)$/, 'purchase_returns'],
  [/^\/penjualan\/retur\/([^/]+)$/, 'sales_returns'],
  [/^\/penjualan\/retur-grosir\/([^/]+)$/, 'wholesale_returns'],
  [/^\/pos\/struk\/([^/]+)$/, 'sales'], [/^\/penjualan\/([^/]+)$/, 'sales'],
  [/^\/pos\/permintaan\/([^/]+)$/, 'stock_requests'], [/^\/pos\/pemindahan\/([^/]+)$/, 'stock_transfers'],
  [/^\/pos\/opname\/([^/]+)$/, 'opname_orders'], [/^\/pos\/penyesuaian\/([^/]+)$/, 'inventory_adjustments'],
  [/^\/pos\/shift\/([^/]+)$/, 'cashier_shifts'], [/^\/klinik\/shift\/([^/]+)$/, 'cashier_shifts'],
  [/^\/pos\/expense\/([^/]+)$/, 'expenses'], [/^\/buku-besar\/beban\/([^/]+)$/, 'expenses'],
  [/^\/keuangan\/jurnal-berulang\/([^/]+)$/, 'recurring_journals'],
  [/^\/keuangan\/rekonsiliasi\/([^/]+)$/, 'bank_reconciliations'], [/^\/keuangan\/aset\/([^/]+)$/, 'fixed_assets'],
  [/^\/kas-bank\/rekening\/([^/]+)(?:\/saldo-awal)?$/, 'cash_accounts'],
  [/^\/hris\/karyawan\/([^/]+)$/, 'employees'], [/^\/crm\/kategori-pelanggan\/([^/]+)$/, 'customer_categories'],
  [/^\/klinik\/antrian\/([^/]+)$/, 'visits'], [/^\/klinik\/rekam-medis\/([^/]+)(?:\/(?:dokumen|resep))?$/, 'visits'],
  [/^\/klinik\/racik\/([^/]+)$/, 'compounding_recipes'], [/^\/klinik\/consent\/([^/]+)$/, 'consents'],
];
/** Only detail routes with a known source identity; never infer IDs from document numbers. */
export function activityRouteObject(path: string): { entity: string; id: string } | null {
  // Existing detail pages already render their own history link.
  const reserved = new Set(['baru', 'impor', 'varian', 'langsung', 'slip', ...Object.keys(MENU_ENTITIES).map(route => route.split('/').at(-1)!)]);
  for (const [route, entity, index = 1] of OBJECT_ROUTES) {
    const match = path.match(route);
    if (!match) continue;
    try {
      const id = decodeURIComponent(match[index]);
      if (id && !reserved.has(id) && objectIdentity(id)) return { entity, id };
    } catch { return null; }
  }
  return null;
}
