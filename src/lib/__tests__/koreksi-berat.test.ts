import { describe, expect, it } from 'vitest';
import { batasBeratKoreksi, bacaBeratKoreksi } from '@/lib/koreksi-berat';
describe('batasBeratKoreksi', () => {
  it.each([['Kucing', 15], ['Anjing', 100], ['Kelinci', 10], ['Burung', 5]])('%s batas %i', (spesies, batas) => expect(batasBeratKoreksi(spesies, 1)).toBe(batas));
  it('spesies tanpa batas = tanpa max', () => expect(batasBeratKoreksi('Hamster', 1)).toBeUndefined());
  it('berat tersimpan di atas batas tidak mengunci form', () => expect(batasBeratKoreksi('Kucing', 20)).toBeUndefined());
  it('berat tersimpan tepat di batas tetap memakai batas', () => expect(batasBeratKoreksi('Kucing', 15)).toBe(15));
});
describe('bacaBeratKoreksi', () => {
  it('kolom tidak ada', () => expect(bacaBeratKoreksi(null)).toEqual({ ada: false, nilai: null, valid: true }));
  it('kosong', () => expect(bacaBeratKoreksi('  ')).toEqual({ ada: true, nilai: null, valid: true }));
  it('2,6 -> 1 kg', () => expect(bacaBeratKoreksi('1')).toEqual({ ada: true, nilai: 1, valid: true }));
  it('dua desimal sah', () => expect(bacaBeratKoreksi('1.25').valid).toBe(true));
  it.each(['0', '-2', '1.255', '10000', 'abc'])('%s tidak sah', (v) => expect(bacaBeratKoreksi(v).valid).toBe(false));
});
