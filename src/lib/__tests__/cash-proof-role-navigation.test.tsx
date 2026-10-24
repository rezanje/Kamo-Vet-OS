import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { NoDok } from '@/components/NoDok';
import { bolehBukaPath } from '@/lib/akses';
it.each([
 ['KM.2026.10.00001','/kas-bank/kas-masuk'],
 ['KK.2026.10.00001','/kas-bank/kas-keluar'],
])('keeps numbered cash proof %s on an existing FINANCE-authorized path', (number,path)=>{
 const html=renderToStaticMarkup(<NoDok nomor={number}/>);
 expect(html).toContain(path);
 expect(html).toContain('bukti=');
 expect(html).not.toContain('/dokumen/');
 expect(bolehBukaPath('FINANCE',path,[])).toBe(true);
 expect(bolehBukaPath('FINANCE','/dokumen/'+number,[])).toBe(false);
});
it('opens a numbered journal on the existing FINANCE-authorized journal screen',()=>{
 const html=renderToStaticMarkup(<NoDok nomor="JRN.2026.10.00001"/>);
 expect(html).toContain('/keuangan/jurnal?nomor=');
 expect(html).not.toContain('/dokumen/');
 expect(bolehBukaPath('FINANCE','/keuangan/jurnal',[])).toBe(true);
});
