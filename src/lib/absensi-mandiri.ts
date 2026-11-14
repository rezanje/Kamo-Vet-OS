// C1: absen mandiri lewat fungsi database absen_mandiri() + selfie wajib (migrasi 20261118640000).
// Murni — tombol di /me, server action, dan tesnya memakai aturan yang sama.

export const BUCKET_FOTO_ABSEN = "absensi-foto";
export const MAKS_FOTO_BYTE = 5 * 1024 * 1024;   // sama dengan batas bucket
export const SISI_FOTO_MAKS = 960;               // px, sisi terpanjang setelah dikompres di HP

export type JenisAbsen = "masuk" | "pulang";

// <employee_id>/<YYYY-MM-DD>/<in|out>-<uuid>.jpg — pola yang diperiksa policy bucket & fungsi database.
export function pathFotoAbsen(employeeId: string, tanggal: string, jenis: JenisAbsen, id: string): string {
  return `${employeeId}/${tanggal}/${jenis === "masuk" ? "in" : "out"}-${id}.jpg`;
}

// Ukuran kompres: sisi terpanjang dipangkas ke `maks`, perbandingan dijaga, tidak pernah diperbesar.
export function ukuranKompres(lebar: number, tinggi: number, maks = SISI_FOTO_MAKS): { lebar: number; tinggi: number } {
  if (!(lebar > 0) || !(tinggi > 0)) return { lebar: 0, tinggi: 0 };
  const skala = Math.min(1, maks / Math.max(lebar, tinggi));
  return { lebar: Math.round(lebar * skala), tinggi: Math.round(tinggi * skala) };
}

type GalatDb = { message?: string | null; code?: string | null } | null | undefined;

const PESAN_SEDANG_DIPERBARUI =
  "Absen mandiri sedang diperbarui, coba lagi beberapa menit lagi. Kalau mendesak, minta HR mencatat absenmu.";

// Fungsi/tabel/bucket belum ada = aplikasi sudah rilis tapi migrasi C1 belum terpasang.
export function fiturBelumTerpasang(e: GalatDb): boolean {
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  return ["PGRST202", "PGRST205", "PGRST204", "42883", "42P01", "42703"].includes(code)
    || /could not find the function|does not exist|bucket not found|schema cache/i.test(msg);
}

// Pesan fungsi database berbentuk "KODE: kalimat untuk pengguna." — kalimatnya yang ditampilkan.
export function pesanAbsen(e: GalatDb): string {
  if (fiturBelumTerpasang(e)) return PESAN_SEDANG_DIPERBARUI;
  const msg = String(e?.message ?? "");
  const m = /\b(?:ABSEN|KOREKSI)_[A-Z_]+:\s*([^\n]+)/.exec(msg);
  if (m) {
    const kalimat = m[1].trim();
    return kalimat.charAt(0).toUpperCase() + kalimat.slice(1);
  }
  return "Absen gagal tersimpan, coba lagi. Kalau terus gagal, ajukan koreksi absen.";
}

export function pesanUnggahFoto(e: GalatDb): string {
  if (fiturBelumTerpasang(e)) return PESAN_SEDANG_DIPERBARUI;
  const msg = String(e?.message ?? "");
  if (/size|too large|exceeded/i.test(msg)) return "Foto terlalu besar. Ambil ulang fotonya.";
  if (/mime|type/i.test(msg)) return "Format foto tidak didukung. Ambil ulang fotonya.";
  return "Foto selfie gagal terunggah. Cek sinyal lalu coba lagi.";
}

export type HasilAbsen = {
  jenis: JenisAbsen; tanggal: string; jam: string; shift: string | null;
  telat_menit: number | null; pulang_cepat_menit: number | null; tanpa_jadwal: boolean;
  cabang: string | null; jarak_m: number | null;
};

export function pesanSuksesAbsen(h: HasilAbsen): string {
  const bagian = [`Absen ${h.jenis} jam ${h.jam} tercatat${h.cabang ? ` di ${h.cabang}` : ""}.`];
  if (h.tanpa_jadwal) bagian.push("Hari ini kamu tidak punya jadwal masuk — absen tetap tercatat dan akan dicek HR.");
  if (h.jenis === "masuk" && (h.telat_menit ?? 0) > 0) bagian.push(`Telat ${h.telat_menit} menit dari jam shift ${h.shift ?? ""}.`.replace(" .", "."));
  if (h.jenis === "pulang" && (h.pulang_cepat_menit ?? 0) > 0) bagian.push(`Pulang ${h.pulang_cepat_menit} menit lebih awal dari jam shift.`);
  return bagian.join(" ");
}

// ── Status tombol di /me ──────────────────────────────────────────────────────
export type BarisAbsenSaya = {
  tanggal: string; jam_masuk: string | null; jam_pulang: string | null; waktu_masuk?: string | null;
};

const BATAS_TERBUKA_MS = 20 * 3600_000;   // sama dengan absen_mandiri(): absen pulang ≤ 20 jam setelah masuk

function waktuMasukMs(b: BarisAbsenSaya): number {
  if (b.waktu_masuk) return new Date(b.waktu_masuk).getTime();
  if (!b.jam_masuk) return NaN;
  return new Date(`${b.tanggal}T${b.jam_masuk.slice(0, 5)}:00+07:00`).getTime();
}

// Tombol yang ditampilkan. Fungsi database tetap yang memutuskan — ini hanya supaya staf tidak
// ditawari tombol yang pasti ditolak (mis. absen masuk saat shift malam kemarin belum ditutup).
export function tombolAbsen(baris: BarisAbsenSaya[], hariIni: string, sekarangMs: number):
  { aksi: JenisAbsen | null; terbuka: BarisAbsenSaya | null; hariIni: BarisAbsenSaya | null } {
  const barisHariIni = baris.find((b) => b.tanggal === hariIni) ?? null;
  const terbuka = baris
    .filter((b) => b.jam_masuk && !b.jam_pulang && sekarangMs - waktuMasukMs(b) <= BATAS_TERBUKA_MS)
    .sort((a, b) => waktuMasukMs(b) - waktuMasukMs(a))[0] ?? null;
  if (terbuka) return { aksi: "pulang", terbuka, hariIni: barisHariIni };
  if (barisHariIni?.jam_masuk) return { aksi: null, terbuka: null, hariIni: barisHariIni };
  return { aksi: "masuk", terbuka: null, hariIni: barisHariIni };
}

// ── Koreksi absen ─────────────────────────────────────────────────────────────
export const KATEGORI_KOREKSI: Record<string, string> = {
  lupa_absen: "Lupa absen",
  foto_gagal: "Foto/kamera gagal",
  lokasi_gagal: "Lokasi tidak terbaca",
  lainnya: "Lainnya",
};
