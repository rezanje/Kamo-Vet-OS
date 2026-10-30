import { describe, expect, it } from "vitest";
import {
  bolehMenerobosDp, DP_MINIMAL_BAWAAN, getDpMinimalPercent,
  kurangUangMuka, pesanDpMinimal, uangMukaMinimal,
} from "../dp-minimal";

// Uang muka minimal tagihan klinik (Andri, 29 Oktober 2026). Database yang menolak;
// angka di sini harus sama persis dengan clinic_private.enforce_min_dp.
describe("uang muka minimal", () => {
  it("membulatkan KE ATAS seperti ceil() di database", () => {
    // 50% dari 100.001 = 50.000,5. Kalau layar membulatkan ke bawah, kasir menerima
    // satu rupiah kurang dan penyimpanannya ditolak tanpa sebab yang terlihat.
    expect(uangMukaMinimal(100_001, 50)).toBe(50_001);
    expect(uangMukaMinimal(100_000, 50)).toBe(50_000);
    expect(uangMukaMinimal(333_333, 30)).toBe(100_000);
  });

  it("persen nol atau total nol mematikan aturannya", () => {
    expect(uangMukaMinimal(500_000, 0)).toBe(0);
    expect(uangMukaMinimal(0, 50)).toBe(0);
    expect(kurangUangMuka(500_000, 0, 0)).toBe(0);
  });

  it("menghitung kekurangan, dan nol begitu minimumnya tercapai", () => {
    expect(kurangUangMuka(1_000_000, 0, 50)).toBe(500_000);
    expect(kurangUangMuka(1_000_000, 200_000, 50)).toBe(300_000);
    expect(kurangUangMuka(1_000_000, 500_000, 50)).toBe(0);
    expect(kurangUangMuka(1_000_000, 900_000, 50)).toBe(0);
  });

  it("tagihan yang sudah lunas tidak pernah kurang uang muka", () => {
    expect(kurangUangMuka(1_000_000, 1_000_000, 80)).toBe(0);
    expect(kurangUangMuka(1_000_000, 1_200_000, 80)).toBe(0);
    expect(pesanDpMinimal(1_000_000, 1_000_000, 80)).toBeNull();
  });

  it("pesannya menyebut minimal dan kekurangannya dalam rupiah", () => {
    expect(pesanDpMinimal(1_000_000, 200_000, 50))
      .toBe("Uang muka minimal 50% = Rp 500.000. Kurang Rp 300.000.");
  });

  it.each([["OWNER", true], ["ADMIN", true], ["FINANCE", true], ["DOCTOR", false], ["STAFF", false], [null, false]] as const)
    ("peran %s boleh menerobos: %s", (role, boleh) => {
      expect(bolehMenerobosDp(role)).toBe(boleh);
    });
});

describe("pembacaan setelan", () => {
  const klien = (hasil: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => hasil }) }) }),
  });

  it("memakai nilai tersimpan", async () => {
    expect(await getDpMinimalPercent(klien({ data: { min_dp_percent: "30" } }))).toBe(30);
  });

  it("baris belum ada, nilai aneh, atau gagal dibaca jatuh ke bawaan 50%", async () => {
    expect(await getDpMinimalPercent(klien({ data: null }))).toBe(DP_MINIMAL_BAWAAN);
    expect(await getDpMinimalPercent(klien({ data: { min_dp_percent: "-5" } }))).toBe(DP_MINIMAL_BAWAAN);
    expect(await getDpMinimalPercent(klien({ data: { min_dp_percent: "abc" } }))).toBe(DP_MINIMAL_BAWAAN);
    expect(await getDpMinimalPercent({ from: () => { throw new Error("mati"); } })).toBe(DP_MINIMAL_BAWAAN);
  });
});
