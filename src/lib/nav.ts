// Navigation + tile config, ported from Dokumen/VetOS_UI_Prototype.html (MV/ML/TL).
// `href` is set only on tiles that have a real page; the rest render as
// "dalam pengembangan" until their module lands (PRD phased rollout).

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

export const MODULES: Module[] = [
  { id: "dashboard", label: "Dashboard", icon: "ti-layout-dashboard" },
  { id: "klinik", label: "Klinik", icon: "ti-stethoscope" },
  { id: "pos", label: "POS & Inventori", icon: "ti-shopping-cart" },
  { id: "pembelian", label: "Pembelian", icon: "ti-truck-delivery" },
  { id: "penjualan", label: "Penjualan", icon: "ti-receipt-2" },
  { id: "keuangan", label: "Keuangan", icon: "ti-report-money" },
  { id: "hris", label: "HRIS", icon: "ti-users" },
  { id: "crm", label: "CRM", icon: "ti-heart-handshake" },
  { id: "pengaturan", label: "Pengaturan", icon: "ti-settings" },
];

export const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  MODULES.map((m) => [m.id, m.label]),
);

const G = { bg: "#e8f5ee", fg: "#16a34a" }; // green
const B = { bg: "#eff6ff", fg: "#2563eb" }; // blue
const P = { bg: "#f3f0ff", fg: "#7c3aed" }; // purple
const R = { bg: "#fef2f2", fg: "#dc2626" }; // red
const A = { bg: "#fffbeb", fg: "#d97706" }; // amber

export const TILES: Record<string, Tile[]> = {
  klinik: [
    { label: "Registrasi pasien", icon: "ti-user-plus", ...G, href: "/klinik/registrasi" },
    { label: "Rekam medis", icon: "ti-notes-medical", ...G },
    { label: "Rawat inap", icon: "ti-bed", ...G, nw: true, href: "/klinik/rawat-inap" },
    { label: "Jadwal dokter", icon: "ti-calendar-event", ...B },
    { label: "Racik obat", icon: "ti-flask", ...B, nw: true, href: "/klinik/racik" },
    { label: "Booking online", icon: "ti-calendar-plus", ...P },
    { label: "Antrian digital", icon: "ti-list-numbers", ...B, href: "/klinik/antrian" },
  ],
  pos: [
    { label: "Transaksi POS", icon: "ti-cash-register", ...G, href: "/pos/transaksi" },
    { label: "Shift kasir", icon: "ti-clock-dollar", ...G, href: "/pos/shift" },
    { label: "Pengeluaran", icon: "ti-receipt-2", ...G, href: "/pos/expense" },
    { label: "Stok per gudang", icon: "ti-stack", ...G, href: "/pos/stok" },
    { label: "Permintaan barang", icon: "ti-truck-delivery", ...B, href: "/pos/permintaan" },
    { label: "Monitor expired", icon: "ti-calendar-x", ...R },
    { label: "Reorder alert", icon: "ti-alert-triangle", ...A },
    { label: "Quest staff", icon: "ti-trophy", ...A, nw: true, href: "/pos/quest" },
    { label: "Online / B2C", icon: "ti-world", ...P, nw: true },
    { label: "Stock opname", icon: "ti-clipboard-check", ...B },
  ],
  pembelian: [
    { label: "Pesanan pembelian", icon: "ti-file-invoice", ...G },
    { label: "Penerimaan barang", icon: "ti-package-import", ...G },
    { label: "Faktur pembelian", icon: "ti-receipt", ...G },
    { label: "Pembayaran pembelian", icon: "ti-cash", ...B },
    { label: "Retur pembelian", icon: "ti-package-export", ...R },
    { label: "Master pemasok", icon: "ti-building-store", ...P },
    { label: "Kat. pemasok", icon: "ti-tag", ...B },
    { label: "Perintah pembayaran", icon: "ti-send", ...B },
  ],
  penjualan: [
    { label: "Penawaran penjualan", icon: "ti-file-text", ...G },
    { label: "Pesanan penjualan", icon: "ti-shopping-bag", ...G },
    { label: "Pengiriman pesanan", icon: "ti-truck", ...G },
    { label: "Uang muka penjualan", icon: "ti-coin", ...B },
    { label: "Faktur penjualan", icon: "ti-receipt-2", ...G },
    { label: "Penerimaan penjualan", icon: "ti-cash-banknote", ...B },
    { label: "Retur penjualan", icon: "ti-arrow-back-up", ...R },
    { label: "Komisi penjual", icon: "ti-percentage", ...P },
    { label: "Target penjualan", icon: "ti-target", ...A },
  ],
  keuangan: [
    { label: "Bagan Akun (COA)", icon: "ti-list-numbers", ...G, href: "/keuangan/coa" },
    { label: "Jurnal umum", icon: "ti-notebook", ...G, href: "/keuangan/jurnal" },
    { label: "Buku besar", icon: "ti-book", ...B, href: "/keuangan/buku-besar" },
    { label: "Lap. laba rugi", icon: "ti-chart-bar", ...G, href: "/keuangan/laba-rugi" },
    { label: "Neraca", icon: "ti-scale", ...B, href: "/keuangan/neraca" },
    { label: "Arus kas", icon: "ti-arrows-exchange", ...P, href: "/keuangan/arus-kas" },
    { label: "AR Aging", icon: "ti-clock-hour-4", ...A },
    { label: "AP Aging", icon: "ti-clock-dollar", ...R },
    { label: "Aset tetap", icon: "ti-building", ...P },
    { label: "Rekonsiliasi bank", icon: "ti-building-bank", ...B, href: "/keuangan/rekonsiliasi" },
    { label: "Lap. HPP", icon: "ti-report", ...G },
  ],
  hris: [
    { label: "Data karyawan", icon: "ti-user-circle", ...G, href: "/hris/karyawan" },
    { label: "Absensi", icon: "ti-map-pin-check", ...G, href: "/hris/absensi" },
    { label: "Cuti & lembur", icon: "ti-calendar-time", ...B, href: "/hris/cuti" },
    { label: "Penggajian", icon: "ti-moneybag", ...G, href: "/hris/penggajian" },
    { label: "KPI karyawan", icon: "ti-chart-dots", ...P, href: "/hris/kpi" },
    { label: "Verifikasi wajah", icon: "ti-scan-eye", bg: "#f3f4f6", fg: "#9ca3af", p2: true },
  ],
  crm: [
    { label: "Data pelanggan", icon: "ti-users-group", ...G, href: "/crm/pelanggan" },
    { label: "Promo", icon: "ti-speakerphone", ...A },
    { label: "Kategori pelanggan", icon: "ti-crown", ...P },
    { label: "Retensi & WA", icon: "ti-brand-whatsapp", ...G },
    { label: "Owner dashboard", icon: "ti-dashboard", ...B },
  ],
  pengaturan: [
    { label: "Cabang & gudang", icon: "ti-building-store", ...G, href: "/pengaturan/cabang" },
    { label: "Manajemen pengguna", icon: "ti-shield", ...B },
    { label: "Chart of Accounts", icon: "ti-list-details", ...G },
    { label: "Konfigurasi loyalty", icon: "ti-star", ...A },
    { label: "WA Engine (7 trigger)", icon: "ti-brand-whatsapp", ...G },
    { label: "Komponen gaji", icon: "ti-coin", ...B },
  ],
};
