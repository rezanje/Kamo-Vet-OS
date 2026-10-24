// Existing application routes only. Payments have no standalone detail route:
// open their exact stored row within the invoice instead of inventing one.
export type DocumentKind = 'purchase-return' | 'legacy-purchase-payment' | 'purchase-order' | 'goods-receipt' | 'purchase-invoice' | 'purchase-payment' | 'purchase-advance' | 'payment-order' | 'sales-invoice' | 'sales-receipt' | 'sales-delivery' | 'sales-advance';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_PATH = /^\/(?:pembelian\/(?:faktur\/|penerimaan\/|retur\/)?|penjualan\/(?:faktur\/|retur\/)?)([0-9a-f-]+)(?:#(?:payment|receipt|legacy-payment)-([0-9a-f-]+))?$/i;
export function documentBackHref(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim() !== input) return null;
  const match = input.match(RETURN_PATH);
  return match && UUID.test(match[1]) && (!match[2] || UUID.test(match[2])) ? input : null;
}
export function documentAnchor(kind: 'payment' | 'receipt' | 'delivery' | 'advance' | 'payment-order' | 'legacy-payment', id: string): string | undefined {
  return UUID.test(id) ? `${kind}-${id}` : undefined;
}
export function relatedDocumentHref(kind: DocumentKind, id: string, parentId?: string, from?: string): string | null {
  if (!UUID.test(id)) return null;
  let path: string;
  switch (kind) {
    case 'purchase-order': path = `/pembelian/${id}`; break;
    case 'legacy-purchase-payment':
      if (!parentId || !UUID.test(parentId)) return null;
      path = `/pembelian/${parentId}#legacy-payment-${id}`; break;
    case 'purchase-return': path = `/pembelian/retur/${id}`; break;
    case 'goods-receipt': path = `/pembelian/penerimaan/${id}`; break;
    case 'purchase-invoice': path = `/pembelian/faktur/${id}`; break;
    case 'sales-invoice': path = `/penjualan/faktur/${id}`; break;
    case 'sales-delivery': path = `/penjualan/pengiriman?delivery=${id}#delivery-${id}`; break;
    case 'purchase-payment':
    case 'sales-receipt':
      if (!parentId || !UUID.test(parentId)) return null;
      path = kind === 'purchase-payment' ? `/pembelian/faktur/${parentId}#payment-${id}` : `/penjualan/faktur/${parentId}#receipt-${id}`;
      break;
    case 'purchase-advance': path = `/pembelian/uang-muka#advance-${id}`; break;
    case 'sales-advance': path = `/penjualan/uang-muka#advance-${id}`; break;
    case 'payment-order': path = `/pembelian/perintah-bayar?order=${id}#payment-order-${id}`; break;
  }
  const back = documentBackHref(from);
  if (!back) return path;
  const [pathname, hash] = path.split('#');
  return `${pathname}${pathname.includes('?') ? '&' : '?'}${new URLSearchParams({ from: back })}${hash ? '#'+hash : ''}`;
}
export function relatedDocumentStatus(status: string): string {
  const labels: Record<string, string> = { aktif: 'Aktif', batal: 'Dibatalkan', berjalan: 'Berjalan', lunas: 'Lunas', draft: 'Draft', disetujui: 'Disetujui', dibayar: 'Dibayar', diproses: 'Diproses', selesai: 'Selesai' };
  return labels[status] ?? status;
}
