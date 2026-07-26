// Penjualan Online / B2C — logika murni, dites di __tests__/online.test.ts
// (spec: docs/superpowers/specs/2026-07-23-penjualan-online-design.md)

export const CHANNELS = ["Shopee", "Tokopedia", "TikTok Shop", "WA"] as const;
export type Channel = (typeof CHANNELS)[number];

// Marketplace = dana ditahan platform lalu cair belakangan (lahir sebagai piutang).
// WA = transfer langsung ke bank, lunas seketika.
const MARKETPLACE: readonly string[] = ["Shopee", "Tokopedia", "TikTok Shop"];

export function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v);
}

export function isMarketplace(channel: string): boolean {
  return MARKETPLACE.includes(channel);
}

// Nomor dokumen ONL-YYYYMMDD-NNNN, seq per hari (ponytail: count+1, sama seperti no_struk POS).
export function prefixNoOnline(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `ONL-${y}${m}${d}`;
}

export function formatNoOnline(date: Date, seq: number): string {
  return `${prefixNoOnline(date)}-${String(seq).padStart(4, "0")}`;
}

export function totalOnline(rows: { qty: number; harga: number }[]): number {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
}

// Komisi marketplace tidak ditebak di depan — dihitung dari selisih order vs dana yang benar-benar cair.
export function hitungKomisi(total: number, nominalCair: number): number {
  return Math.max(0, Math.round(total) - Math.round(nominalCair));
}
