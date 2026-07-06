// Promo per cabang + masa berlaku (pure). promoActiveFor = satu-satunya sumber
// kebenaran "aktif hari ini untuk cabang X" — jangan diduplikasi inline.
export type PromoRule = {
  trigger_item_ids?: string[];
  min_qty?: number;
  min_subtotal?: number;
  suggest?: string;
  discount_type?: string;
  discount_value?: number;
};

export type PromoRow = {
  id: string;
  name: string;
  promo_type: string;
  rule: PromoRule;
  is_active: boolean;
  branch_ids: string[] | null; // null / kosong = semua cabang
  valid_from: string | null;   // 'YYYY-MM-DD', null = tanpa batas awal
  valid_until: string | null;  // 'YYYY-MM-DD', null = tanpa batas akhir
};

export function promoActiveFor(p: PromoRow, branchId: string, today: string): boolean {
  if (!p.is_active) return false;
  if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
  if (p.valid_from && today < p.valid_from) return false;
  if (p.valid_until && today > p.valid_until) return false;
  return true;
}

export function promoScheduleStatus(p: PromoRow, today: string): "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif" {
  if (!p.is_active) return "nonaktif";
  if (p.valid_until && p.valid_until < today) return "kadaluarsa";
  if (p.valid_from && p.valid_from > today) return "terjadwal";
  return "aktif";
}
