import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { BarisVisit } from "@/lib/laporan-visit";

// Fixture fiktif.
const state = vi.hoisted(() => ({ rows: [] as unknown[], dipanggil: [] as unknown[] }));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/EmployeePicker", () => ({ EmployeePicker: () => <input name="orang" /> }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ ringkasan, children, siap }: { ringkasan: React.ReactNode; children: React.ReactNode; siap: boolean }) =>
    <main>{siap ? <>{ringkasan}{children}</> : "BELUM DITAMPILKAN"}</main>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <ul>{items.map((k) => <li key={k.label}>{k.label}: {k.nilai}</li>)}</ul>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
vi.mock("./data", () => ({
  ambilOpsiFilterVisit: async () => ({
    cabangOptions: [{ id: "cabang", name: "Cabang Uji" }],
    karyawan: [{ id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", branchName: null }],
    pesanError: "",
  }),
  ambilVisit: async (arg: unknown) => { state.dipanggil.push(arg); return { rows: state.rows, pesanError: "" }; },
}));

import Page from "./page";

const baris = (over: Partial<BarisVisit> & { id: string }): BarisVisit => ({
  tanggal: "2026-11-10", waktu: "2026-11-10T03:00:00Z", jenis: "doctor_visit", inpatientId: "ranap-1",
  cabangId: "cabang", cabang: "Cabang Uji", pasien: "Milo", pemilik: "Pemilik Fiktif", kondisi: "Stabil", tindakan: "Infus",
  dokterId: "dokter", dokterNama: "Drh. Fiktif", paramedisId: "perawat", paramedisNama: "Perawat Fiktif", ...over,
});

const render = (sp: Record<string, string>) => Page({ searchParams: Promise.resolve(sp) }).then(renderToStaticMarkup);

beforeEach(() => { state.rows = []; state.dipanggil = []; });

it("A1: tanpa Tampilkan tidak membaca catatan rawat inap", async () => {
  expect(await render({})).toContain("BELUM DITAMPILKAN");
  expect(state.dipanggil).toEqual([]);
});

it("A4: merekap visit per dokter & paramedis, cabang diteruskan ke query, tautan unduh membawa saringan", async () => {
  state.rows = [baris({ id: "a" }), baris({ id: "b", inpatientId: "ranap-2" }), baris({ id: "c", jenis: "monitoring" })];
  const html = await render({ tampil: "1", dari: "2026-11-01", sampai: "2026-11-30", cabang_id: "cabang" });
  expect(state.dipanggil).toEqual([{ dari: "2026-11-01", sampai: "2026-11-30", cabangId: "cabang" }]);
  expect(html).toContain("Visit dokter (catatan): 2");
  expect(html).toContain("Pemantauan (bukan visit): 1");
  expect(html).toContain("Perawat Fiktif");
  expect(html).toContain('href="/laporan/visit/unduh?dari=2026-11-01&amp;sampai=2026-11-30&amp;cabang_id=cabang"');
  expect(html).toContain('href="/klinik/rawat-inap/ranap-2"');
});

it("A4: saringan per orang hanya menyisakan orang itu", async () => {
  state.rows = [baris({ id: "a" })];
  const html = await render({ tampil: "1", orang: "perawat" });
  const rekap = html.split("01 · REKAP VISIT PER ORANG")[1].split("02 · RINCIAN")[0];
  expect(rekap).toContain("Perawat Fiktif");
  expect(rekap).not.toContain("Drh. Fiktif");
});

it("Ubah dokter PJ: rincian menampilkan Dokter PJ saat ini, sementara insentif visit tetap atas nama dokter penulis catatan", async () => {
  // Catatan ditulis DRH. ILHAM (dokter visit); PJ rawat inap pasien kemudian dikoreksi menjadi dr. Aini.
  state.rows = [baris({ id: "a", dokterId: "ilham", dokterNama: "DRH. ILHAM", dokterPJ: "DRH LUTHFIAH RUSYDA AINI" })];
  const html = await render({ tampil: "1" });
  const rincian = html.split("02 · RINCIAN CATATAN")[1];
  expect(rincian).toContain("Dokter PJ");
  expect(rincian).toMatch(/data-testid="visit-dokter-pj"[^>]*>DRH LUTHFIAH RUSYDA AINI</);
  const rekap = html.split("01 · REKAP VISIT PER ORANG")[1].split("02 · RINCIAN")[0];
  expect(rekap).toContain("DRH. ILHAM");
  expect(rekap).not.toContain("AINI");
});

it("Ubah dokter PJ: data lama tanpa Dokter PJ tampil strip, bukan galat", async () => {
  state.rows = [baris({ id: "a" })];
  const html = await render({ tampil: "1" });
  expect(html).toMatch(/data-testid="visit-dokter-pj"[^>]*>—</);
});
