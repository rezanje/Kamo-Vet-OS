// Laporan Owner 7 Nov 2026: membuka Dashboard hanya memunculkan "Application error"
// (galat server). Galat saat menghitung ringkasan keuangan tidak boleh lagi
// menjatuhkan seluruh halaman — halaman tetap tampil dengan keterangannya.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const getDashboard = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dashboard', () => ({ getDashboard }));
vi.mock('@/lib/pending-work', () => ({ loadPendingWork: async () => [] }));
vi.mock('@/components/Charts', () => ({ Donut: () => null, LineChart: () => null, CashFlowChart: () => null }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { role: 'OWNER' }, error: null }) };
  return { auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, from: () => query };
} }));

import Dashboard from '../page';

it('shows the dashboard with an explanation instead of crashing when the finance summary fails', async () => {
  getDashboard.mockRejectedValueOnce(new Error('Data laporan berubah atau terpotong selama pembacaan.'));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Ringkasan keuangan belum dapat dihitung');
  expect(html).toContain('Data laporan berubah atau terpotong');
  expect(html).toContain('href="/?sudut=operasional"');
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
