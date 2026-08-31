// Booking online — aturan isian formulir publik. Murni, dites di
// __tests__/booking.test.ts. Dipakai server action; layar cuma mempercantik.
//
// Semua pemeriksaan di sini diulang lagi oleh RLS & trigger di database (migrasi
// 0105): formulirnya terbuka tanpa login, jadi lapisan layar tidak boleh jadi
// satu-satunya pagar.

export const JENIS_HEWAN = ["Anjing", "Kucing", "Kelinci", "Burung", "Lainnya"] as const;
export const POLI_BOOKING = ["Poli Umum", "Poli Gigi", "Poli Kulit", "Vaksinasi", "Grooming"] as const;

/** Jam operasional yang boleh dipesan — di luar ini klinik tutup. */
export const JAM_BUKA = [
  "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00",
] as const;

export const MAKS_HARI_KE_DEPAN = 60;

export type BookingDraft = {
  branchId: string;
  poli: string;
  tanggal: string;   // YYYY-MM-DD
  jam: string;
  namaPemilik: string;
  phone: string;
  namaHewan: string;
  jenisHewan: string;
  keluhan: string;
};

/** Nomor HP Indonesia, disimpan seragam 08xxx supaya cocok dgn data pelanggan. */
export function normalPhone(raw: string): string {
  const angka = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (angka.startsWith("62")) return "0" + angka.slice(2);
  return angka;
}

export function composeBookingScheduledAt(tanggal: string, jam: string): string {
  return `${tanggal}T${jam}:00+07:00`;
}

export function validasiBooking(d: BookingDraft, hariIni: string): string | null {
  if (!d.branchId) return "Pilih klinik tujuan";
  if (!(POLI_BOOKING as readonly string[]).includes(d.poli)) return "Layanan tidak dikenal";
  if (!(JAM_BUKA as readonly string[]).includes(d.jam)) return "Pilih jam kedatangan";
  if (d.namaPemilik.trim().length < 2) return "Nama pemilik wajib diisi";

  const phone = normalPhone(d.phone);
  if (!/^0\d{8,14}$/.test(phone)) return "Nomor HP tidak valid — contoh 081234567890";
  if (d.namaHewan.trim().length < 1) return "Nama hewan wajib diisi";
  if (!(JENIS_HEWAN as readonly string[]).includes(d.jenisHewan)) return "Jenis hewan tidak dikenal";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tanggal)) return "Tanggal tidak valid";
  if (d.tanggal < hariIni) return "Tanggal sudah lewat";
  const batas = new Date(`${hariIni}T00:00:00Z`);
  batas.setUTCDate(batas.getUTCDate() + MAKS_HARI_KE_DEPAN);
  if (d.tanggal > batas.toISOString().slice(0, 10)) {
    return `Booking paling jauh ${MAKS_HARI_KE_DEPAN} hari ke depan`;
  }
  if (d.keluhan.length > 500) return "Keluhan terlalu panjang";
  return null;
}

export const LABEL_STATUS_BOOKING: Record<string, string> = {
  baru: "Menunggu konfirmasi",
  dikonfirmasi: "Dikonfirmasi",
  ditolak: "Ditolak",
  batal: "Dibatalkan",
};

export const BADGE_STATUS_BOOKING: Record<string, string> = {
  baru: "b", dikonfirmasi: "g", ditolak: "r", batal: "x",
};
