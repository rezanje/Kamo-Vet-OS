// Komplain Pelanggan — bagian murni (tanpa database): daftar nilai, alur status, saringan URL, pembaca hasil RPC, format tampilan, kolom Excel.
// Semua hak akses dan hitungan ditegakkan di database (migrasi 20261211100000_komplain_pelanggan.sql); di sini hanya bentuk dan tampilan.
// Modul ini TIDAK menyentuh uang atau stok: refund / ganti barang hanya dicatat sebagai teks (jenis penyelesaian + nomor dokumen).
import { amankanSel } from "./laporan-kategori-penjualan";

export const HALAMAN_KOMPLAIN = "/crm/komplain";
export const IZIN_KELOLA_KOMPLAIN = "crm.komplain_kelola";
export const FUNGSI_KOMPLAIN = {
  buat: "komplain_buat", status: "komplain_ubah_status", catatan: "komplain_catatan", detail: "komplain_ubah_detail",
  kategoriSimpan: "komplain_kategori_simpan", pengaturanSimpan: "komplain_pengaturan_simpan", pilihan: "komplain_pilihan",
  kategoriDaftar: "komplain_kategori_daftar", daftar: "komplain_daftar", lihat: "komplain_detail", dashboard: "komplain_dashboard",
} as const;

export const STATUS = ["Baru", "Dicek", "Dalam penanganan", "Menunggu pelanggan", "Selesai", "Ditolak"] as const;
export type Status = (typeof STATUS)[number];
export const STATUS_TUTUP: readonly Status[] = ["Selesai", "Ditolak"];
export const TINGKAT = ["Rendah", "Sedang", "Tinggi", "Kritis"] as const;
export type Tingkat = (typeof TINGKAT)[number];
export const KANAL = ["Petshop", "Klinik", "Grooming", "Rawat Inap", "Online Shopee", "Lainnya"] as const;
export type Kanal = (typeof KANAL)[number];
export const JENIS_REFERENSI = ["Invoice klinik", "Struk petshop", "Pesanan online", "Lainnya"] as const;
export const JENIS_PENYELESAIAN = ["Maaf/penjelasan", "Ganti barang", "Refund", "Diskon/voucher", "Edukasi staf", "Tidak valid"] as const;
export const BATAS_TELAT_BAWAAN = 3;
export const BATAS_DESKRIPSI = 4000;

export const CATATAN_UANG = "Komplain hanya mencatat. Refund, ganti barang, dan diskon tetap dikerjakan lewat layar refund / koreksi yang sudah ada; di sini hanya dicatat sebagai teks.";

/** Status tujuan yang sah dari status sekarang (sama persis dengan fungsi komplain_ubah_status). Komplain tertutup hanya bisa dibuka kembali ke "Dalam penanganan". */
export function statusBerikut(status: string): Status[] {
  switch (status) {
    case "Baru": return ["Dicek", "Dalam penanganan", "Menunggu pelanggan", "Selesai", "Ditolak"];
    case "Dicek": return ["Dalam penanganan", "Menunggu pelanggan", "Selesai", "Ditolak"];
    case "Dalam penanganan": return ["Menunggu pelanggan", "Selesai", "Ditolak"];
    case "Menunggu pelanggan": return ["Dalam penanganan", "Selesai", "Ditolak"];
    case "Selesai": case "Ditolak": return ["Dalam penanganan"];
    default: return [];
  }
}
export const adalahTutup = (status: string): boolean => (STATUS_TUTUP as readonly string[]).includes(status);

export const WARNA_TINGKAT: Record<string, { warna: string; latar: string }> = {
  Rendah: { warna: "#475569", latar: "#f1f5f9" }, Sedang: { warna: "#b45309", latar: "#fffbeb" },
  Tinggi: { warna: "#c2410c", latar: "#ffedd5" }, Kritis: { warna: "#b91c1c", latar: "#fee2e2" },
};
export const WARNA_STATUS: Record<string, { warna: string; latar: string }> = {
  Baru: { warna: "#1d4ed8", latar: "#dbeafe" }, Dicek: { warna: "#6d28d9", latar: "#ede9fe" }, "Dalam penanganan": { warna: "#b45309", latar: "#fffbeb" },
  "Menunggu pelanggan": { warna: "#0f766e", latar: "#ccfbf1" }, Selesai: { warna: "#15803d", latar: "#e8f5ee" }, Ditolak: { warna: "#475569", latar: "#f1f5f9" },
};

