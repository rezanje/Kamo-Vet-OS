// Aturan rawat inap (Addendum §3) — pure, dipakai server action + UI.

export type Condition = "stabil" | "kritis" | "sembuh" | "rip";
export type Role = "OWNER" | "ADMIN" | "FINANCE" | "STAFF" | "DOCTOR";

export const CONDITION_LABEL: Record<Condition, string> = {
  stabil: "Stabil",
  kritis: "Kritis",
  sembuh: "Sembuh / Boleh Pulang",
  rip: "RIP (Meninggal)",
};

// §3: transisi ke 'rip' hanya boleh dokter — validasi role di server action, bukan cuma UI.
// Default assumption spec: single doctor approval + layar review WA sebelum kirim (bukan auto-send).
export function canTransition(role: Role, to: Condition): boolean {
  if (to === "rip") return role === "DOCTOR";
  return true;
}

export function isTerminal(c: Condition): boolean {
  return c === "sembuh" || c === "rip";
}

// Template WA khusus RIP (bukan template monitoring rutin) — dikirim via Fonnte setelah review dokter.
export function ripWaMessage(petName: string, ownerName: string, branchName: string): string {
  return (
    `Kepada Yth. ${ownerName},\n\n` +
    `Dengan berat hati kami menyampaikan bahwa ${petName} telah berpulang saat perawatan di ${branchName}. ` +
    `Tim dokter kami telah memberikan perawatan terbaik hingga akhir.\n\n` +
    `Kami turut berduka cita yang sedalam-dalamnya. Silakan hubungi klinik untuk informasi selanjutnya.\n\n` +
    `— KAMO PET CARE`
  );
}

/**
 * Jumlah hari rawat inap yang ditagihkan: pembulatan KE ATAS per 24 jam
 * (keputusan Aldi, 19 Agustus — "15 jam berarti 1 hari, 30 jam berarti 2 hari").
 *
 * Dihitung dari jam masuk ke jam pulang, bukan dari selisih tanggal: masuk Senin
 * 23.00 dan pulang Selasa 07.00 itu 8 jam — satu hari, bukan dua.
 */
export function hariRawatInap(masuk: string | Date, keluar: string | Date): number {
  const a = new Date(masuk).getTime();
  const b = new Date(keluar).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  const jam = (b - a) / 36e5;
  if (jam <= 0) return 1;                    // salah input tanggal tetap ditagih 1 hari
  return Math.max(1, Math.ceil(jam / 24));
}
