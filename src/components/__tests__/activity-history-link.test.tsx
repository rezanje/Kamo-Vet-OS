import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ActivityHistoryLink,ActivityNavigationProvider} from '../ActivityHistoryLink';
import {TILES} from '@/lib/nav';
it('offers history for a transaction by its stable identity',()=>{
 const html=renderToStaticMarkup(<ActivityNavigationProvider allowed><ActivityHistoryLink entity="purchase_invoices" id="deleted-object"/></ActivityNavigationProvider>);
 expect(html).toContain('entity=purchase_invoices&amp;object=deleted-object');
 expect(html).toContain('Riwayat aktivitas');
});
it('connects the company activity tile to the general viewer without replacing journal log',()=>{
 expect(TILES.perusahaan.find(t=>t.label==='Log Aktifitas')?.href).toBe('/perusahaan/log-aktifitas');
 expect(TILES['buku-besar'].find(t=>t.label==='Log Aktifitas Jurnal')?.href).toBe('/buku-besar/log');
});

it('hides navigation when existing role/module page access is absent',()=>{
 expect(renderToStaticMarkup(<ActivityNavigationProvider allowed={false}><ActivityHistoryLink entity="items" id="x"/></ActivityNavigationProvider>)).toBe('');
});
