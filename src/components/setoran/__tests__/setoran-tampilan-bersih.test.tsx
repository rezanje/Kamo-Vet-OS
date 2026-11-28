// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/setoran-actions", () => {
  const f = async () => undefined;
  return { buatSetoran: f, ajukanSetoran: f, batalkanDraftSetoran: f, hapusPengeluaranSetoran: f, hapusTransferSetoran: f, putuskanTransferSetoran: f, setujuiSetoran: f, sinkronSetoran: f, tambahPengeluaranSetoran: f, tambahTransferSetoran: f, tolakSetoran: f, voidSetoran: f };
});
vi.mock("@/lib/setoran-server", () => ({
  STATUS_FILTER: ["Draft", "Diajukan"],
  bacaSaringan: () => ({}),
  muatAkses: async () => ({ masuk: true, penyetuju: true, role: "FINANCE" }),
  muatCabang: async () => [{ id: "b1", code: "A", name: "Toko A" }],
  muatDaftar: async () => ({ baris: [{ id: "s1", no_setoran: "SET-1", cabang: "Toko A", periode_mulai: "2026-11-06", periode_selesai: "2026-11-08", jadwal: "2026-11-09", batas_jam: "12:00", kewajiban: 3000000, sisa: 2000000, badge: "Belum lunas", status: "Draft", selisih: 0, selisih_sementara: 0, umur_hari: null, dibuat_oleh: "Rina" }] }),
  muatRekap: async () => ({ menunggu_persetujuan: 0, terlambat: 0, umur_menunggu: { hari_0_1: 0, hari_2_3: 0, hari_4_7: 0, hari_8_plus: 0 }, cabang: [], total: { jumlah: 1, kewajiban: 3, pengeluaran: 0, diharapkan: 3, disetor: 0, kurang: 0, lebih: 0 } }),
}));

import { bacaDetail } from "@/lib/setoran";
import { SetoranDaftarView } from "../SetoranDaftarView";
import { SetoranDashboard } from "../SetoranDashboard";
import { DaftarPengeluaran, DaftarTransfer, AksiPetugas, PanelPenyetuju } from "../SetoranAksi";
import { JUDUL_HALAMAN, SUBJUDUL } from "../gaya";

const detail = bacaDetail({
  id: "11111111-1111-4111-8111-111111111111", no_setoran: "SET-2026-0001", branch_id: "b1", cabang: "Toko A", periode_mulai: "2026-11-06", periode_selesai: "2026-11-08", jadwal: "2026-11-09", batas_jam: "12:00",
  status: "Draft", revision: 3, penyetuju: true, catatan: null, kewajiban: 3000000, pengeluaran: 1000000, transfer: 0, sisa: 2000000, persen: 33,
  harian: [{ tanggal: "2026-11-06", total: 1000000 }], shift_baru: 0, dibuat_oleh: "Rina", diajukan_oleh: null, diajukan_at: null, alasan_tolak: null, shift: [], pengeluaran_shift: [],
  pengeluaran_baris: [], transfer_baris: [], riwayat: [{ at: "2026-11-06T01:00:00Z", jenis: "dibuat", oleh: "Rina", catatan: null }], badge: "Belum lunas", status_periode: "Aktif", terlambat: false,
  keuangan: { diharapkan: 2000000, bersih_shift: 3000000, pengeluaran_setoran: 1000000, transfer_dikonfirmasi: 0, transfer_menunggu: 0, selisih_sementara: -2000000, selisih: null, jenis: "Kurang", penjelasan_lebih: null, penyelesaian: null, journal_id: null, pembalik_journal_id: null, catatan_keuangan: null, penanggung_otomatis: [], kasbon: [], rincian_shift: [], peringatan: [] },
});
const kunci = new Proxy({}, { get: () => "22222222-2222-4222-8222-222222222222" }) as Record<string, string>;

// Teks penjelasan abu-abu yang dihapus atas permintaan Mba Anisa (tampilan setoran lebih bersih).
const DIHAPUS = [
  "Kewajiban setoran per periode, pengeluaran dari dana setoran, dan penutupan oleh Finance",
  "Shift yang sudah ditutup di periode itu otomatis dihitung",
  "Kurang/Lebih dihitung dari setoran yang sudah diajukan atau disetujui",
  "Halaman ini hanya untuk Owner, Finance, Admin",
  "Pengeluaran yang dibayar dari uang setoran ini",
  "Boleh dicicil. Setiap setoran menunggu konfirmasi Finance",
  "Angka per hari = uang fisik tiap shift",
  "Ajukan bila semua uang sudah disetor dan dicatat di atas",
  "Selisih tutup shift sudah dibukukan saat tutup shift; di sini tidak dijurnal lagi",
  "Isi di bawah hanya bila ingin menimpa",
];

