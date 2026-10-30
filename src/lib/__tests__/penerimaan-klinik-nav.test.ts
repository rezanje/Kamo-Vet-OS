import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TILES } from '../nav';

it('Persediaan menyediakan Penerimaan Barang Klinik ke halaman penerimaan yang sudah ada', () => {
  const tiles = TILES.pos.filter(tile => tile.href === '/klinik/penerimaan');
  expect(tiles).toHaveLength(1);
  expect(tiles[0].label).toBe('Penerimaan Barang Klinik');
  expect(tiles[0].p2).not.toBe(true);
  expect(existsSync(join(process.cwd(), 'src/app/(app)/klinik/penerimaan/page.tsx'))).toBe(true);
});

it('Penerimaan Barang dari pemasok tetap di modul Pembelian', () => {
  expect(TILES.pembelian.some(tile => tile.href === '/pembelian/penerimaan')).toBe(true);
});