// ───────────── tipe hasil RPC ─────────────
export type Karyawan = { id: string; name: string };
export type BarisKomplain = {
  id: string; nomor: string; cabang_id: string; cabang: string | null; kanal: string; tanggal: string; waktu: string;
  pelanggan_id: string | null; hewan_id: string | null; nama: string | null; telepon: string | null; hewan: string | null;
  ref_jenis: string | null; ref_nomor: string | null; kategori_id: string; kategori: string | null; tingkat: string;
  deskripsi: string; harapan: string | null; karyawan: Karyawan[]; nominal: number | null; petugas_id: string | null; petugas: string | null;
  status: string; respons_pertama: string | null; ditutup: string | null; jenis_penyelesaian: string | null; catatan_penyelesaian: string | null;
  dibuat_oleh: string; dibuat: string; umur_hari: number | null; terlambat: boolean; respons_jam: number | null; selesai_hari: number | null;
  dibuat_nama?: string | null;
};
export type HasilDaftar = { total: number; baris: BarisKomplain[]; hari_telat: number };
export type Riwayat = { seq: number; jenis: string; dari: string | null; ke: string | null; catatan: string | null; perubahan: Record<string, unknown> | null; oleh: string | null; peran: string | null; waktu: string };
export type Berkas = { id: string; path: string; nama: string; mime: string | null; ukuran: number | null; waktu: string };
export type DetailKomplain = {
  komplain: BarisKomplain; riwayat: Riwayat[]; berkas: Berkas[]; hari_telat: number;
  boleh: { ubah: boolean; catatan: boolean; buka_kembali: boolean; kelola: boolean };
};
export type Pilihan = {
  peran: string; kelola: boolean; hari_telat: number;
  kategori: { id: string; nama: string }[]; cabang: { id: string; nama: string; kode: string }[]; petugas: { id: string; nama: string; peran: string }[];
};
export type KategoriBaris = { id: string; nama: string; urut: number; aktif: boolean; dipakai: number };
export type HasilKategori = { kelola: boolean; hari_telat: number; kategori: KategoriBaris[] };
export type Dashboard = {
  rentang: { dari: string; sampai: string }; hari_telat: number; hari_ini: string;
  kpi: { total: number; terbuka: number; terlambat: number; kritis_terbuka: number; ditutup_rentang: number; ditutup_bulan_ini: number; rata_respons_jam: number | null; rata_selesai_hari: number | null };
  per_cabang: { cabang_id: string; cabang: string | null; jumlah: number; terbuka: number }[];
  per_kategori: { kategori_id: string; kategori: string | null; jumlah: number; terbuka: number }[];
  per_tingkat: { tingkat: string; jumlah: number; terbuka: number }[];
  per_status: { status: string; jumlah: number }[];
  per_kanal: { kanal: string; jumlah: number }[];
  tren_hari: { tanggal: string; jumlah: number }[];
  tren_minggu: { minggu: string; jumlah: number }[];
  pelanggan_berulang: { pelanggan_id: string | null; nama: string | null; telepon: string | null; jumlah: number; terakhir: string }[];
  karyawan_disebut: { karyawan_id: string; nama: string | null; jumlah: number; terakhir: string }[];
  umur_terbuka: BarisKomplain[];
};

const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const arr = (x: unknown): x is unknown[] => Array.isArray(x);
const barisValid = (x: unknown): x is BarisKomplain => obj(x) && typeof x.id === "string" && typeof x.nomor === "string" && typeof x.status === "string" && typeof x.tingkat === "string" && arr(x.karyawan);

