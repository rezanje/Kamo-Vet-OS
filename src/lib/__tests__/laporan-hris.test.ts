import { describe, expect, it } from "vitest";
import {
  keMenit, menitTelat, menitLembur, rekapAbsensi, jamMenit,
  JAM_KERJA_DEFAULT, type BarisAbsensi,
} from "../laporan-hris";

const k = JAM_KERJA_DEFAULT; // masuk 08:00, pulang 17:00, toleransi 10 menit

describe("keMenit", () => {
  it("membaca jam dengan atau tanpa detik", () => {
    expect(keMenit("08:00")).toBe(480);
    expect(keMenit("08:30:00")).toBe(510);
  });

  it("jam kosong bukan berarti tengah malam", () => {
    // Kalau ini mengembalikan 0, karyawan yang belum absen akan terlihat
    // masuk jam 00:00 dan dihitung sangat telat.
    expect(keMenit(null)).toBeNull();
    expect(keMenit("")).toBeNull();
    expect(keMenit("ngawur")).toBeNull();
    expect(keMenit("25:00")).toBeNull();
  });
});

describe("menitTelat", () => {
  it("datang sebelum jam masuk tidak telat", () => {
    expect(menitTelat("07:45", k)).toBe(0);
    expect(menitTelat("08:00", k)).toBe(0);
  });

  it("masih dalam toleransi belum dihitung telat", () => {
    expect(menitTelat("08:10", k)).toBe(0);   // pas di batas toleransi
  });

  it("lewat toleransi dihitung dari jam standar, bukan dari batas toleransi", () => {
    // Datang 08:20 = telat 20 menit dari jam 08:00, bukan 10 menit dari 08:10.
    expect(menitTelat("08:20", k)).toBe(20);
  });

  it("tanpa jam masuk tidak dihitung telat", () => {
    expect(menitTelat(null, k)).toBe(0);
  });

  it("toleransi nol berarti lewat semenit pun telat", () => {
    expect(menitTelat("08:01", { ...k, toleransiMenit: 0 })).toBe(1);
  });
});

describe("menitLembur", () => {
  it("pulang setelah jam standar dihitung lembur", () => {
    expect(menitLembur("18:30", k)).toBe(90);
  });

  it("pulang cepat bukan lembur negatif", () => {
    expect(menitLembur("16:00", k)).toBe(0);
  });

  it("belum absen pulang tidak dihitung lembur", () => {
    expect(menitLembur(null, k)).toBe(0);
  });
});

describe("rekapAbsensi", () => {
  const baris: BarisAbsensi[] = [
    { employee_id: "a", status: "Hadir", jam_masuk: "07:55", jam_pulang: "17:00" },
    { employee_id: "a", status: "Hadir", jam_masuk: "08:25", jam_pulang: "18:00" }, // telat 25, lembur 60
    { employee_id: "a", status: "Sakit", jam_masuk: null,    jam_pulang: null },
    { employee_id: "b", status: "Alpha", jam_masuk: null,    jam_pulang: null },
    { employee_id: "b", status: "Cuti",  jam_masuk: null,    jam_pulang: null },
  ];

  it("menghitung tiap status terpisah", () => {
    const r = rekapAbsensi(baris, k);
    expect(r.get("a")).toMatchObject({ hadir: 2, sakit: 1, izin: 0, alpha: 0, cuti: 0 });
    expect(r.get("b")).toMatchObject({ hadir: 0, alpha: 1, cuti: 1 });
  });

  it("telat dihitung per hari DAN total menitnya", () => {
    const a = rekapAbsensi(baris, k).get("a")!;
    expect(a.telat).toBe(1);
    expect(a.menitTelat).toBe(25);
    expect(a.menitLembur).toBe(60);
  });

  it("hari izin/sakit/cuti tidak ikut jadi telat", () => {
    // Tanpa penjagaan ini, hari sakit (tanpa jam masuk) bisa terbaca telat.
    const r = rekapAbsensi([{ employee_id: "c", status: "Sakit", jam_masuk: null, jam_pulang: null }], k);
    expect(r.get("c")!.telat).toBe(0);
  });

  it("daftar kosong menghasilkan rekap kosong, bukan error", () => {
    expect(rekapAbsensi([], k).size).toBe(0);
  });
});

describe("jamMenit", () => {
  it("menampilkan jam & menit yang kebaca", () => {
    expect(jamMenit(0)).toBe("—");
    expect(jamMenit(45)).toBe("45m");
    expect(jamMenit(85)).toBe("1j 25m");
    expect(jamMenit(120)).toBe("2j 0m");
  });
});
