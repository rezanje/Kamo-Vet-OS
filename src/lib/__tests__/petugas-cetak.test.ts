import { expect, it } from "vitest";
import { petugasCetak, type BarisPetugas } from "../petugas-cetak";

const baris = (p: { dokter?: string; staf?: string; kategori?: string }): BarisPetugas => ({
  service_performers: p.dokter || p.staf ? { doctor_name: p.dokter ?? null, staff_name: p.staf ?? null } : null,
  item: p.kategori ? { tindakan_kategori: p.kategori } : null, resep: null,
});

it("grooming: dokter pemeriksa lalu groomer, dari cuplikan transaksi", () => {
  expect(petugasCetak("Grooming", "Groomer Registrasi", [
    baris({ dokter: "Drh A", staf: "Groomer B", kategori: "Grooming" }),
    baris({ dokter: "Drh A", staf: "Paramedis C", kategori: "Injeksi" }),
  ])).toEqual([{ label: "Dokter Pemeriksa", nama: "Drh A" }, { label: "Groomer", nama: "Groomer B" }]);
});

it("grooming tanpa cuplikan memakai orang dari registrasi sebagai groomer", () => {
  expect(petugasCetak("grooming", "Groomer Registrasi", [baris({})]))
    .toEqual([{ label: "Groomer", nama: "Groomer Registrasi" }]);
});

it("grooming lewat kategori resep dan beberapa groomer digabung", () => {
  const r = baris({ staf: "G1" }); r.resep = { kategori: "Grooming" };
  expect(petugasCetak("Grooming", null, [r, baris({ staf: "G2", kategori: "Grooming" })]))
    .toEqual([{ label: "Groomer", nama: "G1, G2" }]);
});

it("kunjungan non-grooming tetap Dokter PJ; groomer hanya bila ada layanan grooming", () => {
  expect(petugasCetak("Poli Umum", "Drh PJ", [baris({ dokter: "Drh X", staf: "Perawat" })]))
    .toEqual([{ label: "Dokter PJ", nama: "Drh PJ" }]);
  expect(petugasCetak("Poli Umum", "Drh PJ", [baris({ staf: "Groomer B", kategori: "Grooming" })]))
    .toEqual([{ label: "Dokter PJ", nama: "Drh PJ" }, { label: "Groomer", nama: "Groomer B" }]);
  expect(petugasCetak("Poli Umum", null, [])).toEqual([]);
});
