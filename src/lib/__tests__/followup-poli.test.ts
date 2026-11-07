import { describe, expect, it } from "vitest";
import { barisFollowUpTerkirim, batasPerluDiingatkan, bacaHariIngat, bersihkanFollowUp, pesanReminder, posisiFollowUp, sapaanPemilik, tanggalSetelah } from "@/lib/followup";

// Masukan Babibu (5 Nov): follow up dari poli pemeriksaan harus otomatis masuk daftar
// follow up. Isian yang tanggalnya sudah dipilih tapi tombol "Tambah" belum diklik dulu
// hilang diam-diam saat rekam medis disimpan.
describe("follow up dari form pemeriksaan", () => {
  const baris = [{ jenis: "Vaksin", tanggal: "2026-12-05", catatan: "" }];

  it("isian bertanggal yang belum di-Tambah tetap ikut terkirim", () => {
    expect(barisFollowUpTerkirim(baris, { jenis: "Kontrol", tanggal: "2026-11-12", catatan: " luka jahitan " }))
      .toEqual([...baris, { jenis: "Kontrol", tanggal: "2026-11-12", catatan: "luka jahitan" }]);
  });

  it("isian tanpa tanggal tidak menambah baris", () => {
    expect(barisFollowUpTerkirim(baris, { jenis: "Kontrol", tanggal: "", catatan: "x" })).toEqual(baris);
    expect(barisFollowUpTerkirim([], { jenis: "Kontrol", tanggal: "", catatan: "" })).toEqual([]);
  });

  it("baris dari form divalidasi: tanggal wajib, jenis di luar daftar jadi Lainnya", () => {
    expect(bersihkanFollowUp({ jenis: "Vaksin", tanggal: "2026-12-05", catatan: " rabies " }))
      .toEqual({ jenis: "Vaksin", tanggal: "2026-12-05", catatan: "rabies" });
    expect(bersihkanFollowUp({ jenis: "Hack", tanggal: "2026-12-05" })?.jenis).toBe("Lainnya");
    expect(bersihkanFollowUp({ jenis: "Vaksin", tanggal: "" })).toBeNull();
    expect(bersihkanFollowUp({ jenis: "Vaksin", tanggal: "05/12/2026" })).toBeNull();
    expect(bersihkanFollowUp(null)).toBeNull();
  });
});

describe("tombol cepat tanggal follow up", () => {
  it("menambah hari dan bulan tanpa meleset di akhir bulan", () => {
    expect(tanggalSetelah("2026-11-05", { hari: 7 })).toBe("2026-11-12");
    expect(tanggalSetelah("2026-11-05", { hari: 14 })).toBe("2026-11-19");
    expect(tanggalSetelah("2026-11-05", { bulan: 1 })).toBe("2026-12-05");
    expect(tanggalSetelah("2026-11-05", { bulan: 12 })).toBe("2027-11-05");
    expect(tanggalSetelah("2026-12-20", { hari: 14 })).toBe("2027-01-03");
    expect(tanggalSetelah("2027-01-31", { bulan: 1 })).toBe("2027-02-28");
    expect(tanggalSetelah("2028-01-31", { bulan: 1 })).toBe("2028-02-29");
  });
});

// Babibu (5 Nov): Ciomas mengirim WA 3 hari sebelum jadwal — daftar harus memuat H-3 tanpa cek manual.
describe("pengingat H-x sebelum jadwal", () => {
  it("bawaan H-3, pilihan di luar daftar kembali ke bawaan", () => {
    expect(bacaHariIngat(undefined)).toBe(3);
    expect(bacaHariIngat("")).toBe(3);
    expect(bacaHariIngat("0")).toBe(0);
    expect(bacaHariIngat("7")).toBe(7);
    expect(bacaHariIngat("4")).toBe(3);
    expect(bacaHariIngat("abc")).toBe(3);
  });

  it("batas daftar = hari ini + H", () => {
    expect(batasPerluDiingatkan("2026-11-05", 3)).toBe("2026-11-08");
    expect(batasPerluDiingatkan("2026-11-30", 3)).toBe("2026-12-03");
    expect(batasPerluDiingatkan("2026-11-05", 0)).toBe("2026-11-05");
  });

  it("menandai terlewat / hari ini / H-n", () => {
    expect(posisiFollowUp("2026-11-03", "2026-11-05")).toEqual({ teks: "terlewat 2 hari", telat: true });
    expect(posisiFollowUp("2026-11-05", "2026-11-05")).toEqual({ teks: "hari ini", telat: false });
    expect(posisiFollowUp("2026-11-08", "2026-11-05")).toEqual({ teks: "H-3", telat: false });
  });
});

// Nama pelanggan yang tersimpan dengan sapaan dulu menghasilkan "Halo Kak Pak Dimas".
describe("sapaan pesan pengingat WhatsApp", () => {
  it("memakai sapaan bawaan nama, menambah Kak hanya bila belum ada", () => {
    expect(sapaanPemilik("Dimas")).toBe("Kak Dimas");
    expect(sapaanPemilik("Pak Dimas")).toBe("Pak Dimas");
    expect(sapaanPemilik("bu  Rina ")).toBe("bu Rina");
    expect(sapaanPemilik("Kak Nadia")).toBe("Kak Nadia");
    expect(sapaanPemilik("drh. Sari")).toBe("drh. Sari");
    expect(sapaanPemilik("Pakdi")).toBe("Kak Pakdi");
    expect(sapaanPemilik("Masayu")).toBe("Kak Masayu");
    expect(sapaanPemilik("")).toBe("Kak");
    expect(sapaanPemilik(null)).toBe("Kak");
  });

  it("pesan tidak lagi berbunyi Kak Pak / Kak Kak", () => {
    const pesan = (pemilik: string) => pesanReminder({ pemilik, hewan: "Bruno", jenis: "Vaksin", tanggal: "2026-11-07" });
    expect(pesan("Pak Dimas")).toMatch(/^Halo Pak Dimas, Bruno sudah masuk jadwal vaksin pada 7 Nov 2026\./);
    expect(pesan("Dimas")).toMatch(/^Halo Kak Dimas, /);
    expect(pesan("")).toMatch(/^Halo Kak, Bruno/);
  });
});
