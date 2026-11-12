import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { BarisPenjual } from "@/lib/laporan-tenaga-penjual";
import type { DataTenagaPenjual } from "./data";

// Fixture fiktif: nama orang dan dokumen di sini tidak merujuk data nyata.

const state = vi.hoisted(() => ({ data: null as unknown, dipanggil: 0 }));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/EmployeePicker", () => ({ EmployeePicker: () => <input name="karyawan" /> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ ringkasan, children, siap }: { ringkasan: React.ReactNode; children: React.ReactNode; siap: boolean }) =>
    <main>{siap ? <>{ringkasan}{children}</> : "BELUM DITAMPILKAN"}</main>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <ul>{items.map((k) => <li key={k.label}>{k.label}: {k.nilai}</li>)}</ul>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
vi.mock("./data", () => ({
  ambilTenagaPenjual: async () => { state.dipanggil += 1; return state.data; },
  ambilOpsiFilterPenjual: async () => {
    const d = state.data as DataTenagaPenjual;
    return { karyawan: d.karyawan, namaKaryawan: d.namaKaryawan, cabangOptions: d.cabangOptions, pesanError: "" };
  },
}));

import PenjualPage from "./page";

function baris(over: Partial<BarisPenjual> & { id: string }): BarisPenjual {
  return {
    dokumenId: "inv", dokumen: "INV-1", href: "/klinik/pembayaran/visit/invoice", waktu: "2026-10-20T03:00:00Z",
    tanggal: "2026-10-20", kanal: "Klinik", jenis: "Jasa", cabangId: "cabang", cabang: "Cabang Uji",
    pelanggan: "Pemilik Fiktif", pasien: "Milo", item: "Operasi", qty: 1, bruto: 200, netto: 200,
    dokterId: null, stafId: null, penjualId: null, retur: false, ...over,
  };
}

function data(rows: BarisPenjual[], over: Partial<DataTenagaPenjual> = {}): DataTenagaPenjual {
  return {
    rows,
    karyawan: [{ id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", branchName: "Cabang Uji" }],
    namaKaryawan: new Map([["dokter", "Drh. Fiktif"], ["perawat", "Perawat Fiktif"]]),
    cabangOptions: [{ id: "cabang", name: "Cabang Uji" }],
    faktur: [], selisihDokumen: 0, returTanpaSumber: 0, pesanError: "", ...over,
  };
}

// Semua tes isi laporan memakai tampil=1 — seperti setelah pengguna menekan Tampilkan (A1).
const render = (sp: Record<string, string> = {}) =>
  PenjualPage({ searchParams: Promise.resolve({ tampil: "1", ...sp }) }).then(renderToStaticMarkup);

beforeEach(() => { state.data = data([]); state.dipanggil = 0; });

it("A1: membuka laporan tanpa Tampilkan tidak menarik baris penjualan", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter" })]);
  const html = await PenjualPage({ searchParams: Promise.resolve({ karyawan: "dokter" }) }).then(renderToStaticMarkup);
  expect(state.dipanggil).toBe(0);
  expect(html).toContain("BELUM DITAMPILKAN");
  expect(html).not.toContain("Drh. Fiktif");
  await render();
  expect(state.dipanggil).toBe(1);
});

it("memberi baris dua pelaksana ke dua orang tanpa melipatgandakan total perusahaan", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter", stafId: "perawat" })]);
  const html = await render();

  expect(html).toContain("Drh. Fiktif");
  expect(html).toContain("Perawat Fiktif");
  expect(html).toContain("Non-dokter");
  // Kartu ringkasan memakai total perusahaan: satu baris tetap satu kali.
  expect(html).toContain("Total perusahaan (netto): Rp 200");
  expect(html).toContain("Tenaga penjual: 2 orang");
});

it("menampilkan baris tanpa tenaga penjual dan menyebut angkanya di ringkasan", async () => {
  state.data = data([baris({ id: "a", netto: 75, bruto: 75 })]);
  const html = await render();
  expect(html).toContain("Tanpa tenaga penjual");
  expect(html).toContain("Tanpa tenaga penjual: Rp 75");
});

it("menyaring per peran tanpa membuang sisi lain dari barisnya", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter", stafId: "perawat" })]);
  const html = await render({ peran: "Non-dokter" });
  expect(html).toContain("Perawat Fiktif");
  expect(html).not.toContain("Drh. Fiktif<");
  expect(html).toContain("Total perusahaan (netto): Rp 200");
});

