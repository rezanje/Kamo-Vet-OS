import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "STAFF" as string | null, active: true, user: true, rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcOut: { data: { id: "11111111-1111-4111-8111-111111111111", nomor: "KMP-202611-0001" } as unknown, error: null as null | { code?: string; message: string } },
  revalidated: [] as string[], tables: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
vi.mock("next/link", () => ({ default: ({ children, href, ...r }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...r}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/crm/komplain" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user ? { id: "u1" } : null }, error: null }) },
    from(t: string) {
      state.tables.push(t);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role, is_active: state.active } : null, error: null }) }) }) };
    },
    rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push({ name, args }); return state.rpcOut; },
  }),
}));

import * as aksi from "@/app/(app)/crm/komplain/actions";
import { buatKomplainAksi, petugasCabangAksi, simpanBatasTelatKomplainAksi, simpanKategoriKomplainAksi, tambahCatatanKomplainAksi, ubahDetailKomplainAksi, ubahStatusKomplainAksi } from "@/app/(app)/crm/komplain/actions";
import { DashboardKomplain } from "@/components/komplain/DashboardKomplain";
import { HalamanKomplain, SaringanKomplain, TabelKomplain } from "@/components/komplain/DaftarKomplain";
import { KepalaKomplain } from "@/components/komplain/KomplainUi";
import { RincianKomplain } from "@/components/komplain/RincianKomplain";
import { AksiKomplain } from "@/components/komplain/AksiKomplain";
import { KategoriEditor } from "@/components/komplain/KategoriEditor";
import { bacaFilter, type BarisKomplain, type Dashboard, type DetailKomplain, type Pilihan } from "@/lib/komplain";
import { KomplainError, muatDaftar, muatDashboard, muatDetail, muatKategori, muatPilihan, periksaSesiKomplain } from "@/lib/komplain-server";

const K = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333", P = "44444444-4444-4444-8444-444444444444";
beforeEach(() => { state.role = "STAFF"; state.active = true; state.user = true; state.rpc = []; state.revalidated = []; state.tables = []; state.rpcOut = { data: { id: K, nomor: "KMP-202611-0001" }, error: null }; });

const baris = (o: Partial<BarisKomplain> = {}): BarisKomplain => ({
  id: K, nomor: "KMP-202611-0001", cabang_id: B, cabang: "Petshop A", kanal: "Petshop", tanggal: "2026-11-20", waktu: "2026-11-20T03:00:00Z", pelanggan_id: null, hewan_id: null,
  nama: "Pelanggan <b>Uji</b>", telepon: "0812000", hewan: "Mochi", ref_jenis: "Struk petshop", ref_nomor: "STR-1", kategori_id: C, kategori: "Grooming", tingkat: "Kritis",
  deskripsi: "Hasil <script>x</script> kurang rapi", harapan: "Minta maaf", karyawan: [{ id: P, name: "Kasir Satu" }], nominal: 150000, petugas_id: null, petugas: null, status: "Baru",
  respons_pertama: null, ditutup: null, jenis_penyelesaian: null, catatan_penyelesaian: null, dibuat_oleh: P, dibuat_nama: "Kasir Satu", dibuat: "2026-11-20T03:00:00Z", umur_hari: 5, terlambat: true,
  respons_jam: null, selesai_hari: null, ...o,
} as BarisKomplain);
const pilihan: Pilihan = { peran: "OWNER", kelola: true, hari_telat: 3, kategori: [{ id: C, nama: "Grooming" }], cabang: [{ id: B, nama: "Petshop A", kode: "PA" }], petugas: [{ id: P, nama: "Kasir Satu", peran: "STAFF" }] };
const dash = (o: Partial<Dashboard> = {}): Dashboard => ({
  rentang: { dari: "2026-11-01", sampai: "2026-11-25" }, hari_telat: 3, hari_ini: "2026-11-25",
  kpi: { total: 7, terbuka: 4, terlambat: 2, kritis_terbuka: 1, ditutup_rentang: 3, ditutup_bulan_ini: 3, rata_respons_jam: 2.5, rata_selesai_hari: 1.5 },
  per_cabang: [{ cabang_id: B, cabang: "Petshop A", jumlah: 7, terbuka: 4 }], per_kategori: [{ kategori_id: C, kategori: "Grooming", jumlah: 5, terbuka: 3 }],
  per_tingkat: [{ tingkat: "Rendah", jumlah: 1, terbuka: 0 }, { tingkat: "Sedang", jumlah: 3, terbuka: 2 }, { tingkat: "Tinggi", jumlah: 2, terbuka: 1 }, { tingkat: "Kritis", jumlah: 1, terbuka: 1 }],
  per_status: [{ status: "Baru", jumlah: 4 }], per_kanal: [{ kanal: "Petshop", jumlah: 7 }],
  tren_hari: [{ tanggal: "2026-11-20", jumlah: 3 }, { tanggal: "2026-11-21", jumlah: 4 }], tren_minggu: [],
  pelanggan_berulang: [{ pelanggan_id: null, nama: "Budi Uji", telepon: "0812", jumlah: 3, terakhir: "2026-11-21" }],
  karyawan_disebut: [{ karyawan_id: P, nama: "Kasir Satu", jumlah: 2, terakhir: "2026-11-21" }], umur_terbuka: [baris()], ...o,
});
const detail = (o: Partial<DetailKomplain> = {}, b: Partial<BarisKomplain> = {}): DetailKomplain => ({
  komplain: baris(b), hari_telat: 3, boleh: { ubah: true, catatan: true, buka_kembali: false, kelola: false },
  riwayat: [{ seq: 1, jenis: "dibuat", dari: null, ke: "Baru", catatan: null, perubahan: null, oleh: "Kasir Satu", peran: "STAFF", waktu: "2026-11-20T03:00:00Z" },
    { seq: 2, jenis: "ubah", dari: null, ke: null, catatan: "Salah tingkat", perubahan: { tingkat: { dari: "Sedang", ke: "Kritis" } }, oleh: "Owner Uji", peran: "OWNER", waktu: "2026-11-21T03:00:00Z" }],
  berkas: [{ id: "b1", path: "komplain/a.jpg", nama: "foto.jpg", mime: "image/jpeg", ukuran: 10, waktu: "2026-11-20T03:00:00Z" }], ...o,
});
const html = (n: React.ReactElement) => renderToStaticMarkup(n);

