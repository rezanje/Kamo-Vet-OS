export const FOLLOWUP_JENIS = ["Kontrol", "Vaksin", "Grooming", "Obat habis", "Lainnya"] as const;
export type FollowUpJenis = (typeof FOLLOWUP_JENIS)[number];

// Kalimat pembuka per jenis — biar staff gak nyusun pesan dari nol tiap kali.
const PEMBUKA: Record<string, string> = {
  Kontrol: "waktunya kontrol ulang",
  Vaksin: "sudah masuk jadwal vaksin",
  Grooming: "sudah waktunya grooming",
  "Obat habis": "obatnya diperkirakan sudah habis",
  Lainnya: "ada jadwal follow up",
};

export function pesanReminder(p: {
  pemilik: string; hewan: string; jenis: string; tanggal: string; catatan?: string | null; klinik?: string | null;
}) {
  const tgl = tanggalIndo(p.tanggal);
  const baris = [
    `Halo Kak ${p.pemilik}, ${p.hewan} ${PEMBUKA[p.jenis] ?? PEMBUKA.Lainnya} pada ${tgl}.`,
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

// Hari ini di zona WIB — server Vercel jalan di UTC, jadi jangan pakai toISOString() lokal.
export function hariIniWIB() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
