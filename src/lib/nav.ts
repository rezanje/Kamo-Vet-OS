// Navigation + tile config.
//
// Penggolongan modul & urutan tile MENGIKUTI Accurate Online, sesuai spek klien
// `Dokumen/UI ERP KAMO 2026.pdf` (keputusan boss 2026-07-28). Tile yang dicoret ✗
// di PDF tidak dibawa ke sini. Tile bertanda "khusus VetOS" adalah tambahan di
// luar Accurate (klinik, POS kasir, quest, dll) dan ditaruh di akhir grup.
//
// `href` is set only on tiles that have a real page; the rest render as
// "dalam pengembangan" until their module lands. Audit lengkap gap-nya:
// `docs/GAP-MENU-ACCURATE-2026-07.md`.

export type Module = { id: string; label: string; icon: string };

export type Tile = {
  label: string;
  icon: string;
  bg: string;
  fg: string;
  href?: string; // real route, if built
  nw?: boolean; // "Baru" badge
  p2?: boolean; // Fase 2 (disabled)
};

// Urutan sidebar: modul khusus VetOS (operasional harian) dulu, lalu 10 modul
// Accurate persis urutan sidebar-nya di PDF.
export const MODULES: Module[] = [
  { id: "dashboard", label: "Dashboard", icon: "ti-layout-dashboard" },
  { id: "klinik", label: "Klinik", icon: "ti-stethoscope" },
  { id: "crm", label: "CRM", icon: "ti-heart-handshake" },
  { id: "hris", label: "HRIS", icon: "ti-users" },
  { id: "pengaturan", label: "Pengaturan", icon: "ti-settings" },
  { id: "perusahaan", label: "Perusahaan", icon: "ti-building-skyscraper" },
  { id: "buku-besar", label: "Buku Besar", icon: "ti-book-2" },
  { id: "kas-bank", label: "Kas & Bank", icon: "ti-building-bank" },
  { id: "penjualan", label: "Penjualan", icon: "ti-receipt-2" },
  { id: "pembelian", label: "Pembelian", icon: "ti-shopping-cart" },
  { id: "pos", label: "Persediaan", icon: "ti-forklift" },
  { id: "aset-tetap", label: "Aset Tetap", icon: "ti-building-warehouse" },
  { id: "pajak", label: "Pajak", icon: "ti-receipt-tax" },
  { id: "laporan", label: "Daftar Laporan", icon: "ti-chart-pie" },
];

// Prefix URL lama yang tidak lagi jadi modul sidebar, tapi anak-anaknya masih
// dipakai — dipakai Breadcrumb supaya judulnya tidak jadi slug mentah.
const PATH_ALIAS: Record<string, string> = {
  keuangan: "Daftar Laporan",
  kasir: "POS Petshop",
  me: "Dashboard Pribadi",
};

export const MODULE_LABEL: Record<string, string> = {
  ...PATH_ALIAS,
  ...Object.fromEntries(MODULES.map((m) => [m.id, m.label])),
};

// FINANCE hanya pegang dunia keuangan — sidebar & akses URL dibatasi ke modul ini.
// Piutang/hutang hidup di Kas & Bank (ala Accurate), jadi FINANCE tetap kebagian.
export const FINANCE_MODULES = [
  "dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan",
];

// Modul yang boleh diakses per role. Undefined = semua (OWNER/ADMIN).
export function allowedModules(role: string): string[] | null {
  if (role === "FINANCE") return FINANCE_MODULES;
  return null; // full akses
}

const G = { bg: "#e8f5ee", fg: "#16a34a" }; // green  — transaksi
const B = { bg: "#eff6ff", fg: "#2563eb" }; // blue   — master data
const P = { bg: "#f3f0ff", fg: "#7c3aed" }; // purple — tools & log
const R = { bg: "#fef2f2", fg: "#dc2626" }; // red
const A = { bg: "#fffbeb", fg: "#d97706" }; // amber

