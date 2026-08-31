import { describe, expect, it } from "vitest";
import {
  bolehNoShow,
  calculateOccupancy,
  countReferrals,
  followUpCompliance,
  serviceDurations,
  validateServiceTimeline,
} from "../operasional-klinik";

describe("bolehNoShow", () => {
  it("hanya mengizinkan booking terkonfirmasi, lewat jadwal, tanpa visit", () => {
    const now = new Date("2026-08-31T10:00:00+07:00");
    expect(bolehNoShow({ status: "dikonfirmasi", outcome: "pending", scheduledAt: "2026-08-31T09:00:00+07:00", visitId: null }, now)).toBe(true);
    expect(bolehNoShow({ status: "baru", outcome: "pending", scheduledAt: "2026-08-31T09:00:00+07:00", visitId: null }, now)).toBe(false);
    expect(bolehNoShow({ status: "dikonfirmasi", outcome: "pending", scheduledAt: "2026-08-31T11:00:00+07:00", visitId: null }, now)).toBe(false);
  });
});

describe("service timeline", () => {
  it("menolak urutan waktu layanan yang mundur", () => {
    expect(validateServiceTimeline({
      checkedInAt: "2026-08-31T09:00:00Z",
      serviceStartedAt: "2026-08-31T08:59:00Z",
      serviceFinishedAt: null,
      checkedOutAt: null,
    })).toMatch(/mulai layanan/);
  });

  it("menghitung menit tunggu dan layanan tanpa mengubah null menjadi nol", () => {
    expect(serviceDurations({ checkedInAt: "2026-08-31T01:00:00Z", serviceStartedAt: "2026-08-31T01:15:00Z", serviceFinishedAt: "2026-08-31T02:00:00Z", checkedOutAt: null }))
      .toEqual({ waitMinutes: 15, serviceMinutes: 45 });
    expect(serviceDurations({ checkedInAt: "2026-08-31T01:00:00Z", serviceStartedAt: null, serviceFinishedAt: null, checkedOutAt: null }))
      .toEqual({ waitMinutes: null, serviceMinutes: null });
  });
});

describe("clinic metrics", () => {
  it("menghitung follow-up selesai tepat waktu dan mengecualikan batal", () => {
    expect(followUpCompliance([
      { status: "Selesai", dueDate: "2026-08-31", completedAt: "2026-08-31T10:00:00+07:00" },
      { status: "Selesai", dueDate: "2026-08-30", completedAt: "2026-08-31T10:00:00+07:00" },
      { status: "Batal", dueDate: "2026-08-29", completedAt: null },
    ], new Date("2026-08-31T23:00:00+07:00"))).toEqual({ due: 2, completed: 1, rate: 0.5 });
  });

  it("mengembalikan missing saat kapasitas belum tersedia", () => {
    expect(calculateOccupancy({
      from: "2026-08-31", to: "2026-09-01",
      admissions: [{ admittedAt: "2026-08-31T09:00:00+07:00", dischargedAt: null }],
      capacities: [],
    })).toEqual({ status: "missing" });
  });

  it("menghitung okupansi per hari dan referral masuk keluar terpisah", () => {
    expect(calculateOccupancy({
      from: "2026-08-31", to: "2026-08-31",
      admissions: [{ admittedAt: "2026-08-31T09:00:00+07:00", dischargedAt: null }],
      capacities: [{ capacity: 2, validFrom: "2026-08-31", validUntil: null }],
    })).toEqual({ status: "ok", occupiedBedDays: 1, availableBedDays: 2, rate: 0.5 });
    expect(countReferrals([{ direction: "masuk" }, { direction: "keluar" }, { direction: "masuk" }]))
      .toEqual({ masuk: 2, keluar: 1, total: 3 });
  });
});
