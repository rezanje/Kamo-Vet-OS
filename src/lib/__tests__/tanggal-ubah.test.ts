import { describe, expect, it } from "vitest";
import { alasanBermakna, cekTanggalMundur, cekTanggalUbah, penolakanUbahDB } from "@/lib/tanggal-mundur";

const today = "2026-11-26";

describe("alasan bermakna (review PR #570 MINOR-1, sisi aplikasi)", () => {
  it("menolak tab, baris baru, NBSP, titik dan simbol saja; menerima huruf atau angka", () => {
    for (const x of ["\t\t\t", "\n\n\n", "\u00a0\u00a0\u00a0", "...", "---", "!!!"]) expect(alasanBermakna(x)).toBe(false);
    for (const x of ["abc", "nota 12", "123", "é à", "Rp.5"]) expect(alasanBermakna(x)).toBe(true);
  });
  it("input baru: alasan tanpa huruf/angka ditolak walau 3 karakter", () => {
    for (const alasan of ["...", "\t\t\t", "\u00a0\u00a0\u00a0"]) {
      const r = cekTanggalMundur({ tanggal: "2026-11-20", alasan, today });
      expect(r.ok).toBe(false);
    }
    expect(cekTanggalMundur({ tanggal: "2026-11-20", alasan: "nota 7", today })).toMatchObject({ ok: true, mundur: true });
  });
});

describe("cekTanggalUbah: Ubah pengeluaran memakai aturan tanggal yang sama", () => {
  const dasar = { tanggalLama: "2026-11-20", alasan: "salah tanggal", today };
  it("masa depan ditolak", () => {
    const r = cekTanggalUbah({ ...dasar, tanggal: "2026-11-27" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/masa depan/);
  });
  it("tidak sah / kosong ditolak", () => {
    for (const tanggal of ["", "2026-02-31", "kemarin", null, undefined]) expect(cekTanggalUbah({ ...dasar, tanggal }).ok).toBe(false);
  });
  it("tanggal TIDAK diganti: diterima berapa pun umurnya (hanya nominal/kategori dikoreksi)", () => {
    expect(cekTanggalUbah({ tanggal: "2026-05-07", tanggalLama: "2026-05-07", alasan: "salah nominal", today })).toEqual({ ok: true, tanggal: "2026-05-07", berubah: false });
    expect(cekTanggalUbah({ tanggal: "2026-11-20", tanggalLama: "2026-11-20", alasan: null, today })).toMatchObject({ ok: true, berubah: false });
  });
  it("tanggal diganti ke hari ini: diterima tanpa batas tambahan", () => {
    expect(cekTanggalUbah({ tanggal: today, tanggalLama: "2026-01-01", alasan: "salah", today })).toEqual({ ok: true, tanggal: today, berubah: true });
  });
  it("diganti ke masa lalu: batas 31 hari persis (hari ke-31 boleh, ke-32 ditolak)", () => {
    expect(cekTanggalUbah({ ...dasar, tanggal: "2026-10-26" })).toMatchObject({ ok: true, berubah: true });
    const r = cekTanggalUbah({ ...dasar, tanggal: "2026-10-25" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/31 hari/);
  });
  it("200 hari lalu dengan alasan 'abc' (contoh review MINOR-2) sekarang ditolak", () => {
    expect(cekTanggalUbah({ tanggal: "2026-05-10", tanggalLama: "2026-11-26", alasan: "abc", today }).ok).toBe(false);
  });
  it("diganti ke masa lalu: alasan koreksi 3-200 huruf/angka wajib", () => {
    for (const alasan of [null, "", "ab", "...", "x".repeat(201)]) expect(cekTanggalUbah({ ...dasar, tanggal: "2026-11-10", alasan }).ok).toBe(false);
    expect(cekTanggalUbah({ ...dasar, tanggal: "2026-11-10", alasan: "x".repeat(200) })).toMatchObject({ ok: true });
  });
  it("semua penolakan menyatakan perubahan BELUM tersimpan", () => {
    for (const r of [cekTanggalUbah({ ...dasar, tanggal: "2026-12-01" }), cekTanggalUbah({ ...dasar, tanggal: "2026-01-01" }), cekTanggalUbah({ ...dasar, tanggal: "x" })]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/BELUM tersimpan/);
    }
  });
});

describe("penolakanUbahDB: hanya penolakan pasti dikembalikan", () => {
  it.each([
    "Periode akuntansi sudah ditutup",
    "Pengeluaran sudah berubah. Muat ulang detail sebelum mengoreksi.",
    "Shift sudah ditutup. Koreksi memerlukan rekonsiliasi kas terlebih dahulu.",
    "Pengeluaran sudah dibatalkan",
    "Tanggal, kategori, metode atau jumlah pengeluaran tidak valid",
    "Akses pengeluaran ditolak.",
  ])("%s -> pesan + BELUM tersimpan", (m) => {
    const out = penolakanUbahDB(m);
    expect(out).toContain(m.replace(/\.$/, ""));
    expect(out).toMatch(/Perubahan BELUM tersimpan\.$/);
  });
  it("galat tak dikenal (jaringan, timeout, kunci beda) = null: tetap dilempar karena hasilnya belum pasti", () => {
    for (const m of ["fetch failed", "Permintaan sudah digunakan dengan rincian berbeda", "canceling statement due to statement timeout", "", undefined]) expect(penolakanUbahDB(m)).toBeNull();
  });
});