export const TILES: Record<string, Tile[]> = {
  // ── Modul khusus VetOS (tidak ada di Accurate) ──────────────────────────────
  klinik: [
    { label: "Registrasi pasien", icon: "ti-user-plus", ...G, href: "/klinik/registrasi" },
    { label: "Antrian digital", icon: "ti-list-numbers", ...G, href: "/klinik/antrian" },
    { label: "Rekam medis", icon: "ti-notes-medical", ...G },
    { label: "Rawat inap", icon: "ti-bed", ...G, href: "/klinik/rawat-inap" },
    { label: "Racik obat", icon: "ti-flask", ...G, href: "/klinik/racik" },
    { label: "Form persetujuan", icon: "ti-file-check", ...G, href: "/klinik/persetujuan" },
    { label: "Follow up", icon: "ti-calendar-event", ...A, href: "/klinik/follow-up" },
    { label: "Bahan baku klinik", icon: "ti-flask-2", ...B, href: "/klinik/bahan-baku" },
    { label: "Jadwal dokter", icon: "ti-calendar-event", ...B },
    { label: "Booking online", icon: "ti-calendar-plus", ...P },
  ],
  crm: [
    { label: "Promo", icon: "ti-speakerphone", ...G, href: "/crm/promo" },
    { label: "Kode Voucher", icon: "ti-ticket", ...G, nw: true, href: "/crm/voucher" },
    { label: "Pelanggan", icon: "ti-users-group", ...B, href: "/crm/pelanggan" },
    { label: "Kategori Pelanggan", icon: "ti-crown", ...B, href: "/crm/kategori-pelanggan" },
    { label: "Retention (WA)", icon: "ti-brand-whatsapp", ...P },
    { label: "Owner dashboard", icon: "ti-dashboard", ...P },
  ],
  hris: [
    { label: "Karyawan", icon: "ti-user-circle", ...B, href: "/hris/karyawan" },
    { label: "Absensi", icon: "ti-map-pin-check", ...G, href: "/hris/absensi" },
    { label: "Jadwal", icon: "ti-calendar-time", ...G, href: "/hris/jadwal" },
    { label: "Slip Gaji", icon: "ti-moneybag", ...G, href: "/hris/penggajian" },
    { label: "Menu Karyawan", icon: "ti-id-badge", ...G, href: "/me" },
    { label: "Cuti & lembur", icon: "ti-beach", ...G, href: "/hris/cuti" },
    { label: "Pengajuan (lembur/kasbon/reimburse)", icon: "ti-file-check", ...G, href: "/hris/pengajuan" },
    { label: "KPI karyawan", icon: "ti-chart-dots", ...P, href: "/hris/kpi" },
    { label: "Komponen gaji", icon: "ti-coin", ...B, href: "/hris/komponen-gaji" },
    { label: "Master shift", icon: "ti-clock-hour-8", ...B, href: "/hris/shift" },
    { label: "Verifikasi wajah", icon: "ti-scan-eye", bg: "#f3f4f6", fg: "#9ca3af", p2: true },
  ],

  // ── 10 modul Accurate ───────────────────────────────────────────────────────
  pengaturan: [
    { label: "Preferensi", icon: "ti-adjustments", ...A },
    { label: "Akses Grup", icon: "ti-users-plus", ...A },
    { label: "Pengguna", icon: "ti-shield", ...A, href: "/pengaturan/pengguna" },
    { label: "Penomoran", icon: "ti-list-numbers", ...A },
    { label: "Desain Cetakan", icon: "ti-printer", ...A },
    { label: "Penyetuju Transaksi", icon: "ti-user-check", ...A },
    { label: "Cabang & gudang", icon: "ti-building-store", ...B, href: "/pengaturan/cabang" },
    { label: "Konfigurasi loyalty", icon: "ti-star", ...B, href: "/pengaturan/tier" },
    { label: "Aturan gaji", icon: "ti-adjustments-dollar", ...B, href: "/pengaturan/gaji" },
    { label: "WA Engine (7 trigger)", icon: "ti-brand-whatsapp", ...B },
  ],
  perusahaan: [
    { label: "Cabang", icon: "ti-building-community", ...B, href: "/perusahaan/cabang" },
    { label: "Transaksi Berulang", icon: "ti-repeat", ...G, href: "/keuangan/jurnal-berulang" },
    { label: "Proses Akhir Bulan", icon: "ti-calendar-stats", ...G },
    { label: "Transaksi Favorit", icon: "ti-star", ...P },
    { label: "Persetujuan (Approval)", icon: "ti-file-check", ...P },
    { label: "Kalender", icon: "ti-calendar", ...P },
    { label: "Log Aktifitas", icon: "ti-history", ...P },
  ],
  "buku-besar": [
    { label: "Akun Perkiraan", icon: "ti-clipboard-list", ...B, href: "/keuangan/coa" },
    { label: "Pencatatan Beban", icon: "ti-receipt-2", ...G, href: "/buku-besar/beban" },
    { label: "Pencatatan Gaji", icon: "ti-cash", ...G, href: "/hris/penggajian" },
    { label: "Jurnal Umum", icon: "ti-table", ...G, href: "/keuangan/jurnal" },
    { label: "Monitor Anggaran", icon: "ti-device-desktop-analytics", ...P },
    { label: "Transfer Anggaran", icon: "ti-arrows-transfer-down", ...G },
    { label: "Anggaran", icon: "ti-chart-arrows-vertical", ...A },
    { label: "Histori Akun", icon: "ti-history", ...P, href: "/keuangan/buku-besar" },
    { label: "Log Aktifitas Jurnal", icon: "ti-file-search", ...P, href: "/buku-besar/log" },
    { label: "Jurnal Berulang", icon: "ti-repeat", ...G, href: "/keuangan/jurnal-berulang" },
    { label: "Tutup Buku", icon: "ti-lock", ...G, href: "/keuangan/tutup-buku" },
    { label: "Sinkronisasi Jurnal", icon: "ti-refresh-dot", ...A, href: "/keuangan/sinkron" },
  ],
  "kas-bank": [
    // Accurate: "Pembayaran" = bayar hutang pemasok, "Penerimaan" = terima piutang pelanggan.
    // Kas Masuk/Keluar dipisah sendiri: uang kas TANPA faktur (petty cash).
    { label: "Pembayaran Hutang", icon: "ti-cash", ...G, href: "/keuangan/hutang" },
    { label: "Penerimaan Piutang", icon: "ti-cash-banknote", ...G, href: "/keuangan/piutang" },
    { label: "Kas Keluar (Petty Cash)", icon: "ti-cash-off", ...G, href: "/kas-bank/kas-keluar" },
    { label: "Kas Masuk", icon: "ti-wallet", ...G, href: "/kas-bank/kas-masuk" },
    { label: "Transfer Bank", icon: "ti-building-bank", ...G, href: "/kas-bank/transfer" },
    { label: "Rekonsiliasi Bank", icon: "ti-checkbox", ...P, href: "/keuangan/rekonsiliasi" },
    { label: "Daftar Rekening", icon: "ti-wallet", ...B, href: "/kas-bank/rekening" },
    { label: "Peta Rekening Pembayaran", icon: "ti-arrows-split", ...B, href: "/kas-bank/peta" },
    { label: "Payment Gateway", icon: "ti-credit-card", ...B },
    { label: "Arus Kas", icon: "ti-arrows-exchange", ...P, href: "/keuangan/arus-kas" },
  ],
  penjualan: [
    { label: "Penawaran Penjualan", icon: "ti-file-text", ...G },
    { label: "Pesanan Penjualan", icon: "ti-shopping-bag", ...G },
    { label: "Pengiriman Pesanan", icon: "ti-truck", ...G },
    { label: "Uang Muka Penjualan", icon: "ti-coin", ...G },
    { label: "Faktur Penjualan", icon: "ti-receipt-2", ...G },
    { label: "Penerimaan Penjualan", icon: "ti-cash-banknote", ...G },
    { label: "Retur Penjualan", icon: "ti-arrow-back-up", ...G, href: "/penjualan/retur" },
    { label: "Komisi Penjual", icon: "ti-percentage", ...A, href: "/penjualan/komisi" },
    { label: "Target Penjualan", icon: "ti-target", ...A, href: "/penjualan/target" },
    { label: "Penjualan Online", icon: "ti-world", ...G, nw: true, href: "/penjualan/online" },
  ],
  pembelian: [
    { label: "Pesanan Pembelian", icon: "ti-file-invoice", ...G, href: "/pembelian" },
    { label: "Penerimaan Barang", icon: "ti-package-import", ...G, href: "/pembelian/penerimaan" },
    { label: "Uang Muka Pembelian", icon: "ti-cash-banknote", ...G, href: "/pembelian/uang-muka" },
    { label: "Faktur Pembelian", icon: "ti-receipt", ...G, href: "/pembelian/faktur" },
    { label: "Pembayaran Pembelian", icon: "ti-cash", ...G, href: "/keuangan/hutang" },
    { label: "Retur Pembelian", icon: "ti-truck-return", ...G, href: "/pembelian/retur" },
    { label: "Kategori Pemasok", icon: "ti-tag", ...B, href: "/pembelian/kategori-pemasok" },
    { label: "Pemasok", icon: "ti-building-store", ...B, href: "/pembelian?tab=supplier" },
    { label: "Perintah Pembayaran", icon: "ti-send", ...G, href: "/pembelian/perintah-bayar" },
  ],
  // id `pos` dipertahankan supaya route /pos/* lama tidak perlu dipindah.
  pos: [
    { label: "Permintaan Barang", icon: "ti-clipboard-text", ...G, href: "/pos/permintaan" },
    { label: "Pemindahan Barang", icon: "ti-transfer", ...G, href: "/pos/pemindahan" },
    { label: "Penyesuaian Persediaan", icon: "ti-adjustments-alt", ...G },
    { label: "Pekerjaan Pesanan", icon: "ti-clipboard-check", ...G },
    { label: "Penambahan Bahan Baku", icon: "ti-package-import", ...G, href: "/klinik/bahan-baku" },
    { label: "Penyelesaian Pesanan", icon: "ti-checklist", ...G },
    { label: "Perintah Stok Opname", icon: "ti-clipboard-list", ...G, href: "/pos/opname" },
    { label: "Hasil Stok Opname", icon: "ti-clipboard-check", ...G, href: "/pos/opname" },
    { label: "Barang & Jasa", icon: "ti-package", ...B, href: "/pos/sku" },
    { label: "Harga Jual", icon: "ti-tag", ...B, nw: true, href: "/pos/harga" },
    { label: "Gudang", icon: "ti-building-warehouse", ...B, href: "/pengaturan/cabang" },
    { label: "Satuan Barang", icon: "ti-scale-outline", ...B, href: "/pos/satuan" },
    { label: "Kategori Barang", icon: "ti-category", ...B, href: "/pos/kategori" },
    { label: "Merek Barang", icon: "ti-badge", ...B, href: "/pos/merek" },
    { label: "Barang Stok Minimum", icon: "ti-alert-triangle", ...P, nw: true, href: "/pos/stok-minimum" },
    { label: "Stok per Gudang", icon: "ti-stack", ...P, href: "/pos/stok" },
    { label: "Kartu Stok", icon: "ti-history", ...P, nw: true, href: "/pos/kartu-stok" },
    { label: "Monitor Expired", icon: "ti-calendar-x", ...R },
    { label: "Transaksi POS", icon: "ti-cash-register", ...G, href: "/pos/transaksi" },
    { label: "Shift Kasir", icon: "ti-clock-dollar", ...G, href: "/pos/shift" },
    { label: "Pengeluaran", icon: "ti-receipt-2", ...G, href: "/pos/expense" },
    { label: "Quest Staff", icon: "ti-trophy", ...A, href: "/pos/quest" },
  ],
  "aset-tetap": [
    { label: "Aset Tetap", icon: "ti-building", ...B, href: "/keuangan/aset" },
    { label: "Kategori Aset", icon: "ti-category", ...B, href: "/keuangan/kategori-aset" },
    { label: "Kategori Aset Tetap Pajak", icon: "ti-receipt-tax", ...B },
    { label: "Perubahan Aset Tetap", icon: "ti-edit", ...G },
    { label: "Disposisi Aset Tetap", icon: "ti-trash", ...G },
    { label: "Pindah Aset", icon: "ti-arrows-transfer-down", ...G },
  ],
  pajak: [
    { label: "Mode PKP & tarif PPN", icon: "ti-settings", ...B, href: "/pengaturan/pajak" },
    { label: "Rekap PPN", icon: "ti-receipt-tax", ...G, href: "/keuangan/ppn" },
    { label: "e-Faktur CTAS", icon: "ti-file-invoice", ...P },
    { label: "Email Faktur Pajak", icon: "ti-mail-forward", ...P },
    { label: "e-Faktur Legacy", icon: "ti-file-text", ...P },
  ],
  laporan: [
    // Laporan operasional yang diminta tim (2026-08-01) — di luar laporan
    // keuangan standar Accurate, jadi ditaruh paling atas karena paling sering dibuka.
    { label: "Pelanggan Teratas", icon: "ti-trophy", ...A, nw: true, href: "/laporan/pelanggan-teratas" },
    { label: "Jadwal Anabul", icon: "ti-calendar-heart", ...A, nw: true, href: "/laporan/jadwal-anabul" },
    { label: "Rekap Absensi", icon: "ti-clock-check", ...A, nw: true, href: "/laporan/absensi" },
    { label: "Rekap Gaji", icon: "ti-moneybag", ...A, nw: true, href: "/laporan/gaji" },
    { label: "Penjualan per Kasir", icon: "ti-cash-register", ...A, nw: true, href: "/laporan/penjualan-kasir" },
    { label: "Nilai KPI Karyawan", icon: "ti-chart-dots", ...A, nw: true, href: "/laporan/kpi" },
    { label: "Laba Rugi", icon: "ti-chart-bar", ...G, href: "/keuangan/laba-rugi" },
    { label: "Neraca", icon: "ti-scale", ...G, href: "/keuangan/neraca" },
    { label: "Neraca Saldo", icon: "ti-list-check", ...G, href: "/keuangan/neraca-saldo" },
    { label: "Buku Besar", icon: "ti-book", ...G, href: "/keuangan/buku-besar" },
    { label: "Arus Kas", icon: "ti-arrows-exchange", ...G, href: "/keuangan/arus-kas" },
    { label: "Piutang (AR)", icon: "ti-clock-hour-4", ...A, href: "/keuangan/piutang" },
    { label: "Hutang (AP)", icon: "ti-clock-dollar", ...R, href: "/keuangan/hutang" },
    { label: "Laporan HPP", icon: "ti-report", ...G },
    { label: "Shift Kasir (selisih kas)", icon: "ti-clock-dollar", ...G, href: "/pos/shift" },
    { label: "SPT PPN / PPNBM", icon: "ti-file-dollar", ...P },
    { label: "SPT PPh Ps.21", icon: "ti-file-description", ...P },
    { label: "Bukti Potong PPh Ps.21", icon: "ti-file-certificate", ...P },
  ],
};
