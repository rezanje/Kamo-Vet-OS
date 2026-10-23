import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({path:'/pembelian/penerimaan/receipt-id'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path}));
import { ActivityMenuLink } from '../ActivityMenuLink';
import { ActivityNavigationProvider } from '../ActivityHistoryLink';
it('offers registered menu and stable object history on an actual receipt detail route',()=>{
 const html=renderToStaticMarkup(<ActivityNavigationProvider allowed><ActivityMenuLink/></ActivityNavigationProvider>);
 expect(html).toContain('Riwayat aktivitas menu');expect(html).toContain('entity=goods_receipts&amp;object=receipt-id');
});
it('keeps both shortcuts hidden when existing page access is absent',()=>{
 expect(renderToStaticMarkup(<ActivityNavigationProvider allowed={false}><ActivityMenuLink/></ActivityNavigationProvider>)).toBe('');
});
