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
it('opens a short custom production number only when its saved source identifies production',()=>{
 const saved=renderToStaticMarkup(<NoDok nomor="PROD.01" source="produksi"/>);
 expect(saved).toContain('href="/pos/produksi?nomor=PROD.01#selected-production"');
 expect(renderToStaticMarkup(<NoDok nomor="PROD.01"/>)).not.toContain('href=');
 expect(renderToStaticMarkup(<NoDok nomor="catatan bebas" source="manual"/>)).not.toContain('href=');
});
it('does not send an unrelated PRD-like document to production',()=>{
 const unrelated=renderToStaticMarkup(<NoDok nomor="PRD.2026.10.00001" source="purchase"/>);
 expect(unrelated).toContain('href="/dokumen/PRD.2026.10.00001"');
 expect(unrelated).not.toContain('/pos/produksi');
 const production=renderToStaticMarkup(<NoDok nomor="PRD.2026.10.00001" source="produksi"/>);
 expect(production).toContain('/pos/produksi?nomor=PRD.2026.10.00001');
});
