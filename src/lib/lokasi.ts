// Jarak titik ke titik untuk absen berlokasi (migrasi 0087).
// Murni, dites di __tests__/lokasi.test.ts.

const R_BUMI_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

// Haversine — cukup akurat untuk jarak ratusan meter dan tidak butuh library.
export function jarakMeter(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R_BUMI_M * Math.asin(Math.min(1, Math.sqrt(a))));
}

export function validasiKoordinat(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Koordinat tidak valid";
  if (lat < -90 || lat > 90) return "Lintang (latitude) harus antara -90 dan 90";
  if (lng < -180 || lng > 180) return "Bujur (longitude) harus antara -180 dan 180";
  return null;
}

export type TitikCabang = { lat: number | null; lng: number | null; radius_m: number };

export type HasilCek =
  | { boleh: true; alasan: "tanpa-titik" | "di-dalam"; jarak: number | null }
  | { boleh: false; jarak: number; radius: number };

// Cabang tanpa titik = pengecekan mati. Fitur baru tidak boleh melumpuhkan
// absensi harian hanya karena koordinatnya belum sempat diisi.
export function cekLokasiAbsen(
  cabang: TitikCabang,
  posisi: { lat: number; lng: number } | null,
): HasilCek {
  if (cabang.lat === null || cabang.lng === null) return { boleh: true, alasan: "tanpa-titik", jarak: null };
  if (!posisi) return { boleh: false, jarak: -1, radius: cabang.radius_m };

  const jarak = jarakMeter(cabang.lat, cabang.lng, posisi.lat, posisi.lng);
  return jarak <= cabang.radius_m
    ? { boleh: true, alasan: "di-dalam", jarak }
    : { boleh: false, jarak, radius: cabang.radius_m };
}

export function pesanTolakLokasi(h: Extract<HasilCek, { boleh: false }>): string {
  if (h.jarak < 0) return "Lokasi HP tidak terbaca. Izinkan akses lokasi di browser, lalu coba lagi.";
  return `Kamu ${h.jarak} m dari cabang, batasnya ${h.radius} m. Absen hanya bisa dari lokasi cabang.`;
}
