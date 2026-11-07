export const FOLLOWUP_JENIS = ["Kontrol", "Vaksin", "Grooming", "Obat habis", "Lainnya"] as const;
export type FollowUpJenis = (typeof FOLLOWUP_JENIS)[number];

export type FollowUpDraft = { jenis: string; tanggal: string; catatan: string };

/** Satu baris follow up dari form → baris sah, atau null bila tanggalnya bukan YYYY-MM-DD. */
export function bersihkanFollowUp(row: unknown): FollowUpDraft | null {
  const r = (row ?? {}) as Partial<Record<keyof FollowUpDraft, unknown>>;
  const tanggal = String(r.tanggal ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(`${tanggal}T00:00:00Z`))) return null;
  const jenis = FOLLOWUP_JENIS.includes(r.jenis as FollowUpJenis) ? String(r.jenis) : "Lainnya";
  return { jenis, tanggal, catatan: String(r.catatan ?? "").trim().slice(0, 1000) };
}

/**
 * Baris yang dikirim form pemeriksaan: baris yang sudah di-"Tambah" ditambah isian yang
 * tanggalnya sudah dipilih tapi tombol Tambah belum diklik. Dulu isian itu hilang diam-diam
 * saat Simpan, sehingga dokter mengira follow up sudah dibuat padahal tidak masuk daftar.
 */
export function barisFollowUpTerkirim(rows: FollowUpDraft[], isian: FollowUpDraft): FollowUpDraft[] {
  return isian.tanggal ? [...rows, { ...isian, catatan: isian.catatan.trim() }] : rows;
}

/**
 * Berapa hari SEBELUM tanggal follow up pelanggan diingatkan. Klinik Ciomas mengirim
 * WhatsApp 3 hari sebelumnya (Babibu, 5 Nov) — dulu daftar "Jatuh tempo" baru memuat
 * jadwal di hari-H, jadi staf harus memeriksa tab Mendatang secara manual tiap hari.
 */
export const HARI_INGAT_DEFAULT = 3;
export const PILIHAN_HARI_INGAT = [0, 1, 2, 3, 5, 7] as const;

export function bacaHariIngat(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw !== "" && (PILIHAN_HARI_INGAT as readonly number[]).includes(n) ? n : HARI_INGAT_DEFAULT;
}

/** Tanggal terakhir yang sudah masuk daftar "Perlu diingatkan" (hari ini + H). */
export function batasPerluDiingatkan(hariIni: string, hariIngat: number): string {
  return tanggalSetelah(hariIni, { hari: hariIngat });
}

/** Keterangan singkat posisi follow up terhadap hari ini: terlewat / hari ini / H-n. */
export function posisiFollowUp(tanggal: string, hariIni: string): { teks: string; telat: boolean } {
  const selisih = Math.round((Date.parse(`${tanggal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${hariIni}T00:00:00Z`)) / 86_400_000);
  if (selisih < 0) return { teks: `terlewat ${-selisih} hari`, telat: true };
  if (selisih === 0) return { teks: "hari ini", telat: false };
  return { teks: `H-${selisih}`, telat: false };
}

/** Tombol cepat tanggal follow up (vaksin ulang, kontrol). */
export const PINTASAN_FOLLOWUP = [
  { label: "+1 minggu", hari: 7 },
  { label: "+2 minggu", hari: 14 },
  { label: "+1 bulan", bulan: 1 },
  { label: "+3 bulan", bulan: 3 },
  { label: "+1 tahun", bulan: 12 },
] as const satisfies readonly { label: string; hari?: number; bulan?: number }[];

/** Tanggal (YYYY-MM-DD) sekian hari / bulan setelah `dari`; 31 Jan + 1 bulan = 28/29 Feb. */
export function tanggalSetelah(dari: string, geser: { hari?: number; bulan?: number }): string {
  const [y, m, d] = dari.slice(0, 10).split("-").map(Number);
  const bulanTujuan = m - 1 + (geser.bulan ?? 0);
  const hariTerakhir = new Date(Date.UTC(y, bulanTujuan + 1, 0)).getUTCDate();
  const hasil = new Date(Date.UTC(y, bulanTujuan, Math.min(d, hariTerakhir) + (geser.hari ?? 0)));
  return hasil.toISOString().slice(0, 10);
}

// Kalimat pembuka per jenis — biar staff gak nyusun pesan dari nol tiap kali.
const PEMBUKA: Record<string, string> = {
  Kontrol: "waktunya kontrol ulang",
  Vaksin: "sudah masuk jadwal vaksin",
  Grooming: "sudah waktunya grooming",
  "Obat habis": "obatnya diperkirakan sudah habis",
  Lainnya: "ada jadwal follow up",
};

// Nama pelanggan sering disimpan lengkap dengan sapaannya ("Pak Dimas", "Bu Rina"). Dulu pesan
// selalu diawali "Kak", jadi keluar "Halo Kak Pak Dimas". Sapaan bawaan pelanggan dipakai apa adanya;
// "Kak" hanya ditambahkan bila nama belum bersapaan, dan nama kosong cukup "Kak".
const SAPAAN = /^(kak|kakak|pak|bapak|bpk|bu|ibu|bunda|mas|mbak|mba|om|tante|drh|dr|ny|nyonya|tn|tuan|koh|cik|sdr|sdri)\.?(\s|$)/i;

export function sapaanPemilik(nama: string | null | undefined): string {
  const bersih = (nama ?? "").trim().replace(/\s+/g, " ");
  if (!bersih) return "Kak";
  return SAPAAN.test(bersih) ? bersih : `Kak ${bersih}`;
}

export function pesanReminder(p: {
  pemilik: string; hewan: string; jenis: string; tanggal: string; catatan?: string | null; klinik?: string | null;
}) {
  const tgl = tanggalIndo(p.tanggal);
  const baris = [
    `Halo ${sapaanPemilik(p.pemilik)}, ${p.hewan} ${PEMBUKA[p.jenis] ?? PEMBUKA.Lainnya} pada ${tgl}.`,
    p.catatan?.trim() ? `Catatan dokter: ${p.catatan.trim()}` : null,
    "Boleh dibalas pesan ini untuk atur jadwalnya ya. Terima kasih!",
    p.klinik?.trim() ? `— ${p.klinik.trim()}` : null,
  ].filter(Boolean);
  return baris.join("\n\n");
}

// 08xx / +62xx / 62xx → format wa.me (62 tanpa plus).
export function waLink(phone: string, pesan: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits.startsWith("62") ? digits : `62${digits}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(pesan)}`;
}

export function tanggalIndo(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${d} ${bulan[m - 1]} ${y}`;
}

// hariIniWIB pindah ke lib/tanggal (rumah semua helper tanggal) — dulu tinggal di sini
// dan bikin dua sumber kebenaran untuk "hari ini".
