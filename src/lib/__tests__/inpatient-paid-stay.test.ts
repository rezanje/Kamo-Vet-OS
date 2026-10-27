import { describe, expect, it } from 'vitest';
import { paidStayDays, type InpatientHandoff } from '../inpatient-handoff';

// All IDs are fictional. Payment is never allocated to a day on a DP invoice.
type Data = Pick<InpatientHandoff, 'prescriptions' | 'invoices' | 'invoiceLines' | 'stayIds'>;
function fixture(overrides: Partial<Data> = {}): Data {
  return {
    stayIds: ['stay-a'],
    prescriptions: [
      { id: 'drug', medical_record_id: 'mr', kategori: null, nama_obat: 'Obat fiktif', qty: 2, satuan: 'tablet', jenis: 'obat', aturan_pakai: null, compound_recipe_id: null, created_at: '2026-10-26T09:00:00Z' },
      { id: 'fee', medical_record_id: 'mr', kategori: 'Rawat Inap', nama_obat: 'Rawat inap fiktif', qty: 3, satuan: 'hari', jenis: 'jasa', aturan_pakai: null, compound_recipe_id: null, created_at: '2026-10-26T10:00:00Z' },
    ],
    invoices: [{ id: 'inv', invoice_no: 'INV.FIKTIF', paid_status: 'Lunas', voided_at: null, created_at: '2026-10-26T12:00:00Z' }],
    invoiceLines: [{ id: 'line', invoice_id: 'inv', prescription_item_id: 'fee', compound_recipe_id: null, qty: 3 }],
    ...overrides,
  };
}
const withStatus = (paid_status: string, voided_at: string | null = null) =>
  fixture({ invoices: [{ id: 'inv', invoice_no: 'INV.FIKTIF', paid_status, voided_at, created_at: '2026-10-26T12:00:00Z' }] });

describe('paidStayDays', () => {
  it('counts days from the single stay line on an active fully paid invoice', () => {
    expect(paidStayDays(fixture(), 'stay-a', 5)).toEqual({ kind: 'paid', stayed: 5, paid: 3, remaining: 2, invoiceNo: 'INV.FIKTIF' });
    expect(paidStayDays(fixture(), 'stay-a', 3).remaining).toBe(0);
    expect(paidStayDays(fixture(), 'stay-a', 2).remaining).toBe(0);
  });

  it('shows zero paid days when nothing is billed yet', () => {
    const none = fixture({ prescriptions: fixture().prescriptions.slice(0, 1), invoiceLines: [] });
    expect(paidStayDays(none, 'stay-a', 2)).toEqual({ kind: 'unbilled', stayed: 2, paid: 0, remaining: 2, invoiceNo: null });
    expect(paidStayDays(fixture({ invoiceLines: [] }), 'stay-a', 2).kind).toBe('unbilled');
    expect(paidStayDays(withStatus('Lunas', '2026-10-26T13:00:00Z'), 'stay-a', 2).kind).toBe('unbilled');
  });

  it('never allocates DP or unpaid invoices to days', () => {
    for (const status of ['DP', 'Belum Lunas']) {
      expect(paidStayDays(withStatus(status), 'stay-a', 4)).toEqual({ kind: 'unpaid', stayed: 4, paid: 0, remaining: 4, invoiceNo: 'INV.FIKTIF' });
    }
    expect(paidStayDays(withStatus('Aneh'), 'stay-a', 4).kind).toBe('unverified');
  });

  it('refuses to guess when the stay cannot be bound to one line or the bill does not match', () => {
    expect(paidStayDays(fixture({ stayIds: ['stay-a', 'stay-old'] }), 'stay-a', 4).kind).toBe('unverified');
    expect(paidStayDays(fixture({ stayIds: null }), 'stay-a', 4).kind).toBe('unverified');
    expect(paidStayDays(fixture({ stayIds: ['stay-b'] }), 'stay-a', 4).kind).toBe('unverified');
    const twoFees = fixture({ prescriptions: [...fixture().prescriptions, { ...fixture().prescriptions[1], id: 'fee-2' }] });
    expect(paidStayDays(twoFees, 'stay-a', 4).kind).toBe('unverified');
    expect(paidStayDays(fixture({ invoiceLines: [{ id: 'line', invoice_id: 'inv', prescription_item_id: 'fee', compound_recipe_id: null, qty: 2 }] }), 'stay-a', 4).kind).toBe('unverified');
    expect(paidStayDays(fixture({ invoices: [] }), 'stay-a', 4).kind).toBe('unverified');
    const duplicate = fixture({
      invoices: [...fixture().invoices, { id: 'inv-2', invoice_no: 'INV.2', paid_status: 'Lunas', voided_at: null, created_at: '2026-10-26T13:00:00Z' }],
      invoiceLines: [...fixture().invoiceLines, { id: 'line-2', invoice_id: 'inv-2', prescription_item_id: 'fee', compound_recipe_id: null, qty: 3 }],
    });
    expect(paidStayDays(duplicate, 'stay-a', 4).kind).toBe('unverified');
    const unverified = paidStayDays(fixture({ stayIds: null }), 'stay-a', 4);
    expect(unverified.paid).toBeNull();
    expect(unverified.remaining).toBeNull();
  });
});
