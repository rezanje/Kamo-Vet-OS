import { describe, it, expect } from "vitest";
import {
  aturanBerlaku, putuskan, ringkasAturan, labelJenis, kunciKasKeluar,
  type AturanPersetujuan,
} from "../persetujuan";

const a = (p: Partial<AturanPersetujuan>): AturanPersetujuan => ({
  id: "1", jenis: "bayar-faktur", minNilai: 1_000_000, penyetujuRole: "ADMIN", aktif: true, ...p,
});

describe("aturanBerlaku", () => {
  it("di bawah ambang tidak perlu izin", () => {
    expect(aturanBerlaku([a({})], "bayar-faktur", 999_999)).toBeNull();
  });

  it("tepat di ambang belum perlu izin — yang dijaga di ATAS ambang", () => {
    expect(aturanBerlaku([a({})], "bayar-faktur", 1_000_000)).toBeNull();
  });

  it("di atas ambang kena aturan", () => {
    expect(aturanBerlaku([a({})], "bayar-faktur", 1_000_001)?.penyetujuRole).toBe("ADMIN");
  });

  it("jenis lain tidak ikut kena", () => {
    expect(aturanBerlaku([a({})], "kas-keluar", 50_000_000)).toBeNull();
  });

  it("aturan nonaktif diabaikan", () => {
    expect(aturanBerlaku([a({ aktif: false })], "bayar-faktur", 50_000_000)).toBeNull();
  });

  it("kalau dua aturan sama-sama kena, yang ambangnya paling tinggi yang dipakai", () => {
    const dipakai = aturanBerlaku([
      a({ id: "kecil", minNilai: 1_000_000, penyetujuRole: "ADMIN" }),
      a({ id: "besar", minNilai: 50_000_000, penyetujuRole: "OWNER" }),
    ], "bayar-faktur", 60_000_000);
    expect(dipakai?.id).toBe("besar");
    expect(dipakai?.penyetujuRole).toBe("OWNER");
  });

  it("nilai di antara dua ambang memakai aturan yang lebih rendah", () => {
    const dipakai = aturanBerlaku([
      a({ id: "kecil", minNilai: 1_000_000, penyetujuRole: "ADMIN" }),
      a({ id: "besar", minNilai: 50_000_000, penyetujuRole: "OWNER" }),
    ], "bayar-faktur", 5_000_000);
    expect(dipakai?.id).toBe("kecil");
  });
});

describe("putuskan", () => {
  const aturan = a({});

  it("tanpa aturan langsung boleh", () => {
    expect(putuskan(null, null, "ADMIN")).toEqual({ boleh: true, alasan: "tanpa aturan" });
  });

  it("belum pernah diajukan = diajukan sekarang, transaksinya ditahan", () => {
    const k = putuskan(aturan, null, "ADMIN");
    expect(k.boleh).toBe(false);
    expect(k).toMatchObject({ alasan: "baru diajukan" });
  });

  it("masih menunggu = tetap ditahan, tanpa mengajukan ulang", () => {
    expect(putuskan(aturan, { status: "menunggu" }, "ADMIN")).toMatchObject({ alasan: "menunggu" });
  });

  it("sudah disetujui = boleh jalan", () => {
    expect(putuskan(aturan, { status: "disetujui" }, "ADMIN")).toEqual({ boleh: true, alasan: "sudah disetujui" });
  });

  it("ditolak = ditahan, alasannya ikut disebut", () => {
    const k = putuskan(aturan, { status: "ditolak", catatan: "belum ada anggaran" }, "ADMIN");
    expect(k.boleh).toBe(false);
    if (!k.boleh) expect(k.pesan).toMatch(/belum ada anggaran/);
  });
});

describe("ringkasAturan", () => {
  it("dibaca manusia", () => {
    expect(ringkasAturan(a({ minNilai: 5_000_000, penyetujuRole: "OWNER" })))
      .toBe("Pembayaran hutang ke pemasok di atas Rp 5.000.000 harus disetujui OWNER");
  });
});

describe("labelJenis", () => {
  it("jenis tak dikenal ditampilkan apa adanya", () => {
    expect(labelJenis("entah-apa")).toBe("entah-apa");
  });
});

describe("kunciKasKeluar", () => {
  const dasar = { tanggal: "2026-08-25", accountId: "acc-1", lawanCode: "5201", jumlah: 5_000_000 };

  it("isi yang sama menghasilkan kunci yang sama", () => {
    expect(kunciKasKeluar(dasar)).toBe(kunciKasKeluar({ ...dasar }));
  });

  it("nominal berbeda = pengeluaran berbeda = kunci berbeda", () => {
    expect(kunciKasKeluar({ ...dasar, jumlah: 6_000_000 })).not.toBe(kunciKasKeluar(dasar));
  });

  it("rekening berbeda juga kunci berbeda", () => {
    expect(kunciKasKeluar({ ...dasar, accountId: "acc-2" })).not.toBe(kunciKasKeluar(dasar));
  });

  it("pecahan nominal dibulatkan supaya kuncinya stabil", () => {
    expect(kunciKasKeluar({ ...dasar, jumlah: 5_000_000.4 })).toBe(kunciKasKeluar(dasar));
  });
});
