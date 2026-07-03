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
