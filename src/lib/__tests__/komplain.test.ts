import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_ONLINE } from "../admin-online";
import { SELALU_BOLEH, bolehBukaPath } from "../akses";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";
import {
  FUNGSI_KOMPLAIN, IZIN_KELOLA_KOMPLAIN, JENIS_PENYELESAIAN, JENIS_REFERENSI, KANAL, KOLOM_EXCEL, STATUS, STATUS_TUTUP, TINGKAT, UKURAN_HALAMAN,
  adalahTutup, adalahUuid, awalBulan, bacaDaftar, bacaDashboard, bacaDetail, bacaFilter, bacaKategori, bacaPilihan, barisExcel, geserHari, hariIniWib, judulRiwayat,
  lampiranAman, nominalDariIsian, paramSaringan, periksaBaru, periksaStatus, pesanGalatKomplain, ringkasPerubahan, rupiah, statusBerikut, tanggalPendek, tautanFilter,
  teksHari, teksJam, teksUmur, waktuWib, type BarisKomplain,
} from "../komplain";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261211100000_komplain_pelanggan.sql"), "utf8");
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";

const baris = (o: Partial<BarisKomplain> = {}): BarisKomplain => ({
  id: U1, nomor: "KMP-202611-0001", cabang_id: U2, cabang: "Petshop A", kanal: "Petshop", tanggal: "2026-11-20", waktu: "2026-11-20T03:00:00Z", pelanggan_id: null, hewan_id: null,
  nama: "=CMD()", telepon: "0812", hewan: "Mochi", ref_jenis: "Struk petshop", ref_nomor: "STR-1", kategori_id: U1, kategori: "Grooming", tingkat: "Tinggi",
  deskripsi: "Hasil kurang rapi", harapan: null, karyawan: [{ id: U1, name: "Kasir Satu" }], nominal: 150000, petugas_id: null, petugas: null, status: "Baru",
  respons_pertama: null, ditutup: null, jenis_penyelesaian: null, catatan_penyelesaian: null, dibuat_oleh: U1, dibuat: "2026-11-20T03:00:00Z", umur_hari: 5, terlambat: true,
  respons_jam: null, selesai_hari: null, ...o,
});

