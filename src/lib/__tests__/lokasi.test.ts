import { describe, expect, it } from "vitest";
import { cekLokasiAbsen, jarakMeter, pesanTolakLokasi, validasiKoordinat } from "../lokasi";

// Titik acuan: Kebun Raya Bogor.
const CABANG = { lat: -6.5971, lng: 106.7991 };

describe("jarakMeter", () => {
  it("titik yang sama = 0", () => {
    expect(jarakMeter(CABANG.lat, CABANG.lng, CABANG.lat, CABANG.lng)).toBe(0);
  });

  it("beda 0,001 derajat lintang ≈ 111 m", () => {
    const d = jarakMeter(CABANG.lat, CABANG.lng, CABANG.lat + 0.001, CABANG.lng);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });

  it("Bogor ke Jakarta ≈ 50 km", () => {
    const d = jarakMeter(CABANG.lat, CABANG.lng, -6.2088, 106.8456);
    expect(d).toBeGreaterThan(40_000);
    expect(d).toBeLessThan(60_000);
  });
});

describe("cekLokasiAbsen", () => {
  const cabang = { ...CABANG, radius_m: 500 };

  it("di dalam radius boleh", () => {
    const h = cekLokasiAbsen(cabang, { lat: CABANG.lat + 0.001, lng: CABANG.lng });
    expect(h.boleh).toBe(true);
  });

  it("di luar radius ditolak dengan jarak & batasnya", () => {
    const h = cekLokasiAbsen(cabang, { lat: -6.2088, lng: 106.8456 });
    expect(h.boleh).toBe(false);
    if (!h.boleh) {
      expect(h.radius).toBe(500);
      expect(pesanTolakLokasi(h)).toContain("batasnya 500 m");
    }
  });

  it("cabang tanpa titik = pengecekan mati, absen tetap jalan", () => {
    const h = cekLokasiAbsen({ lat: null, lng: null, radius_m: 500 }, null);
    expect(h.boleh).toBe(true);
  });

  it("cabang bertitik tapi lokasi HP tidak terbaca = ditolak dengan pesan izin", () => {
    const h = cekLokasiAbsen(cabang, null);
    expect(h.boleh).toBe(false);
    if (!h.boleh) expect(pesanTolakLokasi(h)).toContain("Izinkan akses lokasi");
  });
});

describe("validasiKoordinat", () => {
  it("menolak angka di luar jangkauan", () => {
    expect(validasiKoordinat(95, 100)).toBeTruthy();
    expect(validasiKoordinat(-6.5, 200)).toBeTruthy();
    expect(validasiKoordinat(Number.NaN, 106)).toBeTruthy();
  });

  it("menerima koordinat wajar", () => {
    expect(validasiKoordinat(CABANG.lat, CABANG.lng)).toBeNull();
  });
});
