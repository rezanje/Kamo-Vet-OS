import { describe, it, expect } from "vitest";
import {
  profilPelanggan, pelangganBaru, baruVsLama, dorman, rataIntervalGabungan, selisihHari,
  type Kunjungan, type TrxRingkas,
} from "../retensi";

const k = (customerId: string, tanggal: string, cabang = "LOJI"): Kunjungan => ({ customerId, tanggal, cabang });

describe("profilPelanggan", () => {
  it("dua struk di hari yang sama = satu kunjungan", () => {
    const p = profilPelanggan([k("a", "2026-08-01"), k("a", "2026-08-01"), k("a", "2026-08-11")]);
    expect(p[0].kunjungan).toBe(2);
    expect(p[0].rataInterval).toBe(10);
  });

  it("baru sekali datang belum punya interval", () => {
    const p = profilPelanggan([k("a", "2026-08-01")]);
    expect(p[0].rataInterval).toBeNull();
  });

  it("rata-rata jarak dari kunjungan pertama ke terakhir", () => {
    const p = profilPelanggan([k("a", "2026-01-01"), k("a", "2026-01-11"), k("a", "2026-01-31")]);
    expect(p[0].rataInterval).toBe(15);   // 30 hari / 2 sela
  });

  it("cabang pertama diambil dari kunjungan paling awal, bukan yang terakhir", () => {
    const p = profilPelanggan([k("a", "2026-08-10", "TKI"), k("a", "2026-08-01", "LOJI")]);
    expect(p[0].cabangPertama).toBe("LOJI");
  });

  it("baris tanpa pelanggan diabaikan, tidak bikin profil hantu", () => {
    expect(profilPelanggan([{ customerId: "", tanggal: "2026-08-01", cabang: "LOJI" }])).toEqual([]);
  });
});

describe("pelangganBaru", () => {
  const profil = profilPelanggan([
    k("a", "2026-07-20", "LOJI"),
    k("b", "2026-08-02", "LOJI"),
    k("c", "2026-08-03", "TKI"),
    k("a", "2026-08-05", "TKI"),
  ]);

  it("hanya yang transaksi pertamanya di dalam rentang", () => {
    expect(pelangganBaru(profil, "2026-08-01", "2026-08-31"))
      .toEqual([{ cabang: "LOJI", baru: 1 }, { cabang: "TKI", baru: 1 }]);
  });

  it("pelanggan lama yang datang lagi tidak dihitung baru", () => {
    const total = pelangganBaru(profil, "2026-08-01", "2026-08-31").reduce((s, r) => s + r.baru, 0);
    expect(total).toBe(2);
  });
});

describe("baruVsLama", () => {
  const profil = profilPelanggan([k("lama", "2026-06-01"), k("baru", "2026-08-02")]);
  const trx: TrxRingkas[] = [
    { customerId: "lama", tanggal: "2026-08-04", cabang: "LOJI", omzet: 100_000 },
    { customerId: "baru", tanggal: "2026-08-02", cabang: "LOJI", omzet: 50_000 },
    { customerId: null, tanggal: "2026-08-05", cabang: "LOJI", omzet: 25_000 },
  ];

  it("memilah transaksi dan omzetnya", () => {
    const [r] = baruVsLama(trx, profil, "2026-08-01");
    expect(r.baru).toBe(1);
    expect(r.omzetBaru).toBe(50_000);
    expect(r.lama).toBe(1);
    expect(r.omzetLama).toBe(100_000);
    expect(r.takDikenal).toBe(1);
  });

  it("struk tanpa identitas tidak ikut membagi rasio", () => {
    const [r] = baruVsLama(trx, profil, "2026-08-01");
    expect(r.rasioBaru).toBe(0.5);
  });

  it("cabang tanpa transaksi teridentifikasi tidak membagi dengan nol", () => {
    const [r] = baruVsLama(
      [{ customerId: null, tanggal: "2026-08-05", cabang: "TKI", omzet: 10_000 }], profil, "2026-08-01");
    expect(r.rasioBaru).toBe(0);
  });
});

describe("dorman", () => {
  const profil = profilPelanggan([
    k("diam", "2026-01-01"),
    k("aktif", "2026-08-20"),
  ]);

  it("yang lewat ambang saja yang muncul, terlama di atas", () => {
    const d = dorman(profil, "2026-08-25", 90);
    expect(d.map((x) => x.customerId)).toEqual(["diam"]);
    expect(d[0].hariDiam).toBe(selisihHari("2026-01-01", "2026-08-25"));
  });

  it("ambang bisa diatur — dinaikkan, daftarnya menyusut", () => {
    expect(dorman(profil, "2026-08-25", 400)).toEqual([]);
  });

  it("tepat di ambang belum disebut dorman", () => {
    const p = profilPelanggan([k("x", "2026-08-01")]);
    expect(dorman(p, "2026-08-31", 30)).toEqual([]);
    expect(dorman(p, "2026-09-01", 30)).toHaveLength(1);
  });
});

describe("rataIntervalGabungan", () => {
  it("hanya menghitung pelanggan yang sudah datang lebih dari sekali", () => {
    const profil = profilPelanggan([
      k("a", "2026-08-01"), k("a", "2026-08-11"),
      k("b", "2026-08-01"), k("b", "2026-08-21"),
      k("c", "2026-08-01"),
    ]);
    expect(rataIntervalGabungan(profil)).toEqual({ rata: 15, dihitungDari: 2 });
  });

  it("belum ada yang datang dua kali = belum bisa dihitung", () => {
    expect(rataIntervalGabungan(profilPelanggan([k("a", "2026-08-01")])))
      .toEqual({ rata: null, dihitungDari: 0 });
  });
});
