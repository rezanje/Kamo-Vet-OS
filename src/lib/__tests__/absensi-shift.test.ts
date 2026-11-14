// C1: telat / pulang cepat / lembur dari shift (termasuk shift malam) + rekap laporan berbasis jadwal.
import { describe, expect, it } from "vitest";
import { menitLemburShift, menitPulangCepat, menitTelatShift, shiftSudahSelesai } from "../absensi-shift";
import { menitTelat as menitTelatGaji } from "../payroll-aturan";
import { rekapAbsensiJadwal, type AbsenLaporan, type JadwalLaporan } from "../laporan-hris";

describe("menitTelatShift", () => {
  it("dihitung dari jam masuk shift orang itu", () => {
    expect(menitTelatShift("08:00", "08:20")).toBe(20);
    expect(menitTelatShift("13:00:00", "12:55:00")).toBe(0);
  });
  it("shift malam: masuk lewat tengah malam tetap telat, bukan 'lebih awal'", () => {
    expect(menitTelatShift("22:00", "00:30")).toBe(150);
    expect(menitTelatShift("22:00", "21:50")).toBe(0);
  });
  it("shift mulai tengah malam: masuk 23:50 malam sebelumnya = tidak telat", () => {
    expect(menitTelatShift("00:30", "23:50")).toBe(0);
  });
  it("data kosong/rusak = 0", () => {
    expect(menitTelatShift(null, "08:00")).toBe(0);
    expect(menitTelatShift("08:00", "ngawur")).toBe(0);
  });
  it("penggajian memakai aturan yang sama dengan laporan", () => {
    expect(menitTelatGaji("22:00", "00:30")).toBe(150);
    expect(menitTelatGaji("08:00", "11:00")).toBe(180);
  });
});

describe("pulang cepat & lembur", () => {
  it("shift siang", () => {
    expect(menitPulangCepat("08:00", "17:00", "16:30")).toBe(30);
    expect(menitPulangCepat("08:00", "17:00", "17:10")).toBe(0);
    expect(menitLemburShift("08:00", "17:00", "18:30")).toBe(90);
    expect(menitLemburShift("08:00", "17:00", "01:00")).toBe(480);   // lembur lewat tengah malam
  });
  it("shift malam 22:00–06:00", () => {
    expect(menitPulangCepat("22:00", "06:00", "05:00")).toBe(60);
    expect(menitPulangCepat("22:00", "06:00", "06:10")).toBe(0);
    expect(menitPulangCepat("22:00", "06:00", "23:00")).toBe(420);   // pulang sebelum tengah malam
    expect(menitLemburShift("22:00", "06:00", "07:00")).toBe(60);
  });
});

describe("shiftSudahSelesai (penentu Alpha hari ini)", () => {
  it("hari lalu selesai; hari ini setelah jam pulang; shift malam kemarin setelah jam pulang pagi ini", () => {
    expect(shiftSudahSelesai("2026-11-18", "08:00", "17:00", "2026-11-20", 0)).toBe(true);
    expect(shiftSudahSelesai("2026-11-20", "08:00", "17:00", "2026-11-20", 16 * 60)).toBe(false);
    expect(shiftSudahSelesai("2026-11-20", "08:00", "17:00", "2026-11-20", 17 * 60)).toBe(true);
    expect(shiftSudahSelesai("2026-11-20", "22:00", "06:00", "2026-11-20", 23 * 60)).toBe(false);
    expect(shiftSudahSelesai("2026-11-19", "22:00", "06:00", "2026-11-20", 5 * 60)).toBe(false);
    expect(shiftSudahSelesai("2026-11-19", "22:00", "06:00", "2026-11-20", 6 * 60)).toBe(true);
    expect(shiftSudahSelesai("2026-11-21", "08:00", "17:00", "2026-11-20", 0)).toBe(false);
  });
});

describe("rekapAbsensiJadwal", () => {
  const pagi = (employee_id: string, tanggal: string): JadwalLaporan => ({ employee_id, tanggal, is_libur: false, jam_masuk: "08:00", jam_pulang: "17:00" });
  const absen = (employee_id: string, tanggal: string, jam_masuk: string | null, jam_pulang: string | null, status = "Hadir"): AbsenLaporan =>
    ({ employee_id, tanggal, status, jam_masuk, jam_pulang });
  const dasar = { awal: "2026-11-01", akhir: "2026-11-30", hariIni: "2026-11-20", menitSekarang: 12 * 60, toleransiMenit: 10 };

  it("hari terjadwal tanpa absen & tanpa cuti = Alpha; cuti disetujui bukan Alpha; libur & tanggal depan tidak dihitung", () => {
    const r = rekapAbsensiJadwal({
      ...dasar,
      jadwal: [pagi("a", "2026-11-02"), pagi("a", "2026-11-03"), pagi("a", "2026-11-04"), pagi("a", "2026-11-05"),
        { employee_id: "a", tanggal: "2026-11-06", is_libur: true, jam_masuk: null, jam_pulang: null },
        pagi("a", "2026-11-20"), pagi("a", "2026-11-25")],
      absen: [absen("a", "2026-11-02", "08:00", "17:00")],
      cuti: [{ employee_id: "a", jenis: "Sakit", tanggal_mulai: "2026-11-03", tanggal_selesai: null },
        { employee_id: "a", jenis: "Cuti", tanggal_mulai: "2026-11-04", tanggal_selesai: "2026-11-04" },
        { employee_id: "a", jenis: "Lembur", tanggal_mulai: "2026-11-05", tanggal_selesai: null }],
    }).get("a")!;
    expect(r).toMatchObject({ hadir: 1, sakit: 1, cuti: 1, alpha: 1, hariTerjadwal: 6 });
  });

  it("telat dari shift (toleransi), pulang cepat, lembur, dan hadir tanpa jadwal", () => {
    const r = rekapAbsensiJadwal({
      ...dasar,
      jadwal: [pagi("b", "2026-11-02"), pagi("b", "2026-11-03"),
        { employee_id: "b", tanggal: "2026-11-04", is_libur: false, jam_masuk: "22:00", jam_pulang: "06:00" }],
      absen: [absen("b", "2026-11-02", "08:25", "16:30"), absen("b", "2026-11-03", "08:10", "18:00"),
        absen("b", "2026-11-04", "00:30", "06:00"), absen("b", "2026-11-07", "09:00", "17:00")],
      cuti: [],
    }).get("b")!;
    expect(r).toMatchObject({ hadir: 4, telat: 2, menitTelat: 25 + 150, pulangCepat: 1, menitPulangCepat: 30, menitLembur: 60, tanpaJadwal: 1, alpha: 0 });
  });

  it("baris Alpha/Izin dari HR tidak dihitung dua kali", () => {
    const r = rekapAbsensiJadwal({
      ...dasar, jadwal: [pagi("c", "2026-11-02"), pagi("c", "2026-11-03")],
      absen: [absen("c", "2026-11-02", null, null, "Alpha"), absen("c", "2026-11-03", null, null, "Izin")], cuti: [],
    }).get("c")!;
    expect(r).toMatchObject({ alpha: 1, izin: 1, hadir: 0 });
  });
});
