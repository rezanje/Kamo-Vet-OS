import { describe, it, expect } from "vitest";
import {
  progresObat, ringkasProgres, peringatanObat, tanggalWib, selisihHari,
  type Protokol, type Pemberian,
} from "../obat-inap";

const protokol = (p: Partial<Protokol> = {}): Protokol => ({
  id: "m1", namaObat: "Ampi Sulbactam", dosis: "1 ml", rute: "IV",
  frekuensiPerHari: 4, durasiHari: 3, mulaiTanggal: "2026-08-24",
  dihentikanAt: null, ...p,
});

// Jam WIB → ISO UTC (WIB = UTC+7).
const dosis = (tanggal: string, jam: number, i = 0, batal = false): Pemberian => ({
  id: `${tanggal}-${jam}-${i}`, medicationId: "m1",
  diberikanAt: new Date(Date.UTC(
    Number(tanggal.slice(0, 4)), Number(tanggal.slice(5, 7)) - 1, Number(tanggal.slice(8, 10)),
    jam - 7,
  )).toISOString(),
  namaPemberi: "drh fanny", catatan: null, dibatalkanAt: batal ? new Date().toISOString() : null,
});

describe("bantuan tanggal", () => {
  it("jam 01.00 WIB masih tanggal yang sama, bukan mundur sehari", () => {
    expect(tanggalWib("2026-08-23T18:00:00Z")).toBe("2026-08-24");
  });
  it("selisih hari kalender", () => {
    expect(selisihHari("2026-08-24", "2026-08-26")).toBe(2);
    expect(selisihHari("2026-08-24", "2026-08-24")).toBe(0);
  });
});

describe("progresObat — Ampi Sulbactam 4× sehari selama 3 hari", () => {
  it("hari pertama, baru 2 dari 4 kali", () => {
    const pr = progresObat(protokol(), [dosis("2026-08-24", 8), dosis("2026-08-24", 14)], "2026-08-24");
    expect(pr.hariKe).toBe(1);
    expect(pr.diberikanHariIni).toBe(2);
    expect(pr.kurangHariIni).toBe(2);
    expect(pr.tertinggal).toBe(0);          // harinya belum habis
    expect(pr.selesai).toBe(false);
  });

  it("hari kedua, kemarin cuma 3 kali → tertinggal 1", () => {
    const kemarin = [dosis("2026-08-24", 8), dosis("2026-08-24", 14), dosis("2026-08-24", 20)];
    const pr = progresObat(protokol(), [...kemarin, dosis("2026-08-25", 8)], "2026-08-25");
    expect(pr.hariKe).toBe(2);
    expect(pr.totalDiberikan).toBe(4);
    expect(pr.tertinggal).toBe(1);
    expect(pr.kurangHariIni).toBe(3);
  });

  it("pemberian yang dibatalkan tidak dihitung", () => {
    const pr = progresObat(protokol(), [dosis("2026-08-24", 8), dosis("2026-08-24", 14, 1, true)], "2026-08-24");
    expect(pr.totalDiberikan).toBe(1);
  });

  it("lewat masa protokol = selesai, tidak menagih dosis lagi", () => {
    const pr = progresObat(protokol(), [], "2026-08-28");
    expect(pr.selesai).toBe(true);
    expect(pr.hariKe).toBe(3);              // tidak melebihi durasi
    expect(pr.kurangHariIni).toBe(0);
  });

  it("dihentikan dokter lebih awal juga dianggap selesai", () => {
    const pr = progresObat(protokol({ dihentikanAt: "2026-08-25T02:00:00Z" }), [], "2026-08-25");
    expect(pr.selesai).toBe(true);
    expect(pr.kurangHariIni).toBe(0);
  });

  it("belum mulai = hari ke-0", () => {
    const pr = progresObat(protokol({ mulaiTanggal: "2026-08-26" }), [], "2026-08-24");
    expect(pr.hariKe).toBe(0);
    expect(ringkasProgres(pr)).toBe("Belum dimulai");
  });
});

describe("ringkasProgres & peringatanObat", () => {
  it("kalimat ringkas menyebut hari dan jumlah pemberian", () => {
    const pr = progresObat(protokol(), [dosis("2026-08-24", 8)], "2026-08-24");
    expect(ringkasProgres(pr)).toBe("Hari ke-1 dari 3 · 1 dari 12 pemberian");
  });

  it("yang tertinggal disebut duluan, yang selesai tidak diganggu", () => {
    const p1 = protokol();
    const pr1 = progresObat(p1, [dosis("2026-08-24", 8)], "2026-08-25");
    const p2 = protokol({ id: "m2", namaObat: "Vitamin B", dihentikanAt: "2026-08-25T00:00:00Z" });
    const pr2 = progresObat(p2, [], "2026-08-25");

    const pesan = peringatanObat([{ protokol: p1, progres: pr1 }, { protokol: p2, progres: pr2 }]);
    expect(pesan).toHaveLength(1);
    expect(pesan[0]).toMatch(/Ampi Sulbactam tertinggal 3 pemberian/);
  });
});
