// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));

import { bacaDetail } from "@/lib/setoran";
import { SetoranDashboard } from "../SetoranDashboard";
import { AksiPetugas, DaftarPengeluaran, DaftarTransfer, PanelPenyetuju } from "../SetoranAksi";

const dasar = {
  id: "11111111-1111-4111-8111-111111111111", no_setoran: "SET-2026-0001", branch_id: "b1", cabang: "Toko A", periode_mulai: "2026-11-06", periode_selesai: "2026-11-08", jadwal: "2026-11-09", batas_jam: "12:00",
  status: "Draft", revision: 3, penyetuju: false, catatan: null, kewajiban: 3000000, pengeluaran: 1000000, transfer: 0, sisa: 2000000, persen: 33,
  harian: [{ tanggal: "2026-11-06", total: 1000000 }, { tanggal: "2026-11-07", total: 1200000 }, { tanggal: "2026-11-08", total: 800000 }], shift_baru: 0, dibuat_oleh: "Rina", diajukan_oleh: null, diajukan_at: null,
  alasan_tolak: null, shift: [], pengeluaran_shift: [], pengeluaran_baris: [{ id: "p1", tanggal: "2026-11-07", kategori: "ATK", deskripsi: "kertas", jumlah: 1000000, lampiran: [{ path: "setoran/b1/n.jpg", nama: "n.jpg" }], dibuat: "", dimasukkan_oleh: "Rina", expense_id: null }],
  transfer_baris: [], riwayat: [], badge: "Belum lunas", status_periode: "Aktif", terlambat: false,
};
const keuangan = (jenis: string | null, sel: number) => ({ diharapkan: 2000000, bersih_shift: 3000000, pengeluaran_setoran: 1000000, transfer_dikonfirmasi: 2000000 + sel, transfer_menunggu: 0, selisih_sementara: sel, selisih: null, jenis, penjelasan_lebih: null, penyelesaian: null, journal_id: null, pembalik_journal_id: null, catatan_keuangan: "RAHASIA-CATATAN", penanggung_otomatis: [{ employee_id: "e1", nama: "Budi" }], kasbon: [], rincian_shift: [] });
const kunci = new Proxy({}, { get: () => "22222222-2222-4222-8222-222222222222" }) as Record<string, string>;
const html = (n: React.ReactElement) => renderToStaticMarkup(n);

it("dashboard menampilkan angka sesuai referensi Andri", () => {
  const h = html(<SetoranDashboard detail={bacaDetail(dasar)} />);
  for (const t of ["Detail Setoran", "Jadwal setoran", "Senin, 9 November 2026", "Sebelum pukul 12.00", "Jumat – Minggu", "Rp3.000.000", "Rp1.000.000", "Sisa kewajiban yang harus disetor", "Rp2.000.000", "33% kewajiban sudah diselesaikan", "Total uang tunai", "Belum lunas", "Rp1.200.000", "Rp800.000"]) expect(h).toContain(t);
});

it("tampilan staf TIDAK memuat lebih/kurang/kasbon/catatan penyetuju/akun jurnal, meski payload server salah mengirim bagian keuangan", () => {
  const staf = bacaDetail({ ...dasar, penyetuju: false, keuangan: keuangan("Lebih", 123456) });
  const h = html(<><SetoranDashboard detail={staf} /><DaftarPengeluaran d={staf} basis="/kasir/setoran" kunci={kunci} urls={{}} /><DaftarTransfer d={staf} basis="/kasir/setoran" kunci={kunci} rekening={[]} penyetuju={false} urls={{}} /><AksiPetugas d={staf} basis="/kasir/setoran" kunci={kunci} /><PanelPenyetuju d={staf} basis="/kasir/setoran" kunci={kunci} karyawan={[]} role="STAFF" so={null} /></>);
  for (const t of ["Lebih", "lebih", "Kurang", "kasbon", "Kasbon", "810004", "182001", "RAHASIA-CATATAN", "123456", "123.456", "Penutupan periode", "Diharapkan", "Pendapatan"]) expect(h).not.toContain(t);
  expect(h).toContain("Tambah pengeluaran"); expect(h).toContain("ajukan penutupan");
});

it("penyetuju melihat selisih lebih, tautan SO, kolom penjelasan, dan tombol setujui; tidak ada offset otomatis", () => {
  const d = bacaDetail({ ...dasar, penyetuju: true, status: "Diajukan", keuangan: keuangan("Lebih", 123456) });
  const h = html(<PanelPenyetuju d={d} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="FINANCE" so={{ ada: true, no_hasil: "HSO-1", tanggal: "2026-11-05", order_id: "o1", nilai_jual_kurang: 50000 }} />);
  expect(h).toContain("Lebih Rp123.456"); expect(h).toContain("Penjelasan lebih (barang lupa input?)"); expect(h).toContain("/pos/opname/o1"); expect(h).toContain("Tidak ada offset otomatis");
  expect(h).toContain("Setujui"); expect(h).toContain("Kembalikan ke petugas");
});

