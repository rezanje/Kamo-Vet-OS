import { describe, expect, it, vi } from "vitest";
import { keteranganJejak, lintasBulan, muatJejakMundurByIds, muatJejakMundurSejak, ringkasLaporanMundur, ringkasPerubahan, selisihHari, tanggalInputWIB } from "@/lib/expense-jejak";

const J = (id: string, extra: Record<string, unknown> = {}) => ({ expense_id: id, effective_date: "2026-11-20", reason: "nota terlupa", recorded_at: "2026-11-26T03:00:00Z", ...extra });

describe("muat jejak untuk daftar", () => {
  it("per id: dipotong 100 id per permintaan dan digabung; baris tak sah dibuang", async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `id-${i}`);
    const dipanggil: number[] = [];
    const klien = { from: (t: string) => ({ select: () => ({ in: (_k: string, potong: string[]) => { expect(t).toBe("expense_backdates"); dipanggil.push(potong.length); return Promise.resolve({ data: [J(potong[0]), { expense_id: "x" }], error: null }); } }) }) };
    const peta = await muatJejakMundurByIds(klien, [...ids, ...ids]);
    expect(dipanggil).toEqual([100, 100, 30]);
    expect(peta.size).toBe(3);
    expect(peta.get("id-0")?.reason).toBe("nota terlupa");
  });
  it("galat baca atau pengecualian = peta kosong, tidak pernah melempar", async () => {
    expect((await muatJejakMundurByIds({ from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "denied" } }) }) }) }, ["a"])).size).toBe(0);
    expect((await muatJejakMundurByIds({ from: () => { throw new Error("tabel tidak dikenal"); } }, ["a"])).size).toBe(0);
    expect((await muatJejakMundurByIds({ from: () => ({}) }, [])).size).toBe(0);
  });
  it("sejak tanggal: halaman 1000 sampai habis", async () => {
    const halaman = [Array.from({ length: 1000 }, (_, i) => J(`a${i}`)), [J("b0"), J("b1")]];
    const range = vi.fn((awal: number) => Promise.resolve({ data: halaman[awal / 1000], error: null }));
    const klien = { from: () => ({ select: () => ({ gte: (k: string, v: string) => { expect([k, v]).toEqual(["effective_date", "2026-01-01"]); return { order: () => ({ order: () => ({ range }) }) }; } }) }) };
    const peta = await muatJejakMundurSejak(klien, "2026-01-01");
    expect(peta.size).toBe(1002);
    expect(range.mock.calls.map((c) => c[0])).toEqual([0, 1000]);
  });
  it("sejak tanggal: galat = kosong", async () => {
    expect((await muatJejakMundurSejak({ from: () => { throw new Error("x"); } }, "2026-01-01")).size).toBe(0);
  });
});

describe("hitungan tanggal WIB", () => {
  it("tanggal input memakai WIB: 17:00Z sudah hari berikutnya", () => {
    expect(tanggalInputWIB("2026-11-25T16:59:59Z")).toBe("2026-11-25");
    expect(tanggalInputWIB("2026-11-25T17:00:00Z")).toBe("2026-11-26");
  });
  it("selisih hari dan lintas bulan", () => {
    expect(selisihHari("2026-11-20", "2026-11-26T03:00:00Z")).toBe(6);
    expect(selisihHari("2026-10-31", "2026-11-01T02:00:00Z")).toBe(1);
    expect(lintasBulan("2026-10-31", "2026-11-01T02:00:00Z")).toBe(true);
    expect(lintasBulan("2026-11-20", "2026-11-26T03:00:00Z")).toBe(false);
    // 31 Okt 23:59 WIB diinput 31 Okt 16:59Z = masih Oktober
    expect(lintasBulan("2026-10-20", "2026-10-31T16:59:00Z")).toBe(false);
    expect(lintasBulan("2026-10-20", "2026-10-31T17:00:00Z")).toBe(true);
  });
  it("keterangan tooltip memuat tanggal efektif, waktu input WIB dan alasan", () => {
    const t = keteranganJejak({ effective_date: "2026-11-20", reason: "nota listrik", recorded_at: "2026-11-26T03:00:00Z" });
    expect(t).toContain("20/11/2026"); expect(t).toContain("WIB"); expect(t).toContain("nota listrik");
  });
});

describe("ringkasPerubahan (riwayat koreksi)", () => {
  it("menyebut tanggal, kategori, metode, jumlah yang berubah", () => {
    const r = ringkasPerubahan(
      { tanggal: "2026-11-26", kategori: "Operasional", metode_bayar: "Tunai", jumlah: 1000 },
      { tanggal: "2026-05-07", kategori: "Listrik & Air", metode_bayar: "Transfer", jumlah: 2500 },
    );
    expect(r).toEqual(["Tanggal 26/11/2026 → 07/05/2026", "Kategori Operasional → Listrik & Air", "Metode Tunai → Transfer", "Jumlah Rp 1.000 → Rp 2.500"]);
  });
  it("tanpa selisih / data kosong = kosong", () => {
    const sama = { tanggal: "2026-11-26", kategori: "A", metode_bayar: "Tunai", jumlah: 5 };
    expect(ringkasPerubahan(sama, { ...sama })).toEqual([]);
    expect(ringkasPerubahan(null, sama)).toEqual([]);
    expect(ringkasPerubahan(sama, undefined)).toEqual([]);
  });
});

describe("ringkasLaporanMundur", () => {
  it("menghitung total tanpa yang dibatalkan dan memisahkan lintas bulan", () => {
    const r = ringkasLaporanMundur([
      { effective_date: "2026-11-20", recorded_at: "2026-11-26T03:00:00Z", jumlah: 1000, dibatalkan: false },
      { effective_date: "2026-10-30", recorded_at: "2026-11-02T03:00:00Z", jumlah: 4000, dibatalkan: false },
      { effective_date: "2026-10-30", recorded_at: "2026-11-02T03:00:00Z", jumlah: 9000, dibatalkan: true },
    ]);
    expect(r).toEqual({ baris: 3, aktif: 2, dibatalkan: 1, total: 5000, lintasBulan: 1, totalLintasBulan: 4000 });
  });
  it("kosong", () => { expect(ringkasLaporanMundur([])).toEqual({ baris: 0, aktif: 0, dibatalkan: 0, total: 0, lintasBulan: 0, totalLintasBulan: 0 }); });
});
