import { describe, it, expect } from "vitest";
import {
  ringkasPerHari, streakBuruk, trenAngka, trenOrdinal, statusSuhu, peringatan,
  normalOrdinal, skorOrdinal,
  type LaporanHarian,
} from "../monitoring-inap";

const kosong = {
  makan: null, minum: null, bab: null, pipis: null, berat: null, suhu: null,
  fotoUrl: null, kondisi: "-", tindakan: null, keterangan: null,
  komunikasiOwner: null, komunikasiVia: null, dokter: null,
};
const log = (p: Partial<LaporanHarian> & { id: string; tanggal: string; waktu: string }): LaporanHarian =>
  ({ ...kosong, ...p });

describe("skala Baik/Sedang/Buruk", () => {
  it("membaca nilai apa adanya, tidak peduli huruf besar-kecil", () => {
    expect(normalOrdinal("Baik")).toBe("Baik");
    expect(normalOrdinal("buruk")).toBe("Buruk");
    expect(normalOrdinal("")).toBeNull();
    expect(normalOrdinal(null)).toBeNull();
  });

  it("catatan lama tetap terbaca di skala baru", () => {
    expect(normalOrdinal("habis")).toBe("Baik");
    expect(normalOrdinal("sebagian")).toBe("Sedang");
    expect(normalOrdinal("tidak mau")).toBe("Buruk");
    expect(normalOrdinal("cair")).toBe("Buruk");
  });

  it("skornya dipakai grafik: Baik paling atas", () => {
    expect(skorOrdinal("Baik")).toBe(3);
    expect(skorOrdinal("Sedang")).toBe(2);
    expect(skorOrdinal("Buruk")).toBe(1);
    expect(skorOrdinal(null)).toBeNull();
  });
});

describe("ringkasPerHari — satu hari bisa banyak visit", () => {
  const data = [
    log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", berat: 10, suhu: 39.5, bab: "Buruk", makan: "Buruk" }),
    log({ id: "2", tanggal: "2026-08-06", waktu: "2026-08-06T20:00:00Z", berat: 9.8, suhu: 38.6, bab: "Baik", makan: "Sedang", fotoUrl: "f2.jpg" }),
    log({ id: "3", tanggal: "2026-08-05", waktu: "2026-08-05T09:00:00Z", berat: 10.2, suhu: 39.0, bab: "Buruk" }),
  ];

  it("hari terbaru di atas & jumlah laporan dihitung", () => {
    const h = ringkasPerHari(data);
    expect(h.map((x) => x.tanggal)).toEqual(["2026-08-06", "2026-08-05"]);
    expect(h[0].jumlahLaporan).toBe(2);
  });

  it("semua nilai memakai catatan TERAKHIR hari itu", () => {
    const h = ringkasPerHari(data);
    expect(h[0].berat).toBe(9.8);
    expect(h[0].suhu).toBe(38.6);
    expect(h[0].makan).toBe("Sedang");
    expect(h[0].bab).toBe("Baik");
  });

  it("hari tanpa catatan sama sekali = belum dinilai, bukan buruk", () => {
    const h = ringkasPerHari([log({ id: "x", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", suhu: 38.5 })]);
    expect(h[0].bab).toBeNull();
    expect(h[0].pipis).toBeNull();
  });
});

describe("streakBuruk", () => {
  const hariDgnBab = (nilai: (string | null)[]) =>
    ringkasPerHari(nilai.map((b, i) => log({
      id: String(i), tanggal: `2026-08-${String(10 - i).padStart(2, "0")}`,
      waktu: `2026-08-${String(10 - i).padStart(2, "0")}T08:00:00Z`, bab: b,
    })));

  it("menghitung hari berturut-turut buruk dari hari terbaru", () => {
    expect(streakBuruk(hariDgnBab(["Buruk", "Buruk", "Baik"]), "bab"))
      .toEqual({ hari: 2, terhentiKarenaKosong: false });
  });

  it("berhenti di hari yang tidak tercatat dan menandainya", () => {
    expect(streakBuruk(hariDgnBab(["Buruk", null, "Buruk"]), "bab"))
      .toEqual({ hari: 1, terhentiKarenaKosong: true });
  });

  it("membaik hari ini = streak nol", () => {
    expect(streakBuruk(hariDgnBab(["Baik", "Buruk"]), "bab").hari).toBe(0);
  });
});

describe("trenOrdinal", () => {
  const hari = ringkasPerHari([
    log({ id: "1", tanggal: "2026-08-04", waktu: "2026-08-04T08:00:00Z", makan: "Buruk" }),
    log({ id: "2", tanggal: "2026-08-05", waktu: "2026-08-05T08:00:00Z", makan: "Sedang" }),
    log({ id: "3", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", makan: "Baik" }),
  ]);

  it("jadi angka supaya bisa digambar, urut lama → baru", () => {
    expect(trenOrdinal(hari, "makan").titik.map((t) => t.nilai)).toEqual([1, 2, 3]);
  });

  it("membaik terbaca sebagai naik", () => {
    expect(trenOrdinal(hari, "makan").arah).toBe("naik");
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
  it("menyebut BAB buruk beruntun, demam, dan berat turun tajam", () => {
    const hari = ringkasPerHari([
      log({ id: "1", tanggal: "2026-08-05", waktu: "2026-08-05T08:00:00Z", bab: "Buruk", pipis: "Baik", berat: 10, suhu: 38.5 }),
      log({ id: "2", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", bab: "Buruk", pipis: "Baik", berat: 9.2, suhu: 39.9 }),
    ]);
    const p = peringatan(hari);
    expect(p.some((x) => /BAB buruk 2 hari/.test(x))).toBe(true);
    expect(p.some((x) => /di atas normal/.test(x))).toBe(true);
    expect(p.some((x) => /Berat turun/.test(x))).toBe(true);
  });

  it("buruk sekali di catatan terakhir tetap disebut", () => {
    const hari = ringkasPerHari([
      log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", makan: "Buruk", suhu: 38.6 }),
    ]);
    expect(peringatan(hari).some((x) => /Makan buruk pada catatan terakhir/.test(x))).toBe(true);
  });

  it("pasien baik-baik saja tidak memunculkan peringatan", () => {
    const hari = ringkasPerHari([
      log({ id: "1", tanggal: "2026-08-06", waktu: "2026-08-06T08:00:00Z", bab: "Baik", pipis: "Baik", berat: 10, suhu: 38.6, makan: "Baik", minum: "Baik" }),
    ]);
    expect(peringatan(hari)).toEqual([]);
  });
});