it("menyaring per karyawan, kanal dan jenis", async () => {
  state.data = data([
    baris({ id: "a", dokterId: "dokter" }),
    baris({ id: "b", penjualId: "perawat", kanal: "Petshop", jenis: "Barang", netto: 50, bruto: 50, dokumenId: "struk" }),
  ]);
  expect(await render({ kanal: "Petshop" })).toContain("Total perusahaan (netto): Rp 50");
  expect(await render({ jenis: "Jasa" })).toContain("Total perusahaan (netto): Rp 200");
  expect(await render({ karyawan: "dokter" })).toContain("Total perusahaan (netto): Rp 200");
});

it("mengabaikan saringan karyawan yang tidak ada di daftar", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter" })]);
  expect(await render({ karyawan: "orang-asing" })).toContain("Total perusahaan (netto): Rp 200");
});

it("menautkan tiap baris rincian ke dokumen asalnya lengkap dengan perannya", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter", dokumen: "INV-9", href: "/penjualan/xyz" })]);
  const html = await render();
  expect(html).toContain('href="/penjualan/xyz"');
  expect(html).toContain("INV-9");
  expect(html).toContain("Milo");
  expect(html).toContain("Pemilik Fiktif");
});

it("menjelaskan retur tak bersumber dan selisih kepala dokumen kalau ada", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter" })], { returTanpaSumber: 40, selisihDokumen: 11 });
  const html = await render();
  expect(html).toContain("Rp 40");
  expect(html).toContain("Rp 11");
});

it("menampilkan pesan kesalahan pembacaan apa adanya", async () => {
  state.data = data([], { pesanError: "Laporan belum bisa dibaca." });
  expect(await render()).toContain("Laporan belum bisa dibaca.");
});

it("merekap sisa tagihan faktur grosir per penjual dan merincinya", async () => {
  state.data = data([], { faktur: [
    { id: "f1", no_faktur: "FJ-1", tanggal: "2026-10-10", penjualId: "perawat", nilai: 1000, dibayar: 400, sisa: 600 },
    { id: "f2", no_faktur: "FJ-2", tanggal: "2026-10-11", penjualId: "perawat", nilai: 500, dibayar: 500, sisa: 0 },
  ] });
  const html = await render();
  const rekap = html.split("03 · FAKTUR GROSIR BELUM LUNAS PER PENJUAL")[1];
  expect(rekap).toContain("Perawat Fiktif");
  expect(rekap).toContain("Rp 1.500");
  expect(rekap).toContain("FJ-1");
  expect(rekap).toContain("FJ-2");
  expect(rekap).toContain("Rp 600");
});

it("A2: tampilan Rekap per item menjumlah qty per orang per item; tampilan rincian tetap bawaan", async () => {
  state.data = data([
    baris({ id: "a", dokterId: "dokter", item: "Vaksin Rabies", itemId: "rabies", jenis: "Obat", qty: 2, dokumenId: "d1" }),
    baris({ id: "b", dokterId: "dokter", item: "Vaksin Rabies", itemId: "rabies", jenis: "Obat", qty: 3, dokumenId: "d2" }),
  ]);
  const rekap = await render({ tampilan: "rekap-item" });
  const bagian = rekap.split("02 · REKAP PER TENAGA PENJUAL → PER ITEM")[1];
  expect(bagian).toBeDefined();
  expect(bagian).toContain("Vaksin Rabies");
  expect(bagian).toMatch(/>5<\/td>/);
  expect(rekap).not.toContain("02 · RINCIAN BARIS PER ORANG");

  const bawaan = await render();
  expect(bawaan).toContain("02 · RINCIAN BARIS PER ORANG");
  expect(bawaan).not.toContain("PER ITEM");
});

it("A3: tombol unduh lengkap membawa semua saringan aktif, termasuk satu karyawan dan tampilan", async () => {
  state.data = data([baris({ id: "a", dokterId: "dokter" })]);
  const html = await render({ dari: "2026-10-01", sampai: "2026-10-31", karyawan: "dokter", tampilan: "rekap-item", cabang_id: "cabang" });
  expect(html).toContain('href="/laporan/penjual/unduh?dari=2026-10-01&amp;sampai=2026-10-31&amp;cabang_id=cabang&amp;karyawan=dokter&amp;tampilan=rekap-item"');
  expect(html).toContain("&amp;format=csv");
});
