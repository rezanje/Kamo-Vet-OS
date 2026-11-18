import { describe, expect, it } from "vitest";
import { readReportRows, ReportInputError } from "@/lib/hpp-reports-server";

const semua = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}` }));

function pembaca(baris: { id: string }[], opsi: { geser?: (from: number) => number; ubahHitung?: (from: number) => number } = {}) {
  const dipanggil: number[] = [];
  let sedang = 0; let puncak = 0;
  const baca = async (from: number, to: number) => {
    dipanggil.push(from);
    sedang++; puncak = Math.max(puncak, sedang);
    await new Promise(r => setTimeout(r, 5));
    sedang--;
    const awal = opsi.geser ? opsi.geser(from) : from;
    return { data: baris.slice(awal, to + 1), error: null, count: opsi.ubahHitung ? opsi.ubahHitung(from) : baris.length };
  };
  return { baca, dipanggil, puncak: () => puncak };
}

describe("readReportRows - pembacaan halaman bersamaan", () => {
  it("hasil dan urutan sama dengan jalur berurutan", async () => {
    const baris = semua(2203);
    const urut = await readReportRows(pembaca(baris).baca);
    const p = pembaca(baris);
    const paralel = await readReportRows(p.baca, undefined, { paralel: 4 });
    expect(paralel).toEqual(urut);
    expect(paralel).toHaveLength(2203);
    expect(p.dipanggil.sort((a, b) => a - b)).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it("halaman pertama dulu (menetapkan jumlah), sisanya paling banyak `paralel` sekaligus", async () => {
    const p = pembaca(semua(6000));
    await readReportRows(p.baca, undefined, { paralel: 3 });
    expect(p.dipanggil[0]).toBe(0);
    expect(p.puncak()).toBeLessThanOrEqual(3);
    expect(p.puncak()).toBeGreaterThan(1);
  });

  it("satu halaman: satu panggilan; kosong: satu panggilan", async () => {
    const a = pembaca(semua(10)); expect(await readReportRows(a.baca, undefined, { paralel: 4 })).toHaveLength(10); expect(a.dipanggil).toEqual([0]);
    const b = pembaca([]); expect(await readReportRows(b.baca, undefined, { paralel: 4 })).toEqual([]); expect(b.dipanggil).toEqual([0]);
  });

  it("jumlah berubah di tengah pembacaan atau halaman terpotong -> galat (gagal-tertutup), seperti jalur berurutan", async () => {
    await expect(readReportRows(pembaca(semua(1200), { ubahHitung: from => from === 500 ? 1201 : 1200 }).baca, undefined, { paralel: 4 })).rejects.toBeInstanceOf(ReportInputError);
    await expect(readReportRows(pembaca(semua(1200), { geser: from => from === 1000 ? 1100 : from }).baca, undefined, { paralel: 4 })).rejects.toBeInstanceOf(ReportInputError);
  });

  it("identitas ganda antar halaman ditolak; galat baca dilempar", async () => {
    const ganda = [...semua(500), ...semua(500)];
    await expect(readReportRows(pembaca(ganda).baca, undefined, { paralel: 4 })).rejects.toBeInstanceOf(ReportInputError);
    await expect(readReportRows(async () => ({ data: null, error: { message: "boom" }, count: null }), undefined, { paralel: 4 })).rejects.toThrow("boom");
  });
});
