import { expect, it } from 'vitest';
import { TILES } from '../nav';
import { bacaFilterFaktur } from '../faktur-gabungan-server';

it('Penerimaan Penjualan membuka daftar Belum lunas tanpa batas tanggal', () => {
  const tile = TILES.penjualan.find(t => t.label === 'Penerimaan Penjualan');
  expect(tile?.href).toBe('/penjualan/faktur?status=belum');
  const url = new URL(tile!.href!, 'http://x');
  const filter = bacaFilterFaktur(Object.fromEntries(url.searchParams), '2026-11-01');
  // Di tanggal 1 rentang bawaan hanya satu hari; status Belum lunas mengabaikan rentang itu.
  expect(filter.status).toBe('belum');
});

it('Faktur Penjualan tetap membuka daftar penuh bulan berjalan', () => {
  expect(TILES.penjualan.find(t => t.label === 'Faktur Penjualan')?.href).toBe('/penjualan/faktur');
});