describe("daftar nilai sinkron dengan migrasi", () => {
  const dalamSql = (kolom: string): string[] => {
    const m = new RegExp(`\\b${kolom} text[^\\n]*?${kolom} in \\(([^)]*)\\)`).exec(sql);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
  };
  it("status, tingkat, kanal, jenis dokumen, jenis penyelesaian = CHECK di tabel", () => {
    expect(dalamSql("status")).toEqual([...STATUS]);
    expect(dalamSql("severity")).toEqual([...TINGKAT]);
    expect(dalamSql("channel")).toEqual([...KANAL]);
    expect(dalamSql("ref_kind")).toEqual([...JENIS_REFERENSI]);
    expect(dalamSql("resolution_type")).toEqual([...JENIS_PENYELESAIAN]);
  });
  it("alur status di aplikasi = matriks di komplain_ubah_status (tiap status terbuka)", () => {
    for (const s of ["Baru", "Dicek", "Dalam penanganan", "Menunggu pelanggan"]) {
      const m = new RegExp(`when '${s}' then p_status in \\(([^)]*)\\)`).exec(sql);
      expect(m, s).not.toBeNull();
      expect([...m![1].matchAll(/'([^']+)'/g)].map(x => x[1]), s).toEqual(statusBerikut(s));
    }
    expect(statusBerikut("Selesai")).toEqual(["Dalam penanganan"]);
    expect(statusBerikut("Ditolak")).toEqual(["Dalam penanganan"]);
    expect(sql).toContain("p_status <> 'Dalam penanganan'");
    expect(statusBerikut("Hilang")).toEqual([]);
    expect(STATUS.map(s => statusBerikut(s).includes("Baru" as never))).not.toContain(true);
  });
  it("kategori awal dan fungsi publik sinkron", () => {
    expect([...sql.matchAll(/^ \('([^']+)', \d+\)/gm)].length + [...sql.matchAll(/\('([^']+)', \d+\)[,;]/g)].length).toBeGreaterThanOrEqual(10);
    for (const f of Object.values(FUNGSI_KOMPLAIN)) expect(sql, f).toContain(`create function public.${f}(`);
    expect(sql).toContain("n.nspname = 'public' and p.proname like 'komplain\\_%';\n  if v_n <> 13");
    expect(Object.values(FUNGSI_KOMPLAIN)).toHaveLength(11);
  });
  it("izin kelola: terdaftar izin khusus, baris katalog modul CRM, aktor Owner dulu lalu kebijakan eksplisit", () => {
    expect(IZIN_KELOLA_KOMPLAIN).toBe("crm.komplain_kelola");
    expect(GRANT_ONLY_ACTIONS).toContain(IZIN_KELOLA_KOMPLAIN);
    expect(isGrantOnlyAction(IZIN_KELOLA_KOMPLAIN)).toBe(true);
    expect(sql).toMatch(/action_catalog\(id, label, "group", enforced\) values\s*\('crm\.komplain_kelola', '[^']*', 'CRM', true\)/);
    expect(sql).toMatch(/action_modules\(id, module_id\) values \('crm\.komplain_kelola', 'crm'\)/);
    expect(sql).toMatch(/if v_role = 'OWNER' then return true; end if;[\s\S]*if not found then return false; end if;/);
  });
  it("migrasi: satu transaksi tanpa begin/commit sendiri, lock_timeout, semua tabel baru ber-RLS dan tanpa hak tulis klien, pagar Admin Online dijalankan ulang", () => {
    expect(sql.split("\n").filter(l => ["begin;", "commit;"].includes(l.trim().toLowerCase()))).toEqual([]);
    expect(sql).toContain("set local lock_timeout = '5s';");
    expect((sql.match(/create table public\./g) ?? []).length).toBe(7);
    expect((sql.match(/enable row level security/g) ?? []).length).toBe(7);
    expect(sql).toContain("select admin_online_private.guard_all();");
    expect(sql).toContain("select admin_online_private.fence_all();");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i);
    expect(sql).not.toMatch(/\b(journal_entries|journal_lines|stock_moves|expenses|point_ledger)\b/);
  });
});

describe("akses halaman: semua akun internal, Admin Online tidak pernah", () => {
  it("/crm/komplain ada di daftar selalu-boleh", () => { expect(SELALU_BOLEH).toContain("/crm/komplain"); });
  it("STAFF/DOCTOR/FINANCE tanpa modul CRM tetap membuka layar komplain; layar CRM lain tetap tertutup", () => {
    for (const role of ["STAFF", "DOCTOR", "FINANCE", "ADMIN", "OWNER"]) {
      for (const p of ["/crm/komplain", "/crm/komplain/baru", "/crm/komplain/dashboard", "/crm/komplain/abc", "/crm/komplain/unduh"]) expect(bolehBukaPath(role, p, []), `${role} ${p}`).toBe(true);
    }
    expect(bolehBukaPath("STAFF", "/crm/pelanggan", [{ role: "STAFF", module_id: "klinik" }])).toBe(false);
    expect(bolehBukaPath("STAFF", "/crm/komplain/baru", [{ role: "STAFF", module_id: "klinik" }])).toBe(true);
    expect(bolehBukaPath("FINANCE", "/crm/follow-up", [])).toBe(false);
  });
  it("Admin Online ditolak di semua layar komplain", () => {
    for (const p of ["/crm/komplain", "/crm/komplain/baru", "/crm/komplain/dashboard", "/crm/komplain/unduh", "/crm/komplain/x?y=1"]) expect(bolehBukaPath(ADMIN_ONLINE, p, []), p).toBe(false);
  });
});

describe("saringan URL", () => {
  const hari = "2026-11-25";
  it("dashboard: bulan ini bila tanggal kosong; daftar tanpa batas tanggal", () => {
    expect(bacaFilter({}, { bulanIni: true, hariIni: hari })).toMatchObject({ dari: "2026-11-01", sampai: "2026-11-25", urut: "terbaru", hal: 1 });
    expect(bacaFilter({}, { hariIni: hari })).toMatchObject({ dari: "", sampai: "" });
  });
  it("nilai tak sah dibuang; tanggal terbalik ditukar; uuid wajib sah; halaman minimal 1", () => {
    const f = bacaFilter({ dari: "2026-13-40", sampai: "bukan", cabang: "x", kategori: U1, petugas: "'; drop", tingkat: "Parah", kanal: "Tokopedia", status: "Hilang", urut: "acak", hal: "-4" }, { hariIni: hari });
    expect(f).toMatchObject({ dari: "", sampai: "", cabang: "", kategori: U1, petugas: "", tingkat: "", kanal: "", status: "", urut: "terbaru", hal: 1 });
    expect(bacaFilter({ dari: "2026-11-20", sampai: "2026-11-10" }, { hariIni: hari })).toMatchObject({ dari: "2026-11-10", sampai: "2026-11-20" });
    expect(bacaFilter({ status: "terbuka", tingkat: "Kritis", kanal: "Klinik", urut: "umur", hal: "3", q: "  Budi  " }, { hariIni: hari })).toMatchObject({ status: "terbuka", tingkat: "Kritis", kanal: "Klinik", urut: "umur", hal: 3, q: "Budi" });
    expect(bacaFilter({ cabang: [U1, U2] }, { hariIni: hari }).cabang).toBe(U1);
    expect(bacaFilter({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(bacaFilter({ dari: "2026-02-30" }).dari).toBe("");
  });
  it("parameter RPC dan tautan balik", () => {
    const f = bacaFilter({ cabang: U1, tingkat: "Kritis", dari: "2026-11-01", sampai: "2026-11-25" }, { hariIni: hari });
    expect(paramSaringan(f)).toEqual({ p_dari: "2026-11-01", p_sampai: "2026-11-25", p_branch: U1, p_kategori: null, p_severity: "Kritis", p_status: null, p_assigned: null, p_channel: null });
    expect(tautanFilter("/crm/komplain", f, { hal: 2 })).toBe(`/crm/komplain?dari=2026-11-01&sampai=2026-11-25&cabang=${U1}&tingkat=Kritis&hal=2`);
    expect(tautanFilter("/crm/komplain", bacaFilter({}, { hariIni: hari }))).toBe("/crm/komplain");
    expect(tautanFilter("/x", f, { dari: "", sampai: "", cabang: "" })).toBe("/x?tingkat=Kritis");
  });
  it("tanggal WIB", () => {
    expect(hariIniWib(new Date("2026-11-24T20:30:00Z"))).toBe("2026-11-25");
    expect(hariIniWib(new Date("2026-11-24T16:59:59Z"))).toBe("2026-11-24");
    expect(awalBulan("2026-11-25")).toBe("2026-11-01"); expect(geserHari("2026-03-01", -1)).toBe("2026-02-28");
    expect(adalahUuid(U1)).toBe(true); expect(adalahUuid("123")).toBe(false); expect(adalahUuid(null)).toBe(false);
  });
});

describe("pemeriksaan isian", () => {
  const ok = { cabang: U1, kanal: "Petshop", kategori: U2, tingkat: "Sedang", deskripsi: "Kembalian kurang", ref_jenis: "", ref_nomor: "", tanggal: "", nominal: "" };
  const hari = "2026-11-25";
  it("isian benar lolos; tiap pelanggaran punya pesan", () => {
    expect(periksaBaru(ok, hari)).toBeNull();
    expect(periksaBaru({ ...ok, cabang: "" }, hari)).toMatch(/cabang/i);
    expect(periksaBaru({ ...ok, kanal: "X" }, hari)).toMatch(/asal/i);
    expect(periksaBaru({ ...ok, kategori: "" }, hari)).toMatch(/kategori/i);
    expect(periksaBaru({ ...ok, tingkat: "Parah" }, hari)).toMatch(/tingkat/i);
    expect(periksaBaru({ ...ok, deskripsi: "abc" }, hari)).toMatch(/Isi komplain/);
    expect(periksaBaru({ ...ok, deskripsi: "x".repeat(4001) }, hari)).toMatch(/maksimal 4000/);
    expect(periksaBaru({ ...ok, ref_jenis: "Struk petshop" }, hari)).toMatch(/bersama-sama/);
    expect(periksaBaru({ ...ok, ref_nomor: "1" }, hari)).toMatch(/bersama-sama/);
    expect(periksaBaru({ ...ok, ref_jenis: "Struk petshop", ref_nomor: "1" }, hari)).toBeNull();
    expect(periksaBaru({ ...ok, tanggal: "2026-11-26" }, hari)).toMatch(/masa depan/);
    expect(periksaBaru({ ...ok, tanggal: "2026-05-01" }, hari)).toMatch(/180 hari/);
    expect(periksaBaru({ ...ok, tanggal: "2026-11-20" }, hari)).toBeNull();
    expect(periksaBaru({ ...ok, tanggal: "kemarin" }, hari)).toMatch(/tidak sah/);
    expect(periksaBaru({ ...ok, nominal: "-5" }, hari)).toMatch(/nol atau lebih/);
    expect(periksaBaru({ ...ok, nominal: "150000" }, hari)).toBeNull();
  });
  it("menutup wajib catatan dan jenis yang cocok; status lain bebas catatan", () => {
    expect(periksaStatus("Dicek", "", "")).toBeNull();
    expect(periksaStatus("Baru", "", "")).toMatch(/status tujuan/);
    expect(periksaStatus("Selesai", "", "Refund")).toMatch(/catatan penyelesaian/);
    expect(periksaStatus("Selesai", "ok", "Refund")).toMatch(/minimal 5/);
    expect(periksaStatus("Selesai", "Sudah dijelaskan", "")).toMatch(/jenis penyelesaian/);
    expect(periksaStatus("Selesai", "Sudah dijelaskan", "Tidak valid")).toMatch(/hanya untuk status Ditolak/);
    expect(periksaStatus("Ditolak", "Bukan komplain kami", "Refund")).toMatch(/Tidak valid/);
    expect(periksaStatus("Ditolak", "Bukan komplain kami", "Tidak valid")).toBeNull();
    expect(periksaStatus("Selesai", "Sudah dijelaskan", "Maaf/penjelasan")).toBeNull();
    expect(STATUS_TUTUP).toEqual(["Selesai", "Ditolak"]); expect(adalahTutup("Selesai")).toBe(true); expect(adalahTutup("Dicek")).toBe(false);
  });
  it("nilai rupiah dan lampiran dibersihkan", () => {
    expect(nominalDariIsian("150000")).toBe(150000); expect(nominalDariIsian("")).toBeNull(); expect(nominalDariIsian("abc")).toBeNull(); expect(nominalDariIsian("-1")).toBeNull();
    const l = lampiranAman([{ path: "komplain/a.jpg", nama: "a.jpg", mime: "image/jpeg", ukuran: 100 }, { path: "dokumen/x.jpg", nama: "x" }, { path: "komplain/../x", nama: "y" }, { path: "komplain/b.png", nama: "", ukuran: 99999999 }, "bukan objek"]);
    expect(l.map(x => x.path)).toEqual(["komplain/a.jpg", "komplain/b.png"]);
    expect(l[1]).toMatchObject({ nama: "berkas", ukuran: null });
    expect(lampiranAman("x")).toEqual([]);
    expect(lampiranAman(Array.from({ length: 30 }, (_, i) => ({ path: `komplain/${i}.jpg`, nama: "f" })))).toHaveLength(10);
  });
});

describe("pembaca hasil RPC", () => {
  it("daftar/detail/pilihan/kategori menolak bentuk salah", () => {
    expect(bacaDaftar({ total: 1, hari_telat: 3, baris: [baris()] })?.total).toBe(1);
    expect(bacaDaftar({ total: "1", hari_telat: 3, baris: [] })).toBeNull(); expect(bacaDaftar({ total: 1, hari_telat: 3, baris: [{ id: 1 }] })).toBeNull(); expect(bacaDaftar(null)).toBeNull();
    expect(bacaDetail({ komplain: baris(), riwayat: [], berkas: [], boleh: { ubah: true }, hari_telat: 3 })).not.toBeNull(); expect(bacaDetail({ komplain: {} })).toBeNull();
    expect(bacaPilihan({ peran: "STAFF", kelola: false, kategori: [], cabang: [], petugas: [] })).not.toBeNull(); expect(bacaPilihan({ peran: "STAFF" })).toBeNull();
    expect(bacaKategori({ kelola: true, kategori: [] })).not.toBeNull(); expect(bacaKategori({ kelola: "ya", kategori: [] })).toBeNull();
  });
  it("dashboard wajib angka KPI dan semua daftar", () => {
    const d = { rentang: { dari: "a", sampai: "b" }, kpi: { total: 1, terbuka: 1, terlambat: 0, kritis_terbuka: 0, ditutup_rentang: 0, ditutup_bulan_ini: 0 }, per_cabang: [], per_kategori: [], per_tingkat: [], per_status: [], per_kanal: [], tren_hari: [], tren_minggu: [], pelanggan_berulang: [], karyawan_disebut: [], umur_terbuka: [] };
    expect(bacaDashboard(d)).not.toBeNull();
    expect(bacaDashboard({ ...d, kpi: { ...d.kpi, total: "1" } })).toBeNull(); expect(bacaDashboard({ ...d, tren_hari: undefined })).toBeNull(); expect(bacaDashboard({ ...d, umur_terbuka: [{ x: 1 }] })).toBeNull();
    expect(bacaDashboard(null)).toBeNull();
  });
});

describe("tampilan dan Excel", () => {
  it("format", () => {
    expect(rupiah(150000)).toBe("Rp 150.000"); expect(rupiah(null)).toBe("—"); expect(tanggalPendek("2026-11-05")).toBe("5 Nov 2026"); expect(tanggalPendek(null)).toBe("—");
    expect(waktuWib("2026-11-24T20:30:00Z")).toBe("25 Nov 2026 03:30"); expect(waktuWib("rusak")).toBe("—"); expect(waktuWib(null)).toBe("—");
    expect(teksUmur({ umur_hari: 5, terlambat: true })).toBe("5 hari · terlambat"); expect(teksUmur({ umur_hari: 0, terlambat: false })).toBe("Hari ini"); expect(teksUmur({ umur_hari: null, terlambat: false })).toBe("Ditutup");
    expect(teksJam(2.5)).toBe("2,5 jam"); expect(teksJam(null)).toBe("—"); expect(teksHari(1.25)).toBe("1,3 hari");
    expect(UKURAN_HALAMAN).toBeGreaterThan(0);
  });
  it("baris Excel: sel rumus diberi petik, kolom sesuai judul, komplain tertutup tanpa kolom terlambat", () => {
    const r = barisExcel(baris());
    expect(r).toHaveLength(KOLOM_EXCEL.length);
    expect(r[7]).toBe("'=CMD()"); expect(r[0]).toBe("KMP-202611-0001"); expect(r[10]).toBe("Struk petshop STR-1"); expect(r[13]).toBe("Kasir Satu"); expect(r[17]).toBe("Ya");
    const t = barisExcel(baris({ status: "Selesai", ditutup: "2026-11-21T03:00:00Z", terlambat: false, umur_hari: null, jenis_penyelesaian: "Refund", catatan_penyelesaian: "+SUM(1)", selesai_hari: 1.2 }));
    expect(t[17]).toBe(""); expect(t[19]).toContain("Nov 2026"); expect(t[20]).toBe("Refund"); expect(t[21]).toBe("'+SUM(1)"); expect(t[22]).toBe(1.2);
  });
  it("riwayat: judul dan ringkasan perubahan", () => {
    expect(judulRiwayat("status")).toBe("Status berubah"); expect(judulRiwayat("aneh")).toBe("aneh");
    expect(ringkasPerubahan({ tingkat: { dari: "Kritis", ke: "Tinggi" }, karyawan: { dari: [], ke: [{ id: "1", name: "Budi" }] } })).toBe("Tingkat: Kritis → Tinggi; Karyawan terlibat: kosong → Budi");
    expect(ringkasPerubahan(null)).toBe(""); expect(ringkasPerubahan({ jenis_penyelesaian: "Refund" })).toBe("Jenis penyelesaian: Refund");
  });
  it("pesan galat database diterjemahkan, termasuk Admin Online; tak dikenal = pesan umum", () => {
    expect(pesanGalatKomplain("ERROR: ADMIN_ONLINE_FUNCTION_DENIED: x")).toMatch(/tidak boleh memakai/);
    expect(pesanGalatKomplain("KOMPLAIN_CATATAN_PENYELESAIAN: x")).toMatch(/catatan penyelesaian/);
    expect(pesanGalatKomplain("KOMPLAIN_TIDAK_ADA_PERUBAHAN: x")).toBe("Tidak ada yang berubah.");
    expect(pesanGalatKomplain("KOMPLAIN_TIDAK_ADA: x")).toMatch(/tidak ditemukan/);
    expect(pesanGalatKomplain("KOMPLAIN_KUNCI_DIPAKAI")).toMatch(/Muat ulang/);
    expect(pesanGalatKomplain("KOMPLAIN_JENIS_PENYELESAIAN_TERLARANG")).toMatch(/hanya diisi saat menutup/);
    expect(pesanGalatKomplain("KOMPLAIN_PENYELESAIAN_TIDAK_COCOK")).toMatch(/tidak cocok/);
    expect(pesanGalatKomplain("KOMPLAIN_CABANG_DITOLAK")).toMatch(/Cabang ini/);
    expect(pesanGalatKomplain("boom")).toMatch(/Belum bisa disimpan/); expect(pesanGalatKomplain(null)).toMatch(/Belum bisa disimpan/);
    // setiap kode galat yang bisa dilempar migrasi punya pesan sendiri (bukan pesan umum), kecuali kode teknis
    const kode = new Set([...sql.matchAll(/message = '(KOMPLAIN_[A-Z_]+):/g)].map(m => m[1]));
    const teknis = new Set(["KOMPLAIN_DRIFT", "KOMPLAIN_CHECK", "KOMPLAIN_TETAP", "KOMPLAIN_JEJAK_TETAP", "KOMPLAIN_KUNCI", "KOMPLAIN_STATUS", "KOMPLAIN_KANAL", "KOMPLAIN_TINGKAT", "KOMPLAIN_NOMINAL", "KOMPLAIN_HARAPAN", "KOMPLAIN_CATATAN", "KOMPLAIN_RENTANG", "KOMPLAIN_KATEGORI_NAMA", "KOMPLAIN_KATEGORI_AKTIF"]);
    const tanpaPesan = [...kode].filter(k => !teknis.has(k) && pesanGalatKomplain(k) === pesanGalatKomplain("tak dikenal"));
    expect(tanpaPesan).toEqual([]);
  });
});
