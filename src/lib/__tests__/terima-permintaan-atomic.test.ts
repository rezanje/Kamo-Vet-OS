import { describe, expect, it, vi } from 'vitest';
import { prosesTerimaPermintaan } from '../terima-permintaan';

it.each([{}, {receipt_number: "", selisih: 0}, {receipt_number: "TRM-1"}, {receipt_number: "TRM-1", selisih: null}, {receipt_number: "TRM-1", selisih: ""}, {receipt_number: "TRM-1", selisih: "bad"}, {receipt_number: "TRM-1", selisih: false}, {receipt_number: "TRM-1", selisih: [1]}])('does not confirm an incomplete receipt response %j', async data => {
  const result = await prosesTerimaPermintaan({rpc: vi.fn().mockResolvedValue({data, error: null})}, {requestId: 'r', branchId: 'b', receivedBy: 'actor', rows: [{id: 'line', item_id: null, qty_diterima: 1, kondisi: 'baik'}]});
  expect(result.ok).toBe(false);
});

it.each([-2, "-2.5", 0])('accepts a confirmed signed receipt difference %j', async selisih => {
  const result = await prosesTerimaPermintaan({rpc: vi.fn().mockResolvedValue({data: [{receipt_number: "TRM-1", selisih}], error: null})}, {requestId: 'r', branchId: 'b', receivedBy: 'actor', rows: [{id: 'line', item_id: null, qty_diterima: 1, kondisi: 'baik'}]});
  expect(result).toEqual({ok: true, receiptNumber: "TRM-1", selisih: Number(selisih)});
});

describe('atomic request receipt', () => {
  it('submits all lines in one RPC and never writes individual stock/doc rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ receipt_number: 'TRM-test', selisih: 0 }], error: null });
    const from = vi.fn(() => { throw new Error('individual write forbidden'); });
    const result = await prosesTerimaPermintaan({ rpc, from }, { requestId: 'request', branchId: 'branch', receivedBy: 'actor', rows: [{ id: 'line', item_id: 'untrusted-item', qty_diterima: 2, kondisi: 'baik' }] });
    expect(result).toEqual({ ok: true, receiptNumber: 'TRM-test', selisih: 0 });
    expect(rpc).toHaveBeenCalledWith('receive_stock_request_atomic', expect.objectContaining({ p_request_id: 'request', p_branch_id: 'branch', p_rows: [{ id: 'line', qty_diterima: 2, kondisi: 'baik', notes: '' }] }));
    expect(from).not.toHaveBeenCalled();
  });
  it('returns database errors without follow-up writes', async () => {
    const result = await prosesTerimaPermintaan({ rpc: vi.fn().mockResolvedValue({ error: { message: 'stok kurang' } }) }, { requestId: 'r', branchId: 'b', receivedBy: null, rows: [{ id: 'l', item_id: null, qty_diterima: 1, kondisi: 'baik' }] });
    expect(result).toEqual({ ok: false, error: 'stok kurang' });
  });
});