export function bacaDaftar(d: unknown): HasilDaftar | null {
  if (!obj(d) || !num(d.total) || !arr(d.baris) || !d.baris.every(barisValid) || !num(d.hari_telat)) return null;
  return d as unknown as HasilDaftar;
}
export function bacaDetail(d: unknown): DetailKomplain | null {
  if (!obj(d) || !barisValid(d.komplain) || !arr(d.riwayat) || !arr(d.berkas) || !obj(d.boleh)) return null;
  return d as unknown as DetailKomplain;
}
export function bacaPilihan(d: unknown): Pilihan | null {
  if (!obj(d) || typeof d.peran !== "string" || typeof d.kelola !== "boolean" || !arr(d.kategori) || !arr(d.cabang) || !arr(d.petugas)) return null;
  return d as unknown as Pilihan;
}
export function bacaKategori(d: unknown): HasilKategori | null {
  if (!obj(d) || typeof d.kelola !== "boolean" || !arr(d.kategori)) return null;
  return d as unknown as HasilKategori;
}
export function bacaDashboard(d: unknown): Dashboard | null {
  if (!obj(d) || !obj(d.kpi) || !obj(d.rentang)) return null;
  const k = d.kpi;
  if (!["total", "terbuka", "terlambat", "kritis_terbuka", "ditutup_rentang", "ditutup_bulan_ini"].every(f => num(k[f]))) return null;
  for (const f of ["per_cabang", "per_kategori", "per_tingkat", "per_status", "per_kanal", "tren_hari", "tren_minggu", "pelanggan_berulang", "karyawan_disebut", "umur_terbuka"]) if (!arr(d[f])) return null;
  if (!(d.umur_terbuka as unknown[]).every(barisValid)) return null;
  return d as unknown as Dashboard;
}

// ───────────── saringan URL ─────────────
export type FilterKomplain = {
  dari: string; sampai: string; cabang: string; kategori: string; tingkat: string; status: string; petugas: string; kanal: string; q: string; urut: "terbaru" | "umur" | "nomor"; hal: number;
};
export const UKURAN_HALAMAN = 25;
const TGL = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const adalahUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
const tanggalSah = (s: string): boolean => TGL.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

