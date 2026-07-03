// Alur permintaan & penerimaan barang (Addendum §5) — pure.

export const REQUEST_FLOW = ["Menunggu Persetujuan", "Disetujui", "Dikirim", "Selesai"] as const;

// Flow linear: Menunggu → Disetujui → Dikirim → Selesai; Ditolak hanya dari Menunggu (terminal).
export function canTransitionRequest(from: string, to: string): boolean {
  if (to === "Ditolak") return from === "Menunggu Persetujuan";
  const i = REQUEST_FLOW.indexOf(from as (typeof REQUEST_FLOW)[number]);
  const j = REQUEST_FLOW.indexOf(to as (typeof REQUEST_FLOW)[number]);
  return i >= 0 && j === i + 1;
}

// Approval hanya Kepala Gudang / Manajer (role OWNER/ADMIN di skema existing).
export function canApprove(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const r2 = (n: number) => Math.round(n * 100) / 100; // qty bisa pecahan — hindari artefak float di UI

export function receiptSummary(items: { qty_ordered: number; qty_received: number }[]) {
  const ordered = r2(items.reduce((a, i) => a + Number(i.qty_ordered), 0));
  const received = r2(items.reduce((a, i) => a + Number(i.qty_received), 0));
  return { ordered, received, selisih: r2(received - ordered) };
}
