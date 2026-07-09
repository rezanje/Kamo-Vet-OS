// Notifikasi pusat (promo/target/system) ke kasir. notificationActiveFor = satu-satunya
// sumber kebenaran "tampil untuk cabang X" — sama pola dengan promoActiveFor.
export type NotificationRow = {
  id: string;
  title: string;
  message: string;
  type: "promo" | "target" | "system";
  is_active: boolean;
  branch_ids: string[] | null; // null / kosong = semua cabang
};

export function notificationActiveFor(n: NotificationRow, branchId: string): boolean {
  if (!n.is_active) return false;
  if (n.branch_ids && n.branch_ids.length > 0 && !n.branch_ids.includes(branchId)) return false;
  return true;
}
