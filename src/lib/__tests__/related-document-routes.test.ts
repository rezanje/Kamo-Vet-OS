import { expect, it } from 'vitest';
import { relatedDocumentHref, documentBackHref, documentAnchor } from '../related-document-routes';
const id='10000000-0000-4000-8000-000000000001';
const parent='20000000-0000-4000-8000-000000000002';
it('uses actual detail routes and exact row anchors for payment/list documents',()=>{
 expect(relatedDocumentHref('purchase-order',id)).toBe('/pembelian/'+id);
 expect(relatedDocumentHref('goods-receipt',id)).toBe('/pembelian/penerimaan/'+id);
 expect(relatedDocumentHref('purchase-invoice',id)).toBe('/pembelian/faktur/'+id);
 expect(relatedDocumentHref('purchase-payment',id,parent)).toBe('/pembelian/faktur/'+parent+'#payment-'+id);
 expect(relatedDocumentHref('sales-receipt',id,parent)).toBe('/penjualan/faktur/'+parent+'#receipt-'+id);
 expect(relatedDocumentHref('sales-delivery',id)).toBe('/penjualan/pengiriman?delivery='+id+'#delivery-'+id);
 expect(relatedDocumentHref('purchase-advance',id)).toBe('/pembelian/uang-muka#advance-'+id);
 expect(relatedDocumentHref('sales-advance',id)).toBe('/penjualan/uang-muka#advance-'+id);
 expect(relatedDocumentHref('legacy-purchase-payment',id,parent)).toBe('/pembelian/'+parent+'#legacy-payment-'+id);
 expect(relatedDocumentHref('purchase-return',id)).toBe('/pembelian/retur/'+id);
 expect(relatedDocumentHref('payment-order',id)).toBe('/pembelian/perintah-bayar?order='+id+'#payment-order-'+id);
});
it('preserves a safe contextual return path and does not invent a payment detail route',()=>{
 const from='/pembelian/faktur/'+parent+'#payment-'+id;
 const href=relatedDocumentHref('purchase-advance',id,undefined,from)!;
 const u=new URL(href,'http://localhost');
 expect(u.searchParams.get('from')).toBe(from);expect(u.hash).toBe('#advance-'+id);
 expect(documentBackHref(from)).toBe(from);
 expect(relatedDocumentHref('purchase-payment',id)).toBeNull();
});
it('preserves the selected payment order while adding a safe return path',()=>{
 const from='/pembelian/faktur/'+parent+'#payment-'+id;
 const href=relatedDocumentHref('payment-order',id,undefined,from)!;
 const u=new URL(href,'http://localhost');
 expect(u.searchParams.get('order')).toBe(id);
 expect(u.searchParams.get('from')).toBe(from);
 expect(u.hash).toBe('#payment-order-'+id);
});
it.each(['javascript:alert(1)','//evil.example/pembelian/x','/pembelian/faktur/../../pengaturan','/crm/pelanggan','/pembelian/faktur/'+parent+'?replace=1','/pembelian/faktur/'+parent+'#unsafe','https://evil.example','/pembelian/faktur/'+parent+'\n'])('rejects untrusted return locations %s',bad=>expect(documentBackHref(bad)).toBeNull());
it('rejects absent, malformed and injected route identities',()=>{
 for(const bad of ['', '../baru','x?secret=1','not-an-id'])expect(relatedDocumentHref('goods-receipt',bad)).toBeNull();
 expect(documentAnchor('payment',id)).toBe('payment-'+id);
});
it('preserves return-to-retur context when opening its exact purchase order', () => {
 const from='/pembelian/retur/'+id;
 const href=relatedDocumentHref('purchase-order',parent,undefined,from)!;
 expect(new URL(href,'http://localhost').searchParams.get('from')).toBe(from);
 expect(documentBackHref(from)).toBe(from);
 expect(documentBackHref(from+'?next=//untrusted.invalid')).toBeNull();
});
