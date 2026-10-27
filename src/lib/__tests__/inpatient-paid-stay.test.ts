import { describe, expect, it } from 'vitest';
import { paidInpatientStay, type InpatientHandoff } from '../inpatient-handoff';

// All IDs and amounts are fictional. Payment is never allocated to a day on a DP invoice.
const stay = '11111111-1111-4111-8111-111111111111';
const anotherStay = '22222222-2222-4222-8222-222222222222';
function fixture(overrides: Partial<InpatientHandoff> = {}): InpatientHandoff {
  return {
    doctor: null, complaint: null, records: [], recipes: [], evidence: [],
    prescriptions: [
      { id: 'service-a', medical_record_id: 'record-a', inpatient_record_id: stay, kategori: 'Rawat Inap', nama_obat: 'Perawatan Fiktif', qty: 3, satuan: 'hari', jenis: 'jasa', aturan_pakai: null, compound_recipe_id: null, created_at: '2026-10-26T10:00:00Z' },
      { id: 'service-b', medical_record_id: 'record-b', inpatient_record_id: anotherStay, kategori: 'Rawat Inap', nama_obat: 'Perawatan Fiktif', qty: 2, satuan: 'hari', jenis: 'jasa', aturan_pakai: null, compound_recipe_id: null, created_at: '2026-10-26T11:00:00Z' },
    ],
    invoices: [{ id: 'invoice-a', invoice_no: 'INV.FIKTIF', paid_status: 'Lunas', voided_at: null, created_at: '2026-10-26T12:00:00Z' }],
    invoiceLines: [{ id: 'line-a', invoice_id: 'invoice-a', prescription_item_id: 'service-a', compound_recipe_id: null, qty: 3 }],
    ...overrides,
  };
}

describe('paidInpatientStay', () => {
  it('shows only days from the exact stay source line on an active paid invoice', () => {
    expect(paidInpatientStay(fixture(), stay)).toEqual({ kind: 'paid', days: 3, invoiceNo: 'INV.FIKTIF' });
    expect(paidInpatientStay(fixture(), anotherStay)).toEqual({ kind: 'unbilled', days: null, invoiceNo: null });
  });

  it('does not allocate a deposit, unpaid invoice, or void invoice to stay days', () => {
    for (const paidStatus of ['DP', 'Belum Lunas']) {
      const data = fixture({ invoices: [{ id: 'invoice-a', invoice_no: 'INV.FIKTIF', paid_status: paidStatus, voided_at: null, created_at: '2026-10-26T12:00:00Z' }] });
      expect(paidInpatientStay(data, stay)).toEqual({ kind: 'unallocated', days: null, invoiceNo: 'INV.FIKTIF' });
    }
    const voided = fixture({ invoices: [{ id: 'invoice-a', invoice_no: 'INV.FIKTIF', paid_status: 'Lunas', voided_at: '2026-10-26T13:00:00Z', created_at: '2026-10-26T12:00:00Z' }] });
    expect(paidInpatientStay(voided, stay)).toEqual({ kind: 'unbilled', days: null, invoiceNo: null });
  });

  it('rejects inconsistent qty, duplicate active links, and an unknown invoice', () => {
    const inconsistent = fixture({ invoiceLines: [{ id: 'line-a', invoice_id: 'invoice-a', prescription_item_id: 'service-a', compound_recipe_id: null, qty: 5 }] });
    expect(paidInpatientStay(inconsistent, stay).kind).toBe('unverified');
    const duplicate = fixture({ invoiceLines: [...fixture().invoiceLines, { id: 'line-b', invoice_id: 'invoice-a', prescription_item_id: 'service-a', compound_recipe_id: null, qty: 3 }] });
    expect(paidInpatientStay(duplicate, stay).kind).toBe('unverified');
    const unknown = fixture({ invoices: [] });
    expect(paidInpatientStay(unknown, stay).kind).toBe('unverified');
  });

  it('never guesses a stay from a matching service name or an old unlinked prescription', () => {
    const historical = fixture({ prescriptions: fixture().prescriptions.map(row => ({ ...row, inpatient_record_id: null })) });
    expect(paidInpatientStay(historical, stay)).toEqual({ kind: 'unverified', days: null, invoiceNo: null });
    const unrelated = fixture({ prescriptions: [{ ...fixture().prescriptions[0], kategori: 'Grooming' }] });
    expect(paidInpatientStay(unrelated, stay).kind).toBe('unverified');
  });
});