it("penyetuju + kurang: tawarkan kasbon (182001) dan pembagian ke kasir; selisih besar minta konfirmasi", () => {
  const d = bacaDetail({ ...dasar, penyetuju: true, status: "Diajukan", keuangan: keuangan("Kurang", -6000000) });
  const h = html(<PanelPenyetuju d={d} basis="/kas-bank/setoran" kunci={kunci} karyawan={[{ id: "e1", nama: "Budi" }]} role="ADMIN" so={null} />);
  expect(h).toContain("Kurang Rp6.000.000"); expect(h).toContain("182001"); expect(h).toContain("Budi"); expect(h).toContain("Rp 5.000.000");
});

it("setoran Diajukan tidak bisa diedit: tidak ada form tambah/hapus; Void hanya untuk Owner/Finance", () => {
  const d = bacaDetail({ ...dasar, status: "Diajukan" });
  const h = html(<><DaftarPengeluaran d={d} basis="/kasir/setoran" kunci={kunci} urls={{}} /><AksiPetugas d={d} basis="/kasir/setoran" kunci={kunci} /></>);
  expect(h).not.toContain("Tambah pengeluaran"); expect(h).not.toContain("Hapus"); expect(h).toContain("Tidak bisa diubah");
  const ok = bacaDetail({ ...dasar, penyetuju: true, status: "Disetujui", keuangan: keuangan("Pas", 0) });
  expect(html(<PanelPenyetuju d={ok} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="FINANCE" so={null} />)).toContain("Batalkan setoran ini");
  expect(html(<PanelPenyetuju d={ok} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="ADMIN" so={null} />)).not.toContain("Batalkan setoran ini");
});

it("penyetuju melihat peringatan dan tombol Setujui dimatikan bila ada peringatan blokir (pengeluaran melebihi kewajiban / pemisahan tugas)", () => {
  const blok = { kode: "PENGELUARAN_MELEBIHI", tingkat: "blokir", pesan: "Pengeluaran lebih besar dari kewajiban; tolak agar diperiksa." };
  const d = bacaDetail({ ...dasar, penyetuju: true, status: "Diajukan", keuangan: { ...keuangan("Lebih", 1000000), peringatan: [blok, { kode: "PENGELUARAN_KEMBAR", tingkat: "peringatan", pesan: "Ada baris kembar." }, { kode: "X", tingkat: "info", pesan: "" }] } });
  expect(d.keuangan?.peringatan.map((w) => w.kode)).toEqual(["PENGELUARAN_MELEBIHI", "PENGELUARAN_KEMBAR"]);
  const h = html(<PanelPenyetuju d={d} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="FINANCE" so={null} />);
  expect(h).toContain("Tidak bisa disetujui: "); expect(h).toContain("Periksa: "); expect(h).toContain("tolak agar diperiksa");
  expect(h).toMatch(/<button[^>]*disabled[^>]*>\s*Setujui &amp; tutup periode/);
  const aman = bacaDetail({ ...dasar, penyetuju: true, status: "Diajukan", keuangan: keuangan("Pas", 0) });
  const h2 = html(<PanelPenyetuju d={aman} basis="/kas-bank/setoran" kunci={kunci} karyawan={[]} role="FINANCE" so={null} />);
  expect(h2).not.toContain("peringatan-setoran"); expect(h2).not.toMatch(/<button[^>]*disabled[^>]*>\s*Setujui &amp; tutup periode/);
});

it("staf tidak pernah melihat peringatan, walau payload salah mengirimnya di bagian keuangan", () => {
  const staf = bacaDetail({ ...dasar, penyetuju: false, keuangan: { ...keuangan("Lebih", 5), peringatan: [{ kode: "PENGELUARAN_MELEBIHI", tingkat: "blokir", pesan: "RAHASIA-PERINGATAN" }] } });
  expect(staf.keuangan).toBeUndefined();
  const h = html(<><SetoranDashboard detail={staf} /><DaftarPengeluaran d={staf} basis="/kasir/setoran" kunci={kunci} urls={{}} /></>);
  expect(h).not.toContain("RAHASIA-PERINGATAN"); expect(h).not.toContain("melebihi");
});

it("staf: setoran Disetujui/Diajukan tampil Lunas / Menunggu dengan sisa 0 (basis data mengirim sisa 0)", () => {
  const d = bacaDetail({ ...dasar, status: "Disetujui", sisa: 0, persen: 100, badge: "Lunas", status_periode: "Selesai" });
  const h = html(<SetoranDashboard detail={d} />);
  expect(h).toContain("Lunas"); expect(h).toContain("100% kewajiban sudah diselesaikan");
});