async function semua() {
  const daftar = renderToStaticMarkup(await SetoranDaftarView({ basis: "/kas-bank/setoran", sp: {} }));
  const det = renderToStaticMarkup(<>
    <SetoranDashboard detail={detail} />
    <DaftarPengeluaran d={detail} basis="/kas-bank/setoran" kunci={kunci} urls={{}} />
    <DaftarTransfer d={detail} basis="/kas-bank/setoran" kunci={kunci} rekening={[]} penyetuju urls={{}} />
    <AksiPetugas d={detail} basis="/kas-bank/setoran" kunci={kunci} />
    <PanelPenyetuju d={{ ...detail, status: "Diajukan" }} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="FINANCE" so={null} />
  </>);
  return { daftar, det };
}

it("teks penjelasan abu-abu tidak muncul lagi di daftar maupun detail setoran", async () => {
  const { daftar, det } = await semua();
  for (const t of DIHAPUS) { expect(daftar).not.toContain(t); expect(det).not.toContain(t); }
  // tidak ada paragraf penjelasan abu-abu bergaya var(--tm) yang tersisa di bawah judul bagian
  expect(daftar).not.toContain("pg-sub");
});

it("yang harus tetap ada: label, status, peringatan dan tombol tidak ikut terhapus", async () => {
  const { daftar, det } = await semua();
  for (const t of ["Rekap Setoran", "Buat periode setoran", "Buat periode", "Terapkan", "Unduh Excel", "Belum lunas", "Draft"]) expect(daftar).toContain(t);
  for (const t of ["Tambah pengeluaran", "Catat setoran", "Selesai disetor — ajukan penutupan", "Setujui &amp; tutup periode", "tidak ada karyawan tertaut", "Detail Setoran", "33% kewajiban sudah diselesaikan"]) expect(det).toContain(t);
});

it("sub judul bagian seragam: lebih besar dan lebih tebal dari teks isi, judul halaman paling besar", async () => {
  const { daftar, det } = await semua();
  expect(SUBJUDUL.fontSize).toBeGreaterThanOrEqual(16);
  expect(Number(SUBJUDUL.fontWeight)).toBeGreaterThanOrEqual(600);
  expect(Number(JUDUL_HALAMAN.fontSize)).toBeGreaterThan(Number(SUBJUDUL.fontSize));
  const subD = (daftar.match(/<h3 [^>]*data-subjudul[^>]*>[^<]*/g) ?? []).map((x) => x.replace(/<[^>]*>/, ""));
  for (const t of ["Rekap per cabang", "Buat periode setoran", "Daftar setoran"]) expect(subD).toContain(t);
  const subT = (det.match(/<h3 [^>]*data-subjudul[^>]*>[^<]*/g) ?? []).map((x) => x.replace(/<[^>]*>/, ""));
  for (const t of ["Informasi periode", "Ringkasan dana setoran", "Rincian sumber uang setoran", "Pengeluaran dari dana setoran", "Setoran ke perusahaan", "Penutupan periode — khusus Finance / penyetuju"]) expect(subT).toContain(t);
  // semua h3 memakai gaya sub judul (tidak ada h3 yang tertinggal 14px)
  for (const h of [daftar, det]) {
    expect((h.match(/<h3\b/g) ?? []).length).toBe((h.match(/<h3 class="setoran-subjudul"/g) ?? []).length);
    expect(h).toContain("font-size:17px");
    expect(h).toContain("font-weight:600");
  }
  expect(daftar).toContain("data-judul-halaman");
  expect(det).toContain("data-judul-halaman");
});

it("tidak ada h3 dengan font 14px tertinggal di komponen setoran", () => {
  for (const f of ["SetoranDaftarView", "SetoranAksi", "SetoranDashboard", "SetoranDetailView"]) {
    const src = readFileSync(`${process.cwd()}/src/components/setoran/${f}.tsx`, "utf8");
    expect(src).not.toMatch(/<h3 style=/);
  }
});