export const hariIniWib = (now: Date = new Date()): string => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const awalBulan = (hari: string): string => hari.slice(0, 8) + "01";
export function geserHari(tgl: string, n: number): string { const d = new Date(tgl + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const ambil = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** Saringan dari URL. `bulanIni`: dashboard memakai bulan ini bila tanggal tidak diisi; daftar tidak membatasi tanggal. Nilai tak sah dibuang. */
export function bacaFilter(raw: Record<string, string | string[] | undefined>, opsi: { bulanIni?: boolean; hariIni?: string } = {}): FilterKomplain {
  const hari = opsi.hariIni ?? hariIniWib();
  let dari = ambil(raw.dari), sampai = ambil(raw.sampai);
  if (!tanggalSah(dari)) dari = ""; if (!tanggalSah(sampai)) sampai = "";
  if (opsi.bulanIni) { if (!dari) dari = awalBulan(hari); if (!sampai) sampai = hari; }
  if (dari && sampai && sampai < dari) [dari, sampai] = [sampai, dari];
  const cabang = ambil(raw.cabang), kategori = ambil(raw.kategori), petugas = ambil(raw.petugas);
  const tingkat = ambil(raw.tingkat), status = ambil(raw.status), kanal = ambil(raw.kanal);
  const urut = ambil(raw.urut);
  const hal = Number.parseInt(ambil(raw.hal), 10);
  return {
    dari, sampai, cabang: adalahUuid(cabang) ? cabang : "", kategori: adalahUuid(kategori) ? kategori : "", petugas: adalahUuid(petugas) ? petugas : "",
    tingkat: (TINGKAT as readonly string[]).includes(tingkat) ? tingkat : "", kanal: (KANAL as readonly string[]).includes(kanal) ? kanal : "",
    status: [...STATUS, "terbuka", "ditutup"].includes(status) ? status : "", q: ambil(raw.q).trim().slice(0, 80),
    urut: urut === "umur" || urut === "nomor" ? urut : "terbaru", hal: Number.isFinite(hal) && hal > 0 && hal < 10_000 ? hal : 1,
  };
}

/** Parameter RPC (komplain_daftar / komplain_dashboard) dari saringan. */
export const paramSaringan = (f: FilterKomplain) => ({
  p_dari: f.dari || null, p_sampai: f.sampai || null, p_branch: f.cabang || null, p_kategori: f.kategori || null, p_severity: f.tingkat || null,
  p_status: f.status || null, p_assigned: f.petugas || null, p_channel: f.kanal || null,
});

export function tautanFilter(path: string, f: Partial<FilterKomplain>, ubah: Partial<FilterKomplain> = {}): string {
  const m = { ...f, ...ubah }; const p = new URLSearchParams();
  for (const [k, v] of Object.entries(m)) {
    if (v === "" || v == null || (k === "urut" && v === "terbaru") || (k === "hal" && v === 1)) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

// ───────────── format tampilan ─────────────
export const rupiah = (n: number | null | undefined): string => (n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
export function tanggalPendek(tgl: string | null | undefined): string {
  if (!tgl || !TGL.test(tgl.slice(0, 10))) return "—";
  const [y, m, d] = tgl.slice(0, 10).split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][m - 1]} ${y}`;
}
export function waktuWib(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso); if (Number.isNaN(t)) return "—";
  const w = new Date(t + 7 * 3600_000).toISOString();
  return `${tanggalPendek(w.slice(0, 10))} ${w.slice(11, 16)}`;
}
export function teksUmur(b: Pick<BarisKomplain, "umur_hari" | "terlambat">): string {
  if (b.umur_hari == null) return "Ditutup";
  const t = b.umur_hari <= 0 ? "Hari ini" : `${b.umur_hari} hari`;
  return b.terlambat ? `${t} · terlambat` : t;
}
export const teksJam = (j: number | null | undefined): string => (j == null ? "—" : `${j.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`);
export const teksHari = (h: number | null | undefined): string => (h == null ? "—" : `${h.toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari`);

// ───────────── pemeriksaan isian (tampilan; database memeriksa ulang) ─────────────
export type IsianBaru = { cabang: string; kanal: string; kategori: string; tingkat: string; deskripsi: string; ref_jenis: string; ref_nomor: string; tanggal: string; nominal: string };
export function periksaBaru(i: IsianBaru, hari: string): string | null {
  if (!adalahUuid(i.cabang)) return "Pilih cabang.";
  if (!(KANAL as readonly string[]).includes(i.kanal)) return "Pilih asal komplain.";
  if (!adalahUuid(i.kategori)) return "Pilih kategori.";
  if (!(TINGKAT as readonly string[]).includes(i.tingkat)) return "Pilih tingkat keparahan.";
  if (i.deskripsi.trim().length < 5) return "Isi komplain wajib diisi (minimal 5 huruf).";
  if (i.deskripsi.length > BATAS_DESKRIPSI) return `Isi komplain maksimal ${BATAS_DESKRIPSI} huruf.`;
  if (Boolean(i.ref_jenis) !== Boolean(i.ref_nomor.trim())) return "Isi jenis dan nomor dokumen bersama-sama, atau kosongkan keduanya.";
  if (i.tanggal) { if (!tanggalSah(i.tanggal)) return "Tanggal komplain tidak sah."; if (i.tanggal > hari) return "Tanggal komplain tidak boleh di masa depan."; if (i.tanggal < geserHari(hari, -180)) return "Tanggal komplain maksimal 180 hari ke belakang."; }
  if (i.nominal.trim() && !(Number(i.nominal) >= 0)) return "Nilai rupiah harus angka nol atau lebih.";
  return null;
}
export function periksaStatus(tujuan: string, catatan: string, jenis: string): string | null {
  if (!(STATUS as readonly string[]).includes(tujuan) || tujuan === "Baru") return "Pilih status tujuan.";
  if (adalahTutup(tujuan)) {
    if (catatan.trim().length < 5) return "Menutup komplain wajib dengan catatan penyelesaian (minimal 5 huruf).";
    if (!(JENIS_PENYELESAIAN as readonly string[]).includes(jenis)) return "Pilih jenis penyelesaian.";
    if (tujuan === "Ditolak" && jenis !== "Tidak valid") return "Komplain yang ditolak berjenis penyelesaian \"Tidak valid\".";
    if (tujuan === "Selesai" && jenis === "Tidak valid") return "\"Tidak valid\" hanya untuk status Ditolak.";
  }
  return null;
}
export const kunciPermintaan = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0"));

// ───────────── Excel ─────────────
export const KOLOM_EXCEL = ["Nomor", "Tanggal komplain", "Cabang", "Asal", "Kategori", "Tingkat", "Status", "Pelanggan", "Telepon", "Hewan", "Dokumen", "Isi komplain",
  "Harapan pelanggan", "Karyawan terlibat", "Nilai (Rp)", "Petugas", "Umur (hari)", "Terlambat", "Respons pertama (jam)", "Ditutup", "Jenis penyelesaian", "Catatan penyelesaian", "Selesai (hari)"] as const;
export function barisExcel(b: BarisKomplain): (string | number)[] {
  return [
    b.nomor, b.tanggal, b.cabang ?? "", b.kanal, b.kategori ?? "", b.tingkat, b.status, b.nama ?? "", b.telepon ?? "", b.hewan ?? "",
    b.ref_jenis ? `${b.ref_jenis} ${b.ref_nomor ?? ""}`.trim() : "", b.deskripsi, b.harapan ?? "", b.karyawan.map(k => k.name).join(", "),
    b.nominal ?? "", b.petugas ?? "", b.umur_hari ?? "", b.ditutup ? "" : b.terlambat ? "Ya" : "Tidak", b.respons_jam ?? "", b.ditutup ? waktuWib(b.ditutup) : "",
    b.jenis_penyelesaian ?? "", b.catatan_penyelesaian ?? "", b.selesai_hari ?? "",
  ].map(amankanSel);
}

// ───────────── pesan galat database -> teks Indonesia ─────────────
const PESAN: [RegExp, string][] = [
  [/ADMIN_ONLINE_FUNCTION_DENIED|KOMPLAIN_DITOLAK/, "Akun ini tidak boleh memakai Komplain Pelanggan."],
  [/KOMPLAIN_CABANG_DITOLAK/, "Cabang ini tidak boleh Anda akses."],
  [/KOMPLAIN_KUNCI_DIPAKAI/, "Permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman lalu coba lagi."],
  [/KOMPLAIN_TIDAK_ADA_PERUBAHAN/, "Tidak ada yang berubah."],
  [/KOMPLAIN_TIDAK_ADA/, "Komplain tidak ditemukan atau bukan untuk akun Anda."],
  [/KOMPLAIN_BUKAN_PENANGANAN/, "Hanya pembuat, petugas, atau pemegang izin kelola yang boleh mengubah komplain ini."],
  [/KOMPLAIN_BUKA_KEMBALI/, "Membuka kembali komplain yang sudah ditutup hanya untuk Owner atau pemegang izin kelola."],
  [/KOMPLAIN_ALASAN_BUKA/, "Tulis alasan membuka kembali (minimal 5 huruf)."],
  [/KOMPLAIN_TRANSISI/, "Perpindahan status itu tidak diizinkan dari status sekarang."],
  [/KOMPLAIN_STATUS_SAMA/, "Komplain sudah berstatus itu."],
  [/KOMPLAIN_CATATAN_PENYELESAIAN/, "Menutup komplain wajib dengan catatan penyelesaian (minimal 5 huruf)."],
  [/KOMPLAIN_JENIS_PENYELESAIAN_TERLARANG/, "Jenis penyelesaian hanya diisi saat menutup komplain."],
  [/KOMPLAIN_JENIS_PENYELESAIAN/, "Pilih jenis penyelesaian."],
  [/KOMPLAIN_PENYELESAIAN_TIDAK_COCOK/, "Jenis penyelesaian tidak cocok dengan status (Ditolak = Tidak valid)."],
  [/KOMPLAIN_SUDAH_DITUTUP/, "Komplain sudah ditutup. Buka kembali dulu bila perlu diubah."],
  [/KOMPLAIN_ALASAN_UBAH/, "Tulis alasan perubahan (minimal 3 huruf)."],
  [/KOMPLAIN_PETUGAS/, "Petugas harus akun aktif yang punya akses ke cabang ini."],
  [/KOMPLAIN_KATEGORI_KEMBAR/, "Kategori dengan nama itu sudah ada."],
  [/KOMPLAIN_KELOLA_DITOLAK/, "Hanya Owner atau pemegang izin kelola komplain yang boleh mengubah ini."],
  [/KOMPLAIN_KATEGORI/, "Pilih kategori yang aktif."],
  [/KOMPLAIN_DESKRIPSI/, "Isi komplain wajib diisi (5 sampai 4000 huruf)."],
  [/KOMPLAIN_TANGGAL/, "Tanggal komplain tidak boleh di masa depan atau lebih dari 180 hari lalu."],
  [/KOMPLAIN_LAMPIRAN/, "Lampiran tidak valid (maksimal 10 berkas, 10 MB per berkas)."],
  [/KOMPLAIN_REFERENSI/, "Isi jenis dan nomor dokumen bersama-sama, atau kosongkan keduanya."],
  [/KOMPLAIN_PELANGGAN|KOMPLAIN_HEWAN/, "Data pelanggan atau hewan tidak ditemukan. Muat ulang halaman."],
  [/KOMPLAIN_KARYAWAN/, "Karyawan yang dipilih tidak ditemukan."],
  [/KOMPLAIN_HARI_TELAT/, "Batas terlambat 1 sampai 90 hari."],
  [/KOMPLAIN_CABANG/, "Pilih cabang yang aktif."],
];
export const pesanGalatKomplain = (message: string | undefined | null): string =>
  PESAN.find(([re]) => re.test(String(message ?? "")))?.[1] ?? "Belum bisa disimpan. Muat ulang halaman lalu coba lagi.";

// ───────────── masukan aksi server ─────────────
export type LampiranKomplain = { path: string; nama: string; mime: string | null; ukuran: number | null };
export type BuatInput = {
  kunci: string; cabang: string; kanal: string; tanggal: string; pelangganId: string | null; hewanId: string | null; nama: string; telepon: string;
  refJenis: string; refNomor: string; kategori: string; tingkat: string; deskripsi: string; harapan: string; karyawan: string[]; nominal: string;
  petugas: string | null; lampiran: LampiranKomplain[];
};
export type StatusInput = { kunci: string; id: string; status: string; catatan: string; jenis: string };
export type CatatanInput = { kunci: string; id: string; catatan: string; lampiran: LampiranKomplain[] };
export type DetailInput = {
  kunci: string; id: string; kategori: string; tingkat: string; petugas: string | null; karyawan: string[]; nominal: string; harapan: string;
  refJenis: string; refNomor: string; catatan: string;
};
export type KategoriInput = { id: string | null; nama: string; urut: number | null; aktif: boolean };

/** Rupiah dari isian teks ("150000", "150.000" tidak dipakai) -> angka atau null. */
export function nominalDariIsian(s: string): number | null {
  const t = String(s ?? "").trim(); if (!t) return null;
  const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null;
}
export function lampiranAman(x: unknown): LampiranKomplain[] {
  if (!Array.isArray(x)) return [];
  const out: LampiranKomplain[] = [];
  for (const r of x.slice(0, 10)) {
    const row = (r ?? {}) as Partial<LampiranKomplain>; const path = String(row.path ?? "").trim();
    if (!path.startsWith("komplain/") || path.includes("..") || path.length > 500) continue;
    const ukuran = Number(row.ukuran);
    out.push({ path, nama: String(row.nama ?? "").trim().slice(0, 200) || "berkas", mime: String(row.mime ?? "").trim().slice(0, 120) || null,
      ukuran: Number.isFinite(ukuran) && ukuran > 0 && ukuran <= 10 * 1024 * 1024 ? Math.round(ukuran) : null });
  }
  return out;
}

/** Hasil aksi server yang dipakai layar (bentuk dasar; aksi tertentu menambah kolom). */
export type HasilAksiUi = { ok: true; sudahAda?: boolean } | { ok: false; pesan: string };

const JUDUL_RIWAYAT: Record<string, string> = { dibuat: "Komplain dicatat", status: "Status berubah", catatan: "Catatan", ubah: "Rincian diubah", tugaskan: "Petugas diubah", lampiran: "Lampiran ditambah" };
export const judulRiwayat = (jenis: string): string => JUDUL_RIWAYAT[jenis] ?? jenis;
const LABEL_UBAH: Record<string, string> = { kategori: "Kategori", tingkat: "Tingkat", petugas: "Petugas", karyawan: "Karyawan terlibat", nominal: "Nilai", harapan: "Harapan", referensi: "Dokumen", jenis_penyelesaian: "Jenis penyelesaian", nomor: "Nomor", lampiran: "Lampiran" };
const nilaiRingkas = (v: unknown): string => {
  if (v == null || v === "") return "kosong";
  if (Array.isArray(v)) return v.map(x => (typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : String(x))).join(", ") || "kosong";
  return String(v);
};
/** Ringkasan perubahan (kolom `perubahan` jejak) jadi teks pendek: "Tingkat: Kritis → Tinggi; ...". */
export function ringkasPerubahan(p: Record<string, unknown> | null): string {
  if (!p) return "";
  return Object.entries(p).map(([k, v]) => {
    const label = LABEL_UBAH[k] ?? k;
    if (v && typeof v === "object" && !Array.isArray(v) && "dari" in v && "ke" in v) return `${label}: ${nilaiRingkas((v as { dari: unknown }).dari)} → ${nilaiRingkas((v as { ke: unknown }).ke)}`;
    return `${label}: ${nilaiRingkas(v)}`;
  }).join("; ");
}
