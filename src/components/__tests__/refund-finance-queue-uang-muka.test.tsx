import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// Antrean refund finance: pengembalian saldo uang muka klinik berbagi antrean yang sama (ambil proses -> catat transfer selesai -> batalkan).
const s = vi.hoisted(() => ({ role: 'FINANCE', active: true, rpc: vi.fn(), advRpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  rpc: (name: string, args: unknown) => name === 'get_clinic_advance_refunds' || /^clinic_advance_refund_/.test(name) ? s.advRpc(name, args) : name === 'get_clinic_refund_requests' ? Promise.resolve({ data: [], error: null }) : s.rpc(name, args),
  from: (table: string) => { const q = { select: () => q, eq: () => q, order: () => q, range: () => q, maybeSingle: async () => ({ data: { role: s.role, is_active: s.active }, error: null }),
    then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: table === 'cash_accounts' ? [{ id: 'bank', nama: 'Bank BCA', branch_id: null }] : [], count: table === 'cash_accounts' ? 1 : 0, error: null }).then(resolve) }; return q; } }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock('@/components/LocalTransactionDraft', () => ({ TransactionForm: ({ children }: React.PropsWithChildren) => <form>{children}</form> }));
vi.mock('@/components/SubmitButton', () => ({ SubmitButton: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(decodeURIComponent(url)); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import Page from '@/app/(app)/kas-bank/refund/page';
import { processRefund } from '@/app/(app)/kas-bank/refund/actions';

const id = '11000000-0000-4000-8000-000000000011';
const row = { id, no_refund: 'RUM-202611-0001', advance_id: '12000000-0000-4000-8000-000000000012', no_uang_muka: 'UMK-202611-0045', visit_id: '13000000-0000-4000-8000-000000000013',
  customer_name: 'Keripik Tempe', branch_id: 'branch', amount: 30000, status: 'pending', reason: 'Dikembalikan sesuai keputusan Andri', destination: { bank: 'BCA', account: '1234567890', name: 'Keripik Tempe' },
  requested_by: 'owner', requested_at: '2026-11-07T01:00:00.000Z', processed_by: null, completed_at: null, tanggal: null, bank_reference: null, journal_id: null };
beforeEach(() => { s.role = 'FINANCE'; s.active = true; s.rpc.mockReset(); s.rpc.mockResolvedValue({ data: [], error: null }); s.advRpc.mockReset(); s.advRpc.mockResolvedValue({ data: [row], error: null }); });

it('lists an advance refund request in the same queue: number, advance, customer, amount, bank destination, explicit claim, journal not posted yet', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('RUM-202611-0001'); expect(html).toContain('UMK-202611-0045'); expect(html).toContain('Keripik Tempe');
  expect(html).toContain('1234567890'); expect(html).toContain('Ambil proses'); expect(html).toContain('30.000');
  expect(html).toContain('/klinik/pembayaran/13000000-0000-4000-8000-000000000013');
  expect(s.advRpc).toHaveBeenCalledWith('get_clinic_advance_refunds', { p_advance: null, p_office: true, p_status: '', p_offset: 0 });
});

it('shows the completion form (date, bank account, reference, transfer confirmation) only to the claimant, and says the journal is posted on completion', async () => {
  s.advRpc.mockResolvedValue({ data: [{ ...row, status: 'diproses', processed_by: 'actor' }], error: null });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('name="reference"'); expect(html).toContain('name="account_id"'); expect(html).toContain('name="payment_confirmed"'); expect(html).toContain('Bank BCA');
  expect(html).toContain('jurnal');
  s.advRpc.mockResolvedValue({ data: [{ ...row, status: 'diproses', processed_by: 'other' }], error: null });
  const other = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(other).not.toContain('name="reference"'); expect(other).toContain('petugas lain');
});

it('keeps the queue usable before the database step (advance RPC missing) and fails visibly for a malformed advance list', async () => {
  s.advRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Antrean refund transfer');
  s.advRpc.mockResolvedValue({ data: [{ ...row, amount: -5 }], error: null });
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/belum dapat/);
});

const form = (operation: string, extra: Record<string, string> = {}) => { const f = new FormData(); f.set('id', id); f.set('kind', 'uang_muka'); f.set('operation', operation); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };
const done = { refund_id: id, no_refund: 'RUM-202611-0001', status: 'selesai', journal_id: '14000000-0000-4000-8000-000000000014' };

it('routes claim / complete / cancel of kind uang_muka to the advance refund RPCs with their own arguments', async () => {
  s.advRpc.mockResolvedValue({ data: { refund_id: id, status: 'diproses' }, error: null });
  await expect(processRefund(form('claim'))).rejects.toThrow(/diambil/);
  expect(s.advRpc).toHaveBeenLastCalledWith('clinic_advance_refund_claim', { p_id: id });
  s.advRpc.mockResolvedValue({ data: done, error: null });
  await expect(processRefund(form('complete', { payment_confirmed: 'yes', tanggal: '2026-11-07', account_id: '50000000-0000-4000-8000-000000000005', reference: 'TRF-BCA-777' }))).rejects.toThrow(/jurnal/);
  expect(s.advRpc).toHaveBeenLastCalledWith('clinic_advance_refund_complete', { p_id: id, p_date: '2026-11-07', p_account: '50000000-0000-4000-8000-000000000005', p_reference: 'TRF-BCA-777' });
  s.advRpc.mockResolvedValue({ data: { refund_id: id, status: 'batal' }, error: null });
  await expect(processRefund(form('cancel', { reason: 'Belum jadi ditransfer', unpaid_confirmed: 'yes' }))).rejects.toThrow(/dibatalkan/);
  expect(s.advRpc).toHaveBeenLastCalledWith('clinic_advance_refund_cancel', { p_id: id, p_reason: 'Belum jadi ditransfer', p_unpaid_confirmed: true });
  expect(s.rpc).not.toHaveBeenCalled();
});

it('refuses recording an unconfirmed transfer and confirms only the exact refund and status (no success for a wrong id, a missing journal or a wrong status)', async () => {
  await expect(processRefund(form('complete', { tanggal: '2026-11-07', account_id: '50000000-0000-4000-8000-000000000005', reference: 'X' }))).rejects.toThrow(/konfirmasi/);
  expect(s.advRpc).not.toHaveBeenCalled();
  const f = () => form('complete', { payment_confirmed: 'yes', tanggal: '2026-11-07', account_id: '50000000-0000-4000-8000-000000000005', reference: 'TRF-1' });
  for (const data of [{ ...done, refund_id: '99000000-0000-4000-8000-000000000099' }, { ...done, journal_id: null }, { ...done, status: 'diproses' }, { ...done, no_refund: '' }, null]) {
    s.advRpc.mockResolvedValue({ data, error: null });
    await expect(processRefund(f())).rejects.toThrow(/belum terkonfirmasi/);
  }
});

it('does not turn a transport error into success or ask for another transfer, and shows a database refusal as is', async () => {
  s.advRpc.mockRejectedValue(Error('offline'));
  await expect(processRefund(form('claim'))).rejects.toThrow(/Jangan transfer ulang/);
  s.advRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'CLAIM_TAKEN: pengembalian ini sedang ditangani petugas lain; jangan transfer ulang' } });
  await expect(processRefund(form('claim'))).rejects.toThrow(/petugas lain/);
});

it.each(['STAFF', 'DOCTOR', 'ADMIN'])('queue page for role %s does not show advance refunds (existing role gate unchanged: only OWNER/ADMIN/FINANCE may open the page; ADMIN sees but the RPC itself refuses)', async (role) => {
  s.role = role;
  if (role === 'ADMIN') { s.advRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ACCESS_DENIED: x' } }); const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })); expect(html).not.toContain('RUM-202611-0001'); return; }
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/Akses/);
  expect(s.advRpc).not.toHaveBeenCalled();
});
