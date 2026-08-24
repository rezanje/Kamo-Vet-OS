import { describe, it, expect } from "vitest";
import {
  ringkasPerHari, streakTidakAda, trenAngka, statusSuhu, peringatan,
  type LaporanHarian,
} from "../monitoring-inap";

const kosong = {
  makan: null, minum: null, bab: null, pipis: null, berat: null, suhu: null,
  fotoUrl: null, kondisi: "-", tindakan: null, keterangan: null,
  komunikasiOwner: null, komunikasiVia: null, dokter: null,
};
const log = (p: Partial<LaporanHarian> & { id: string; tanggal: string; waktu: string }): LaporanHarian =>
  ({ ...kosong, ...p });

describe("ringkasPerHari — satu hari bisa banyak visit", () => {
  const data = [
    log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", berat: 10, suhu: 39.5, bab: "tidak ada", makan: "tidak mau" }),
    log({ id: "2", tanggal: "2026-08-06", waktu: "2026-08-06T20:00:00Z", berat: 9.8, suhu: 38.6, bab: "normal", makan: "sebagian", fotoUrl: "f2.jpg" }),
    log({ id: "3", tanggal: "2026-08-05", waktu: "2026-08-05T09:00:00Z", berat: 10.2, suhu: 39.0, bab: "tidak ada" }),
  ];

  it("hari terbaru di atas & jumlah laporan dihitung", () => {
    const h = ringkasPerHari(data);
    expect(h.map((x) => x.tanggal)).toEqual(["2026-08-06", "2026-08-05"]);
    expect(h[0].jumlahLaporan).toBe(2);
  });

  it("angka memakai catatan TERAKHIR hari itu", () => {
    const h = ringkasPerHari(data);
    expect(h[0].berat).toBe(9.8);
    expect(h[0].suhu).toBe(38.6);
    expect(h[0].makan).toBe("sebagian");
  });

  it("BAB dianggap ada kalau salah satu visit mencatat ada", () => {
    const h = ringkasPerHari(data);
    expect(h[0].adaBab).toBe(true);
    expect(h[1].adaBab).toBe(false);
  });

  it("hari tanpa catatan BAB sama sekali = tidak diketahui, bukan 'tidak ada'", () => {
    const h = ringkasPerHari([log({ id: "x", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", suhu: 38.5 })]);
    expect(h[0].adaBab).toBeNull();
    expect(h[0].adaPipis).toBeNull();
  });
});

describe("streakTidakAda", () => {
  const hariDgnBab = (nilai: (string | null)[]) =>
    ringkasPerHari(nilai.map((b, i) => log({
      id: String(i), tanggal: `2026-08-${String(10 - i).padStart(2, "0")}`,
      waktu: `2026-08-${String(10 - i).padStart(2, "0")}T08:00:00Z`, bab: b,
    })));

  it("menghitung hari berturut-turut tanpa BAB dari hari terbaru", () => {
    const s = streakTidakAda(hariDgnBab(["tidak ada", "tidak ada", "normal"]), "bab");
    expect(s).toEqual({ hari: 2, terhentiKarenaKosong: false });
  });

  it("berhenti di hari yang tidak tercatat dan menandainya", () => {
    const s = streakTidakAda(hariDgnBab(["tidak ada", null, "tidak ada"]), "bab");
    expect(s).toEqual({ hari: 1, terhentiKarenaKosong: true });
  });

  it("BAB hari ini = streak nol", () => {
    expect(streakTidakAda(hariDgnBab(["normal", "tidak ada"]), "bab").hari).toBe(0);
  });
});

describe("trenAngka", () => {
  const hari = ringkasPerHari([
    log({ id: "1", tanggal: "2026-08-04", waktu: "2026-08-04T08:00:00Z", berat: 10.0 }),
    log({ id: "2", tanggal: "2026-08-05", waktu: "2026-08-05T08:00:00Z", berat: 9.6 }),
    log({ id: "3", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", berat: 9.9 }),
  ]);

  it("titik grafik urut lama → baru", () => {
    expect(trenAngka(hari, "berat").titik.map((t) => t.nilai)).toEqual([10.0, 9.6, 9.9]);
  });

  it("membandingkan dua penimbangan terakhir", () => {
    const t = trenAngka(hari, "berat");
    expect(t.terakhir).toBe(9.9);
    expect(t.sebelumnya).toBe(9.6);
    expect(t.delta).toBeCloseTo(0.3);
    expect(t.arah).toBe("naik");
  });

  it("satu titik saja belum bisa disebut tren", () => {
    const satu = ringkasPerHari([log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", suhu: 39 })]);
    expect(trenAngka(satu, "suhu").arah).toBe("belum cukup data");
  });
});

describe("statusSuhu", () => {
  it("memakai rentang normal anjing & kucing", () => {
    expect(statusSuhu(39.8)).toBe("demam");
    expect(statusSuhu(38.5)).toBe("normal");
    expect(statusSuhu(37.2)).toBe("rendah");
    expect(statusSuhu(null)).toBe("belum diukur");
  });
});

describe("peringatan serah terima", () => {
  it("menyebut BAB tertahan, demam, dan berat turun tajam", () => {
    const hari = ringkasPerHari([
      log({ id: "1", tanggal: "2026-08-05", waktu: "2026-08-05T08:00:00Z", bab: "tidak ada", pipis: "normal", berat: 10, suhu: 38.5 }),
      log({ id: "2", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", bab: "tidak ada", pipis: "normal", berat: 9.2, suhu: 39.9 }),
    ]);
    const p = peringatan(hari);
    expect(p.some((x) => /BAB 2 hari/.test(x))).toBe(true);
    expect(p.some((x) => /di atas normal/.test(x))).toBe(true);
    expect(p.some((x) => /Berat turun/.test(x))).toBe(true);
  });

  it("pasien baik-baik saja tidak memunculkan peringatan", () => {
    const hari = ringkasPerHari([
      log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", bab: "normal", pipis: "normal", berat: 10, suhu: 38.6, makan: "habis", minum: "normal" }),
    ]);
    expect(peringatan(hari)).toEqual([]);
  });
});
