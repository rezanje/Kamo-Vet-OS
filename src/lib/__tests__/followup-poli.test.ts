import { describe, expect, it } from "vitest";
import { barisFollowUpTerkirim, bersihkanFollowUp, tanggalSetelah } from "@/lib/followup";

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
