// Diff invoice lama vs baru untuk audit log (Addendum §7) — server yang men-generate log,
// jangan pernah percaya client untuk menulis entry sendiri.

export type InvoiceSnapshot = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid_status: string;
  metode_bayar: string;
  items: { deskripsi: string; qty: number; harga: number }[];
};

export type InvoiceDiff = { field_changed: string; old_value: string; new_value: string };

const FIELDS = ["subtotal", "discount", "tax", "total", "paid_status", "metode_bayar"] as const;

function serializeItems(items: InvoiceSnapshot["items"]): string {
  return items.map((i) => `${i.deskripsi} x${i.qty} @${i.harga}`).join("; ");
}

export function diffInvoice(oldInv: InvoiceSnapshot, newInv: InvoiceSnapshot): InvoiceDiff[] {
  const out: InvoiceDiff[] = [];
  for (const f of FIELDS) {
    if (String(oldInv[f]) !== String(newInv[f])) {
      out.push({ field_changed: f, old_value: String(oldInv[f]), new_value: String(newInv[f]) });
    }
  }
  const oldItems = serializeItems(oldInv.items);
  const newItems = serializeItems(newInv.items);
  if (oldItems !== newItems) out.push({ field_changed: "items", old_value: oldItems, new_value: newItems });
  return out;
}

// Field yang menyentuh angka tagihan → wajib alasan (spec §7: reason disarankan wajib utk total/item).
export function requiresReason(diffs: InvoiceDiff[]): boolean {
  return diffs.some((d) => ["subtotal", "discount", "tax", "total", "items"].includes(d.field_changed));
}