describe("sesi: Admin Online, akun nonaktif, tanpa login tidak pernah lolos", () => {
  it("STAFF/DOCTOR/FINANCE/ADMIN/OWNER lolos", async () => {
    for (const r of ["STAFF", "DOCTOR", "FINANCE", "ADMIN", "OWNER"]) { state.role = r; const s = await periksaSesiKomplain((await (await import("@/lib/supabase/server")).createClient())); expect(s, r).toEqual({ ok: true, role: r }); }
  });
  it("ADMIN_ONLINE, nonaktif, tanpa profil, tanpa user ditolak", async () => {
    const c = await (await import("@/lib/supabase/server")).createClient();
    state.role = "ADMIN_ONLINE"; expect((await periksaSesiKomplain(c)).ok).toBe(false);
    state.role = "STAFF"; state.active = false; expect((await periksaSesiKomplain(c)).ok).toBe(false);
    state.active = true; state.role = null; expect((await periksaSesiKomplain(c)).ok).toBe(false);
    state.role = "STAFF"; state.user = false; expect((await periksaSesiKomplain(c)).ok).toBe(false);
  });
});

describe("aksi server", () => {
  const buat = { kunci: K, cabang: B, kanal: "Petshop", tanggal: "", pelangganId: null, hewanId: null, nama: " Budi ", telepon: "0812", refJenis: "", refNomor: "", kategori: C, tingkat: "Sedang", deskripsi: "Kembalian kurang", harapan: "", karyawan: [P], nominal: "50000", petugas: null, lampiran: [] };
  it("buat: memanggil RPC dengan kunci permintaan, tidak menyentuh tabel lain, dan menyegarkan halaman", async () => {
    const h = await buatKomplainAksi(buat);
    expect(h).toMatchObject({ ok: true, id: K, nomor: "KMP-202611-0001" });
    expect(state.rpc).toHaveLength(1);
    expect(state.rpc[0].name).toBe("komplain_buat");
    expect(state.rpc[0].args).toMatchObject({ p_request_key: K, p_branch_id: B, p_channel: "Petshop", p_category_id: C, p_severity: "Sedang", p_nama: "Budi", p_nominal: 50000, p_karyawan: [P], p_tanggal: null, p_ref_jenis: null, p_assigned: null });
    expect(new Set(state.tables)).toEqual(new Set(["profiles"]));
    expect(state.revalidated).toEqual(["/crm/komplain"]);
  });
  it("buat: kirim ulang = hasil 'sudah ada' tanpa galat", async () => {
    state.rpcOut = { data: { id: K, nomor: "KMP-202611-0001", already_applied: true }, error: null };
    expect(await buatKomplainAksi(buat)).toMatchObject({ ok: true, sudahAda: true });
  });
  it("Admin Online ditolak SEBELUM RPC mana pun, untuk semua aksi", async () => {
    state.role = "ADMIN_ONLINE";
    const hasil = [
      await buatKomplainAksi(buat), await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Dicek", catatan: "", jenis: "" }),
      await tambahCatatanKomplainAksi({ kunci: K, id: K, catatan: "halo", lampiran: [] }),
      await ubahDetailKomplainAksi({ kunci: K, id: K, kategori: C, tingkat: "Sedang", petugas: null, karyawan: [], nominal: "", harapan: "", refJenis: "", refNomor: "", catatan: "alasan" }),
      await simpanKategoriKomplainAksi({ id: null, nama: "Baru", urut: null, aktif: true }), await simpanBatasTelatKomplainAksi(5), await petugasCabangAksi(B),
    ];
    for (const h of hasil) expect(h).toMatchObject({ ok: false, pesan: expect.stringMatching(/tidak boleh memakai/) });
    expect(state.rpc).toEqual([]);
  });
  it("setiap aksi yang diekspor punya uji Admin Online di atas (tidak ada aksi baru terlewat)", () => {
    expect(Object.keys(aksi).sort()).toEqual(["buatKomplainAksi", "petugasCabangAksi", "simpanBatasTelatKomplainAksi", "simpanKategoriKomplainAksi", "tambahCatatanKomplainAksi", "ubahDetailKomplainAksi", "ubahStatusKomplainAksi"]);
  });
  it("isian rusak ditolak sebelum database", async () => {
    expect(await buatKomplainAksi({ ...buat, kunci: "x" })).toMatchObject({ ok: false });
    expect(await buatKomplainAksi({ ...buat, cabang: "x" })).toMatchObject({ ok: false });
    expect(await buatKomplainAksi({ ...buat, karyawan: ["x"] })).toMatchObject({ ok: false });
    expect(await buatKomplainAksi({ ...buat, deskripsi: "ab" })).toMatchObject({ ok: false, pesan: expect.stringMatching(/Isi komplain/) });
    expect(await buatKomplainAksi(null as never)).toMatchObject({ ok: false });
    expect(await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Selesai", catatan: "", jenis: "" })).toMatchObject({ ok: false });
    expect(await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Hilang", catatan: "", jenis: "" })).toMatchObject({ ok: false });
    expect(await ubahStatusKomplainAksi({ kunci: "x", id: K, status: "Dicek", catatan: "", jenis: "" })).toMatchObject({ ok: false });
    expect(await tambahCatatanKomplainAksi({ kunci: K, id: K, catatan: "", lampiran: [] })).toMatchObject({ ok: false });
    expect(await ubahDetailKomplainAksi({ kunci: K, id: K, kategori: C, tingkat: "Sedang", petugas: null, karyawan: [], nominal: "", harapan: "", refJenis: "", refNomor: "", catatan: "ab" })).toMatchObject({ ok: false });
    expect(await ubahDetailKomplainAksi({ kunci: K, id: K, kategori: C, tingkat: "Sedang", petugas: null, karyawan: [], nominal: "abc", harapan: "", refJenis: "", refNomor: "", catatan: "alasan" })).toMatchObject({ ok: false, pesan: expect.stringMatching(/angka/) });
    expect(await simpanKategoriKomplainAksi({ id: null, nama: "a", urut: null, aktif: true })).toMatchObject({ ok: false });
    expect(await simpanKategoriKomplainAksi({ id: "x", nama: "Baik", urut: null, aktif: true })).toMatchObject({ ok: false });
    expect(await simpanBatasTelatKomplainAksi(0)).toMatchObject({ ok: false }); expect(await simpanBatasTelatKomplainAksi(91)).toMatchObject({ ok: false }); expect(await simpanBatasTelatKomplainAksi(2.5)).toMatchObject({ ok: false });
    expect(await petugasCabangAksi("x")).toMatchObject({ ok: false });
    expect(state.rpc).toEqual([]);
  });
  it("status: tutup membawa jenis dan catatan ke RPC; galat database diterjemahkan", async () => {
    state.rpcOut = { data: {}, error: null };
    expect(await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Selesai", catatan: " Sudah dijelaskan ", jenis: "Maaf/penjelasan" })).toMatchObject({ ok: true });
    expect(state.rpc[0]).toEqual({ name: "komplain_ubah_status", args: { p_id: K, p_status: "Selesai", p_catatan: "Sudah dijelaskan", p_resolusi_jenis: "Maaf/penjelasan", p_request_key: K } });
    state.rpcOut = { data: null, error: { message: "KOMPLAIN_KOMPLAIN_DITOLAK: x" } };
    expect(await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Dicek", catatan: "", jenis: "" })).toMatchObject({ ok: false });
    state.rpcOut = { data: null, error: { message: "KOMPLAIN_TIDAK_ADA: x" } };
    expect(await ubahStatusKomplainAksi({ kunci: K, id: K, status: "Dicek", catatan: "", jenis: "" })).toMatchObject({ ok: false, pesan: expect.stringMatching(/tidak ditemukan/) });
  });
  it("kategori dan batas telat memanggil RPC pengaturan", async () => {
    state.rpcOut = { data: {}, error: null };
    expect(await simpanKategoriKomplainAksi({ id: null, nama: " Parkir ", urut: 12, aktif: true })).toEqual({ ok: true });
    expect(await simpanBatasTelatKomplainAksi(5)).toEqual({ ok: true });
    expect(state.rpc.map(r => r.name)).toEqual(["komplain_kategori_simpan", "komplain_pengaturan_simpan"]);
    expect(state.rpc[0].args).toEqual({ p_id: null, p_nama: "Parkir", p_urut: 12, p_aktif: true });
    expect(state.rpc[1].args).toEqual({ p_hari_telat: 5 });
  });
  it("petugasCabang meneruskan hak database (daftar dari komplain_pilihan)", async () => {
    state.rpcOut = { data: pilihan, error: null };
    expect(await petugasCabangAksi(B)).toEqual({ ok: true, petugas: pilihan.petugas });
    expect(state.rpc[0]).toEqual({ name: "komplain_pilihan", args: { p_branch: B } });
  });
});

describe("pembaca sisi server", () => {
  const fake = (out: { data: unknown; error: { code?: string; message?: string } | null }) => ({ rpc: async () => out });
  it("galat database jadi KomplainError berbahasa Indonesia; Admin Online tidak bocor detail", async () => {
    await expect(muatDaftar(fake({ data: null, error: { code: "PGRST202", message: "x" } }), bacaFilter({}))).rejects.toThrow(/belum terpasang/);
    await expect(muatDaftar(fake({ data: null, error: { message: "ADMIN_ONLINE_FUNCTION_DENIED: secret" } }), bacaFilter({}))).rejects.toThrow("Akun ini tidak boleh memakai Komplain Pelanggan.");
    await expect(muatDetail(fake({ data: null, error: { message: "KOMPLAIN_TIDAK_ADA: abc" } }), K)).rejects.toThrow(/tidak ditemukan/);
    await expect(muatDetail(fake({ data: null, error: null }), "bukan-uuid")).rejects.toThrow(KomplainError);
    await expect(muatDashboard(fake({ data: { kpi: 1 }, error: null }), bacaFilter({}))).rejects.toThrow(/belum dapat dibaca/);
    await expect(muatPilihan(fake({ data: {}, error: null }))).rejects.toThrow(/belum dapat dibaca/);
    await expect(muatKategori(fake({ data: null, error: { message: "boom" } }))).rejects.toThrow(/belum dapat dimuat/);
  });
  it("daftar: saringan diteruskan sebagai parameter RPC; halaman -> offset", async () => {
    const calls: unknown[] = [];
    const c = { rpc: async (n: string, a: unknown) => { calls.push([n, a]); return { data: { total: 0, baris: [], hari_telat: 3 }, error: null }; } };
    await muatDaftar(c, bacaFilter({ cabang: B, status: "terbuka", hal: "3", q: "budi", urut: "umur" }, { hariIni: "2026-11-25" }));
    expect(calls[0]).toEqual(["komplain_daftar", { p_dari: null, p_sampai: null, p_branch: B, p_kategori: null, p_severity: null, p_status: "terbuka", p_assigned: null, p_channel: null, p_q: "budi", p_urut: "umur", p_limit: 25, p_offset: 50 }]);
    await muatDaftar(c, bacaFilter({}), { limit: 5000, offset: 0 });
    expect((calls[1] as [string, Record<string, number>])[1]).toMatchObject({ p_limit: 5000, p_offset: 0 });
  });
});

describe("layar", () => {
  it("dashboard: semua KPI, bagian, dan tautan; teks pelanggan di-escape", () => {
    const h = html(<DashboardKomplain d={dash()} filter={bacaFilter({}, { bulanIni: true, hariIni: "2026-11-25" })} />);
    for (const t of ["Komplain terbuka", "Terlambat (&gt; 3 hari)", "Kritis, belum selesai", "Ditutup bulan ini", "Rata-rata respons pertama", "2,5 jam", "Rata-rata waktu penyelesaian", "1,5 hari", "Per cabang", "Per kategori", "Per status", "Per asal komplain", "Tren komplain", "Menurut tingkat", "Pelanggan yang berulang kali komplain", "Budi Uji", "3×", "Karyawan yang paling sering disebut", "belum berarti bersalah", "tertua dulu", "Lihat semua yang terbuka"]) expect(h, t).toContain(t);
    expect(h).toContain("KMP-202611-0001"); expect(h).toContain("Pelanggan &lt;b&gt;Uji&lt;/b&gt;"); expect(h).not.toContain("<b>Uji</b>");
    expect(h).toContain("status=terbuka"); expect(h).toContain("urut=umur");
  });
  it("dashboard kosong menampilkan keterangan, bukan grafik rusak", () => {
    const k = { total: 0, terbuka: 0, terlambat: 0, kritis_terbuka: 0, ditutup_rentang: 0, ditutup_bulan_ini: 0, rata_respons_jam: null, rata_selesai_hari: null };
    const h = html(<DashboardKomplain d={dash({ kpi: k, per_cabang: [], per_kategori: [], per_tingkat: [], per_status: [], per_kanal: [], tren_hari: [], pelanggan_berulang: [], karyawan_disebut: [], umur_terbuka: [] })} filter={bacaFilter({})} />);
    expect(h).toContain("Tidak ada komplain pada rentang ini."); expect(h).toContain("Tidak ada komplain yang masih terbuka"); expect(h).toContain("Belum ada pelanggan dengan 2 komplain");
    expect(h).toContain("Belum ada komplain.");
  });
  it("dashboard memakai tren mingguan bila rentang > 45 hari", () => {
    const tren = Array.from({ length: 50 }, (_, i) => ({ tanggal: `2026-0${1 + Math.floor(i / 30)}-${String((i % 28) + 1).padStart(2, "0")}`, jumlah: 1 }));
    const h = html(<DashboardKomplain d={dash({ tren_hari: tren, tren_minggu: [{ minggu: "2026-01-05", jumlah: 4 }, { minggu: "2026-01-12", jumlah: 2 }] })} filter={bacaFilter({})} />);
    expect(h).toContain("Komplain per minggu"); expect(h).not.toContain("Komplain per hari");
  });
  it("saringan: semua kolom, formulir GET, nilai terpilih; kotak cari hanya di daftar", () => {
    const f = bacaFilter({ cabang: B, tingkat: "Kritis", q: "budi" }, { hariIni: "2026-11-25" });
    const h = html(<SaringanKomplain filter={f} pilihan={pilihan} aksi="/crm/komplain" urut />);
    expect(h).toContain('method="get"'); expect(h).toContain('action="/crm/komplain"');
    for (const n of ["dari", "sampai", "cabang", "kategori", "tingkat", "status", "petugas", "kanal", "q", "urut"]) expect(h, n).toContain(`name="${n}"`);
    expect(html(<SaringanKomplain filter={f} pilihan={pilihan} aksi="/crm/komplain/dashboard" />)).not.toContain('name="q"');
  });
  it("daftar: tabel, halaman, kosong; tautan halaman mempertahankan saringan", () => {
    const f = bacaFilter({ cabang: B }, { hariIni: "2026-11-25" });
    const h = html(<HalamanKomplain filter={f} hasil={{ total: 60, baris: [baris()], hari_telat: 3 }} path="/crm/komplain" />);
    expect(h).toContain("KMP-202611-0001"); expect(h).toContain(`/crm/komplain/${K}`); expect(h).toContain("hal=2"); expect(h).toContain(`cabang=${B}`);
    expect(html(<TabelKomplain baris={[]} />)).toContain("Belum ada komplain yang cocok.");
    expect(html(<HalamanKomplain filter={f} hasil={{ total: 0, baris: [], hari_telat: 3 }} path="/crm/komplain" />)).toContain("Belum ada komplain yang cocok.");
  });
  it("kepala: tab dan peringatan bahwa modul tidak mengubah uang", () => {
    const h = html(<KepalaKomplain aktif="daftar" judul="Komplain Pelanggan" catatanUang />);
    expect(h).toContain("/crm/komplain/dashboard"); expect(h).toContain("/crm/komplain/baru"); expect(h).toContain("/crm/komplain/kategori"); expect(h).toMatch(/refund|koreksi/i);
  });
  it("rincian: isi, riwayat tak bisa diubah, ringkasan perubahan, lampiran bertanda tangan; HTML di-escape", () => {
    const h = html(<RincianKomplain detail={detail()} urlBerkas={{ "komplain/a.jpg": "https://x.test/a.jpg?token=1" }} />);
    for (const t of ["KMP-202611-0001", "Petshop A", "Grooming", "Kritis", "Rp 150.000", "Kasir Satu", "Riwayat (tidak bisa diubah)", "Tingkat: Sedang → Kritis", "Salah tingkat", "https://x.test/a.jpg?token=1", "foto.jpg", "Minta maaf", "Belum ada"]) expect(h, t).toContain(t);
    expect(h).toContain("&lt;script&gt;"); expect(h).not.toContain("<script>");
    expect(html(<RincianKomplain detail={detail({}, { status: "Selesai", ditutup: "2026-11-22T03:00:00Z", jenis_penyelesaian: "Refund", catatan_penyelesaian: "Refund via KK-9", selesai_hari: 2, terlambat: false, umur_hari: null })} urlBerkas={{}} />)).toContain("Refund via KK-9");
  });
  it("penanganan: tombol mengikuti hak dari database; tidak ada uang/stok", () => {
    const edit = html(<AksiKomplain detail={detail()} pilihan={pilihan} karyawan={[]} />);
    expect(edit).toContain("Ubah status"); expect(edit).toContain("Tambah catatan"); expect(edit).toContain("Ubah rincian");
    const lihat = html(<AksiKomplain detail={detail({ boleh: { ubah: false, catatan: true, buka_kembali: false, kelola: false } })} pilihan={pilihan} karyawan={[]} />);
    expect(lihat).not.toContain("Ubah status"); expect(lihat).not.toContain("Ubah rincian"); expect(lihat).toContain("Tambah catatan"); expect(lihat).toContain("pemegang izin kelola");
    const tutupTanpaHak = html(<AksiKomplain detail={detail({ boleh: { ubah: true, catatan: true, buka_kembali: false, kelola: false } }, { status: "Selesai" })} pilihan={pilihan} karyawan={[]} />);
    expect(tutupTanpaHak).not.toContain("Buka kembali komplain"); expect(tutupTanpaHak).toContain("sudah ditutup");
    const buka = html(<AksiKomplain detail={detail({ boleh: { ubah: true, catatan: true, buka_kembali: true, kelola: true } }, { status: "Selesai" })} pilihan={pilihan} karyawan={[]} />);
    expect(buka).toContain("Buka kembali komplain");
    expect(edit).not.toMatch(/jurnal|posting|stok berkurang/i);
  });
  it("kategori: pemegang izin bisa ubah; lainnya hanya melihat", () => {
    const data = { kelola: true, hari_telat: 3, kategori: [{ id: C, nama: "Grooming", urut: 10, aktif: true, dipakai: 4 }] };
    const owner = html(<KategoriEditor data={data} />);
    expect(owner).toContain("Tambah kategori"); expect(owner).toContain("Grooming"); expect(owner).toContain("Batas &quot;terlambat&quot;".replace("&quot;", "&quot;"));
    const staf = html(<KategoriEditor data={{ ...data, kelola: false }} />);
    expect(staf).not.toContain("Tambah kategori"); expect(staf).toContain("hanya bisa dilihat"); expect(staf).toContain("disabled");
  });
});
